import {
  eq,
  and,
  desc,
  asc,
  sql,
  ilike,
  or,
  gte,
  lte,
  lt,
  inArray,
  count,
  isNull,
  isNotNull,
} from "drizzle-orm";
import { db } from "./db";
import {
  companies,
  companyUsers,
  users,
  contacts,
  tags,
  contactTags,
  leadSources,
  properties,
  routes,
  servicePlans,
  vacationHolds,
  agreements,
  jobs,
  jobAddOns,
  visits,
  invoices,
  invoiceLineItems,
  automationRules,
  automationEventLogs,
  apiKeys,
  webhooks,
  webhookDeliveries,
  attachments,
  servicePricing,
  serviceBillingRules,
  servicePackages,
  messages,
  portalSessions,
  adminNotes,
  smsMessages,
  emailsSent,
  accountDailyMetrics,
  saasCostsMonthly,
  costConfig,
  usageEvents,
  notifications,
  timeEntries,
  activityLog,
  auditTrail,
  importRuns,
  importBatches,
  importRows,
  importMappings,
  importRuleSuggestions,
  invoicePayments,
  estimates,
  serviceChangeRequests,
  DEFAULT_PRICING_RULES,
  type Company,
  type InsertCompany,
  type CompanyUser,
  type InsertCompanyUser,
  type Contact,
  type InsertContact,
  type Tag,
  type InsertTag,
  type LeadSource,
  type InsertLeadSource,
  type Property,
  type InsertProperty,
  type Route,
  type InsertRoute,
  type Agreement,
  type InsertAgreement,
  type Job,
  type InsertJob,
  type JobAddOn,
  type JobWithAgreement,
  type ServicePlan,
  type InsertServicePlan,
  type ServicePlanAddOn,
  servicePlanAddOns,
  type VacationHold,
  type InsertVacationHold,
  type Visit,
  type InsertVisit,
  type Invoice,
  type InsertInvoice,
  type InvoiceLineItem,
  type InsertInvoiceLineItem,
  type AutomationRule,
  type InsertAutomationRule,
  type ApiKey,
  type InsertApiKey,
  type Webhook,
  type InsertWebhook,
  type Attachment,
  type InsertAttachment,
  type ServicePricingItem,
  type InsertServicePricing,
  type ServiceBillingRule,
  type InsertServiceBillingRule,
  type ServicePackage,
  type InsertServicePackage,
  type Message,
  type InsertMessage,
  type AdminNote,
  type InsertAdminNote,
  type Notification,
  type InsertNotification,
  type PortalSession,
  type InsertPortalSession,
  type SmsMessage,
  type InsertSmsMessage,
  type EmailSent,
  type InsertEmailSent,
  type AccountDailyMetric,
  type InsertAccountDailyMetric,
  type SaasCostMonthly,
  type InsertSaasCostMonthly,
  type CostConfigItem,
  type TimeEntry,
  type InsertTimeEntry,
  type ActivityLog,
  type InsertActivityLog,
  type WebhookDelivery,
  type InsertWebhookDelivery,
  type AuditTrail,
  type InsertAuditTrail,
  type ImportRun,
  type InsertImportRun,
  type ImportBatch,
  type InsertImportBatch,
  type ImportRow,
  type InsertImportRow,
  type ImportMapping,
  type InsertImportMapping,
  type ImportRuleSuggestion,
  type InsertImportRuleSuggestion,
  type InvoicePayment,
  type InsertInvoicePayment,
  type PriceRecommendation,
  type InsertPriceRecommendation,
  type ProfitabilitySnapshot,
  type InsertProfitabilitySnapshot,
  type OverheadCost,
  type InsertOverheadCost,
  type CompetitorPricing,
  type InsertCompetitorPricing,
  type Estimate,
  type InsertEstimate,
  type ServiceChangeRequest,
  type InsertServiceChangeRequest,
  type ServiceZone,
  type InsertServiceZone,
  type UsageEvent,
  type InsertUsageEvent,
  type VoiceCall,
  type InsertVoiceCall,
  voiceCalls,
  priceRecommendations,
  profitabilitySnapshots,
  overheadCosts,
  competitorPricing,
  serviceZones,
  type Quote,
  type InsertQuote,
  quotes,
  messageRouting,
  messageExceptions,
  messageAttachments,
  type MessageRouting,
  type InsertMessageRouting,
  type MessageException,
  type InsertMessageException,
  type MessageAttachment,
  type InsertMessageAttachment,
  systemMessages,
  type SystemMessage,
  type InsertSystemMessage,
  businessAssessments,
  type BusinessAssessment,
  type InsertBusinessAssessment,
  errorReports,
  errorFixTasks,
  type ErrorReport,
  type InsertErrorReport,
  type ErrorFixTask,
  type InsertErrorFixTask,
  geocodeCacheTable,
  type GeocodeCache,
  autocompleteCacheTable,
  type AutocompleteCache,
  retellWebhookRepairs,
  type RetellWebhookRepair,
  type InsertRetellWebhookRepair,
} from "@shared/schema";

export interface CustomerProfitabilityEntry {
  contactId: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  propertyCount: number;
  revenueCentsPerMonth: number;
  costCentsPerMonth: number;
  profitCentsPerMonth: number;
  profitMarginPct: number;
  status: "profitable" | "marginal" | "unprofitable";
  planCount: number;
}

export interface RouteProfitabilityEntry {
  routeId: string;
  routeName: string | null;
  dayOfWeek: string | null;
  technicianId: string | null;
  totalStops: number;
  totalRevenueCents: number;
  totalCostCents: number;
  totalProfitCents: number;
  avgMarginPct: number;
  customers: {
    contactId: string;
    firstName: string;
    lastName: string;
    revenueCents: number;
    costCents: number;
  }[];
}

export interface IStorage {
  // Users
  setImportMode(userId: string, value: boolean): Promise<void>;

  // Companies
  getCompany(id: string): Promise<Company | undefined>;
  listCompanies(): Promise<Company[]>;
  getCompanyByPhone(phone: string): Promise<Company | undefined>;
  getCompanyByTelnyxNumber(telnyxNumber: string): Promise<Company | undefined>;
  getCompanyBySlug(slug: string): Promise<Company | undefined>;
  getCompanyByStripeConnectAccountId(accountId: string): Promise<Company | undefined>;
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
  getContacts(
    companyId: string,
    filters?: { status?: string; search?: string }
  ): Promise<Contact[]>;
  getContactsPage(
    companyId: string,
    filters?: { status?: string; search?: string },
    page?: number,
    limit?: number
  ): Promise<{ data: Contact[]; total: number }>;
  createContact(data: InsertContact): Promise<Contact>;
  updateContact(id: string, companyId: string, data: Partial<InsertContact>): Promise<Contact>;
  deleteContact(id: string, companyId: string): Promise<void>;

  // Tags
  getTags(companyId: string): Promise<Tag[]>;
  createTag(data: InsertTag): Promise<Tag>;
  deleteTag(id: string, companyId?: string): Promise<void>;
  addTagToContact(contactId: string, tagId: string): Promise<void>;
  removeTagFromContact(contactId: string, tagId: string): Promise<void>;
  getContactTags(contactId: string): Promise<Tag[]>;

  // Lead Sources
  getLeadSources(companyId: string): Promise<LeadSource[]>;
  createLeadSource(data: InsertLeadSource): Promise<LeadSource>;
  deleteLeadSource(id: string, companyId?: string): Promise<void>;

  // Properties
  getProperty(id: string, companyId: string): Promise<Property | undefined>;
  getProperties(companyId: string, contactId?: string): Promise<Property[]>;
  createProperty(data: InsertProperty): Promise<Property>;
  updateProperty(id: string, companyId: string, data: Partial<InsertProperty>): Promise<Property>;
  deleteProperty(id: string, companyId: string): Promise<void>;

  // Routes
  getRoute(id: string, companyId: string): Promise<Route | undefined>;
  getRoutes(companyId: string, dayOfWeek?: string): Promise<Route[]>;
  getRouteByDate(companyId: string, date: string): Promise<Route | undefined>;
  getOrCreateDailyRoute(companyId: string, date: string): Promise<Route>;
  createRoute(data: InsertRoute): Promise<Route>;
  updateRoute(id: string, companyId: string, data: Partial<InsertRoute>): Promise<Route>;
  deleteRoute(id: string, companyId: string): Promise<void>;
  moveRouteToDate(
    routeId: string,
    companyId: string,
    targetDate: string
  ): Promise<{ movedCount: number; targetRouteId: string }>;
  renumberRouteStops(routeId: string, companyId: string): Promise<void>;
  reorderRouteStops(routeId: string, companyId: string, orderedIds: string[]): Promise<void>;

  // Agreements
  getAgreement(id: string, companyId: string): Promise<Agreement | undefined>;
  getAgreements(
    companyId: string,
    filters?: { contactId?: string; isActive?: boolean }
  ): Promise<Agreement[]>;
  createAgreement(data: InsertAgreement): Promise<Agreement>;
  updateAgreement(
    id: string,
    companyId: string,
    data: Partial<InsertAgreement>
  ): Promise<Agreement>;
  deleteAgreement(id: string, companyId: string): Promise<void>;

  // Jobs
  getJob(id: string, companyId: string): Promise<Job | undefined>;
  getJobs(
    companyId: string,
    filters?: { agreementId?: string; propertyId?: string; routeId?: string; jobStatus?: string }
  ): Promise<Job[]>;
  createJob(data: InsertJob): Promise<Job>;
  updateJob(id: string, companyId: string, data: Partial<InsertJob>): Promise<Job>;
  deleteJob(id: string, companyId: string): Promise<void>;
  getJobAddOns(jobId: string): Promise<JobAddOn[]>;
  setJobAddOns(
    jobId: string,
    addOns: { servicePricingId: string; name: string; price: string }[]
  ): Promise<JobAddOn[]>;
  getJobByServicePlanId(servicePlanId: string): Promise<Job | undefined>;
  getAgreementByServicePlanId(servicePlanId: string): Promise<Agreement | undefined>;
  getJobsWithAgreements(
    companyId: string,
    filters?: { isActive?: boolean; routeId?: string; propertyId?: string; contactId?: string }
  ): Promise<JobWithAgreement[]>;

  cancelFutureVisitsForJobs(jobIds: string[], fromDate: string): Promise<number>;
  unassignAllJobStops(routeId: string): Promise<number>;

  // Service Plans (legacy — kept during migration)
  getServicePlan(id: string, companyId: string): Promise<ServicePlan | undefined>;
  getServicePlans(
    companyId: string,
    filters?: { contactId?: string; propertyId?: string; isActive?: boolean; routeId?: string }
  ): Promise<ServicePlan[]>;
  createServicePlan(data: InsertServicePlan): Promise<ServicePlan>;
  updateServicePlan(
    id: string,
    companyId: string,
    data: Partial<InsertServicePlan>
  ): Promise<ServicePlan>;
  deleteServicePlan(id: string, companyId: string): Promise<void>;
  getServicePlanAddOns(servicePlanId: string): Promise<ServicePlanAddOn[]>;
  getAllServicePlanAddOnsForCompany(planIds: string[]): Promise<Map<string, ServicePlanAddOn[]>>;
  setServicePlanAddOns(
    servicePlanId: string,
    addOns: { servicePricingId: string; name: string; price: string }[]
  ): Promise<ServicePlanAddOn[]>;

  cancelFutureVisitsForPlans(planIds: string[], fromDate: string): Promise<number>;
  deleteFutureScheduledVisitsForPlans(planIds: string[], afterDate: string): Promise<number>;

  // Unassign all stops from a route
  unassignAllStops(routeId: string): Promise<number>;

  // Vacation Holds
  getVacationHolds(servicePlanId: string): Promise<VacationHold[]>;
  getVacationHoldsForPlans(planIds: string[]): Promise<VacationHold[]>;
  getVacationHoldsForAgreements(agreementIds: string[]): Promise<VacationHold[]>;
  createVacationHold(data: InsertVacationHold): Promise<VacationHold>;
  deleteVacationHold(id: string, companyId: string): Promise<void>;

  // Visits
  getVisit(id: string, companyId: string): Promise<Visit | undefined>;
  getVisits(
    companyId: string,
    filters?: { date?: string; routeId?: string; status?: string }
  ): Promise<Visit[]>;
  getVisitsForDateRange(companyId: string, startDate: string, endDate: string): Promise<Visit[]>;
  getOverdueVisits(companyId: string, beforeDate: string): Promise<Visit[]>;
  createVisit(data: InsertVisit): Promise<Visit | null>;
  updateVisit(id: string, companyId: string, data: Partial<InsertVisit>): Promise<Visit>;
  getTodaysVisitsCount(companyId: string, today: string): Promise<number>;
  getTodaysVisits(companyId: string, today: string): Promise<Visit[]>;
  getOverdueInvoicesCount(companyId: string, today: string): Promise<number>;
  getActiveContactsCount(companyId: string): Promise<number>;
  getActiveServicePlansCount(companyId: string): Promise<number>;

  // Invoices
  getInvoice(id: string, companyId: string): Promise<Invoice | undefined>;
  getInvoiceById(id: string): Promise<Invoice | undefined>;
  getInvoiceByPayToken(token: string): Promise<Invoice | undefined>;
  ensureInvoicePayToken(id: string, companyId: string): Promise<string>;
  getInvoices(
    companyId: string,
    filters?: { contactId?: string; status?: string }
  ): Promise<Invoice[]>;
  getInvoicesPage(
    companyId: string,
    filters?: { contactId?: string; status?: string; excludeVoided?: boolean },
    page?: number,
    limit?: number
  ): Promise<{ data: Invoice[]; total: number }>;
  createInvoice(data: InsertInvoice): Promise<Invoice>;
  updateInvoice(id: string, companyId: string, data: Partial<InsertInvoice>): Promise<Invoice>;
  getNextInvoiceNumber(companyId: string): Promise<string>;
  getFailedPaymentsCount(companyId: string): Promise<number>;
  getRevenueForPeriod(
    companyId: string,
    startDate: string,
    endDate: string,
    timezone?: string
  ): Promise<number>;

  // Invoice Line Items
  getInvoiceLineItems(invoiceId: string): Promise<InvoiceLineItem[]>;
  createInvoiceLineItem(data: InsertInvoiceLineItem): Promise<InvoiceLineItem>;
  deleteInvoiceLineItems(invoiceId: string): Promise<void>;
  deleteInvoice(id: string, companyId: string): Promise<void>;
  isVisitInvoiced(visitId: string): Promise<boolean>;
  getUninvoicedCompletedVisits(
    companyId: string,
    contactId: string,
    startDate: string,
    endDate: string
  ): Promise<Visit[]>;
  getScheduledVisitsForRange(
    companyId: string,
    contactId: string,
    startDate: string,
    endDate: string
  ): Promise<Visit[]>;
  createInvoiceWithLineItems(
    invoiceData: InsertInvoice,
    lineItems: Omit<InsertInvoiceLineItem, "invoiceId">[]
  ): Promise<Invoice>;
  getUninvoicedSummary(companyId: string): Promise<{
    count: number;
    totalDollars: number;
    byContact: { contactId: string; contactName: string; count: number; totalDollars: number }[];
  }>;
  getVisitsForContact(
    companyId: string,
    contactId: string,
    limit: number,
    offset: number
  ): Promise<{
    visits: {
      id: string;
      scheduledDate: string;
      status: string;
      servicePlanName: string;
      propertyAddress: string;
      completedAt: Date | null;
      startedAt: Date | null;
    }[];
    total: number;
  }>;
  getUninvoicedVisitsForContact(
    companyId: string,
    contactId: string
  ): Promise<{
    visits: (Visit & { servicePlanName: string; pricePerVisit: string; propertyAddress: string })[];
    totalDollars: number;
  }>;

  // Automation Rules
  getAutomationRules(companyId: string): Promise<AutomationRule[]>;
  createAutomationRule(data: InsertAutomationRule): Promise<AutomationRule>;
  updateAutomationRule(
    id: string,
    companyId: string,
    data: Partial<InsertAutomationRule>
  ): Promise<AutomationRule>;
  deleteAutomationRule(id: string, companyId?: string): Promise<void>;
  getRulesForTrigger(companyId: string, trigger: string): Promise<AutomationRule[]>;
  createAutomationEventLog(data: {
    companyId: string;
    ruleId?: string;
    trigger: string;
    payload?: unknown;
    result?: unknown;
  }): Promise<void>;

  // API Keys
  getApiKeys(companyId: string): Promise<ApiKey[]>;
  getApiKeyByPrefix(prefix: string): Promise<ApiKey | undefined>;
  createApiKey(data: InsertApiKey): Promise<ApiKey>;
  updateApiKeyLastUsed(id: string): Promise<void>;
  deleteApiKey(id: string, companyId?: string): Promise<void>;

  // Webhooks
  getWebhooks(companyId: string): Promise<Webhook[]>;
  createWebhook(data: InsertWebhook): Promise<Webhook>;
  updateWebhook(id: string, companyId: string, data: Partial<InsertWebhook>): Promise<Webhook>;
  deleteWebhook(id: string, companyId?: string): Promise<void>;
  getWebhooksForEvent(companyId: string, event: string): Promise<Webhook[]>;

  // Attachments
  createAttachment(data: InsertAttachment): Promise<Attachment>;
  getAttachments(
    companyId: string,
    filters?: { contactId?: string; propertyId?: string; visitId?: string }
  ): Promise<Attachment[]>;
  createDocument(data: InsertAttachment): Promise<Attachment>;
  getDocumentImports(companyId: string): Promise<Attachment[]>;

  // Service Pricing
  getServicePricing(companyId: string, category?: string): Promise<ServicePricingItem[]>;
  createServicePricingItem(data: InsertServicePricing): Promise<ServicePricingItem>;
  updateServicePricingItem(
    id: string,
    companyId: string,
    data: Partial<InsertServicePricing>
  ): Promise<ServicePricingItem>;
  deleteServicePricingItem(id: string, companyId: string): Promise<void>;

  // Service Billing Rules
  getServiceBillingRules(companyId: string): Promise<ServiceBillingRule[]>;
  upsertServiceBillingRule(
    companyId: string,
    servicePricingId: string,
    data: Partial<InsertServiceBillingRule>
  ): Promise<ServiceBillingRule>;
  deleteServiceBillingRule(companyId: string, servicePricingId: string): Promise<void>;

  // Service Packages
  getServicePackages(companyId: string): Promise<ServicePackage[]>;
  createServicePackage(data: InsertServicePackage): Promise<ServicePackage>;
  updateServicePackage(
    id: string,
    companyId: string,
    data: Partial<InsertServicePackage>
  ): Promise<ServicePackage>;
  deleteServicePackage(id: string, companyId: string): Promise<void>;

  // Messages
  getMessages(
    companyId: string,
    filters?: {
      contactId?: string;
      channel?: string;
      direction?: string;
      isRead?: boolean;
      phone?: string;
      emailThreadId?: string;
      retentionDays?: number;
    }
  ): Promise<Message[]>;
  markMessageRead(id: string, companyId: string): Promise<Message>;
  markMessagesReadByContact(contactId: string, companyId: string): Promise<void>;
  markMessagesReadByPhone(phone: string, companyId: string): Promise<void>;
  markMessagesReadByEmail(emailThreadId: string, companyId: string): Promise<void>;
  getUnreadSmsCount(companyId: string): Promise<number>;
  getUnreadEmailCount(companyId: string): Promise<number>;
  getMessagesByEmailThreadId(emailThreadId: string, companyId?: string): Promise<Message[]>;
  createMessage(data: InsertMessage): Promise<Message>;
  updateMessageStatus(id: string, status: string, errorMessage?: string): Promise<Message>;

  // Portal Sessions
  createPortalSession(data: InsertPortalSession): Promise<PortalSession>;
  getPortalSessionByToken(tokenHash: string): Promise<PortalSession | undefined>;
  deleteExpiredPortalSessions(): Promise<void>;
  deletePortalSession(id: string): Promise<void>;

  // Contact by ID (without company scope - for portal)
  getContactById(id: string): Promise<Contact | undefined>;

  // Seed default pricing
  seedDefaultPricing(companyId: string): Promise<void>;

  // Admin (platform-level)
  getAllCompanies(): Promise<Company[]>;
  getPendingDeletionCompanies(): Promise<Company[]>;
  softDeleteCompany(id: string): Promise<Company>;
  restoreCompany(id: string): Promise<Company>;
  getAdminNotes(companyId: string): Promise<AdminNote[]>;
  createAdminNote(data: InsertAdminNote): Promise<AdminNote>;
  deleteAdminNote(id: string): Promise<void>;
  updateCompanySubscription(
    companyId: string,
    tier: string,
    opts?: {
      subscriptionStatus?: string;
      trialEndsAt?: Date | null;
      customMaxUsers?: number | null;
    }
  ): Promise<Company>;
  getPlatformStats(): Promise<{
    totalCompanies: number;
    totalUsers: number;
    totalContacts: number;
    totalVisits: number;
    mrr: number;
  }>;

  // SMS Messages
  createSmsMessage(data: InsertSmsMessage): Promise<SmsMessage>;
  getSmsMessages(companyId: string, startDate?: string, endDate?: string): Promise<SmsMessage[]>;
  getSmsCountForPeriod(companyId: string, startDate: string, endDate: string): Promise<number>;

  // Email Logs
  createEmailLog(data: InsertEmailSent): Promise<EmailSent>;
  getEmailLogs(companyId: string, startDate?: string, endDate?: string): Promise<EmailSent[]>;
  getEmailCountForPeriod(companyId: string, startDate: string, endDate: string): Promise<number>;

  // Account Daily Metrics
  upsertDailyMetrics(data: InsertAccountDailyMetric): Promise<AccountDailyMetric>;
  getDailyMetrics(
    companyId: string,
    startDate: string,
    endDate: string
  ): Promise<AccountDailyMetric[]>;
  getAllDailyMetrics(startDate: string, endDate: string): Promise<AccountDailyMetric[]>;

  // SaaS Costs
  getSaasCosts(month: string): Promise<SaasCostMonthly | undefined>;
  upsertSaasCosts(data: InsertSaasCostMonthly): Promise<SaasCostMonthly>;
  getAllSaasCosts(): Promise<SaasCostMonthly[]>;

  // Cost Config
  getCostConfig(): Promise<CostConfigItem[]>;
  upsertCostConfig(
    key: string,
    valueCents: number,
    valuePct?: string,
    description?: string
  ): Promise<CostConfigItem>;

  // Notifications
  getNotifications(companyId: string, limit?: number): Promise<Notification[]>;
  getUnreadNotificationCount(companyId: string): Promise<number>;
  createNotification(data: InsertNotification): Promise<Notification>;
  markNotificationRead(id: string, companyId: string): Promise<Notification>;
  markAllNotificationsRead(companyId: string): Promise<void>;

  // Retell Webhook Repairs
  createRetellWebhookRepair(data: InsertRetellWebhookRepair): Promise<RetellWebhookRepair>;
  listRetellWebhookRepairs(companyId: string, limit?: number): Promise<RetellWebhookRepair[]>;

  // Time Entries
  createTimeEntry(data: InsertTimeEntry): Promise<TimeEntry>;
  updateTimeEntry(
    id: string,
    companyId: string,
    data: Partial<InsertTimeEntry>
  ): Promise<TimeEntry>;
  getTimeEntries(
    companyId: string,
    filters?: { userId?: string; startDate?: string; endDate?: string }
  ): Promise<TimeEntry[]>;
  getActiveTimeEntry(userId: string): Promise<TimeEntry | undefined>;

  // Activity Log
  createActivityLog(data: InsertActivityLog): Promise<ActivityLog>;
  getActivityLogs(
    companyId: string,
    contactId: string,
    limit?: number,
    offset?: number
  ): Promise<ActivityLog[]>;

  // Webhook Deliveries
  createWebhookDelivery(data: InsertWebhookDelivery): Promise<WebhookDelivery>;
  updateWebhookDelivery(id: string, data: Partial<InsertWebhookDelivery>): Promise<WebhookDelivery>;
  getPendingWebhookDeliveries(): Promise<WebhookDelivery[]>;
  getWebhookDeliveries(webhookId: string, limit?: number): Promise<WebhookDelivery[]>;
  getWebhookDeliveriesForCompany(companyId: string, limit?: number): Promise<WebhookDelivery[]>;

  // Audit Trail
  createAuditEntry(data: InsertAuditTrail): Promise<AuditTrail>;
  getAuditTrail(
    companyId: string,
    filters?: { entityType?: string; startDate?: string; endDate?: string },
    limit?: number,
    offset?: number
  ): Promise<AuditTrail[]>;

  // Bulk operations
  bulkUpdateContacts(
    ids: string[],
    companyId: string,
    data: Partial<InsertContact>
  ): Promise<number>;
  bulkDeleteContacts(ids: string[], companyId: string): Promise<number>;

  // Search
  searchContacts(
    companyId: string,
    term: string
  ): Promise<Pick<Contact, "id" | "firstName" | "lastName" | "email" | "phone" | "status">[]>;
  searchProperties(
    companyId: string,
    term: string
  ): Promise<Pick<Property, "id" | "streetAddress" | "city" | "contactId">[]>;
  searchInvoices(
    companyId: string,
    term: string
  ): Promise<Pick<Invoice, "id" | "invoiceNumber" | "status" | "total" | "contactId">[]>;
  searchRoutes(
    companyId: string,
    term: string
  ): Promise<Pick<Route, "id" | "name" | "dayOfWeek">[]>;

  // Import Runs
  createImportRun(data: InsertImportRun): Promise<ImportRun>;
  getImportRun(id: string, companyId: string): Promise<ImportRun | undefined>;
  updateImportRun(
    id: string,
    data: Partial<InsertImportRun> & { completedAt?: Date }
  ): Promise<ImportRun>;
  getImportRuns(companyId: string): Promise<ImportRun[]>;
  getImportRunByHash(companyId: string, fileHash: string): Promise<ImportRun | undefined>;

  // Import Batches (staging)
  createImportBatch(data: InsertImportBatch): Promise<ImportBatch>;
  getImportBatch(id: string, companyId: string): Promise<ImportBatch | undefined>;
  updateImportBatch(
    id: string,
    data: Partial<InsertImportBatch> & { completedAt?: Date }
  ): Promise<ImportBatch>;
  getImportBatches(companyId: string): Promise<ImportBatch[]>;

  // Import Rows
  createImportRow(data: InsertImportRow): Promise<ImportRow>;
  bulkCreateImportRows(rows: InsertImportRow[]): Promise<ImportRow[]>;
  getImportRows(
    batchId: string,
    companyId: string,
    filters?: { status?: string; missingField?: string }
  ): Promise<ImportRow[]>;
  getImportRow(id: string, companyId: string): Promise<ImportRow | undefined>;
  updateImportRow(
    id: string,
    companyId: string,
    data: Partial<InsertImportRow>
  ): Promise<ImportRow>;
  bulkUpdateImportRows(
    ids: string[],
    companyId: string,
    data: Partial<InsertImportRow>
  ): Promise<void>;

  // Import Mappings
  bulkCreateImportMappings(mappings: InsertImportMapping[]): Promise<ImportMapping[]>;
  getImportMappings(batchId: string): Promise<ImportMapping[]>;

  // Import Rule Suggestions
  createImportRuleSuggestion(data: InsertImportRuleSuggestion): Promise<ImportRuleSuggestion>;
  getImportRuleSuggestions(batchId: string): Promise<ImportRuleSuggestion[]>;
  getImportRuleSuggestionByRow(rowId: string): Promise<ImportRuleSuggestion | undefined>;
  updateImportRuleSuggestion(
    id: string,
    data: Partial<InsertImportRuleSuggestion>
  ): Promise<ImportRuleSuggestion>;

  // Invoice Payments
  createInvoicePayment(data: InsertInvoicePayment): Promise<InvoicePayment>;
  getInvoicePayments(invoiceId: string): Promise<InvoicePayment[]>;
  getInvoicePaymentsByCompany(
    companyId: string,
    filters?: { source?: string }
  ): Promise<InvoicePayment[]>;
  getInvoicePaymentByExternalId(
    companyId: string,
    externalId: string
  ): Promise<InvoicePayment | undefined>;
  getInvoiceByExternalId(
    companyId: string,
    externalSource: string,
    externalId: string
  ): Promise<Invoice | undefined>;

  // Price Recommendations
  createPriceRecommendation(data: InsertPriceRecommendation): Promise<PriceRecommendation>;
  getPriceRecommendations(companyId: string, propertyId?: string): Promise<PriceRecommendation[]>;
  getLatestPriceRecommendation(
    companyId: string,
    propertyId: string
  ): Promise<PriceRecommendation | undefined>;

  // Profitability Snapshots
  getProfitabilitySnapshots(
    companyId: string,
    filters?: { startDate?: string; endDate?: string; contactId?: string }
  ): Promise<ProfitabilitySnapshot[]>;
  getProfitabilitySnapshot(
    id: string,
    companyId: string
  ): Promise<ProfitabilitySnapshot | undefined>;
  createProfitabilitySnapshot(data: InsertProfitabilitySnapshot): Promise<ProfitabilitySnapshot>;
  deleteProfitabilitySnapshots(companyId: string, olderThan?: string): Promise<void>;
  getCustomerProfitabilitySummary(companyId: string): Promise<CustomerProfitabilityEntry[]>;
  getRouteProfitabilitySummary(companyId: string): Promise<RouteProfitabilityEntry[]>;

  // Overhead Costs
  getOverheadCosts(companyId: string): Promise<OverheadCost[]>;
  createOverheadCost(data: InsertOverheadCost): Promise<OverheadCost>;
  updateOverheadCost(
    id: string,
    companyId: string,
    data: Partial<InsertOverheadCost>
  ): Promise<OverheadCost>;
  deleteOverheadCost(id: string, companyId: string): Promise<void>;
  getTotalMonthlyOverheadCents(companyId: string): Promise<number>;

  // Competitor Pricing
  getCompetitorPricing(companyId: string, zipCode?: string): Promise<CompetitorPricing[]>;
  createCompetitorPricing(data: InsertCompetitorPricing): Promise<CompetitorPricing>;
  updateCompetitorPricing(
    id: string,
    companyId: string,
    data: Partial<InsertCompetitorPricing>
  ): Promise<CompetitorPricing>;
  deleteCompetitorPricing(id: string, companyId: string): Promise<void>;

  // Estimates
  getEstimate(id: string, companyId: string): Promise<Estimate | undefined>;
  getEstimates(
    companyId: string,
    filters?: { contactId?: string; status?: string }
  ): Promise<Estimate[]>;
  createEstimate(data: InsertEstimate): Promise<Estimate>;
  updateEstimate(id: string, companyId: string, data: Partial<InsertEstimate>): Promise<Estimate>;

  // Service Change Requests
  getServiceChangeRequest(id: string, companyId: string): Promise<ServiceChangeRequest | undefined>;
  getServiceChangeRequests(
    companyId: string,
    filters?: { contactId?: string; status?: string }
  ): Promise<ServiceChangeRequest[]>;
  createServiceChangeRequest(data: InsertServiceChangeRequest): Promise<ServiceChangeRequest>;
  updateServiceChangeRequest(
    id: string,
    companyId: string,
    data: Partial<InsertServiceChangeRequest>
  ): Promise<ServiceChangeRequest>;

  getServiceZones(companyId: string): Promise<ServiceZone[]>;
  createServiceZone(data: InsertServiceZone): Promise<ServiceZone>;
  updateServiceZone(
    id: string,
    companyId: string,
    data: Partial<InsertServiceZone>
  ): Promise<ServiceZone>;
  deleteServiceZone(id: string, companyId: string): Promise<void>;

  // Jobs
  createJobFromEstimate(estimate: Estimate, contactId: string): Promise<ServicePlan>;

  // Usage Events
  createUsageEvent(data: InsertUsageEvent): Promise<UsageEvent>;
  getUsageEvents(companyId: string, startDate: string, endDate: string): Promise<UsageEvent[]>;
  getUsageSummary(
    companyId: string,
    startDate: string,
    endDate: string
  ): Promise<{ smsSegments: number; voiceMinutes: number; userSeats: number }>;

  // Voice Calls
  createVoiceCall(data: InsertVoiceCall): Promise<VoiceCall>;
  updateVoiceCall(
    id: string,
    data: Partial<Pick<InsertVoiceCall, "outcome" | "summary" | "metadata">>
  ): Promise<VoiceCall>;
  getVoiceCalls(companyId: string, limit?: number): Promise<VoiceCall[]>;
  getVoiceCallById(companyId: string, id: string): Promise<VoiceCall | undefined>;
  getVoiceCallByRetellId(retellCallId: string): Promise<VoiceCall | undefined>;
  getVoiceCallSummary(
    companyId: string,
    startDate: string,
    endDate: string
  ): Promise<{ totalCalls: number; totalMinutes: number }>;

  // Referral helpers
  getContactByReferralCode(code: string): Promise<Contact | undefined>;
  getReferralCount(contactId: string): Promise<number>;

  // Quotes
  getQuote(id: string, companyId: string): Promise<Quote | undefined>;
  getQuotes(
    companyId: string,
    filters?: { status?: string; type?: string; contactId?: string }
  ): Promise<Quote[]>;
  createQuote(data: InsertQuote): Promise<Quote>;
  updateQuote(id: string, companyId: string, data: Partial<InsertQuote>): Promise<Quote>;
  deleteQuote(id: string, companyId: string): Promise<void>;
  getNextQuoteNumber(companyId: string): Promise<string>;

  // Message Routing (shared number)
  findMessageRouting(sharedNumber: string, customerPhone: string): Promise<MessageRouting[]>;
  upsertMessageRouting(data: InsertMessageRouting): Promise<MessageRouting>;

  // Message Attachments
  createMessageAttachment(data: InsertMessageAttachment): Promise<MessageAttachment>;
  getMessageAttachments(messageId: string): Promise<MessageAttachment[]>;

  // Message Exceptions
  getMessageExceptions(filters?: {
    resolved?: boolean;
    companyId?: string;
  }): Promise<MessageException[]>;
  createMessageException(data: InsertMessageException): Promise<MessageException>;
  resolveMessageException(
    id: string,
    resolvedBy: string,
    companyId: string,
    skipCandidateCheck?: boolean
  ): Promise<MessageException | undefined>;
  dismissMessageException(
    id: string,
    resolvedBy: string,
    companyId?: string
  ): Promise<MessageException | undefined>;

  // System Messages
  createSystemMessage(data: InsertSystemMessage): Promise<SystemMessage>;
  getSystemMessages(
    companyId: string,
    filters?: { includeDismissed?: boolean }
  ): Promise<SystemMessage[]>;
  getUnreadSystemMessageCount(companyId: string): Promise<number>;
  markSystemMessageRead(id: string, companyId: string): Promise<SystemMessage | undefined>;
  dismissSystemMessage(id: string, companyId: string): Promise<SystemMessage | undefined>;
  dismissAllSystemMessages(companyId: string): Promise<void>;

  // Business Assessments
  saveBusinessAssessment(data: InsertBusinessAssessment): Promise<BusinessAssessment>;
  getBusinessAssessments(companyId: string, limit?: number): Promise<BusinessAssessment[]>;
  getBusinessAssessmentById(id: string, companyId: string): Promise<BusinessAssessment | null>;

  // Error Reports
  createErrorReport(data: InsertErrorReport): Promise<ErrorReport>;
  listErrorReports(filters?: {
    status?: string;
    message?: string;
    fromDate?: Date;
    toDate?: Date;
    limit?: number;
    offset?: number;
  }): Promise<ErrorReport[]>;
  listGroupedErrorReports(filters?: {
    status?: string;
    severity?: string;
    fromDate?: Date;
    toDate?: Date;
    limit?: number;
    offset?: number;
  }): Promise<GroupedErrorReport[]>;
  getErrorReport(id: string): Promise<ErrorReport | undefined>;
  updateErrorReport(
    id: string,
    data: Partial<Pick<InsertErrorReport, "status" | "severity">>
  ): Promise<ErrorReport>;
  bulkUpdateErrorReportStatus(
    message: string,
    status: "open" | "acknowledged" | "resolved"
  ): Promise<number>;
  createErrorFixTask(data: InsertErrorFixTask): Promise<ErrorFixTask>;
  getErrorFixTask(errorReportId: string): Promise<ErrorFixTask | undefined>;
  updateErrorFixTask(
    id: string,
    data: Partial<Pick<ErrorFixTask, "status">>
  ): Promise<ErrorFixTask>;
  getOpenErrorCount(): Promise<number>;
  getLatestErrorTimestamp(): Promise<Date | null>;

  // Geocode Cache
  getGeocodeCache(addressKey: string): Promise<GeocodeCache | undefined>;
  setGeocodeCache(
    addressKey: string,
    latitude: string | null,
    longitude: string | null
  ): Promise<void>;
  pruneGeocodeCache(olderThanDays: number): Promise<void>;

  // Autocomplete Cache
  getAutocompleteCache(queryKey: string): Promise<AutocompleteCache | undefined>;
  setAutocompleteCache(queryKey: string, results: unknown[]): Promise<void>;
  pruneAutocompleteCache(olderThanDays: number): Promise<void>;
}

export type GroupedErrorReport = {
  message: string;
  errorType: "react" | "js" | "api";
  status: "open" | "acknowledged" | "resolved";
  count: number;
  firstSeen: string;
  lastSeen: string;
  latestId: string;
};

export class DatabaseStorage implements IStorage {
  // ================ Users ================
  async setImportMode(userId: string, value: boolean): Promise<void> {
    await db
      .update(users)
      .set({ importMode: value, updatedAt: new Date() })
      .where(eq(users.id, userId));
  }

  // ================ Companies ================
  async getCompany(id: string): Promise<Company | undefined> {
    const [company] = await db
      .select()
      .from(companies)
      .where(and(eq(companies.id, id), isNull(companies.deletedAt)));
    return company;
  }

  async listCompanies(): Promise<Company[]> {
    return db.select().from(companies).where(isNull(companies.deletedAt));
  }

  async getCompanyByPhone(phone: string): Promise<Company | undefined> {
    const digits = phone.replace(/\D/g, "");
    const allCompanies = await db.select().from(companies).where(isNull(companies.deletedAt));
    return allCompanies.find((c) => {
      if (!c.phone) return false;
      const cDigits = c.phone.replace(/\D/g, "");
      return cDigits.length >= 10 && digits.length >= 10 && digits.endsWith(cDigits.slice(-10));
    });
  }

  async getCompanyByTelnyxNumber(telnyxNumber: string): Promise<Company | undefined> {
    const normalized = telnyxNumber.replace(/\s/g, "");
    const [company] = await db
      .select()
      .from(companies)
      .where(and(eq(companies.telnyxPhoneNumber, normalized), isNull(companies.deletedAt)))
      .limit(1);
    return company;
  }

  async getCompanyBySlug(slug: string): Promise<Company | undefined> {
    const [company] = await db
      .select()
      .from(companies)
      .where(and(eq(companies.slug, slug), isNull(companies.deletedAt)));
    return company;
  }

  async getCompanyByStripeConnectAccountId(accountId: string): Promise<Company | undefined> {
    const [company] = await db
      .select()
      .from(companies)
      .where(and(eq(companies.stripeConnectAccountId, accountId), isNull(companies.deletedAt)));
    return company;
  }

  async createCompany(data: InsertCompany): Promise<Company> {
    if (!data.slug && data.name) {
      const baseSlug =
        data.name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "") || "company";
      let slug = baseSlug;
      let suffix = 1;
      while (true) {
        const existing = await this.getCompanyBySlug(slug);
        if (!existing) break;
        slug = `${baseSlug}-${suffix++}`;
      }
      data = { ...data, slug };
    }
    const [company] = await db.insert(companies).values(data).returning();
    return company;
  }

  async updateCompany(id: string, data: Partial<InsertCompany>): Promise<Company> {
    const [company] = await db
      .update(companies)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(companies.id, id))
      .returning();
    return company;
  }

  // ================ Company Users ================
  async getCompanyUser(companyId: string, userId: string): Promise<CompanyUser | undefined> {
    const [cu] = await db
      .select()
      .from(companyUsers)
      .where(and(eq(companyUsers.companyId, companyId), eq(companyUsers.userId, userId)));
    return cu;
  }

  async getCompanyUsers(companyId: string): Promise<CompanyUser[]> {
    return db.select().from(companyUsers).where(eq(companyUsers.companyId, companyId));
  }

  async getCompaniesForUser(userId: string): Promise<CompanyUser[]> {
    return db
      .select()
      .from(companyUsers)
      .where(and(eq(companyUsers.userId, userId), eq(companyUsers.isActive, true)));
  }

  async createCompanyUser(data: InsertCompanyUser): Promise<CompanyUser> {
    const [cu] = await db.insert(companyUsers).values(data).returning();
    return cu;
  }

  async addUserToCompany(userId: string, companyId: string, role: string): Promise<CompanyUser> {
    const [cu] = await db
      .insert(companyUsers)
      .values({ userId, companyId, role: role as "owner" | "admin" | "tech" })
      .returning();
    return cu;
  }

  async updateCompanyUser(id: string, data: Partial<InsertCompanyUser>): Promise<CompanyUser> {
    const [cu] = await db
      .update(companyUsers)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(companyUsers.id, id))
      .returning();
    return cu;
  }

  async countActiveCompanyUsers(companyId: string): Promise<number> {
    const [result] = await db
      .select({ count: count() })
      .from(companyUsers)
      .where(and(eq(companyUsers.companyId, companyId), eq(companyUsers.isActive, true)));
    return result?.count ?? 0;
  }

  // ================ Contacts ================
  async getContact(id: string, companyId: string): Promise<Contact | undefined> {
    const [contact] = await db
      .select()
      .from(contacts)
      .where(and(eq(contacts.id, id), eq(contacts.companyId, companyId)));
    return contact;
  }

  async getContacts(
    companyId: string,
    filters?: { status?: string; search?: string }
  ): Promise<Contact[]> {
    const conditions = [eq(contacts.companyId, companyId)];
    if (filters?.status)
      conditions.push(
        eq(contacts.status, filters.status as (typeof contacts.$inferSelect)["status"])
      );
    if (filters?.search) {
      conditions.push(
        or(
          ilike(contacts.firstName, `%${filters.search}%`),
          ilike(contacts.lastName, `%${filters.search}%`),
          ilike(contacts.email, `%${filters.search}%`),
          ilike(contacts.phone, `%${filters.search}%`)
        )!
      );
    }
    return db
      .select()
      .from(contacts)
      .where(and(...conditions))
      .orderBy(asc(contacts.firstName), asc(contacts.lastName));
  }

  async getContactsPage(
    companyId: string,
    filters?: { status?: string; search?: string },
    page: number = 1,
    limit: number = 50
  ): Promise<{ data: Contact[]; total: number }> {
    const conditions = [eq(contacts.companyId, companyId)];
    if (filters?.status)
      conditions.push(
        eq(contacts.status, filters.status as (typeof contacts.$inferSelect)["status"])
      );
    if (filters?.search) {
      conditions.push(
        or(
          ilike(contacts.firstName, `%${filters.search}%`),
          ilike(contacts.lastName, `%${filters.search}%`),
          ilike(contacts.email, `%${filters.search}%`),
          ilike(contacts.phone, `%${filters.search}%`)
        )!
      );
    }
    const offset = (page - 1) * limit;
    const [data, countResult] = await Promise.all([
      db
        .select()
        .from(contacts)
        .where(and(...conditions))
        .orderBy(asc(contacts.firstName), asc(contacts.lastName))
        .limit(limit)
        .offset(offset),
      db
        .select({ total: sql<number>`COUNT(*)::int` })
        .from(contacts)
        .where(and(...conditions)),
    ]);
    return { data, total: countResult[0]?.total ?? 0 };
  }

  async createContact(data: InsertContact): Promise<Contact> {
    const [contact] = await db.insert(contacts).values(data).returning();
    return contact;
  }

  async updateContact(
    id: string,
    companyId: string,
    data: Partial<InsertContact>
  ): Promise<Contact> {
    const [contact] = await db
      .update(contacts)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(contacts.id, id), eq(contacts.companyId, companyId)))
      .returning();
    return contact;
  }

  async deleteContact(id: string, companyId: string): Promise<void> {
    await db.delete(contacts).where(and(eq(contacts.id, id), eq(contacts.companyId, companyId)));
  }

  // ================ Tags ================
  async getTags(companyId: string): Promise<Tag[]> {
    return db.select().from(tags).where(eq(tags.companyId, companyId));
  }

  async createTag(data: InsertTag): Promise<Tag> {
    const [tag] = await db.insert(tags).values(data).returning();
    return tag;
  }

  async deleteTag(id: string, companyId?: string): Promise<void> {
    const conditions = companyId
      ? and(eq(tags.id, id), eq(tags.companyId, companyId))
      : eq(tags.id, id);
    await db.delete(tags).where(conditions);
  }

  async addTagToContact(contactId: string, tagId: string): Promise<void> {
    await db.insert(contactTags).values({ contactId, tagId }).onConflictDoNothing();
  }

  async removeTagFromContact(contactId: string, tagId: string): Promise<void> {
    await db
      .delete(contactTags)
      .where(and(eq(contactTags.contactId, contactId), eq(contactTags.tagId, tagId)));
  }

  async getContactTags(contactId: string): Promise<Tag[]> {
    const result = await db
      .select({ tag: tags })
      .from(contactTags)
      .innerJoin(tags, eq(contactTags.tagId, tags.id))
      .where(eq(contactTags.contactId, contactId));
    return result.map((r) => r.tag);
  }

  // ================ Lead Sources ================
  async getLeadSources(companyId: string): Promise<LeadSource[]> {
    return db
      .select()
      .from(leadSources)
      .where(eq(leadSources.companyId, companyId))
      .orderBy(leadSources.name);
  }

  async createLeadSource(data: InsertLeadSource): Promise<LeadSource> {
    const [source] = await db.insert(leadSources).values(data).onConflictDoNothing().returning();
    if (!source) {
      const [existing] = await db
        .select()
        .from(leadSources)
        .where(and(eq(leadSources.companyId, data.companyId), eq(leadSources.name, data.name)));
      return existing;
    }
    return source;
  }

  async deleteLeadSource(id: string, companyId?: string): Promise<void> {
    const conditions = companyId
      ? and(eq(leadSources.id, id), eq(leadSources.companyId, companyId))
      : eq(leadSources.id, id);
    await db.delete(leadSources).where(conditions);
  }

  // ================ Properties ================
  async getProperty(id: string, companyId: string): Promise<Property | undefined> {
    const [property] = await db
      .select()
      .from(properties)
      .where(and(eq(properties.id, id), eq(properties.companyId, companyId)));
    return property;
  }

  async getProperties(companyId: string, contactId?: string): Promise<Property[]> {
    const conditions = [eq(properties.companyId, companyId)];
    if (contactId) conditions.push(eq(properties.contactId, contactId));
    return db
      .select()
      .from(properties)
      .where(and(...conditions));
  }

  async createProperty(data: InsertProperty): Promise<Property> {
    const [property] = await db.insert(properties).values(data).returning();
    return property;
  }

  async updateProperty(
    id: string,
    companyId: string,
    data: Partial<InsertProperty>
  ): Promise<Property> {
    const [property] = await db
      .update(properties)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(properties.id, id), eq(properties.companyId, companyId)))
      .returning();
    return property;
  }

  async deleteProperty(id: string, companyId: string): Promise<void> {
    await db
      .delete(properties)
      .where(and(eq(properties.id, id), eq(properties.companyId, companyId)));
  }

  // ================ Routes ================
  async getRoute(id: string, companyId: string): Promise<Route | undefined> {
    const [route] = await db
      .select()
      .from(routes)
      .where(and(eq(routes.id, id), eq(routes.companyId, companyId)));
    return route;
  }

  async getRoutes(companyId: string, dayOfWeek?: string): Promise<Route[]> {
    const conditions = [eq(routes.companyId, companyId)];
    if (dayOfWeek)
      conditions.push(
        eq(routes.dayOfWeek, dayOfWeek as Exclude<(typeof routes.$inferSelect)["dayOfWeek"], null>)
      );
    return db
      .select()
      .from(routes)
      .where(and(...conditions));
  }

  async getRouteByDate(companyId: string, date: string): Promise<Route | undefined> {
    const [route] = await db
      .select()
      .from(routes)
      .where(and(eq(routes.companyId, companyId), eq(routes.date, date)));
    return route;
  }

  async getOrCreateDailyRoute(companyId: string, date: string): Promise<Route> {
    const existing = await this.getRouteByDate(companyId, date);
    if (existing) return existing;
    const d = new Date(date + "T00:00:00Z");
    const dayNameMap: Record<
      number,
      "sunday" | "monday" | "tuesday" | "wednesday" | "thursday" | "friday" | "saturday"
    > = {
      0: "sunday",
      1: "monday",
      2: "tuesday",
      3: "wednesday",
      4: "thursday",
      5: "friday",
      6: "saturday",
    };
    const displayNames: Record<number, string> = {
      0: "Sunday",
      1: "Monday",
      2: "Tuesday",
      3: "Wednesday",
      4: "Thursday",
      5: "Friday",
      6: "Saturday",
    };
    const dayOfWeek = dayNameMap[d.getUTCDay()];
    const displayName = displayNames[d.getUTCDay()];
    const formatted = `${d.getUTCMonth() + 1}/${d.getUTCDate()}/${d.getUTCFullYear()}`;
    const name = `${displayName} ${formatted}`;
    const [route] = await db
      .insert(routes)
      .values({
        companyId,
        name,
        date,
        dayOfWeek,
      })
      .onConflictDoNothing()
      .returning();
    if (route) return route;
    const raceWinner = await this.getRouteByDate(companyId, date);
    if (raceWinner) return raceWinner;
    throw new Error(`Failed to create or find daily route for ${date}`);
  }

  async createRoute(data: InsertRoute): Promise<Route> {
    const [route] = await db.insert(routes).values(data).returning();
    return route;
  }

  async updateRoute(id: string, companyId: string, data: Partial<InsertRoute>): Promise<Route> {
    const [route] = await db
      .update(routes)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(routes.id, id), eq(routes.companyId, companyId)))
      .returning();
    return route;
  }

  async deleteRoute(id: string, companyId: string): Promise<void> {
    await db.delete(routes).where(and(eq(routes.id, id), eq(routes.companyId, companyId)));
  }

  async moveRouteToDate(
    routeId: string,
    companyId: string,
    targetDate: string
  ): Promise<{ movedCount: number; targetRouteId: string }> {
    const sourceRoute = await this.getRoute(routeId, companyId);
    if (!sourceRoute) throw new Error("Route not found");
    if (sourceRoute.date === targetDate)
      throw new Error("Target date is the same as the current route date");

    const existingTargetRoute = await this.getRouteByDate(companyId, targetDate);
    let targetRouteId: string;

    if (existingTargetRoute) {
      // Target date route already exists — use it; source route keeps its own date
      targetRouteId = existingTargetRoute.id;
    } else {
      // No route exists for targetDate.
      // Check if source route has any non-scheduled visits that would remain after the move.
      const nonScheduled = await db
        .select({ id: visits.id })
        .from(visits)
        .where(
          and(
            eq(visits.routeId, routeId),
            eq(visits.companyId, companyId),
            inArray(visits.status, ["in_progress", "completed", "skipped", "cancelled"])
          )
        )
        .limit(1);

      if (nonScheduled.length === 0) {
        // Source route will be empty after the move — reuse it as the target route by updating its date
        const d = new Date(targetDate + "T00:00:00Z");
        const dayNameMap: Record<
          number,
          "sunday" | "monday" | "tuesday" | "wednesday" | "thursday" | "friday" | "saturday"
        > = {
          0: "sunday",
          1: "monday",
          2: "tuesday",
          3: "wednesday",
          4: "thursday",
          5: "friday",
          6: "saturday",
        };
        const displayNames: Record<number, string> = {
          0: "Sunday",
          1: "Monday",
          2: "Tuesday",
          3: "Wednesday",
          4: "Thursday",
          5: "Friday",
          6: "Saturday",
        };
        const dayOfWeek = dayNameMap[d.getUTCDay()];
        const formatted = `${d.getUTCMonth() + 1}/${d.getUTCDate()}/${d.getUTCFullYear()}`;
        const name = `${displayNames[d.getUTCDay()]} ${formatted}`;
        await db
          .update(routes)
          .set({ date: targetDate, dayOfWeek, name, updatedAt: new Date() })
          .where(and(eq(routes.id, routeId), eq(routes.companyId, companyId)));
        targetRouteId = routeId;
      } else {
        // Non-scheduled visits remain — create a fresh route for targetDate so source keeps its date
        const newRoute = await this.getOrCreateDailyRoute(companyId, targetDate);
        targetRouteId = newRoute.id;
      }
    }

    const moved = await db
      .update(visits)
      .set({ routeId: targetRouteId, scheduledDate: targetDate, updatedAt: new Date() })
      .where(
        and(
          eq(visits.routeId, routeId),
          eq(visits.companyId, companyId),
          eq(visits.status, "scheduled")
        )
      )
      .returning({ id: visits.id });

    return { movedCount: moved.length, targetRouteId };
  }

  async renumberRouteStops(routeId: string, companyId: string): Promise<void> {
    const stops = await db
      .select({ id: servicePlans.id })
      .from(servicePlans)
      .where(
        and(
          eq(servicePlans.routeId, routeId),
          eq(servicePlans.companyId, companyId),
          eq(servicePlans.isActive, true)
        )
      )
      .orderBy(asc(servicePlans.stopOrder), asc(servicePlans.id));

    for (let i = 0; i < stops.length; i++) {
      await db
        .update(servicePlans)
        .set({ stopOrder: i + 1, updatedAt: new Date() })
        .where(and(eq(servicePlans.id, stops[i].id), eq(servicePlans.companyId, companyId)));
    }

    if (stops.length > 0) {
      await db.execute(sql`
        UPDATE jobs
        SET stop_order = sp.stop_order, updated_at = NOW()
        FROM service_plans sp
        WHERE jobs.service_plan_id = sp.id
          AND sp.route_id = ${routeId}
          AND sp.company_id = ${companyId}
          AND sp.is_active = true
      `);
    }
  }

  async reorderRouteStops(routeId: string, companyId: string, orderedIds: string[]): Promise<void> {
    await db.transaction(async (tx) => {
      for (let i = 0; i < orderedIds.length; i++) {
        await tx
          .update(servicePlans)
          .set({ stopOrder: i + 1, updatedAt: new Date() })
          .where(
            and(
              eq(servicePlans.id, orderedIds[i]),
              eq(servicePlans.routeId, routeId),
              eq(servicePlans.companyId, companyId)
            )
          );
      }
      if (orderedIds.length > 0) {
        await tx.execute(sql`
          UPDATE jobs
          SET stop_order = sp.stop_order, updated_at = NOW()
          FROM service_plans sp
          WHERE jobs.service_plan_id = sp.id
            AND sp.route_id = ${routeId}
            AND sp.company_id = ${companyId}
            AND sp.is_active = true
        `);
      }
    });
  }

  // ================ Agreements ================
  async getAgreement(id: string, companyId: string): Promise<Agreement | undefined> {
    const [a] = await db
      .select()
      .from(agreements)
      .where(and(eq(agreements.id, id), eq(agreements.companyId, companyId)));
    return a;
  }

  async getAgreements(
    companyId: string,
    filters?: { contactId?: string; isActive?: boolean }
  ): Promise<Agreement[]> {
    const conditions = [eq(agreements.companyId, companyId)];
    if (filters?.contactId) conditions.push(eq(agreements.contactId, filters.contactId));
    if (filters?.isActive !== undefined) conditions.push(eq(agreements.isActive, filters.isActive));
    return db
      .select()
      .from(agreements)
      .where(and(...conditions));
  }

  async createAgreement(data: InsertAgreement): Promise<Agreement> {
    const [a] = await db.insert(agreements).values(data).returning();
    return a;
  }

  async updateAgreement(
    id: string,
    companyId: string,
    data: Partial<InsertAgreement>
  ): Promise<Agreement> {
    const [a] = await db
      .update(agreements)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(agreements.id, id), eq(agreements.companyId, companyId)))
      .returning();
    return a;
  }

  async deleteAgreement(id: string, companyId: string): Promise<void> {
    await db
      .delete(agreements)
      .where(and(eq(agreements.id, id), eq(agreements.companyId, companyId)));
  }

  async getAgreementByServicePlanId(servicePlanId: string): Promise<Agreement | undefined> {
    const [a] = await db
      .select()
      .from(agreements)
      .where(eq(agreements.servicePlanId, servicePlanId));
    return a;
  }

  // ================ Jobs ================
  async getJob(id: string, companyId: string): Promise<Job | undefined> {
    const [j] = await db
      .select()
      .from(jobs)
      .where(and(eq(jobs.id, id), eq(jobs.companyId, companyId)));
    return j;
  }

  async getJobs(
    companyId: string,
    filters?: { agreementId?: string; propertyId?: string; routeId?: string; jobStatus?: string }
  ): Promise<Job[]> {
    const conditions = [eq(jobs.companyId, companyId)];
    if (filters?.agreementId) conditions.push(eq(jobs.agreementId, filters.agreementId));
    if (filters?.propertyId) conditions.push(eq(jobs.propertyId, filters.propertyId));
    if (filters?.routeId) conditions.push(eq(jobs.routeId, filters.routeId));
    if (filters?.jobStatus) conditions.push(sql`${jobs.jobStatus} = ${filters.jobStatus}`);
    return db
      .select()
      .from(jobs)
      .where(and(...conditions));
  }

  async createJob(data: InsertJob): Promise<Job> {
    const [j] = await db.insert(jobs).values(data).returning();
    return j;
  }

  async updateJob(id: string, companyId: string, data: Partial<InsertJob>): Promise<Job> {
    const [j] = await db
      .update(jobs)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(jobs.id, id), eq(jobs.companyId, companyId)))
      .returning();
    return j;
  }

  async deleteJob(id: string, companyId: string): Promise<void> {
    await db.delete(jobs).where(and(eq(jobs.id, id), eq(jobs.companyId, companyId)));
  }

  async getJobByServicePlanId(servicePlanId: string): Promise<Job | undefined> {
    const [j] = await db.select().from(jobs).where(eq(jobs.servicePlanId, servicePlanId));
    return j;
  }

  async getJobsWithAgreements(
    companyId: string,
    filters?: { isActive?: boolean; routeId?: string; propertyId?: string; contactId?: string }
  ): Promise<JobWithAgreement[]> {
    const conditions = [eq(jobs.companyId, companyId)];
    if (filters?.isActive !== undefined) conditions.push(eq(agreements.isActive, filters.isActive));
    if (filters?.routeId) conditions.push(eq(jobs.routeId, filters.routeId));
    if (filters?.propertyId) conditions.push(eq(jobs.propertyId, filters.propertyId));
    if (filters?.contactId) conditions.push(eq(agreements.contactId, filters.contactId));
    const rows = await db
      .select({
        job: jobs,
        agreement: agreements,
      })
      .from(jobs)
      .innerJoin(agreements, eq(jobs.agreementId, agreements.id))
      .where(and(...conditions));
    return rows.map((r) => ({
      ...r.job,
      contactId: r.agreement.contactId,
      frequency: r.agreement.frequency,
      pricePerVisit: r.agreement.pricePerVisit,
      startDate: r.agreement.startDate,
      endDate: r.agreement.endDate,
      endsAfterCount: r.agreement.endsAfterCount,
      endsAfterUnit: r.agreement.endsAfterUnit,
      estimateId: r.agreement.estimateId,
      agreementIsActive: r.agreement.isActive,
      agreementPausedAt: r.agreement.pausedAt,
      isActive: r.agreement.isActive,
      pausedAt: r.agreement.pausedAt,
    }));
  }

  async getJobAddOns(jobId: string): Promise<JobAddOn[]> {
    return db.select().from(jobAddOns).where(eq(jobAddOns.jobId, jobId));
  }

  async setJobAddOns(
    jobId: string,
    addOns: { servicePricingId: string; name: string; price: string }[]
  ): Promise<JobAddOn[]> {
    await db.delete(jobAddOns).where(eq(jobAddOns.jobId, jobId));
    if (addOns.length === 0) return [];
    const rows = addOns.map((a) => ({
      jobId,
      servicePricingId: a.servicePricingId,
      name: a.name,
      price: a.price,
    }));
    return db.insert(jobAddOns).values(rows).returning();
  }

  async cancelFutureVisitsForJobs(jobIds: string[], fromDate: string): Promise<number> {
    if (jobIds.length === 0) return 0;
    const result = await db
      .update(visits)
      .set({ status: "cancelled" })
      .where(
        and(
          sql`${visits.jobId} IN (${sql.join(
            jobIds.map((id) => sql`${id}`),
            sql`, `
          )})`,
          gte(visits.scheduledDate, fromDate),
          eq(visits.status, "scheduled")
        )
      )
      .returning();
    return result.length;
  }

  async unassignAllJobStops(routeId: string): Promise<number> {
    const result = await db
      .update(jobs)
      .set({ routeId: null, stopOrder: 0, updatedAt: new Date() })
      .where(and(eq(jobs.routeId, routeId), eq(jobs.jobStatus, "active")))
      .returning();
    return result.length;
  }

  async getVacationHoldsForAgreements(agreementIds: string[]): Promise<VacationHold[]> {
    if (agreementIds.length === 0) return [];
    return db
      .select()
      .from(vacationHolds)
      .where(
        sql`${vacationHolds.agreementId} IN (${sql.join(
          agreementIds.map((id) => sql`${id}`),
          sql`, `
        )})`
      );
  }

  // ================ Service Plans (legacy) ================
  async getServicePlan(id: string, companyId: string): Promise<ServicePlan | undefined> {
    const [sp] = await db
      .select()
      .from(servicePlans)
      .where(and(eq(servicePlans.id, id), eq(servicePlans.companyId, companyId)));
    return sp;
  }

  async getServicePlans(
    companyId: string,
    filters?: { contactId?: string; propertyId?: string; isActive?: boolean; routeId?: string }
  ): Promise<ServicePlan[]> {
    const conditions = [eq(servicePlans.companyId, companyId)];
    if (filters?.contactId) conditions.push(eq(servicePlans.contactId, filters.contactId));
    if (filters?.propertyId) conditions.push(eq(servicePlans.propertyId, filters.propertyId));
    if (filters?.isActive !== undefined)
      conditions.push(eq(servicePlans.isActive, filters.isActive));
    if (filters?.routeId) conditions.push(eq(servicePlans.routeId, filters.routeId));
    return db
      .select()
      .from(servicePlans)
      .where(and(...conditions));
  }

  async createServicePlan(data: InsertServicePlan): Promise<ServicePlan> {
    const [sp] = await db.insert(servicePlans).values(data).returning();
    return sp;
  }

  async updateServicePlan(
    id: string,
    companyId: string,
    data: Partial<InsertServicePlan>
  ): Promise<ServicePlan> {
    const shouldInvalidate = "routeId" in data || "dayOfWeek" in data || data.isActive === false;

    let affectedRouteIds: string[] = [];
    if (shouldInvalidate) {
      const [existing] = await db
        .select({ routeId: servicePlans.routeId })
        .from(servicePlans)
        .where(and(eq(servicePlans.id, id), eq(servicePlans.companyId, companyId)));
      if (existing?.routeId) affectedRouteIds.push(existing.routeId);
      if (data.routeId && data.routeId !== existing?.routeId) affectedRouteIds.push(data.routeId);
    }

    const [sp] = await db
      .update(servicePlans)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(servicePlans.id, id), eq(servicePlans.companyId, companyId)))
      .returning();

    if (affectedRouteIds.length > 0) {
      const uniqueIds = affectedRouteIds.filter((id, idx, arr) => arr.indexOf(id) === idx);
      for (const routeId of uniqueIds) {
        db.update(routes)
          .set({ lastOptimizedAt: null, optimizedStopHash: null, updatedAt: new Date() })
          .where(and(eq(routes.id, routeId), eq(routes.companyId, companyId)))
          .execute()
          .catch(() => {});
      }
    }

    return sp;
  }

  async deleteServicePlan(id: string, companyId: string): Promise<void> {
    await db
      .delete(servicePlans)
      .where(and(eq(servicePlans.id, id), eq(servicePlans.companyId, companyId)));
  }

  async getServicePlanAddOns(servicePlanId: string): Promise<ServicePlanAddOn[]> {
    return db
      .select()
      .from(servicePlanAddOns)
      .where(eq(servicePlanAddOns.servicePlanId, servicePlanId));
  }

  async getAllServicePlanAddOnsForCompany(
    planIds: string[]
  ): Promise<Map<string, ServicePlanAddOn[]>> {
    const result = new Map<string, ServicePlanAddOn[]>();
    if (planIds.length === 0) return result;
    const allAddOns = await db
      .select()
      .from(servicePlanAddOns)
      .where(inArray(servicePlanAddOns.servicePlanId, planIds));
    for (const addOn of allAddOns) {
      if (!result.has(addOn.servicePlanId)) result.set(addOn.servicePlanId, []);
      result.get(addOn.servicePlanId)!.push(addOn);
    }
    return result;
  }

  async setServicePlanAddOns(
    servicePlanId: string,
    addOns: { servicePricingId: string; name: string; price: string }[]
  ): Promise<ServicePlanAddOn[]> {
    await db.delete(servicePlanAddOns).where(eq(servicePlanAddOns.servicePlanId, servicePlanId));
    if (addOns.length === 0) return [];
    const rows = addOns.map((a) => ({
      servicePlanId,
      servicePricingId: a.servicePricingId,
      name: a.name,
      price: a.price,
    }));
    return db.insert(servicePlanAddOns).values(rows).returning();
  }

  async cancelFutureVisitsForPlans(planIds: string[], fromDate: string): Promise<number> {
    if (planIds.length === 0) return 0;
    const result = await db
      .update(visits)
      .set({ status: "cancelled" })
      .where(
        and(
          inArray(visits.servicePlanId, planIds),
          gte(visits.scheduledDate, fromDate),
          eq(visits.status, "scheduled")
        )
      )
      .returning();
    return result.length;
  }

  async deleteFutureScheduledVisitsForPlans(planIds: string[], afterDate: string): Promise<number> {
    if (planIds.length === 0) return 0;
    const result = await db
      .delete(visits)
      .where(
        and(
          inArray(visits.servicePlanId, planIds),
          sql`${visits.scheduledDate} > ${afterDate}`,
          eq(visits.status, "scheduled")
        )
      )
      .returning();
    return result.length;
  }

  async unassignAllStops(routeId: string): Promise<number> {
    const result = await db
      .update(servicePlans)
      .set({ routeId: null, stopOrder: 0, updatedAt: new Date() })
      .where(and(eq(servicePlans.routeId, routeId), eq(servicePlans.isActive, true)))
      .returning();
    return result.length;
  }

  // ================ Vacation Holds ================
  async getVacationHolds(servicePlanId: string): Promise<VacationHold[]> {
    return db.select().from(vacationHolds).where(eq(vacationHolds.servicePlanId, servicePlanId));
  }

  async getVacationHoldsForPlans(planIds: string[]): Promise<VacationHold[]> {
    if (planIds.length === 0) return [];
    return db.select().from(vacationHolds).where(inArray(vacationHolds.servicePlanId, planIds));
  }

  async createVacationHold(data: InsertVacationHold): Promise<VacationHold> {
    const [vh] = await db.insert(vacationHolds).values(data).returning();
    return vh;
  }

  async deleteVacationHold(id: string, companyId: string): Promise<void> {
    const [hold] = await db
      .select({ id: vacationHolds.id })
      .from(vacationHolds)
      .innerJoin(servicePlans, eq(vacationHolds.servicePlanId, servicePlans.id))
      .where(and(eq(vacationHolds.id, id), eq(servicePlans.companyId, companyId)));
    if (!hold) return;
    await db.delete(vacationHolds).where(eq(vacationHolds.id, id));
  }

  // ================ Visits ================
  async getVisit(id: string, companyId: string): Promise<Visit | undefined> {
    const [visit] = await db
      .select()
      .from(visits)
      .where(and(eq(visits.id, id), eq(visits.companyId, companyId)));
    return visit;
  }

  async getVisits(
    companyId: string,
    filters?: { date?: string; routeId?: string; status?: string }
  ): Promise<Visit[]> {
    const conditions = [eq(visits.companyId, companyId)];
    if (filters?.date) conditions.push(eq(visits.scheduledDate, filters.date));
    if (filters?.routeId) conditions.push(eq(visits.routeId, filters.routeId));
    if (filters?.status)
      conditions.push(eq(visits.status, filters.status as (typeof visits.$inferSelect)["status"]));
    return db
      .select()
      .from(visits)
      .where(and(...conditions))
      .orderBy(asc(visits.scheduledDate));
  }

  async getVisitsForDateRange(
    companyId: string,
    startDate: string,
    endDate: string
  ): Promise<Visit[]> {
    return db
      .select()
      .from(visits)
      .where(
        and(
          eq(visits.companyId, companyId),
          gte(visits.scheduledDate, startDate),
          lte(visits.scheduledDate, endDate)
        )
      )
      .orderBy(asc(visits.scheduledDate));
  }

  async getOverdueVisits(companyId: string, beforeDate: string): Promise<Visit[]> {
    return db
      .select()
      .from(visits)
      .where(
        and(
          eq(visits.companyId, companyId),
          lt(visits.scheduledDate, beforeDate),
          inArray(visits.status, ["scheduled", "in_progress"])
        )
      )
      .orderBy(asc(visits.scheduledDate));
  }

  async createVisit(data: InsertVisit): Promise<Visit | null> {
    const [visit] = await db.insert(visits).values(data).onConflictDoNothing().returning();
    return visit ?? null;
  }

  async updateVisit(id: string, companyId: string, data: Partial<InsertVisit>): Promise<Visit> {
    const [visit] = await db
      .update(visits)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(visits.id, id), eq(visits.companyId, companyId)))
      .returning();
    return visit;
  }

  async getTodaysVisitsCount(companyId: string, today: string): Promise<number> {
    const [result] = await db
      .select({ count: count() })
      .from(visits)
      .where(and(eq(visits.companyId, companyId), eq(visits.scheduledDate, today)));
    return result?.count ?? 0;
  }

  async getTodaysVisits(companyId: string, today: string): Promise<Visit[]> {
    return db
      .select()
      .from(visits)
      .where(and(eq(visits.companyId, companyId), eq(visits.scheduledDate, today)));
  }

  async getOverdueInvoicesCount(companyId: string, today: string): Promise<number> {
    const [result] = await db
      .select({ count: count() })
      .from(invoices)
      .where(
        and(
          eq(invoices.companyId, companyId),
          inArray(invoices.status, ["pending"]),
          lt(invoices.dueDate, today)
        )
      );
    return result?.count ?? 0;
  }

  async getActiveContactsCount(companyId: string): Promise<number> {
    const [result] = await db
      .select({ count: count() })
      .from(contacts)
      .where(and(eq(contacts.companyId, companyId), eq(contacts.status, "active")));
    return result?.count ?? 0;
  }

  async getActiveServicePlansCount(companyId: string): Promise<number> {
    const [result] = await db
      .select({ count: count() })
      .from(servicePlans)
      .where(and(eq(servicePlans.companyId, companyId), eq(servicePlans.isActive, true)));
    return result?.count ?? 0;
  }

  // ================ Invoices ================
  async getInvoice(id: string, companyId: string): Promise<Invoice | undefined> {
    const [invoice] = await db
      .select()
      .from(invoices)
      .where(and(eq(invoices.id, id), eq(invoices.companyId, companyId)));
    return invoice;
  }

  async getInvoiceById(id: string): Promise<Invoice | undefined> {
    const [invoice] = await db.select().from(invoices).where(eq(invoices.id, id));
    return invoice;
  }

  async getInvoiceByPayToken(token: string): Promise<Invoice | undefined> {
    const [invoice] = await db.select().from(invoices).where(eq(invoices.payToken, token));
    return invoice;
  }

  async ensureInvoicePayToken(id: string, companyId: string): Promise<string> {
    const existing = await this.getInvoice(id, companyId);
    if (existing?.payToken) return existing.payToken;
    const { randomBytes } = await import("crypto");
    const token = randomBytes(32).toString("hex");
    await db
      .update(invoices)
      .set({ payToken: token })
      .where(and(eq(invoices.id, id), eq(invoices.companyId, companyId)));
    return token;
  }

  async getInvoices(
    companyId: string,
    filters?: { contactId?: string; status?: string }
  ): Promise<Invoice[]> {
    const conditions = [eq(invoices.companyId, companyId)];
    if (filters?.contactId) conditions.push(eq(invoices.contactId, filters.contactId));
    if (filters?.status)
      conditions.push(
        eq(invoices.status, filters.status as (typeof invoices.$inferSelect)["status"])
      );
    return db
      .select()
      .from(invoices)
      .where(and(...conditions))
      .orderBy(desc(invoices.createdAt));
  }

  async getInvoicesPage(
    companyId: string,
    filters?: { contactId?: string; status?: string; excludeVoided?: boolean },
    page: number = 1,
    limit: number = 50
  ): Promise<{ data: Invoice[]; total: number }> {
    const conditions = [eq(invoices.companyId, companyId)];
    if (filters?.contactId) conditions.push(eq(invoices.contactId, filters.contactId));

    if (filters?.status === "overdue") {
      // Invoices that are past their due date and not yet paid or voided
      conditions.push(
        sql`${invoices.status} NOT IN ('paid', 'voided')`,
        sql`${invoices.dueDate} IS NOT NULL`,
        sql`${invoices.dueDate} < CURRENT_DATE`
      );
    } else if (filters?.status === "unpaid") {
      // Draft/sent/pending invoices that are not yet past due
      conditions.push(
        sql`${invoices.status} IN ('draft', 'sent', 'pending')`,
        sql`(${invoices.dueDate} IS NULL OR ${invoices.dueDate} >= CURRENT_DATE)`
      );
    } else {
      if (filters?.status)
        conditions.push(
          eq(invoices.status, filters.status as (typeof invoices.$inferSelect)["status"])
        );
      if (filters?.excludeVoided) conditions.push(sql`${invoices.status} != 'voided'`);
    }

    const offset = (page - 1) * limit;
    const [data, countResult] = await Promise.all([
      db
        .select()
        .from(invoices)
        .where(and(...conditions))
        .orderBy(desc(invoices.createdAt))
        .limit(limit)
        .offset(offset),
      db
        .select({ total: sql<number>`COUNT(*)::int` })
        .from(invoices)
        .where(and(...conditions)),
    ]);
    return { data, total: countResult[0]?.total ?? 0 };
  }

  async createInvoice(data: InsertInvoice): Promise<Invoice> {
    const { randomBytes } = await import("crypto");
    const payToken = randomBytes(32).toString("hex");
    const [invoice] = await db
      .insert(invoices)
      .values({ ...data, payToken })
      .returning();
    return invoice;
  }

  async updateInvoice(
    id: string,
    companyId: string,
    data: Partial<InsertInvoice>
  ): Promise<Invoice> {
    const [invoice] = await db
      .update(invoices)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(invoices.id, id), eq(invoices.companyId, companyId)))
      .returning();
    return invoice;
  }

  async getNextInvoiceNumber(companyId: string): Promise<string> {
    const [result] = await db
      .select({
        maxNum: sql<string>`MAX(
        CASE WHEN ${invoices.invoiceNumber} ~ '^INV-[0-9]+$'
        THEN CAST(SUBSTRING(${invoices.invoiceNumber} FROM 5) AS integer)
        ELSE 0 END
      )`,
      })
      .from(invoices)
      .where(eq(invoices.companyId, companyId));
    const num = (parseInt(result?.maxNum || "0") || 0) + 1;
    return `INV-${String(num).padStart(5, "0")}`;
  }

  async getFailedPaymentsCount(companyId: string): Promise<number> {
    const [result] = await db
      .select({ count: count() })
      .from(invoices)
      .where(and(eq(invoices.companyId, companyId), eq(invoices.status, "failed")));
    return result?.count ?? 0;
  }

  async getRevenueForPeriod(
    companyId: string,
    startDate: string,
    endDate: string,
    timezone: string = "UTC"
  ): Promise<number> {
    const [result] = await db
      .select({
        total: sql<string>`COALESCE(SUM(${invoices.total}::numeric), 0)`,
      })
      .from(invoices)
      .where(
        sql`${invoices.companyId} = ${companyId}
        AND ${invoices.status} IN ('sent', 'pending', 'paid', 'failed')
        AND COALESCE(${invoices.issuedDate}, ((${invoices.createdAt} AT TIME ZONE 'UTC') AT TIME ZONE ${timezone})::date) >= ${startDate}::date
        AND COALESCE(${invoices.issuedDate}, ((${invoices.createdAt} AT TIME ZONE 'UTC') AT TIME ZONE ${timezone})::date) <= ${endDate}::date`
      );
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

  async deleteInvoiceLineItems(invoiceId: string): Promise<void> {
    await db.delete(invoiceLineItems).where(eq(invoiceLineItems.invoiceId, invoiceId));
  }

  async deleteInvoice(id: string, companyId: string): Promise<void> {
    await db.delete(invoicePayments).where(eq(invoicePayments.invoiceId, id));
    await db.delete(invoiceLineItems).where(eq(invoiceLineItems.invoiceId, id));
    await db.update(visits).set({ invoiceId: null }).where(eq(visits.invoiceId, id));
    await db.delete(invoices).where(and(eq(invoices.id, id), eq(invoices.companyId, companyId)));
  }

  async isVisitInvoiced(visitId: string): Promise<boolean> {
    const [result] = await db
      .select({ count: count() })
      .from(invoiceLineItems)
      .where(eq(invoiceLineItems.visitId, visitId));
    return (result?.count ?? 0) > 0;
  }

  async getUninvoicedCompletedVisits(
    companyId: string,
    contactId: string,
    startDate: string,
    endDate: string
  ): Promise<Visit[]> {
    const allVisits = await db
      .select()
      .from(visits)
      .where(
        and(
          eq(visits.companyId, companyId),
          eq(visits.status, "completed"),
          gte(visits.scheduledDate, startDate),
          lte(visits.scheduledDate, endDate)
        )
      );
    const contactPlans = await db
      .select()
      .from(servicePlans)
      .where(and(eq(servicePlans.companyId, companyId), eq(servicePlans.contactId, contactId)));
    const nonStopOnlyPlanIds = new Set(contactPlans.filter((p) => !p.isStopOnly).map((p) => p.id));
    const contactVisits = allVisits.filter((v) => nonStopOnlyPlanIds.has(v.servicePlanId));
    const uninvoiced: Visit[] = [];
    for (const v of contactVisits) {
      const invoiced = await this.isVisitInvoiced(v.id);
      if (!invoiced) uninvoiced.push(v);
    }
    return uninvoiced;
  }

  async getScheduledVisitsForRange(
    companyId: string,
    contactId: string,
    startDate: string,
    endDate: string
  ): Promise<Visit[]> {
    const allVisits = await db
      .select()
      .from(visits)
      .where(
        and(
          eq(visits.companyId, companyId),
          gte(visits.scheduledDate, startDate),
          lte(visits.scheduledDate, endDate)
        )
      );
    const contactPlans = await db
      .select()
      .from(servicePlans)
      .where(and(eq(servicePlans.companyId, companyId), eq(servicePlans.contactId, contactId)));
    const planIds = new Set(contactPlans.map((p) => p.id));
    const contactVisits = allVisits.filter((v) => planIds.has(v.servicePlanId));
    const uninvoiced: Visit[] = [];
    for (const v of contactVisits) {
      const invoiced = await this.isVisitInvoiced(v.id);
      if (!invoiced) uninvoiced.push(v);
    }
    return uninvoiced;
  }

  async createInvoiceWithLineItems(
    invoiceData: InsertInvoice,
    lineItems: Omit<InsertInvoiceLineItem, "invoiceId">[]
  ): Promise<Invoice> {
    const [invoice] = await db.insert(invoices).values(invoiceData).returning();
    for (const item of lineItems) {
      await db.insert(invoiceLineItems).values({ ...item, invoiceId: invoice.id });
    }
    return invoice;
  }

  async getUninvoicedSummary(companyId: string): Promise<{
    count: number;
    totalDollars: number;
    byContact: { contactId: string; contactName: string; count: number; totalDollars: number }[];
  }> {
    const completedVisits = await db
      .select()
      .from(visits)
      .where(and(eq(visits.companyId, companyId), eq(visits.status, "completed")));

    const allLineItems = await db
      .select({ visitId: invoiceLineItems.visitId })
      .from(invoiceLineItems)
      .where(sql`${invoiceLineItems.visitId} IS NOT NULL`);
    const invoicedVisitIds = new Set(allLineItems.map((li) => li.visitId));
    const uninvoiced = completedVisits.filter((v) => !invoicedVisitIds.has(v.id));

    if (uninvoiced.length === 0) {
      return { count: 0, totalDollars: 0, byContact: [] };
    }

    const planIds = Array.from(new Set(uninvoiced.map((v) => v.servicePlanId)));
    const plans =
      planIds.length > 0
        ? await db.select().from(servicePlans).where(inArray(servicePlans.id, planIds))
        : [];
    const planMap = new Map(plans.map((p) => [p.id, p]));

    const contactIds = Array.from(new Set(plans.map((p) => p.contactId)));
    const contactsList =
      contactIds.length > 0
        ? await db.select().from(contacts).where(inArray(contacts.id, contactIds))
        : [];
    const contactMap = new Map(contactsList.map((c) => [c.id, c]));

    const byContactMap = new Map<
      string,
      { contactId: string; contactName: string; count: number; totalDollars: number }
    >();
    let totalDollars = 0;

    for (const v of uninvoiced) {
      const plan = planMap.get(v.servicePlanId);
      if (!plan || plan.isStopOnly) continue;
      const price = parseFloat(plan.pricePerVisit) || 0;
      totalDollars += price;
      const contact = contactMap.get(plan.contactId);
      const contactName = contact ? `${contact.firstName} ${contact.lastName}` : "Unknown";
      const existing = byContactMap.get(plan.contactId);
      if (existing) {
        existing.count++;
        existing.totalDollars += price;
      } else {
        byContactMap.set(plan.contactId, {
          contactId: plan.contactId,
          contactName,
          count: 1,
          totalDollars: price,
        });
      }
    }

    const totalCount = Array.from(byContactMap.values()).reduce((sum, c) => sum + c.count, 0);
    return {
      count: totalCount,
      totalDollars: Math.round(totalDollars * 100) / 100,
      byContact: Array.from(byContactMap.values()).sort((a, b) => b.totalDollars - a.totalDollars),
    };
  }

  async getVisitsForContact(
    companyId: string,
    contactId: string,
    limit: number,
    offset: number
  ): Promise<{
    visits: {
      id: string;
      scheduledDate: string;
      status: string;
      servicePlanName: string;
      propertyAddress: string;
      completedAt: Date | null;
      startedAt: Date | null;
    }[];
    total: number;
  }> {
    const contactPlans = await db
      .select()
      .from(servicePlans)
      .where(and(eq(servicePlans.companyId, companyId), eq(servicePlans.contactId, contactId)));
    if (contactPlans.length === 0) return { visits: [], total: 0 };

    const planIds = contactPlans.map((p) => p.id);
    const [countResult] = await db
      .select({ count: count() })
      .from(visits)
      .where(and(eq(visits.companyId, companyId), inArray(visits.servicePlanId, planIds)));
    const total = countResult?.count ?? 0;

    const allVisits = await db
      .select()
      .from(visits)
      .where(and(eq(visits.companyId, companyId), inArray(visits.servicePlanId, planIds)))
      .orderBy(desc(visits.scheduledDate))
      .limit(limit)
      .offset(offset);

    const planMap = new Map(contactPlans.map((p) => [p.id, p]));
    const propertyIds = Array.from(new Set(contactPlans.map((p) => p.propertyId)));
    const propsList =
      propertyIds.length > 0
        ? await db.select().from(properties).where(inArray(properties.id, propertyIds))
        : [];
    const propMap = new Map(propsList.map((p) => [p.id, p]));

    const enriched = allVisits.map((v) => {
      const plan = planMap.get(v.servicePlanId);
      const prop = plan ? propMap.get(plan.propertyId) : undefined;
      return {
        id: v.id,
        scheduledDate: v.scheduledDate,
        status: v.status,
        servicePlanName: plan?.frequency
          ? `${plan.frequency.charAt(0).toUpperCase() + plan.frequency.slice(1)} Service`
          : "Service",
        propertyAddress: prop
          ? `${prop.streetAddress}${prop.city ? `, ${prop.city}` : ""}`
          : "Unknown",
        completedAt: v.completedAt,
        startedAt: v.startedAt,
      };
    });

    return { visits: enriched, total };
  }

  async getUninvoicedVisitsForContact(
    companyId: string,
    contactId: string
  ): Promise<{
    visits: (Visit & { servicePlanName: string; pricePerVisit: string; propertyAddress: string })[];
    totalDollars: number;
  }> {
    const contactPlans = await db
      .select()
      .from(servicePlans)
      .where(and(eq(servicePlans.companyId, companyId), eq(servicePlans.contactId, contactId)));
    if (contactPlans.length === 0) return { visits: [], totalDollars: 0 };

    const planIds = contactPlans.map((p) => p.id);
    const completedVisits = await db
      .select()
      .from(visits)
      .where(
        and(
          eq(visits.companyId, companyId),
          eq(visits.status, "completed"),
          inArray(visits.servicePlanId, planIds)
        )
      );

    if (completedVisits.length === 0) return { visits: [], totalDollars: 0 };

    const allLineItems = await db
      .select({ visitId: invoiceLineItems.visitId })
      .from(invoiceLineItems)
      .where(
        inArray(
          invoiceLineItems.visitId!,
          completedVisits.map((v) => v.id)
        )
      );
    const invoicedVisitIds = new Set(allLineItems.map((li) => li.visitId));
    const uninvoiced = completedVisits.filter((v) => !invoicedVisitIds.has(v.id));

    const planMap = new Map(contactPlans.map((p) => [p.id, p]));
    const stopOnlyPlanIds = new Set(contactPlans.filter((p) => p.isStopOnly).map((p) => p.id));

    const propertyIds = Array.from(new Set(contactPlans.map((p) => p.propertyId)));
    const propsList =
      propertyIds.length > 0
        ? await db.select().from(properties).where(inArray(properties.id, propertyIds))
        : [];
    const propMap = new Map(propsList.map((p) => [p.id, p]));

    const filteredUninvoiced = uninvoiced.filter((v) => !stopOnlyPlanIds.has(v.servicePlanId));

    let totalDollars = 0;
    const enriched = filteredUninvoiced
      .map((v) => {
        const plan = planMap.get(v.servicePlanId);
        const prop = plan ? propMap.get(plan.propertyId) : undefined;
        const price = parseFloat(plan?.pricePerVisit || "0");
        totalDollars += price;
        return {
          ...v,
          servicePlanName: plan?.frequency
            ? `${plan.frequency.charAt(0).toUpperCase() + plan.frequency.slice(1)} Service`
            : "Service",
          pricePerVisit: plan?.pricePerVisit || "0",
          propertyAddress: prop
            ? `${prop.streetAddress}${prop.city ? `, ${prop.city}` : ""}`
            : "Unknown",
        };
      })
      .sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate));

    return { visits: enriched, totalDollars: Math.round(totalDollars * 100) / 100 };
  }

  // ================ Automation Rules ================
  async getAutomationRules(companyId: string): Promise<AutomationRule[]> {
    return db.select().from(automationRules).where(eq(automationRules.companyId, companyId));
  }

  async createAutomationRule(data: InsertAutomationRule): Promise<AutomationRule> {
    const [rule] = await db.insert(automationRules).values(data).returning();
    return rule;
  }

  async updateAutomationRule(
    id: string,
    companyId: string,
    data: Partial<InsertAutomationRule>
  ): Promise<AutomationRule> {
    const [rule] = await db
      .update(automationRules)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(automationRules.id, id), eq(automationRules.companyId, companyId)))
      .returning();
    return rule;
  }

  async deleteAutomationRule(id: string, companyId?: string): Promise<void> {
    await db.delete(automationEventLogs).where(eq(automationEventLogs.ruleId, id));
    const conditions = companyId
      ? and(eq(automationRules.id, id), eq(automationRules.companyId, companyId))
      : eq(automationRules.id, id);
    await db.delete(automationRules).where(conditions);
  }

  async getRulesForTrigger(companyId: string, trigger: string): Promise<AutomationRule[]> {
    return db
      .select()
      .from(automationRules)
      .where(
        and(
          eq(automationRules.companyId, companyId),
          eq(automationRules.trigger, trigger as (typeof automationRules.$inferSelect)["trigger"]),
          eq(automationRules.isActive, true)
        )
      );
  }

  async createAutomationEventLog(data: {
    companyId: string;
    ruleId?: string;
    trigger: string;
    payload?: unknown;
    result?: unknown;
  }): Promise<void> {
    await db.insert(automationEventLogs).values(data);
  }

  // ================ API Keys ================
  async getApiKeys(companyId: string): Promise<ApiKey[]> {
    return db.select().from(apiKeys).where(eq(apiKeys.companyId, companyId));
  }

  async getApiKeyByPrefix(prefix: string): Promise<ApiKey | undefined> {
    const [key] = await db.select().from(apiKeys).where(eq(apiKeys.keyPrefix, prefix));
    return key;
  }

  async createApiKey(data: InsertApiKey): Promise<ApiKey> {
    const [key] = await db.insert(apiKeys).values(data).returning();
    return key;
  }

  async updateApiKeyLastUsed(id: string): Promise<void> {
    await db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, id));
  }

  async deleteApiKey(id: string, companyId?: string): Promise<void> {
    const conditions = companyId
      ? and(eq(apiKeys.id, id), eq(apiKeys.companyId, companyId))
      : eq(apiKeys.id, id);
    await db.delete(apiKeys).where(conditions);
  }

  // ================ Webhooks ================
  async getWebhooks(companyId: string): Promise<Webhook[]> {
    return db.select().from(webhooks).where(eq(webhooks.companyId, companyId));
  }

  async createWebhook(data: InsertWebhook): Promise<Webhook> {
    const [wh] = await db.insert(webhooks).values(data).returning();
    return wh;
  }

  async updateWebhook(
    id: string,
    companyId: string,
    data: Partial<InsertWebhook>
  ): Promise<Webhook> {
    const [wh] = await db
      .update(webhooks)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(webhooks.id, id), eq(webhooks.companyId, companyId)))
      .returning();
    return wh;
  }

  async deleteWebhook(id: string, companyId?: string): Promise<void> {
    const conditions = companyId
      ? and(eq(webhooks.id, id), eq(webhooks.companyId, companyId))
      : eq(webhooks.id, id);
    await db.delete(webhooks).where(conditions);
  }

  async getWebhooksForEvent(companyId: string, event: string): Promise<Webhook[]> {
    const allWebhooks = await db
      .select()
      .from(webhooks)
      .where(and(eq(webhooks.companyId, companyId), eq(webhooks.isActive, true)));
    return allWebhooks.filter((wh) => (wh.events as string[]).includes(event));
  }

  // ================ Attachments ================
  async createAttachment(data: InsertAttachment): Promise<Attachment> {
    const [attachment] = await db.insert(attachments).values(data).returning();
    return attachment;
  }

  async getAttachments(
    companyId: string,
    filters?: { contactId?: string; propertyId?: string; visitId?: string }
  ): Promise<Attachment[]> {
    const conditions = [eq(attachments.companyId, companyId)];
    if (filters?.contactId) conditions.push(eq(attachments.contactId, filters.contactId));
    if (filters?.propertyId) conditions.push(eq(attachments.propertyId, filters.propertyId));
    if (filters?.visitId) conditions.push(eq(attachments.visitId, filters.visitId));
    return db
      .select()
      .from(attachments)
      .where(and(...conditions))
      .orderBy(desc(attachments.createdAt));
  }

  async createDocument(data: InsertAttachment): Promise<Attachment> {
    const [attachment] = await db.insert(attachments).values(data).returning();
    return attachment;
  }

  async getDocumentImports(companyId: string): Promise<Attachment[]> {
    return db
      .select()
      .from(attachments)
      .where(
        and(
          eq(attachments.companyId, companyId),
          isNull(attachments.visitId),
          isNull(attachments.propertyId),
          isNotNull(attachments.documentCategory)
        )
      )
      .orderBy(desc(attachments.createdAt));
  }

  // ================ Service Pricing ================
  async getServicePricing(companyId: string, category?: string): Promise<ServicePricingItem[]> {
    const conditions = [eq(servicePricing.companyId, companyId)];
    if (category)
      conditions.push(
        eq(servicePricing.category, category as (typeof servicePricing.$inferSelect)["category"])
      );
    return db
      .select()
      .from(servicePricing)
      .where(and(...conditions))
      .orderBy(asc(servicePricing.sortOrder), asc(servicePricing.name));
  }

  async createServicePricingItem(data: InsertServicePricing): Promise<ServicePricingItem> {
    const [item] = await db.insert(servicePricing).values(data).returning();
    return item;
  }

  async updateServicePricingItem(
    id: string,
    companyId: string,
    data: Partial<InsertServicePricing>
  ): Promise<ServicePricingItem> {
    const [item] = await db
      .update(servicePricing)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(servicePricing.id, id), eq(servicePricing.companyId, companyId)))
      .returning();
    return item;
  }

  async deleteServicePricingItem(id: string, companyId: string): Promise<void> {
    await db
      .delete(servicePricing)
      .where(and(eq(servicePricing.id, id), eq(servicePricing.companyId, companyId)));
  }

  // ================ Service Billing Rules ================
  async getServiceBillingRules(companyId: string): Promise<ServiceBillingRule[]> {
    return db
      .select()
      .from(serviceBillingRules)
      .where(eq(serviceBillingRules.companyId, companyId));
  }

  async upsertServiceBillingRule(
    companyId: string,
    servicePricingId: string,
    data: Partial<InsertServiceBillingRule>
  ): Promise<ServiceBillingRule> {
    const [rule] = await db
      .insert(serviceBillingRules)
      .values({ companyId, servicePricingId, ...data })
      .onConflictDoUpdate({
        target: [serviceBillingRules.companyId, serviceBillingRules.servicePricingId],
        set: { ...data, updatedAt: new Date() },
      })
      .returning();
    return rule;
  }

  async deleteServiceBillingRule(companyId: string, servicePricingId: string): Promise<void> {
    await db
      .delete(serviceBillingRules)
      .where(
        and(
          eq(serviceBillingRules.companyId, companyId),
          eq(serviceBillingRules.servicePricingId, servicePricingId)
        )
      );
  }

  // ================ Service Packages ================
  async getServicePackages(companyId: string): Promise<ServicePackage[]> {
    return db
      .select()
      .from(servicePackages)
      .where(eq(servicePackages.companyId, companyId))
      .orderBy(asc(servicePackages.sortOrder), asc(servicePackages.name));
  }

  async createServicePackage(data: InsertServicePackage): Promise<ServicePackage> {
    const [pkg] = await db.insert(servicePackages).values(data).returning();
    return pkg;
  }

  async updateServicePackage(
    id: string,
    companyId: string,
    data: Partial<InsertServicePackage>
  ): Promise<ServicePackage> {
    const [pkg] = await db
      .update(servicePackages)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(servicePackages.id, id), eq(servicePackages.companyId, companyId)))
      .returning();
    return pkg;
  }

  async deleteServicePackage(id: string, companyId: string): Promise<void> {
    await db
      .delete(servicePackages)
      .where(and(eq(servicePackages.id, id), eq(servicePackages.companyId, companyId)));
  }

  // ================ Seed Default Pricing ================
  async seedDefaultPricing(companyId: string): Promise<void> {
    const existingPricing = await this.getServicePricing(companyId);
    const existingPackages = await this.getServicePackages(companyId);

    if (existingPricing.length === 0) {
      const rules = DEFAULT_PRICING_RULES;
      const inc = rules.perDogRule.incrementDogs;

      const frequencies = [
        {
          label: "Weekly Scooping",
          base: rules.basePrices.weekly,
          unit: "per_week",
          descPrefix: "Once per week yard cleanup",
        },
        {
          label: "Twice Weekly Scooping",
          base: rules.basePrices.twiceWeekly,
          unit: "per_visit",
          descPrefix: "Two visits per week",
        },
        {
          label: "Bi-Weekly Scooping",
          base: rules.basePrices.biWeekly,
          unit: "per_visit",
          descPrefix: "Every other week yard cleanup",
        },
      ];

      let sortOrder = 1;
      for (const freq of frequencies) {
        for (let dogs = 1; dogs <= rules.perDogRule.maxDogs; dogs++) {
          const surchargeSteps = Math.floor((dogs - 1) / inc);
          const price = freq.base + surchargeSteps * rules.perDogRule.surchargeAmount;
          await this.createServicePricingItem({
            companyId,
            category: "recurring_service",
            name: `${freq.label} ${dogs} ${dogs === 1 ? "Dog" : "Dogs"}`,
            description: `${freq.descPrefix} for ${dogs} ${dogs === 1 ? "dog" : "dogs"}`,
            basePrice: price.toFixed(2),
            unit: freq.unit,
            sortOrder: sortOrder++,
            metadata: { ruleGenerated: true },
          });
        }
        await this.createServicePricingItem({
          companyId,
          category: "recurring_service",
          name: `${freq.label} ${rules.perDogRule.maxDogs + 1}+ Dogs`,
          description: `${freq.descPrefix} for ${rules.perDogRule.maxDogs + 1}+ dogs - call for quote`,
          basePrice: "0.00",
          unit: freq.unit,
          sortOrder: sortOrder++,
          metadata: { callForQuote: true, ruleGenerated: true },
        });
      }

      const defaultNonRecurring: Omit<InsertServicePricing, "companyId">[] = [
        {
          category: "one_time_service",
          name: "One-Time Cleaning (First 5-Gal Bucket)",
          description: "Initial one-time cleanup, first 5-gallon bucket",
          basePrice: "49.99",
          unit: "flat_rate",
          sortOrder: 1,
        },
        {
          category: "one_time_service",
          name: "One-Time Cleaning (Additional 5-Gal Bucket)",
          description: "Additional 5-gallon bucket for one-time cleanup",
          basePrice: "24.99",
          unit: "flat_rate",
          sortOrder: 2,
        },
        {
          category: "add_on",
          name: "Front/Side Yard",
          description: "Additional service for front or side yard areas",
          basePrice: "7.99",
          unit: "per_visit",
          sortOrder: 1,
        },
        {
          category: "add_on",
          name: "Deck",
          description: "Deck cleaning and waste removal",
          basePrice: "5.99",
          unit: "per_visit",
          sortOrder: 2,
        },
        {
          category: "add_on",
          name: "Deodorizing (with Scoop)",
          description: "Deodorizing treatment included with scooping service",
          basePrice: "9.99",
          unit: "per_visit",
          sortOrder: 3,
        },
        {
          category: "add_on",
          name: "Waste Take-Away",
          description: "Removal of collected waste from property",
          basePrice: "5.99",
          unit: "per_visit",
          sortOrder: 4,
        },
      ];

      for (const item of defaultNonRecurring) {
        await this.createServicePricingItem({ ...item, companyId });
      }

      let yardSort = 100;
      for (const tier of rules.yardSizeTiers) {
        await this.createServicePricingItem({
          companyId,
          category: "add_on",
          name: `Lot Size up to ${tier.upToAcres} Acre`,
          description:
            tier.surcharge === 0
              ? `No additional charge for lots up to ${tier.upToAcres} acre`
              : `Additional charge for lots up to ${tier.upToAcres} acre`,
          basePrice: tier.surcharge.toFixed(2),
          unit: "per_visit",
          sortOrder: yardSort++,
          metadata: { ruleGenerated: true },
        });
      }

      const company = await this.getCompany(companyId);
      if (company) {
        const existingConfig = (company.pricingConfig || {}) as Record<string, unknown>;
        await this.updateCompany(companyId, {
          pricingConfig: { ...existingConfig, pricingRules: rules },
        } as Partial<InsertCompany>);
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
        includedItems: [
          "Twice Weekly Scooping 2 Dog",
          "Deodorizing (with Scoop)",
          "Waste Take-Away",
        ],
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

  // ================ Messages ================
  async getMessages(
    companyId: string,
    filters?: {
      contactId?: string;
      channel?: string;
      direction?: string;
      isRead?: boolean;
      phone?: string;
      emailThreadId?: string;
      retentionDays?: number;
    }
  ): Promise<Message[]> {
    const conditions = [eq(messages.companyId, companyId)];
    if (filters?.retentionDays && filters.retentionDays > 0) {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - filters.retentionDays);
      conditions.push(gte(messages.createdAt, cutoff));
    }
    if (filters?.contactId) conditions.push(eq(messages.contactId, filters.contactId));
    if (filters?.channel)
      conditions.push(
        eq(messages.channel, filters.channel as (typeof messages.$inferSelect)["channel"])
      );
    if (filters?.direction)
      conditions.push(
        eq(messages.direction, filters.direction as (typeof messages.$inferSelect)["direction"])
      );
    if (filters?.isRead !== undefined) conditions.push(eq(messages.isRead, filters.isRead));
    if (filters?.phone) {
      conditions.push(
        or(eq(messages.fromAddress, filters.phone), eq(messages.toAddress, filters.phone))!
      );
    }
    if (filters?.emailThreadId) {
      conditions.push(
        or(
          eq(messages.emailThreadId, filters.emailThreadId),
          and(isNull(messages.emailThreadId), eq(messages.id, filters.emailThreadId))
        )!
      );
    }
    return db
      .select()
      .from(messages)
      .where(and(...conditions))
      .orderBy(desc(messages.createdAt));
  }

  async markMessageRead(id: string, companyId: string): Promise<Message> {
    const [msg] = await db
      .update(messages)
      .set({ isRead: true })
      .where(and(eq(messages.id, id), eq(messages.companyId, companyId)))
      .returning();
    return msg;
  }

  async markMessagesReadByContact(contactId: string, companyId: string): Promise<void> {
    await db
      .update(messages)
      .set({ isRead: true })
      .where(
        and(
          eq(messages.companyId, companyId),
          eq(messages.contactId, contactId),
          eq(messages.channel, "sms"),
          eq(messages.direction, "inbound"),
          eq(messages.isRead, false)
        )
      );
  }

  async markMessagesReadByPhone(phone: string, companyId: string): Promise<void> {
    await db
      .update(messages)
      .set({ isRead: true })
      .where(
        and(
          eq(messages.companyId, companyId),
          eq(messages.fromAddress, phone),
          eq(messages.channel, "sms"),
          eq(messages.direction, "inbound"),
          eq(messages.isRead, false)
        )
      );
  }

  async getUnreadSmsCount(companyId: string): Promise<number> {
    const result = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(messages)
      .where(
        and(
          eq(messages.companyId, companyId),
          eq(messages.channel, "sms"),
          eq(messages.direction, "inbound"),
          eq(messages.isRead, false)
        )
      );
    return result[0]?.count ?? 0;
  }

  async getUnreadEmailCount(companyId: string): Promise<number> {
    const result = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(messages)
      .where(
        and(
          eq(messages.companyId, companyId),
          eq(messages.channel, "email"),
          eq(messages.direction, "inbound"),
          eq(messages.isRead, false)
        )
      );
    return result[0]?.count ?? 0;
  }

  async getMessagesByEmailThreadId(emailThreadId: string, companyId?: string): Promise<Message[]> {
    const conditions = [eq(messages.emailThreadId, emailThreadId)];
    if (companyId) {
      conditions.push(eq(messages.companyId, companyId));
    }
    return db
      .select()
      .from(messages)
      .where(and(...conditions))
      .orderBy(messages.createdAt);
  }

  async markMessagesReadByEmail(emailThreadId: string, companyId: string): Promise<void> {
    await db
      .update(messages)
      .set({ isRead: true })
      .where(
        and(
          eq(messages.companyId, companyId),
          eq(messages.emailThreadId, emailThreadId),
          eq(messages.channel, "email"),
          eq(messages.direction, "inbound"),
          eq(messages.isRead, false)
        )
      );
  }

  async createMessage(data: InsertMessage): Promise<Message> {
    const [msg] = await db.insert(messages).values(data).returning();
    return msg;
  }

  async updateMessageStatus(id: string, status: string, errorMessage?: string): Promise<Message> {
    const updateData: Partial<typeof messages.$inferInsert> = {
      status: status as (typeof messages.$inferSelect)["status"],
    };
    if (errorMessage) updateData.errorMessage = errorMessage;
    const [msg] = await db.update(messages).set(updateData).where(eq(messages.id, id)).returning();
    return msg;
  }

  // ================ Portal Sessions ================
  async createPortalSession(data: InsertPortalSession): Promise<PortalSession> {
    const [session] = await db.insert(portalSessions).values(data).returning();
    return session;
  }

  async getPortalSessionByToken(tokenHash: string): Promise<PortalSession | undefined> {
    const [session] = await db
      .select()
      .from(portalSessions)
      .where(
        and(eq(portalSessions.tokenHash, tokenHash), gte(portalSessions.expiresAt, new Date()))
      );
    return session;
  }

  async deleteExpiredPortalSessions(): Promise<void> {
    await db.delete(portalSessions).where(lte(portalSessions.expiresAt, new Date()));
  }

  async deletePortalSession(id: string): Promise<void> {
    await db.delete(portalSessions).where(eq(portalSessions.id, id));
  }

  async getContactById(id: string): Promise<Contact | undefined> {
    const [contact] = await db.select().from(contacts).where(eq(contacts.id, id));
    return contact;
  }

  // ================ Admin (Platform-level) ================
  async getAllCompanies(): Promise<Company[]> {
    return db
      .select()
      .from(companies)
      .where(isNull(companies.deletedAt))
      .orderBy(desc(companies.createdAt));
  }

  async getPendingDeletionCompanies(): Promise<Company[]> {
    return db
      .select()
      .from(companies)
      .where(isNotNull(companies.deletedAt))
      .orderBy(desc(companies.deletedAt));
  }

  async softDeleteCompany(id: string): Promise<Company> {
    const [company] = await db
      .update(companies)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(companies.id, id))
      .returning();
    return company;
  }

  async restoreCompany(id: string): Promise<Company> {
    const [company] = await db
      .update(companies)
      .set({ deletedAt: null, updatedAt: new Date() })
      .where(eq(companies.id, id))
      .returning();
    return company;
  }

  async getAdminNotes(companyId: string): Promise<AdminNote[]> {
    return db
      .select()
      .from(adminNotes)
      .where(eq(adminNotes.companyId, companyId))
      .orderBy(desc(adminNotes.createdAt));
  }

  async createAdminNote(data: InsertAdminNote): Promise<AdminNote> {
    const [note] = await db.insert(adminNotes).values(data).returning();
    return note;
  }

  async deleteAdminNote(id: string): Promise<void> {
    await db.delete(adminNotes).where(eq(adminNotes.id, id));
  }

  async updateCompanySubscription(
    companyId: string,
    tier: string,
    opts?: {
      subscriptionStatus?: string;
      trialEndsAt?: Date | null;
      customMaxUsers?: number | null;
    }
  ): Promise<Company> {
    const setData: Partial<typeof companies.$inferInsert> = {
      subscriptionTier: tier as (typeof companies.$inferSelect)["subscriptionTier"],
    };
    if (opts?.subscriptionStatus !== undefined)
      setData.subscriptionStatus =
        opts.subscriptionStatus as (typeof companies.$inferSelect)["subscriptionStatus"];
    if (opts?.trialEndsAt !== undefined) setData.trialEndsAt = opts.trialEndsAt;
    if (opts?.customMaxUsers !== undefined) setData.customMaxUsers = opts.customMaxUsers;
    const [updated] = await db
      .update(companies)
      .set(setData)
      .where(eq(companies.id, companyId))
      .returning();
    return updated;
  }

  async getPlatformStats(): Promise<{
    totalCompanies: number;
    totalUsers: number;
    totalContacts: number;
    totalVisits: number;
    mrr: number;
  }> {
    const tierPricing: Record<string, number> = {
      tier_1: 29,
      tier_1_3: 49,
      tier_3_5: 99,
      tier_6_10: 149,
      tier_10_plus: 599,
    };
    const allCompanies = await db.select().from(companies).where(isNull(companies.deletedAt));
    const [usersCount] = await db.select({ count: count() }).from(companyUsers);
    const [contactsCount] = await db.select({ count: count() }).from(contacts);
    const [visitsCount] = await db.select({ count: count() }).from(visits);
    const mrr = allCompanies.reduce((sum, c) => sum + (tierPricing[c.subscriptionTier] || 0), 0);
    return {
      totalCompanies: allCompanies.length,
      totalUsers: usersCount.count,
      totalContacts: contactsCount.count,
      totalVisits: visitsCount.count,
      mrr,
    };
  }

  // ================ SMS Messages ================
  async createSmsMessage(data: InsertSmsMessage): Promise<SmsMessage> {
    const [msg] = await db.insert(smsMessages).values(data).returning();
    return msg;
  }

  async getSmsMessages(
    companyId: string,
    startDate?: string,
    endDate?: string
  ): Promise<SmsMessage[]> {
    const conditions = [eq(smsMessages.companyId, companyId)];
    if (startDate) conditions.push(gte(smsMessages.createdAt, new Date(startDate)));
    if (endDate) conditions.push(lte(smsMessages.createdAt, new Date(endDate)));
    return db
      .select()
      .from(smsMessages)
      .where(and(...conditions))
      .orderBy(desc(smsMessages.createdAt));
  }

  async getSmsCountForPeriod(
    companyId: string,
    startDate: string,
    endDate: string
  ): Promise<number> {
    const [result] = await db
      .select({ count: count() })
      .from(smsMessages)
      .where(
        and(
          eq(smsMessages.companyId, companyId),
          gte(smsMessages.createdAt, new Date(startDate)),
          lte(smsMessages.createdAt, new Date(endDate + "T23:59:59.999Z"))
        )
      );
    return result?.count ?? 0;
  }

  // ================ Email Logs ================
  async createEmailLog(data: InsertEmailSent): Promise<EmailSent> {
    const [log] = await db.insert(emailsSent).values(data).returning();
    return log;
  }

  async getEmailLogs(
    companyId: string,
    startDate?: string,
    endDate?: string
  ): Promise<EmailSent[]> {
    const conditions = [eq(emailsSent.companyId, companyId)];
    if (startDate) conditions.push(gte(emailsSent.createdAt, new Date(startDate)));
    if (endDate) conditions.push(lte(emailsSent.createdAt, new Date(endDate)));
    return db
      .select()
      .from(emailsSent)
      .where(and(...conditions))
      .orderBy(desc(emailsSent.createdAt));
  }

  async getEmailCountForPeriod(
    companyId: string,
    startDate: string,
    endDate: string
  ): Promise<number> {
    const [result] = await db
      .select({ count: count() })
      .from(emailsSent)
      .where(
        and(
          eq(emailsSent.companyId, companyId),
          gte(emailsSent.createdAt, new Date(startDate)),
          lte(emailsSent.createdAt, new Date(endDate + "T23:59:59.999Z"))
        )
      );
    return result?.count ?? 0;
  }

  // ================ Account Daily Metrics ================
  async upsertDailyMetrics(data: InsertAccountDailyMetric): Promise<AccountDailyMetric> {
    const [metric] = await db
      .insert(accountDailyMetrics)
      .values(data)
      .onConflictDoUpdate({
        target: [accountDailyMetrics.companyId, accountDailyMetrics.date],
        set: {
          logins: data.logins ?? 0,
          jobsScheduled: data.jobsScheduled ?? 0,
          jobsCompleted: data.jobsCompleted ?? 0,
          invoicesSent: data.invoicesSent ?? 0,
          paymentsCount: data.paymentsCount ?? 0,
          paymentsGrossCents: data.paymentsGrossCents ?? 0,
          paymentsNetCents: data.paymentsNetCents ?? 0,
          twilioSmsOutbound: data.twilioSmsOutbound ?? 0,
          twilioSmsInbound: data.twilioSmsInbound ?? 0,
          twilioCostCentsEst: data.twilioCostCentsEst ?? 0,
          sendgridEmailsSent: data.sendgridEmailsSent ?? 0,
          sendgridCostCentsEst: data.sendgridCostCentsEst ?? 0,
          churnRiskScore: data.churnRiskScore ?? 0,
        },
      })
      .returning();
    return metric;
  }

  async getDailyMetrics(
    companyId: string,
    startDate: string,
    endDate: string
  ): Promise<AccountDailyMetric[]> {
    return db
      .select()
      .from(accountDailyMetrics)
      .where(
        and(
          eq(accountDailyMetrics.companyId, companyId),
          gte(accountDailyMetrics.date, startDate),
          lte(accountDailyMetrics.date, endDate)
        )
      )
      .orderBy(desc(accountDailyMetrics.date));
  }

  async getAllDailyMetrics(startDate: string, endDate: string): Promise<AccountDailyMetric[]> {
    return db
      .select()
      .from(accountDailyMetrics)
      .where(and(gte(accountDailyMetrics.date, startDate), lte(accountDailyMetrics.date, endDate)))
      .orderBy(desc(accountDailyMetrics.date));
  }

  // ================ SaaS Costs ================
  async getSaasCosts(month: string): Promise<SaasCostMonthly | undefined> {
    const [cost] = await db
      .select()
      .from(saasCostsMonthly)
      .where(eq(saasCostsMonthly.month, month));
    return cost;
  }

  async upsertSaasCosts(data: InsertSaasCostMonthly): Promise<SaasCostMonthly> {
    const [cost] = await db
      .insert(saasCostsMonthly)
      .values(data)
      .onConflictDoUpdate({
        target: [saasCostsMonthly.month],
        set: {
          hostingCents: data.hostingCents ?? 0,
          dbCents: data.dbCents ?? 0,
          emailPlatformCents: data.emailPlatformCents ?? 0,
          smsPlatformCents: data.smsPlatformCents ?? 0,
          monitoringCents: data.monitoringCents ?? 0,
          otherCents: data.otherCents ?? 0,
          supportLaborCents: data.supportLaborCents ?? 0,
        },
      })
      .returning();
    return cost;
  }

  async getAllSaasCosts(): Promise<SaasCostMonthly[]> {
    return db.select().from(saasCostsMonthly).orderBy(desc(saasCostsMonthly.month));
  }

  // ================ Cost Config ================
  async getCostConfig(): Promise<CostConfigItem[]> {
    return db.select().from(costConfig);
  }

  async upsertCostConfig(
    key: string,
    valueCents: number,
    valuePct?: string,
    description?: string
  ): Promise<CostConfigItem> {
    const [item] = await db
      .insert(costConfig)
      .values({ key, valueCents, valuePct, description })
      .onConflictDoUpdate({
        target: [costConfig.key],
        set: { valueCents, valuePct, description, updatedAt: new Date() },
      })
      .returning();
    return item;
  }

  // ================ Notifications ================
  async getNotifications(companyId: string, limit = 50): Promise<Notification[]> {
    return db
      .select()
      .from(notifications)
      .where(eq(notifications.companyId, companyId))
      .orderBy(desc(notifications.createdAt))
      .limit(limit);
  }

  async getUnreadNotificationCount(companyId: string): Promise<number> {
    const [result] = await db
      .select({ count: count() })
      .from(notifications)
      .where(and(eq(notifications.companyId, companyId), eq(notifications.isRead, false)));
    return result?.count ?? 0;
  }

  async createNotification(data: InsertNotification): Promise<Notification> {
    const [notif] = await db.insert(notifications).values(data).returning();
    return notif;
  }

  async markNotificationRead(id: string, companyId: string): Promise<Notification> {
    const [notif] = await db
      .update(notifications)
      .set({ isRead: true })
      .where(and(eq(notifications.id, id), eq(notifications.companyId, companyId)))
      .returning();
    return notif;
  }

  async markAllNotificationsRead(companyId: string): Promise<void> {
    await db
      .update(notifications)
      .set({ isRead: true })
      .where(and(eq(notifications.companyId, companyId), eq(notifications.isRead, false)));
  }

  // ================ Time Entries ================
  async createTimeEntry(data: InsertTimeEntry): Promise<TimeEntry> {
    const [entry] = await db.insert(timeEntries).values(data).returning();
    return entry;
  }

  async updateTimeEntry(
    id: string,
    companyId: string,
    data: Partial<InsertTimeEntry>
  ): Promise<TimeEntry> {
    const [entry] = await db
      .update(timeEntries)
      .set(data)
      .where(and(eq(timeEntries.id, id), eq(timeEntries.companyId, companyId)))
      .returning();
    return entry;
  }

  async getTimeEntries(
    companyId: string,
    filters?: { userId?: string; startDate?: string; endDate?: string }
  ): Promise<TimeEntry[]> {
    const conditions = [eq(timeEntries.companyId, companyId)];
    if (filters?.userId) conditions.push(eq(timeEntries.userId, filters.userId));
    if (filters?.startDate) conditions.push(gte(timeEntries.clockIn, new Date(filters.startDate)));
    if (filters?.endDate)
      conditions.push(lte(timeEntries.clockIn, new Date(filters.endDate + "T23:59:59")));
    return db
      .select()
      .from(timeEntries)
      .where(and(...conditions))
      .orderBy(desc(timeEntries.clockIn));
  }

  async getActiveTimeEntry(userId: string): Promise<TimeEntry | undefined> {
    const [entry] = await db
      .select()
      .from(timeEntries)
      .where(and(eq(timeEntries.userId, userId), sql`${timeEntries.clockOut} IS NULL`))
      .orderBy(desc(timeEntries.clockIn))
      .limit(1);
    return entry;
  }

  // ================ Activity Log ================
  async createActivityLog(data: InsertActivityLog): Promise<ActivityLog> {
    const [entry] = await db.insert(activityLog).values(data).returning();
    return entry;
  }

  async getActivityLogs(
    companyId: string,
    contactId: string,
    limit = 50,
    offset = 0
  ): Promise<ActivityLog[]> {
    return db
      .select()
      .from(activityLog)
      .where(and(eq(activityLog.companyId, companyId), eq(activityLog.contactId, contactId)))
      .orderBy(desc(activityLog.createdAt))
      .limit(limit)
      .offset(offset);
  }

  // ================ Webhook Deliveries ================
  async createWebhookDelivery(data: InsertWebhookDelivery): Promise<WebhookDelivery> {
    const [delivery] = await db.insert(webhookDeliveries).values(data).returning();
    return delivery;
  }

  async updateWebhookDelivery(
    id: string,
    data: Partial<InsertWebhookDelivery>
  ): Promise<WebhookDelivery> {
    const [delivery] = await db
      .update(webhookDeliveries)
      .set(data)
      .where(eq(webhookDeliveries.id, id))
      .returning();
    return delivery;
  }

  async getPendingWebhookDeliveries(): Promise<WebhookDelivery[]> {
    return db
      .select()
      .from(webhookDeliveries)
      .where(
        and(
          eq(webhookDeliveries.status, "pending"),
          or(
            sql`${webhookDeliveries.nextRetry} IS NULL`,
            lte(webhookDeliveries.nextRetry, new Date())
          )
        )
      )
      .orderBy(asc(webhookDeliveries.createdAt))
      .limit(100);
  }

  async getWebhookDeliveries(webhookId: string, limit = 50): Promise<WebhookDelivery[]> {
    return db
      .select()
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.webhookId, webhookId))
      .orderBy(desc(webhookDeliveries.createdAt))
      .limit(limit);
  }

  async getWebhookDeliveriesForCompany(companyId: string, limit = 100): Promise<WebhookDelivery[]> {
    const companyWebhooks = await db
      .select({ id: webhooks.id })
      .from(webhooks)
      .where(eq(webhooks.companyId, companyId));
    if (companyWebhooks.length === 0) return [];
    const webhookIds = companyWebhooks.map((w) => w.id);
    return db
      .select()
      .from(webhookDeliveries)
      .where(inArray(webhookDeliveries.webhookId, webhookIds))
      .orderBy(desc(webhookDeliveries.createdAt))
      .limit(limit);
  }

  // ================ Audit Trail ================
  async createAuditEntry(data: InsertAuditTrail): Promise<AuditTrail> {
    const [entry] = await db.insert(auditTrail).values(data).returning();
    return entry;
  }

  async getAuditTrail(
    companyId: string,
    filters?: { entityType?: string; startDate?: string; endDate?: string },
    limit = 100,
    offset = 0
  ): Promise<AuditTrail[]> {
    const conditions = [eq(auditTrail.companyId, companyId)];
    if (filters?.entityType) conditions.push(eq(auditTrail.entityType, filters.entityType));
    if (filters?.startDate) conditions.push(gte(auditTrail.createdAt, new Date(filters.startDate)));
    if (filters?.endDate)
      conditions.push(lte(auditTrail.createdAt, new Date(filters.endDate + "T23:59:59")));
    return db
      .select()
      .from(auditTrail)
      .where(and(...conditions))
      .orderBy(desc(auditTrail.createdAt))
      .limit(limit)
      .offset(offset);
  }

  // ================ Bulk Operations ================
  async bulkUpdateContacts(
    ids: string[],
    companyId: string,
    data: Partial<InsertContact>
  ): Promise<number> {
    await db
      .update(contacts)
      .set({ ...data, updatedAt: new Date() })
      .where(and(inArray(contacts.id, ids), eq(contacts.companyId, companyId)));
    return ids.length;
  }

  async bulkDeleteContacts(ids: string[], companyId: string): Promise<number> {
    await db
      .delete(contacts)
      .where(and(inArray(contacts.id, ids), eq(contacts.companyId, companyId)));
    return ids.length;
  }

  async searchContacts(
    companyId: string,
    term: string
  ): Promise<Pick<Contact, "id" | "firstName" | "lastName" | "email" | "phone" | "status">[]> {
    return db
      .select({
        id: contacts.id,
        firstName: contacts.firstName,
        lastName: contacts.lastName,
        email: contacts.email,
        phone: contacts.phone,
        status: contacts.status,
      })
      .from(contacts)
      .where(
        and(
          eq(contacts.companyId, companyId),
          or(
            sql`lower(${contacts.firstName}) like ${term}`,
            sql`lower(${contacts.lastName}) like ${term}`,
            sql`lower(${contacts.email}) like ${term}`,
            sql`${contacts.phone} like ${term}`
          )
        )
      )
      .limit(10);
  }

  async searchProperties(
    companyId: string,
    term: string
  ): Promise<Pick<Property, "id" | "streetAddress" | "city" | "contactId">[]> {
    return db
      .select({
        id: properties.id,
        streetAddress: properties.streetAddress,
        city: properties.city,
        contactId: properties.contactId,
      })
      .from(properties)
      .where(
        and(
          eq(properties.companyId, companyId),
          or(
            sql`lower(${properties.streetAddress}) like ${term}`,
            sql`lower(${properties.city}) like ${term}`
          )
        )
      )
      .limit(10);
  }

  async searchInvoices(
    companyId: string,
    term: string
  ): Promise<Pick<Invoice, "id" | "invoiceNumber" | "status" | "total" | "contactId">[]> {
    return db
      .select({
        id: invoices.id,
        invoiceNumber: invoices.invoiceNumber,
        status: invoices.status,
        total: invoices.total,
        contactId: invoices.contactId,
      })
      .from(invoices)
      .where(
        and(
          eq(invoices.companyId, companyId),
          or(
            sql`lower(${invoices.invoiceNumber}) like ${term}`,
            sql`cast(${invoices.total} as text) like ${term}`
          )
        )
      )
      .limit(10);
  }

  async searchRoutes(
    companyId: string,
    term: string
  ): Promise<Pick<Route, "id" | "name" | "dayOfWeek">[]> {
    return db
      .select({ id: routes.id, name: routes.name, dayOfWeek: routes.dayOfWeek })
      .from(routes)
      .where(and(eq(routes.companyId, companyId), sql`lower(${routes.name}) like ${term}`))
      .limit(10);
  }

  // ================ Import Runs ================
  async createImportRun(data: InsertImportRun): Promise<ImportRun> {
    const [run] = await db.insert(importRuns).values(data).returning();
    return run;
  }

  async getImportRun(id: string, companyId: string): Promise<ImportRun | undefined> {
    const [run] = await db
      .select()
      .from(importRuns)
      .where(and(eq(importRuns.id, id), eq(importRuns.companyId, companyId)));
    return run;
  }

  async updateImportRun(
    id: string,
    data: Partial<InsertImportRun> & { completedAt?: Date }
  ): Promise<ImportRun> {
    const [run] = await db.update(importRuns).set(data).where(eq(importRuns.id, id)).returning();
    return run;
  }

  async getImportRuns(companyId: string): Promise<ImportRun[]> {
    return db
      .select()
      .from(importRuns)
      .where(eq(importRuns.companyId, companyId))
      .orderBy(desc(importRuns.createdAt));
  }

  async getImportRunByHash(companyId: string, fileHash: string): Promise<ImportRun | undefined> {
    const [run] = await db
      .select()
      .from(importRuns)
      .where(and(eq(importRuns.companyId, companyId), eq(importRuns.fileHash, fileHash)));
    return run;
  }

  // ================ Import Batches ================
  async createImportBatch(data: InsertImportBatch): Promise<ImportBatch> {
    const [batch] = await db.insert(importBatches).values(data).returning();
    return batch;
  }

  async getImportBatch(id: string, companyId: string): Promise<ImportBatch | undefined> {
    const [batch] = await db
      .select()
      .from(importBatches)
      .where(and(eq(importBatches.id, id), eq(importBatches.companyId, companyId)));
    return batch;
  }

  async updateImportBatch(
    id: string,
    data: Partial<InsertImportBatch> & { completedAt?: Date }
  ): Promise<ImportBatch> {
    const [batch] = await db
      .update(importBatches)
      .set(data)
      .where(eq(importBatches.id, id))
      .returning();
    return batch;
  }

  async getImportBatches(companyId: string): Promise<ImportBatch[]> {
    return db
      .select()
      .from(importBatches)
      .where(eq(importBatches.companyId, companyId))
      .orderBy(desc(importBatches.createdAt));
  }

  // ================ Import Rows ================
  async createImportRow(data: InsertImportRow): Promise<ImportRow> {
    const [row] = await db.insert(importRows).values(data).returning();
    return row;
  }

  async bulkCreateImportRows(rows: InsertImportRow[]): Promise<ImportRow[]> {
    if (rows.length === 0) return [];
    const CHUNK = 250;
    let inserted: ImportRow[] = [];
    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK);
      const result = await db.insert(importRows).values(chunk).returning();
      inserted = inserted.concat(result);
    }
    return inserted;
  }

  async getImportRows(
    batchId: string,
    companyId: string,
    filters?: { status?: string; missingField?: string }
  ): Promise<ImportRow[]> {
    const conditions = [eq(importRows.batchId, batchId), eq(importRows.companyId, companyId)];
    if (filters?.status) {
      conditions.push(
        eq(importRows.status, filters.status as (typeof importRows.$inferSelect)["status"])
      );
    }
    const results = await db
      .select()
      .from(importRows)
      .where(and(...conditions))
      .orderBy(asc(importRows.rowIndex));

    if (filters?.missingField) {
      return results.filter(
        (r) => r.missingFields && r.missingFields.includes(filters.missingField!)
      );
    }
    return results;
  }

  async getImportRow(id: string, companyId: string): Promise<ImportRow | undefined> {
    const [row] = await db
      .select()
      .from(importRows)
      .where(and(eq(importRows.id, id), eq(importRows.companyId, companyId)));
    return row;
  }

  async updateImportRow(
    id: string,
    companyId: string,
    data: Partial<InsertImportRow>
  ): Promise<ImportRow> {
    const [row] = await db
      .update(importRows)
      .set(data)
      .where(and(eq(importRows.id, id), eq(importRows.companyId, companyId)))
      .returning();
    return row;
  }

  async bulkUpdateImportRows(
    ids: string[],
    companyId: string,
    data: Partial<InsertImportRow>
  ): Promise<void> {
    if (ids.length === 0) return;
    await db
      .update(importRows)
      .set(data)
      .where(and(inArray(importRows.id, ids), eq(importRows.companyId, companyId)));
  }

  // ================ Import Mappings ================
  async bulkCreateImportMappings(mappings: InsertImportMapping[]): Promise<ImportMapping[]> {
    if (mappings.length === 0) return [];
    return db.insert(importMappings).values(mappings).returning();
  }

  async getImportMappings(batchId: string): Promise<ImportMapping[]> {
    return db.select().from(importMappings).where(eq(importMappings.batchId, batchId));
  }

  // ================ Import Rule Suggestions ================
  async createImportRuleSuggestion(
    data: InsertImportRuleSuggestion
  ): Promise<ImportRuleSuggestion> {
    const [suggestion] = await db.insert(importRuleSuggestions).values(data).returning();
    return suggestion;
  }

  async getImportRuleSuggestions(batchId: string): Promise<ImportRuleSuggestion[]> {
    return db
      .select()
      .from(importRuleSuggestions)
      .where(eq(importRuleSuggestions.batchId, batchId));
  }

  async getImportRuleSuggestionByRow(rowId: string): Promise<ImportRuleSuggestion | undefined> {
    const [suggestion] = await db
      .select()
      .from(importRuleSuggestions)
      .where(eq(importRuleSuggestions.rowId, rowId));
    return suggestion;
  }

  async updateImportRuleSuggestion(
    id: string,
    data: Partial<InsertImportRuleSuggestion>
  ): Promise<ImportRuleSuggestion> {
    const [suggestion] = await db
      .update(importRuleSuggestions)
      .set(data)
      .where(eq(importRuleSuggestions.id, id))
      .returning();
    return suggestion;
  }

  // ================ Invoice Payments ================
  async createInvoicePayment(data: InsertInvoicePayment): Promise<InvoicePayment> {
    const [payment] = await db.insert(invoicePayments).values(data).returning();
    return payment;
  }

  async getInvoicePayments(invoiceId: string): Promise<InvoicePayment[]> {
    return db
      .select()
      .from(invoicePayments)
      .where(eq(invoicePayments.invoiceId, invoiceId))
      .orderBy(desc(invoicePayments.paidAt));
  }

  async getInvoicePaymentsByCompany(
    companyId: string,
    filters?: { source?: string }
  ): Promise<InvoicePayment[]> {
    const conditions = [eq(invoicePayments.companyId, companyId)];
    if (filters?.source) {
      conditions.push(
        eq(
          invoicePayments.source,
          filters.source as (typeof invoicePayments.$inferSelect)["source"]
        )
      );
    }
    return db
      .select()
      .from(invoicePayments)
      .where(and(...conditions))
      .orderBy(desc(invoicePayments.paidAt));
  }

  async getInvoicePaymentByExternalId(
    companyId: string,
    externalId: string
  ): Promise<InvoicePayment | undefined> {
    const [payment] = await db
      .select()
      .from(invoicePayments)
      .where(
        and(eq(invoicePayments.companyId, companyId), eq(invoicePayments.externalId, externalId))
      );
    return payment;
  }

  async getInvoiceByExternalId(
    companyId: string,
    externalSource: string,
    externalId: string
  ): Promise<Invoice | undefined> {
    const [inv] = await db
      .select()
      .from(invoices)
      .where(
        and(
          eq(invoices.companyId, companyId),
          eq(invoices.externalSource, externalSource),
          eq(invoices.externalId, externalId)
        )
      );
    return inv;
  }

  // ================ Price Recommendations ================
  async createPriceRecommendation(data: InsertPriceRecommendation): Promise<PriceRecommendation> {
    const [rec] = await db.insert(priceRecommendations).values(data).returning();
    return rec;
  }

  async getPriceRecommendations(
    companyId: string,
    propertyId?: string
  ): Promise<PriceRecommendation[]> {
    const conditions = [eq(priceRecommendations.companyId, companyId)];
    if (propertyId) {
      conditions.push(eq(priceRecommendations.propertyId, propertyId));
    }
    return db
      .select()
      .from(priceRecommendations)
      .where(and(...conditions))
      .orderBy(desc(priceRecommendations.calculatedAt));
  }

  async getLatestPriceRecommendation(
    companyId: string,
    propertyId: string
  ): Promise<PriceRecommendation | undefined> {
    const [rec] = await db
      .select()
      .from(priceRecommendations)
      .where(
        and(
          eq(priceRecommendations.companyId, companyId),
          eq(priceRecommendations.propertyId, propertyId)
        )
      )
      .orderBy(desc(priceRecommendations.calculatedAt))
      .limit(1);
    return rec;
  }

  // ================ Profitability Snapshots ================
  async getProfitabilitySnapshots(
    companyId: string,
    filters?: { startDate?: string; endDate?: string; contactId?: string }
  ): Promise<ProfitabilitySnapshot[]> {
    const conditions = [eq(profitabilitySnapshots.companyId, companyId)];
    if (filters?.contactId)
      conditions.push(eq(profitabilitySnapshots.contactId, filters.contactId));
    if (filters?.startDate)
      conditions.push(gte(profitabilitySnapshots.snapshotDate, filters.startDate));
    if (filters?.endDate)
      conditions.push(lte(profitabilitySnapshots.snapshotDate, filters.endDate));
    return db
      .select()
      .from(profitabilitySnapshots)
      .where(and(...conditions))
      .orderBy(desc(profitabilitySnapshots.snapshotDate));
  }

  async getProfitabilitySnapshot(
    id: string,
    companyId: string
  ): Promise<ProfitabilitySnapshot | undefined> {
    const [snap] = await db
      .select()
      .from(profitabilitySnapshots)
      .where(
        and(eq(profitabilitySnapshots.id, id), eq(profitabilitySnapshots.companyId, companyId))
      );
    return snap;
  }

  async createProfitabilitySnapshot(
    data: InsertProfitabilitySnapshot
  ): Promise<ProfitabilitySnapshot> {
    const [snap] = await db.insert(profitabilitySnapshots).values(data).returning();
    return snap;
  }

  async deleteProfitabilitySnapshots(companyId: string, olderThan?: string): Promise<void> {
    const conditions = [eq(profitabilitySnapshots.companyId, companyId)];
    if (olderThan) conditions.push(lt(profitabilitySnapshots.snapshotDate, olderThan));
    await db.delete(profitabilitySnapshots).where(and(...conditions));
  }

  async getCustomerProfitabilitySummary(companyId: string): Promise<CustomerProfitabilityEntry[]> {
    const activeContacts = await db
      .select({
        id: contacts.id,
        firstName: contacts.firstName,
        lastName: contacts.lastName,
        email: contacts.email,
        phone: contacts.phone,
        status: contacts.status,
      })
      .from(contacts)
      .where(and(eq(contacts.companyId, companyId), eq(contacts.status, "active")));

    const activePlans = await db
      .select()
      .from(servicePlans)
      .where(and(eq(servicePlans.companyId, companyId), eq(servicePlans.isActive, true)));

    const allProperties = await db
      .select()
      .from(properties)
      .where(eq(properties.companyId, companyId));

    const propertyMap = new Map(allProperties.map((p) => [p.id, p]));

    const result: CustomerProfitabilityEntry[] = [];

    for (const contact of activeContacts) {
      const contactPlans = activePlans.filter((p) => p.contactId === contact.id);
      if (contactPlans.length === 0) continue;

      let totalRevenueCentsPerMonth = 0;
      let totalCostCentsPerMonth = 0;
      let propertyCount = 0;

      for (const plan of contactPlans) {
        const property = propertyMap.get(plan.propertyId);
        if (!property) continue;
        propertyCount++;

        const pricePerVisitCents = Math.round(parseFloat(plan.pricePerVisit) * 100);

        let visitsPerMonth = 4;
        switch (plan.frequency) {
          case "weekly":
            visitsPerMonth = 4.33;
            break;
          case "biweekly":
            visitsPerMonth = 2.17;
            break;
          case "monthly":
            visitsPerMonth = 1;
            break;
          case "onetime":
            visitsPerMonth = 0.25;
            break;
        }

        totalRevenueCentsPerMonth += pricePerVisitCents * visitsPerMonth;
      }

      const profitCents = totalRevenueCentsPerMonth - totalCostCentsPerMonth;
      const marginPct =
        totalRevenueCentsPerMonth > 0 ? (profitCents / totalRevenueCentsPerMonth) * 100 : 0;

      let profitabilityStatus: "profitable" | "marginal" | "unprofitable" = "profitable";
      if (profitCents < 0) profitabilityStatus = "unprofitable";
      else if (marginPct < 15) profitabilityStatus = "marginal";

      result.push({
        contactId: contact.id,
        firstName: contact.firstName,
        lastName: contact.lastName,
        email: contact.email,
        phone: contact.phone,
        propertyCount,
        revenueCentsPerMonth: Math.round(totalRevenueCentsPerMonth),
        costCentsPerMonth: Math.round(totalCostCentsPerMonth),
        profitCentsPerMonth: Math.round(profitCents),
        profitMarginPct: Math.round(marginPct * 100) / 100,
        status: profitabilityStatus,
        planCount: contactPlans.length,
      });
    }

    return result;
  }

  async getRouteProfitabilitySummary(companyId: string): Promise<RouteProfitabilityEntry[]> {
    const companyRoutes = await db.select().from(routes).where(eq(routes.companyId, companyId));
    const activePlans = await db
      .select()
      .from(servicePlans)
      .where(and(eq(servicePlans.companyId, companyId), eq(servicePlans.isActive, true)));
    const allContacts = await db
      .select({
        id: contacts.id,
        firstName: contacts.firstName,
        lastName: contacts.lastName,
      })
      .from(contacts)
      .where(eq(contacts.companyId, companyId));

    const contactMap = new Map(allContacts.map((c) => [c.id, c]));

    const result: RouteProfitabilityEntry[] = [];

    for (const route of companyRoutes) {
      const routePlans = activePlans.filter((p) => p.routeId === route.id);
      if (routePlans.length === 0) {
        result.push({
          routeId: route.id,
          routeName: route.name,
          dayOfWeek: route.dayOfWeek,
          technicianId: route.technicianId,
          totalStops: 0,
          totalRevenueCents: 0,
          totalCostCents: 0,
          totalProfitCents: 0,
          avgMarginPct: 0,
          customers: [],
        });
        continue;
      }

      let totalRevenueCents = 0;
      let totalCostCents = 0;
      const customerMap = new Map<
        string,
        {
          contactId: string;
          firstName: string;
          lastName: string;
          revenueCents: number;
          costCents: number;
        }
      >();

      for (const plan of routePlans) {
        const pricePerVisitCents = Math.round(parseFloat(plan.pricePerVisit) * 100);
        totalRevenueCents += pricePerVisitCents;

        const contact = contactMap.get(plan.contactId);
        if (contact) {
          const existing = customerMap.get(plan.contactId);
          if (existing) {
            existing.revenueCents += pricePerVisitCents;
          } else {
            customerMap.set(plan.contactId, {
              contactId: contact.id,
              firstName: contact.firstName,
              lastName: contact.lastName,
              revenueCents: pricePerVisitCents,
              costCents: 0,
            });
          }
        }
      }

      const totalProfitCents = totalRevenueCents - totalCostCents;
      const avgMarginPct = totalRevenueCents > 0 ? (totalProfitCents / totalRevenueCents) * 100 : 0;

      result.push({
        routeId: route.id,
        routeName: route.name,
        dayOfWeek: route.dayOfWeek,
        technicianId: route.technicianId,
        totalStops: routePlans.length,
        totalRevenueCents,
        totalCostCents,
        totalProfitCents,
        avgMarginPct: Math.round(avgMarginPct * 100) / 100,
        customers: Array.from(customerMap.values()).sort((a, b) => a.revenueCents - b.revenueCents),
      });
    }

    return result;
  }

  // ================ Overhead Costs ================
  async getOverheadCosts(companyId: string): Promise<OverheadCost[]> {
    return db
      .select()
      .from(overheadCosts)
      .where(eq(overheadCosts.companyId, companyId))
      .orderBy(asc(overheadCosts.category), asc(overheadCosts.sortOrder));
  }

  async createOverheadCost(data: InsertOverheadCost): Promise<OverheadCost> {
    const [item] = await db.insert(overheadCosts).values(data).returning();
    return item;
  }

  async updateOverheadCost(
    id: string,
    companyId: string,
    data: Partial<InsertOverheadCost>
  ): Promise<OverheadCost> {
    const [item] = await db
      .update(overheadCosts)
      .set(data)
      .where(and(eq(overheadCosts.id, id), eq(overheadCosts.companyId, companyId)))
      .returning();
    return item;
  }

  async deleteOverheadCost(id: string, companyId: string): Promise<void> {
    await db
      .delete(overheadCosts)
      .where(and(eq(overheadCosts.id, id), eq(overheadCosts.companyId, companyId)));
  }

  async getTotalMonthlyOverheadCents(companyId: string): Promise<number> {
    const result = await db
      .select({ total: sql<number>`COALESCE(SUM(${overheadCosts.monthlyCostCents}), 0)` })
      .from(overheadCosts)
      .where(eq(overheadCosts.companyId, companyId));
    return Number(result[0]?.total ?? 0);
  }

  // ================ Competitor Pricing ================
  async getCompetitorPricing(companyId: string, zipCode?: string): Promise<CompetitorPricing[]> {
    const conditions = [eq(competitorPricing.companyId, companyId)];
    if (zipCode) conditions.push(eq(competitorPricing.zipCode, zipCode));
    return db
      .select()
      .from(competitorPricing)
      .where(and(...conditions))
      .orderBy(asc(competitorPricing.zipCode), asc(competitorPricing.competitorName));
  }

  async createCompetitorPricing(data: InsertCompetitorPricing): Promise<CompetitorPricing> {
    const [item] = await db.insert(competitorPricing).values(data).returning();
    return item;
  }

  async updateCompetitorPricing(
    id: string,
    companyId: string,
    data: Partial<InsertCompetitorPricing>
  ): Promise<CompetitorPricing> {
    const [item] = await db
      .update(competitorPricing)
      .set(data)
      .where(and(eq(competitorPricing.id, id), eq(competitorPricing.companyId, companyId)))
      .returning();
    return item;
  }

  async deleteCompetitorPricing(id: string, companyId: string): Promise<void> {
    await db
      .delete(competitorPricing)
      .where(and(eq(competitorPricing.id, id), eq(competitorPricing.companyId, companyId)));
  }

  // ================ Estimates ================
  async getEstimate(id: string, companyId: string): Promise<Estimate | undefined> {
    const [item] = await db
      .select()
      .from(estimates)
      .where(and(eq(estimates.id, id), eq(estimates.companyId, companyId)));
    return item;
  }

  async getEstimates(
    companyId: string,
    filters?: { contactId?: string; status?: string }
  ): Promise<Estimate[]> {
    const conditions = [eq(estimates.companyId, companyId)];
    if (filters?.contactId) conditions.push(eq(estimates.contactId, filters.contactId));
    if (filters?.status)
      conditions.push(
        eq(estimates.status, filters.status as (typeof estimates.$inferSelect)["status"])
      );
    return db
      .select()
      .from(estimates)
      .where(and(...conditions))
      .orderBy(desc(estimates.createdAt));
  }

  async createEstimate(data: InsertEstimate): Promise<Estimate> {
    const [item] = await db.insert(estimates).values(data).returning();
    return item;
  }

  async updateEstimate(
    id: string,
    companyId: string,
    data: Partial<InsertEstimate>
  ): Promise<Estimate> {
    const [item] = await db
      .update(estimates)
      .set(data)
      .where(and(eq(estimates.id, id), eq(estimates.companyId, companyId)))
      .returning();
    return item;
  }

  // ================ Service Change Requests ================
  async getServiceChangeRequest(
    id: string,
    companyId: string
  ): Promise<ServiceChangeRequest | undefined> {
    const [item] = await db
      .select()
      .from(serviceChangeRequests)
      .where(and(eq(serviceChangeRequests.id, id), eq(serviceChangeRequests.companyId, companyId)));
    return item;
  }

  async getServiceChangeRequests(
    companyId: string,
    filters?: { contactId?: string; status?: string }
  ): Promise<ServiceChangeRequest[]> {
    const conditions = [eq(serviceChangeRequests.companyId, companyId)];
    if (filters?.contactId) conditions.push(eq(serviceChangeRequests.contactId, filters.contactId));
    if (filters?.status)
      conditions.push(
        eq(
          serviceChangeRequests.status,
          filters.status as (typeof serviceChangeRequests.$inferSelect)["status"]
        )
      );
    return db
      .select()
      .from(serviceChangeRequests)
      .where(and(...conditions))
      .orderBy(desc(serviceChangeRequests.createdAt));
  }

  async createServiceChangeRequest(
    data: InsertServiceChangeRequest
  ): Promise<ServiceChangeRequest> {
    const [item] = await db.insert(serviceChangeRequests).values(data).returning();
    return item;
  }

  async updateServiceChangeRequest(
    id: string,
    companyId: string,
    data: Partial<InsertServiceChangeRequest>
  ): Promise<ServiceChangeRequest> {
    const [item] = await db
      .update(serviceChangeRequests)
      .set(data)
      .where(and(eq(serviceChangeRequests.id, id), eq(serviceChangeRequests.companyId, companyId)))
      .returning();
    return item;
  }

  // ================ Referral Helpers ================
  async getContactByReferralCode(code: string): Promise<Contact | undefined> {
    const [contact] = await db.select().from(contacts).where(eq(contacts.referralCode, code));
    return contact;
  }

  async getReferralCount(contactId: string): Promise<number> {
    const contact = await this.getContactById(contactId);
    if (!contact?.referralCode) return 0;
    const result = await db
      .select({ count: count() })
      .from(contacts)
      .where(eq(contacts.referralSource, contact.referralCode));
    return Number(result[0]?.count ?? 0);
  }

  async getServiceZones(companyId: string): Promise<ServiceZone[]> {
    return db
      .select()
      .from(serviceZones)
      .where(eq(serviceZones.companyId, companyId))
      .orderBy(serviceZones.zipCode);
  }

  async createServiceZone(data: InsertServiceZone): Promise<ServiceZone> {
    const [zone] = await db.insert(serviceZones).values(data).returning();
    return zone;
  }

  async updateServiceZone(
    id: string,
    companyId: string,
    data: Partial<InsertServiceZone>
  ): Promise<ServiceZone> {
    const [zone] = await db
      .update(serviceZones)
      .set(data)
      .where(and(eq(serviceZones.id, id), eq(serviceZones.companyId, companyId)))
      .returning();
    return zone;
  }

  async deleteServiceZone(id: string, companyId: string): Promise<void> {
    await db
      .delete(serviceZones)
      .where(and(eq(serviceZones.id, id), eq(serviceZones.companyId, companyId)));
  }

  // ================ Usage Events ================
  async createUsageEvent(data: InsertUsageEvent): Promise<UsageEvent> {
    const [event] = await db.insert(usageEvents).values(data).returning();
    return event;
  }

  async getUsageEvents(
    companyId: string,
    startDate: string,
    endDate: string
  ): Promise<UsageEvent[]> {
    return db
      .select()
      .from(usageEvents)
      .where(
        and(
          eq(usageEvents.companyId, companyId),
          gte(usageEvents.recordedAt, new Date(startDate)),
          lte(usageEvents.recordedAt, new Date(endDate))
        )
      )
      .orderBy(desc(usageEvents.recordedAt));
  }

  async getUsageSummary(
    companyId: string,
    startDate: string,
    endDate: string
  ): Promise<{ smsSegments: number; voiceMinutes: number; userSeats: number }> {
    const rows = await db
      .select({
        eventType: usageEvents.eventType,
        total: sql<number>`coalesce(sum(${usageEvents.quantity}), 0)`,
      })
      .from(usageEvents)
      .where(
        and(
          eq(usageEvents.companyId, companyId),
          gte(usageEvents.recordedAt, new Date(startDate)),
          lte(usageEvents.recordedAt, new Date(endDate))
        )
      )
      .groupBy(usageEvents.eventType);
    const map: Record<string, number> = {};
    for (const r of rows) map[r.eventType] = Number(r.total);
    return {
      smsSegments: map["sms_segment"] || 0,
      voiceMinutes: map["voice_minute"] || 0,
      userSeats: map["user_seat"] || 0,
    };
  }

  async createVoiceCall(data: InsertVoiceCall): Promise<VoiceCall> {
    const [call] = await db.insert(voiceCalls).values(data).returning();
    return call;
  }

  async updateVoiceCall(
    id: string,
    data: Partial<Pick<InsertVoiceCall, "outcome" | "summary" | "metadata">>
  ): Promise<VoiceCall> {
    const [call] = await db.update(voiceCalls).set(data).where(eq(voiceCalls.id, id)).returning();
    return call;
  }

  async getVoiceCalls(companyId: string, limit = 50): Promise<VoiceCall[]> {
    return db
      .select()
      .from(voiceCalls)
      .where(eq(voiceCalls.companyId, companyId))
      .orderBy(desc(voiceCalls.createdAt))
      .limit(limit);
  }

  async getVoiceCallById(companyId: string, id: string): Promise<VoiceCall | undefined> {
    const [call] = await db
      .select()
      .from(voiceCalls)
      .where(and(eq(voiceCalls.companyId, companyId), eq(voiceCalls.id, id)));
    return call;
  }

  async getVoiceCallByRetellId(retellCallId: string): Promise<VoiceCall | undefined> {
    const [call] = await db
      .select()
      .from(voiceCalls)
      .where(eq(voiceCalls.retellCallId, retellCallId));
    return call;
  }

  async getVoiceCallSummary(
    companyId: string,
    startDate: string,
    endDate: string
  ): Promise<{ totalCalls: number; totalMinutes: number }> {
    const [result] = await db
      .select({
        totalCalls: sql<number>`count(*)`,
        totalMinutes: sql<number>`coalesce(sum(${voiceCalls.durationMinutes}), 0)`,
      })
      .from(voiceCalls)
      .where(
        and(
          eq(voiceCalls.companyId, companyId),
          gte(voiceCalls.createdAt, new Date(startDate)),
          lte(voiceCalls.createdAt, new Date(endDate))
        )
      );
    return {
      totalCalls: Number(result?.totalCalls || 0),
      totalMinutes: Number(result?.totalMinutes || 0),
    };
  }

  async createJobFromEstimate(estimate: Estimate, contactId: string): Promise<ServicePlan> {
    const totalDollars = (estimate.totalCents / 100).toFixed(2);
    const today = new Date().toISOString().split("T")[0];
    const svcName = estimate.description || "Job from estimate";

    return db.transaction(async (tx) => {
      const [sp] = await tx
        .insert(servicePlans)
        .values({
          companyId: estimate.companyId,
          contactId,
          propertyId: estimate.propertyId!,
          frequency: "onetime",
          pricePerVisit: totalDollars,
          startDate: today,
          isActive: false,
          serviceName: svcName,
          jobType: "one_off",
          jobStatus: "draft",
          anytime: true,
          estimateId: estimate.id,
          stopOrder: 0,
        })
        .returning();

      const [agreement] = await tx
        .insert(agreements)
        .values({
          companyId: estimate.companyId,
          contactId,
          frequency: "onetime",
          pricePerVisit: totalDollars,
          isActive: false,
          startDate: today,
          estimateId: estimate.id,
          servicePlanId: sp.id,
        })
        .returning();

      await tx.insert(jobs).values({
        companyId: estimate.companyId,
        agreementId: agreement.id,
        propertyId: estimate.propertyId!,
        serviceName: svcName,
        jobType: "one_off",
        jobStatus: "draft",
        anytime: true,
        stopOrder: 0,
        servicePlanId: sp.id,
      });

      return sp;
    });
  }
  // ================ Quotes ================
  async getQuote(id: string, companyId: string): Promise<Quote | undefined> {
    const [quote] = await db
      .select()
      .from(quotes)
      .where(and(eq(quotes.id, id), eq(quotes.companyId, companyId)));
    return quote;
  }

  async getQuotes(
    companyId: string,
    filters?: { status?: string; type?: string; contactId?: string }
  ): Promise<Quote[]> {
    const conditions = [eq(quotes.companyId, companyId)];
    if (filters?.status)
      conditions.push(eq(quotes.status, filters.status as (typeof quotes.$inferSelect)["status"]));
    if (filters?.type)
      conditions.push(eq(quotes.type, filters.type as (typeof quotes.$inferSelect)["type"]));
    if (filters?.contactId) conditions.push(eq(quotes.contactId, filters.contactId));
    return db
      .select()
      .from(quotes)
      .where(and(...conditions))
      .orderBy(desc(quotes.createdAt));
  }

  async createQuote(data: InsertQuote): Promise<Quote> {
    const [quote] = await db.insert(quotes).values(data).returning();
    return quote;
  }

  async updateQuote(id: string, companyId: string, data: Partial<InsertQuote>): Promise<Quote> {
    const [quote] = await db
      .update(quotes)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(quotes.id, id), eq(quotes.companyId, companyId)))
      .returning();
    return quote;
  }

  async deleteQuote(id: string, companyId: string): Promise<void> {
    await db.delete(quotes).where(and(eq(quotes.id, id), eq(quotes.companyId, companyId)));
  }

  async getNextQuoteNumber(companyId: string): Promise<string> {
    const [result] = await db
      .select({
        maxNum: sql<string>`max(quote_number)`,
      })
      .from(quotes)
      .where(eq(quotes.companyId, companyId));
    const current = result?.maxNum;
    if (!current) return "Q-0001";
    const match = current.match(/Q-(\d+)/);
    if (!match) return "Q-0001";
    const next = parseInt(match[1], 10) + 1;
    return `Q-${String(next).padStart(4, "0")}`;
  }

  // ================ Message Routing (shared number) ================

  async findMessageRouting(sharedNumber: string, customerPhone: string): Promise<MessageRouting[]> {
    const canonicalShared = this.canonicalizePhone(sharedNumber);
    const canonicalCustomer = this.canonicalizePhone(customerPhone);
    if (!canonicalShared || !canonicalCustomer) return [];
    const rows = await db
      .select()
      .from(messageRouting)
      .where(
        and(
          eq(messageRouting.sharedNumber, canonicalShared),
          eq(messageRouting.customerPhone, canonicalCustomer)
        )
      )
      .orderBy(desc(messageRouting.lastUsedAt));
    return rows;
  }

  private canonicalizePhone(phone: string): string {
    const digits = phone.replace(/\D/g, "");
    if (digits.length === 10) return `+1${digits}`;
    if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
    return `+${digits}`;
  }

  async upsertMessageRouting(data: InsertMessageRouting): Promise<MessageRouting> {
    const canonicalData = {
      ...data,
      sharedNumber: this.canonicalizePhone(data.sharedNumber),
      customerPhone: this.canonicalizePhone(data.customerPhone),
    };
    const [row] = await db
      .insert(messageRouting)
      .values(canonicalData)
      .onConflictDoUpdate({
        target: [
          messageRouting.sharedNumber,
          messageRouting.customerPhone,
          messageRouting.companyId,
        ],
        set: {
          contactId: canonicalData.contactId,
          lastUsedAt: new Date(),
        },
      })
      .returning();
    return row;
  }

  // ================ Message Attachments ================

  async createMessageAttachment(data: InsertMessageAttachment): Promise<MessageAttachment> {
    const [row] = await db.insert(messageAttachments).values(data).returning();
    return row;
  }

  async getMessageAttachments(messageId: string): Promise<MessageAttachment[]> {
    return await db
      .select()
      .from(messageAttachments)
      .where(eq(messageAttachments.messageId, messageId))
      .orderBy(asc(messageAttachments.createdAt));
  }

  // ================ Message Exceptions ================

  async getMessageExceptions(filters?: {
    resolved?: boolean;
    companyId?: string;
  }): Promise<MessageException[]> {
    const conditions = [];
    if (filters?.resolved === false) {
      conditions.push(sql`${messageExceptions.resolvedAt} IS NULL`);
    } else if (filters?.resolved === true) {
      conditions.push(sql`${messageExceptions.resolvedAt} IS NOT NULL`);
    }
    if (filters?.companyId) {
      conditions.push(
        sql`(${messageExceptions.candidateCompanyIds} @> ARRAY[${filters.companyId}]::text[] OR ${messageExceptions.resolvedCompanyId} = ${filters.companyId})`
      );
    }
    const query =
      conditions.length > 0
        ? db
            .select()
            .from(messageExceptions)
            .where(and(...conditions))
            .orderBy(desc(messageExceptions.createdAt))
        : db.select().from(messageExceptions).orderBy(desc(messageExceptions.createdAt));
    return await query;
  }

  async createMessageException(data: InsertMessageException): Promise<MessageException> {
    const [row] = await db.insert(messageExceptions).values(data).returning();
    return row;
  }

  async resolveMessageException(
    id: string,
    resolvedBy: string,
    companyId: string,
    skipCandidateCheck?: boolean
  ): Promise<MessageException | undefined> {
    const conditions = [eq(messageExceptions.id, id), sql`${messageExceptions.resolvedAt} IS NULL`];
    if (!skipCandidateCheck) {
      conditions.push(sql`${messageExceptions.candidateCompanyIds} @> ARRAY[${companyId}]::text[]`);
    }
    const [row] = await db
      .update(messageExceptions)
      .set({ resolvedAt: new Date(), resolvedBy, resolvedCompanyId: companyId })
      .where(and(...conditions))
      .returning();
    return row;
  }

  async dismissMessageException(
    id: string,
    resolvedBy: string,
    companyId?: string
  ): Promise<MessageException | undefined> {
    const conditions = [eq(messageExceptions.id, id), sql`${messageExceptions.resolvedAt} IS NULL`];
    if (companyId) {
      conditions.push(sql`${messageExceptions.candidateCompanyIds} @> ARRAY[${companyId}]::text[]`);
    }
    const [row] = await db
      .update(messageExceptions)
      .set({ resolvedAt: new Date(), resolvedBy, reason: "dismissed" })
      .where(and(...conditions))
      .returning();
    return row;
  }

  async createSystemMessage(data: InsertSystemMessage): Promise<SystemMessage> {
    const [msg] = await db.insert(systemMessages).values(data).returning();
    return msg;
  }

  async getSystemMessages(
    companyId: string,
    filters?: { includeDismissed?: boolean }
  ): Promise<SystemMessage[]> {
    const conditions = [eq(systemMessages.companyId, companyId)];
    if (!filters?.includeDismissed) {
      conditions.push(isNull(systemMessages.dismissedAt));
    }
    return db
      .select()
      .from(systemMessages)
      .where(and(...conditions))
      .orderBy(desc(systemMessages.createdAt))
      .limit(50);
  }

  async getUnreadSystemMessageCount(companyId: string): Promise<number> {
    const [result] = await db
      .select({ count: count() })
      .from(systemMessages)
      .where(
        and(
          eq(systemMessages.companyId, companyId),
          isNull(systemMessages.dismissedAt),
          isNull(systemMessages.readAt)
        )
      );
    return result?.count ?? 0;
  }

  async markSystemMessageRead(id: string, companyId: string): Promise<SystemMessage | undefined> {
    const [row] = await db
      .update(systemMessages)
      .set({ readAt: new Date() })
      .where(and(eq(systemMessages.id, id), eq(systemMessages.companyId, companyId)))
      .returning();
    return row;
  }

  async dismissSystemMessage(id: string, companyId: string): Promise<SystemMessage | undefined> {
    const [row] = await db
      .update(systemMessages)
      .set({ dismissedAt: new Date() })
      .where(and(eq(systemMessages.id, id), eq(systemMessages.companyId, companyId)))
      .returning();
    return row;
  }

  async dismissAllSystemMessages(companyId: string): Promise<void> {
    await db
      .update(systemMessages)
      .set({ dismissedAt: new Date() })
      .where(and(eq(systemMessages.companyId, companyId), isNull(systemMessages.dismissedAt)));
  }

  // ================ Business Assessments ================
  async saveBusinessAssessment(data: InsertBusinessAssessment): Promise<BusinessAssessment> {
    const [row] = await db.insert(businessAssessments).values(data).returning();
    return row;
  }

  async getBusinessAssessments(companyId: string, limit = 13): Promise<BusinessAssessment[]> {
    return db
      .select()
      .from(businessAssessments)
      .where(eq(businessAssessments.companyId, companyId))
      .orderBy(desc(businessAssessments.createdAt))
      .limit(limit);
  }

  async getBusinessAssessmentById(
    id: string,
    companyId: string
  ): Promise<BusinessAssessment | null> {
    const [row] = await db
      .select()
      .from(businessAssessments)
      .where(and(eq(businessAssessments.id, id), eq(businessAssessments.companyId, companyId)));
    return row ?? null;
  }

  // ================ Error Reports ================
  async createErrorReport(data: InsertErrorReport): Promise<ErrorReport> {
    const [row] = await db.insert(errorReports).values(data).returning();
    return row;
  }

  async listErrorReports(filters?: {
    status?: string;
    message?: string;
    fromDate?: Date;
    toDate?: Date;
    limit?: number;
    offset?: number;
  }): Promise<ErrorReport[]> {
    const status = filters?.status as "open" | "acknowledged" | "resolved" | undefined;
    return db
      .select()
      .from(errorReports)
      .where(
        and(
          status ? eq(errorReports.status, status) : undefined,
          filters?.message ? eq(errorReports.message, filters.message) : undefined,
          filters?.fromDate ? gte(errorReports.createdAt, filters.fromDate) : undefined,
          filters?.toDate ? lte(errorReports.createdAt, filters.toDate) : undefined
        )
      )
      .orderBy(desc(errorReports.createdAt))
      .limit(filters?.limit ?? 50)
      .offset(filters?.offset ?? 0);
  }

  async listGroupedErrorReports(filters?: {
    status?: string;
    severity?: string;
    fromDate?: Date;
    toDate?: Date;
    limit?: number;
    offset?: number;
  }): Promise<GroupedErrorReport[]> {
    const { status, severity, fromDate, toDate, limit = 50, offset = 0 } = filters ?? {};
    const whereParts: ReturnType<typeof sql>[] = [];
    if (status) whereParts.push(sql`status = ${status}`);
    if (severity) whereParts.push(sql`severity = ${severity}`);
    if (fromDate) whereParts.push(sql`created_at >= ${fromDate}`);
    if (toDate) whereParts.push(sql`created_at <= ${toDate}`);
    const whereClause =
      whereParts.length > 0 ? sql`WHERE ${sql.join(whereParts, sql` AND `)}` : sql``;
    const result = await db.execute(sql`
      WITH grouped AS (
        SELECT
          message,
          COUNT(*) AS cnt,
          MIN(created_at) AS first_seen,
          MAX(created_at) AS last_seen
        FROM error_reports
        ${whereClause}
        GROUP BY message
      ),
      latest AS (
        SELECT DISTINCT ON (message)
          id, message, error_type, status, severity
        FROM error_reports
        ${whereClause}
        ORDER BY message, created_at DESC
      )
      SELECT
        g.message,
        g.cnt::int AS count,
        g.first_seen AS "firstSeen",
        g.last_seen AS "lastSeen",
        l.id AS "latestId",
        l.error_type AS "errorType",
        l.status,
        l.severity
      FROM grouped g
      JOIN latest l ON l.message = g.message
      ORDER BY
        CASE l.severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END,
        g.cnt DESC,
        g.last_seen DESC
      LIMIT ${limit} OFFSET ${offset}
    `);
    return result.rows as GroupedErrorReport[];
  }

  async getErrorReport(id: string): Promise<ErrorReport | undefined> {
    const [row] = await db.select().from(errorReports).where(eq(errorReports.id, id));
    return row;
  }

  async updateErrorReport(
    id: string,
    data: Partial<Pick<InsertErrorReport, "status" | "severity">>
  ): Promise<ErrorReport> {
    const [row] = await db
      .update(errorReports)
      .set(data)
      .where(eq(errorReports.id, id))
      .returning();
    return row;
  }

  async bulkUpdateErrorReportStatus(
    message: string,
    status: "open" | "acknowledged" | "resolved"
  ): Promise<number> {
    const result = await db
      .update(errorReports)
      .set({ status })
      .where(eq(errorReports.message, message))
      .returning({ id: errorReports.id });
    return result.length;
  }

  async createErrorFixTask(data: InsertErrorFixTask): Promise<ErrorFixTask> {
    const [row] = await db.insert(errorFixTasks).values(data).returning();
    return row;
  }

  async getErrorFixTask(errorReportId: string): Promise<ErrorFixTask | undefined> {
    const [row] = await db
      .select()
      .from(errorFixTasks)
      .where(eq(errorFixTasks.errorReportId, errorReportId));
    return row;
  }

  async updateErrorFixTask(
    id: string,
    data: Partial<Pick<ErrorFixTask, "status">>
  ): Promise<ErrorFixTask> {
    const [row] = await db
      .update(errorFixTasks)
      .set(data)
      .where(eq(errorFixTasks.id, id))
      .returning();
    return row;
  }

  async getOpenErrorCount(): Promise<number> {
    const [result] = await db
      .select({ cnt: count() })
      .from(errorReports)
      .where(eq(errorReports.status, "open"));
    return result?.cnt ?? 0;
  }

  async getLatestErrorTimestamp(): Promise<Date | null> {
    const [result] = await db
      .select({ ts: sql<Date>`max(${errorReports.createdAt})` })
      .from(errorReports);
    return result?.ts ?? null;
  }

  async getGeocodeCache(addressKey: string): Promise<GeocodeCache | undefined> {
    const [row] = await db
      .select()
      .from(geocodeCacheTable)
      .where(eq(geocodeCacheTable.addressKey, addressKey));
    return row;
  }

  async setGeocodeCache(
    addressKey: string,
    latitude: string | null,
    longitude: string | null
  ): Promise<void> {
    await db
      .insert(geocodeCacheTable)
      .values({ addressKey, latitude, longitude, cachedAt: new Date() })
      .onConflictDoUpdate({
        target: geocodeCacheTable.addressKey,
        set: { latitude, longitude, cachedAt: new Date() },
      });
  }

  async pruneGeocodeCache(olderThanDays: number): Promise<void> {
    const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);
    await db.delete(geocodeCacheTable).where(lt(geocodeCacheTable.cachedAt, cutoff));
  }

  async getAutocompleteCache(queryKey: string): Promise<AutocompleteCache | undefined> {
    const [row] = await db
      .select()
      .from(autocompleteCacheTable)
      .where(eq(autocompleteCacheTable.queryKey, queryKey));
    return row;
  }

  async setAutocompleteCache(queryKey: string, results: unknown[]): Promise<void> {
    await db
      .insert(autocompleteCacheTable)
      .values({ queryKey, results, cachedAt: new Date() })
      .onConflictDoUpdate({
        target: autocompleteCacheTable.queryKey,
        set: { results, cachedAt: new Date() },
      });
  }

  async pruneAutocompleteCache(olderThanDays: number): Promise<void> {
    const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);
    await db.delete(autocompleteCacheTable).where(lt(autocompleteCacheTable.cachedAt, cutoff));
  }

  async createRetellWebhookRepair(data: InsertRetellWebhookRepair): Promise<RetellWebhookRepair> {
    const [repair] = await db.insert(retellWebhookRepairs).values(data).returning();
    return repair;
  }

  async listRetellWebhookRepairs(companyId: string, limit = 50): Promise<RetellWebhookRepair[]> {
    return db
      .select()
      .from(retellWebhookRepairs)
      .where(eq(retellWebhookRepairs.companyId, companyId))
      .orderBy(desc(retellWebhookRepairs.repairedAt))
      .limit(limit);
  }
}

export const storage = new DatabaseStorage();
