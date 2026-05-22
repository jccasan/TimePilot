import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, timestamp, jsonb, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// ─── CRM Contacts ────────────────────────────────────────────
export const crmContacts = pgTable("crm_contacts", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull(),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  email: text("email").notNull(),
  phone: text("phone"),
  company: text("company"),
  title: text("title"),
  status: text("status").notNull().default("active"),
  source: text("source").default("manual"),
  leadScore: integer("lead_score").default(0),
  assignedTo: text("assigned_to"),
  tags: text("tags")
    .array()
    .default(sql`'{}'::text[]`),
  customFields: jsonb("custom_fields").default({}),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertCrmContactSchema = createInsertSchema(crmContacts).omit({
  id: true,
  companyId: true,
  createdAt: true,
});
export type InsertCrmContact = z.infer<typeof insertCrmContactSchema>;
export type CrmContact = typeof crmContacts.$inferSelect;

// ─── CRM Companies ───────────────────────────────────────────
export const crmCompanies = pgTable("crm_companies", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull(),
  name: text("name").notNull(),
  domain: text("domain"),
  industry: text("industry"),
  size: text("size"),
  status: text("status").notNull().default("active"),
  customFields: jsonb("custom_fields").default({}),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertCrmCompanySchema = createInsertSchema(crmCompanies).omit({
  id: true,
  companyId: true,
  createdAt: true,
});
export type InsertCrmCompany = z.infer<typeof insertCrmCompanySchema>;
export type CrmCompany = typeof crmCompanies.$inferSelect;

// ─── CRM Deals ───────────────────────────────────────────────
export const crmDeals = pgTable("crm_deals", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull(),
  title: text("title").notNull(),
  value: integer("value").default(0),
  currency: text("currency").notNull().default("USD"),
  stage: text("stage").notNull().default("lead"),
  probability: integer("probability").default(0),
  expectedCloseDate: timestamp("expected_close_date"),
  description: text("description"),
  contactId: varchar("contact_id"),
  crmCompanyId: varchar("crm_company_id"),
  assignedTo: text("assigned_to"),
  status: text("status").notNull().default("open"),
  customFields: jsonb("custom_fields").default({}),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertCrmDealSchema = createInsertSchema(crmDeals)
  .omit({ id: true, companyId: true, createdAt: true })
  .extend({
    expectedCloseDate: z.coerce.date().optional().nullable(),
  });
export type InsertCrmDeal = z.infer<typeof insertCrmDealSchema>;
export type CrmDeal = typeof crmDeals.$inferSelect;

// ─── CRM Tasks ───────────────────────────────────────────────
export const crmTasks = pgTable("crm_tasks", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  type: text("type").notNull().default("todo"),
  priority: text("priority").notNull().default("medium"),
  status: text("status").notNull().default("pending"),
  dueDate: timestamp("due_date"),
  assignedTo: text("assigned_to"),
  contactId: varchar("contact_id"),
  dealId: varchar("deal_id"),
  crmCompanyId: varchar("crm_company_id"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertCrmTaskSchema = createInsertSchema(crmTasks)
  .omit({ id: true, companyId: true, completedAt: true, createdAt: true })
  .extend({
    dueDate: z.coerce.date().optional().nullable(),
  });
export type InsertCrmTask = z.infer<typeof insertCrmTaskSchema>;
export type CrmTask = typeof crmTasks.$inferSelect;

// ─── CRM Activities ──────────────────────────────────────────
export const crmActivities = pgTable("crm_activities", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull(),
  type: text("type").notNull(),
  description: text("description").notNull(),
  contactId: varchar("contact_id"),
  dealId: varchar("deal_id"),
  crmCompanyId: varchar("crm_company_id"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertCrmActivitySchema = createInsertSchema(crmActivities).omit({
  id: true,
  companyId: true,
  createdAt: true,
});
export type InsertCrmActivity = z.infer<typeof insertCrmActivitySchema>;
export type CrmActivity = typeof crmActivities.$inferSelect;

// ─── CRM Notes ───────────────────────────────────────────────
export const crmNotes = pgTable("crm_notes", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull(),
  content: text("content").notNull(),
  body: text("body"),
  contactId: varchar("contact_id"),
  dealId: varchar("deal_id"),
  crmCompanyId: varchar("crm_company_id"),
  authorId: varchar("author_id"),
  pinned: boolean("pinned").default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertCrmNoteSchema = createInsertSchema(crmNotes).omit({
  id: true,
  companyId: true,
  createdAt: true,
});
export type InsertCrmNote = z.infer<typeof insertCrmNoteSchema>;
export type CrmNote = typeof crmNotes.$inferSelect;

// ─── CRM Emails ──────────────────────────────────────────────
export const crmEmails = pgTable("crm_emails", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull(),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  fromAddress: text("from_address").notNull(),
  toAddress: text("to_address").notNull(),
  direction: text("direction").notNull().default("outbound"),
  status: text("status").notNull().default("sent"),
  contactId: varchar("contact_id"),
  dealId: varchar("deal_id"),
  threadId: varchar("thread_id"),
  sentAt: timestamp("sent_at").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertCrmEmailSchema = createInsertSchema(crmEmails).omit({
  id: true,
  companyId: true,
  sentAt: true,
  createdAt: true,
});
export type InsertCrmEmail = z.infer<typeof insertCrmEmailSchema>;
export type CrmEmail = typeof crmEmails.$inferSelect;

// ─── CRM Documents ───────────────────────────────────────────
export const crmDocuments = pgTable("crm_documents", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull(),
  name: text("name").notNull(),
  type: text("type").notNull().default("other"),
  url: text("url").notNull(),
  mimeType: text("mime_type"),
  sizeBytes: integer("size_bytes"),
  size: integer("size").default(0),
  contactId: varchar("contact_id"),
  dealId: varchar("deal_id"),
  crmCompanyId: varchar("crm_company_id"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertCrmDocumentSchema = createInsertSchema(crmDocuments).omit({
  id: true,
  companyId: true,
  createdAt: true,
});
export type InsertCrmDocument = z.infer<typeof insertCrmDocumentSchema>;
export type CrmDocument = typeof crmDocuments.$inferSelect;

// ─── CRM Web Forms ───────────────────────────────────────────
export const crmWebForms = pgTable("crm_web_forms", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull(),
  name: text("name").notNull(),
  fields: jsonb("fields").notNull().default([]),
  submitAction: text("submit_action").default("create_contact"),
  redirectUrl: text("redirect_url"),
  active: boolean("active").notNull().default(true),
  submissionCount: integer("submission_count").default(0),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertCrmWebFormSchema = createInsertSchema(crmWebForms).omit({
  id: true,
  companyId: true,
  createdAt: true,
});
export type InsertCrmWebForm = z.infer<typeof insertCrmWebFormSchema>;
export type CrmWebForm = typeof crmWebForms.$inferSelect;

export const crmFormSubmissions = pgTable("crm_form_submissions", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull(),
  formId: varchar("form_id").notNull(),
  data: jsonb("data").notNull().default({}),
  ipAddress: text("ip_address"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertCrmFormSubmissionSchema = createInsertSchema(crmFormSubmissions).omit({
  id: true,
  companyId: true,
  createdAt: true,
});
export type InsertCrmFormSubmission = z.infer<typeof insertCrmFormSubmissionSchema>;
export type CrmFormSubmission = typeof crmFormSubmissions.$inferSelect;

// ─── CRM Quotes ──────────────────────────────────────────────
export const crmQuotes = pgTable("crm_quotes", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull(),
  title: text("title").notNull(),
  dealId: varchar("deal_id"),
  contactId: varchar("contact_id"),
  crmCompanyId: varchar("crm_company_id"),
  items: jsonb("items").notNull().default([]),
  subtotal: integer("subtotal").default(0),
  taxRate: integer("tax_rate").default(0),
  total: integer("total").default(0),
  currency: text("currency").notNull().default("USD"),
  status: text("status").notNull().default("draft"),
  validUntil: timestamp("valid_until"),
  signatureToken: varchar("signature_token").unique(),
  signedAt: timestamp("signed_at"),
  signedByName: text("signed_by_name"),
  signedByEmail: text("signed_by_email"),
  signatureData: text("signature_data"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertCrmQuoteSchema = createInsertSchema(crmQuotes)
  .omit({
    id: true,
    companyId: true,
    createdAt: true,
    signatureToken: true,
    signedAt: true,
    signedByName: true,
    signedByEmail: true,
    signatureData: true,
  })
  .extend({ validUntil: z.coerce.date().optional().nullable() });
export type InsertCrmQuote = z.infer<typeof insertCrmQuoteSchema>;
export type CrmQuote = typeof crmQuotes.$inferSelect;

// ─── CRM Projects ────────────────────────────────────────────
export const crmProjects = pgTable("crm_projects", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  status: text("status").notNull().default("active"),
  contactId: varchar("contact_id"),
  crmCompanyId: varchar("crm_company_id"),
  dealId: varchar("deal_id"),
  startDate: timestamp("start_date"),
  endDate: timestamp("end_date"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertCrmProjectSchema = createInsertSchema(crmProjects)
  .omit({ id: true, companyId: true, createdAt: true })
  .extend({
    startDate: z.coerce.date().optional().nullable(),
    endDate: z.coerce.date().optional().nullable(),
  });
export type InsertCrmProject = z.infer<typeof insertCrmProjectSchema>;
export type CrmProject = typeof crmProjects.$inferSelect;

export const crmProjectTasks = pgTable("crm_project_tasks", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull(),
  projectId: varchar("project_id").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  completed: boolean("completed").default(false),
  stepNumber: integer("step_number"),
  status: text("status").notNull().default("pending"),
  assignedTo: text("assigned_to"),
  dueDate: timestamp("due_date"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertCrmProjectTaskSchema = createInsertSchema(crmProjectTasks)
  .omit({ id: true, companyId: true, createdAt: true })
  .extend({
    dueDate: z.coerce.date().optional().nullable(),
  });
export type InsertCrmProjectTask = z.infer<typeof insertCrmProjectTaskSchema>;
export type CrmProjectTask = typeof crmProjectTasks.$inferSelect;

// ─── CRM Email Campaigns ─────────────────────────────────────
export const crmEmailCampaigns = pgTable("crm_email_campaigns", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull(),
  name: text("name").notNull(),
  type: text("type"),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  bodyHtml: text("body_html"),
  bodyText: text("body_text"),
  fromEmail: text("from_email"),
  fromName: text("from_name"),
  segmentRules: jsonb("segment_rules").default({}),
  status: text("status").notNull().default("draft"),
  scheduledAt: timestamp("scheduled_at"),
  sentAt: timestamp("sent_at"),
  sentCount: integer("sent_count").default(0),
  openCount: integer("open_count").default(0),
  clickCount: integer("click_count").default(0),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertCrmEmailCampaignSchema = createInsertSchema(crmEmailCampaigns).omit({
  id: true,
  companyId: true,
  sentAt: true,
  createdAt: true,
});
export type InsertCrmEmailCampaign = z.infer<typeof insertCrmEmailCampaignSchema>;
export type CrmEmailCampaign = typeof crmEmailCampaigns.$inferSelect;

export const crmCampaignRecipients = pgTable("crm_campaign_recipients", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull(),
  campaignId: varchar("campaign_id").notNull(),
  contactId: varchar("contact_id").notNull(),
  status: text("status").notNull().default("pending"),
  openedAt: timestamp("opened_at"),
  clickedAt: timestamp("clicked_at"),
  trackingToken: text("tracking_token"),
});

export const insertCrmCampaignRecipientSchema = createInsertSchema(crmCampaignRecipients).omit({
  id: true,
  companyId: true,
  openedAt: true,
  clickedAt: true,
});
export type InsertCrmCampaignRecipient = z.infer<typeof insertCrmCampaignRecipientSchema>;
export type CrmCampaignRecipient = typeof crmCampaignRecipients.$inferSelect;

// ─── CRM Automations ─────────────────────────────────────────
export const crmAutomations = pgTable("crm_automations", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  triggerType: text("trigger_type"),
  triggerConditions: jsonb("trigger_conditions").default({}),
  trigger: text("trigger").notNull(),
  conditions: jsonb("conditions").default({}),
  actions: jsonb("actions").default([]),
  active: boolean("active").notNull().default(true),
  runCount: integer("run_count").default(0),
  lastRunAt: timestamp("last_run_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertCrmAutomationSchema = createInsertSchema(crmAutomations).omit({
  id: true,
  companyId: true,
  createdAt: true,
});
export type InsertCrmAutomation = z.infer<typeof insertCrmAutomationSchema>;
export type CrmAutomation = typeof crmAutomations.$inferSelect;

// ─── CRM Audit Logs ──────────────────────────────────────────
export const crmAuditLogs = pgTable("crm_audit_logs", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull(),
  action: text("action").notNull(),
  entity: text("entity").notNull(),
  entityId: varchar("entity_id"),
  changes: jsonb("changes").default({}),
  details: jsonb("details").default({}),
  userId: text("user_id"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertCrmAuditLogSchema = createInsertSchema(crmAuditLogs).omit({
  id: true,
  companyId: true,
  createdAt: true,
});
export type InsertCrmAuditLog = z.infer<typeof insertCrmAuditLogSchema>;
export type CrmAuditLog = typeof crmAuditLogs.$inferSelect;

// ─── CRM Sequences ───────────────────────────────────────────
export const crmSequences = pgTable("crm_sequences", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  active: boolean("active").default(true),
  status: text("status").notNull().default("draft"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertCrmSequenceSchema = createInsertSchema(crmSequences).omit({
  id: true,
  companyId: true,
  createdAt: true,
});
export type InsertCrmSequence = z.infer<typeof insertCrmSequenceSchema>;
export type CrmSequence = typeof crmSequences.$inferSelect;

export const crmSequenceSteps = pgTable("crm_sequence_steps", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull(),
  sequenceId: varchar("sequence_id").notNull(),
  stepNumber: integer("step_number").notNull().default(1),
  type: text("type").notNull().default("email"),
  subject: text("subject"),
  body: text("body"),
  delayDays: integer("delay_days").notNull().default(0),
  delayHours: integer("delay_hours").default(0),
  emailSubject: text("email_subject"),
  emailBody: text("email_body"),
  taskTitle: text("task_title"),
  taskType: text("task_type").default("call"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertCrmSequenceStepSchema = createInsertSchema(crmSequenceSteps).omit({
  id: true,
  companyId: true,
  createdAt: true,
});
export type InsertCrmSequenceStep = z.infer<typeof insertCrmSequenceStepSchema>;
export type CrmSequenceStep = typeof crmSequenceSteps.$inferSelect;

export const crmSequenceEnrollments = pgTable("crm_sequence_enrollments", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  sequenceId: varchar("sequence_id").notNull(),
  contactId: varchar("contact_id").notNull(),
  companyId: varchar("company_id").notNull(),
  status: text("status").notNull().default("active"),
  currentStep: integer("current_step").notNull().default(0),
  nextRunAt: timestamp("next_run_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertCrmSequenceEnrollmentSchema = createInsertSchema(crmSequenceEnrollments).omit({
  id: true,
  createdAt: true,
});
export type InsertCrmSequenceEnrollment = z.infer<typeof insertCrmSequenceEnrollmentSchema>;
export type CrmSequenceEnrollment = typeof crmSequenceEnrollments.$inferSelect;

// ─── CRM Lead Scoring Rules ──────────────────────────────────
export const crmLeadScoringRules = pgTable("crm_lead_scoring_rules", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull(),
  name: text("name").notNull(),
  field: text("field").notNull(),
  operator: text("operator").notNull(),
  value: text("value").notNull(),
  score: integer("score").notNull().default(0),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertCrmLeadScoringRuleSchema = createInsertSchema(crmLeadScoringRules).omit({
  id: true,
  companyId: true,
  createdAt: true,
});
export type InsertCrmLeadScoringRule = z.infer<typeof insertCrmLeadScoringRuleSchema>;
export type CrmLeadScoringRule = typeof crmLeadScoringRules.$inferSelect;

// ─── CRM Notifications ───────────────────────────────────────
export const crmNotifications = pgTable("crm_notifications", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull(),
  userId: varchar("user_id"),
  type: text("type").notNull().default("info"),
  title: text("title").notNull(),
  body: text("body"),
  entityType: text("entity_type"),
  entityId: varchar("entity_id"),
  read: boolean("read").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertCrmNotificationSchema = createInsertSchema(crmNotifications).omit({
  id: true,
  companyId: true,
  createdAt: true,
});
export type InsertCrmNotification = z.infer<typeof insertCrmNotificationSchema>;
export type CrmNotification = typeof crmNotifications.$inferSelect;

// ─── CRM Webhooks ─────────────────────────────────────────────
export const crmWebhooks = pgTable("crm_webhooks", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").notNull(),
  name: text("name").notNull(),
  url: text("url").notNull(),
  secret: text("secret"),
  events: text("events")
    .array()
    .default(sql`'{}'::text[]`),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertCrmWebhookSchema = createInsertSchema(crmWebhooks).omit({
  id: true,
  companyId: true,
  createdAt: true,
});
export type InsertCrmWebhook = z.infer<typeof insertCrmWebhookSchema>;
export type CrmWebhook = typeof crmWebhooks.$inferSelect;

// ─── CRM Webhook Deliveries ───────────────────────────────────
export const crmWebhookDeliveries = pgTable("crm_webhook_deliveries", {
  id: varchar("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  webhookId: varchar("webhook_id").notNull(),
  event: text("event").notNull(),
  payload: jsonb("payload").default({}),
  status: text("status").notNull().default("pending"),
  responseStatus: integer("response_status"),
  responseBody: text("response_body"),
  attempts: integer("attempts").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertCrmWebhookDeliverySchema = createInsertSchema(crmWebhookDeliveries).omit({
  id: true,
  createdAt: true,
});
export type InsertCrmWebhookDelivery = z.infer<typeof insertCrmWebhookDeliverySchema>;
export type CrmWebhookDelivery = typeof crmWebhookDeliveries.$inferSelect;

// ─── Shared Paginated Result type ────────────────────────────
export interface CrmPaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  totalPages: number;
}
