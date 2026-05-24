CREATE TYPE "public"."activity_action" AS ENUM('created', 'updated', 'status_changed', 'visit_completed', 'visit_scheduled', 'invoice_created', 'invoice_paid', 'email_sent', 'email_inbound', 'sms_sent', 'note_added', 'portal_login');--> statement-breakpoint
CREATE TYPE "public"."audit_action" AS ENUM('create', 'update', 'delete', 'void');--> statement-breakpoint
CREATE TYPE "public"."automation_trigger" AS ENUM('lead_created', 'service_completed', 'payment_failed', 'invoice_created', 'quote_created');--> statement-breakpoint
CREATE TYPE "public"."calendar_feed_mode" AS ENUM('summary', 'detailed');--> statement-breakpoint
CREATE TYPE "public"."change_request_status" AS ENUM('pending', 'approved', 'denied');--> statement-breakpoint
CREATE TYPE "public"."change_request_type" AS ENUM('frequency_change', 'day_change', 'cancel', 'other', 'same_day_service', 'pause');--> statement-breakpoint
CREATE TYPE "public"."charge_timing" AS ENUM('day_before', 'weekly_batch');--> statement-breakpoint
CREATE TYPE "public"."churn_reason" AS ENUM('too_expensive', 'not_enough_features', 'switched_competitor', 'business_closed', 'seasonal', 'poor_support', 'other');--> statement-breakpoint
CREATE TYPE "public"."competitor_source" AS ENUM('manual', 'research');--> statement-breakpoint
CREATE TYPE "public"."contact_type" AS ENUM('residential', 'commercial');--> statement-breakpoint
CREATE TYPE "public"."cost_driver_type" AS ENUM('pct_revenue', 'per_stop', 'per_mile', 'fuel', 'payment_processing', 'pct_expense', 'per_unit', 'manual');--> statement-breakpoint
CREATE TYPE "public"."day_of_week" AS ENUM('monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday', 'tbd');--> statement-breakpoint
CREATE TYPE "public"."discount_type" AS ENUM('percent', 'amount');--> statement-breakpoint
CREATE TYPE "public"."document_request_status" AS ENUM('pending', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."email_status" AS ENUM('queued', 'sent', 'delivered', 'bounced', 'failed');--> statement-breakpoint
CREATE TYPE "public"."ends_after_unit" AS ENUM('days', 'weeks', 'months', 'years');--> statement-breakpoint
CREATE TYPE "public"."error_report_severity" AS ENUM('low', 'medium', 'high', 'critical');--> statement-breakpoint
CREATE TYPE "public"."error_report_status" AS ENUM('open', 'acknowledged', 'resolved');--> statement-breakpoint
CREATE TYPE "public"."error_report_type" AS ENUM('react', 'js', 'api');--> statement-breakpoint
CREATE TYPE "public"."estimate_status" AS ENUM('pending', 'approved', 'declined', 'expired');--> statement-breakpoint
CREATE TYPE "public"."import_batch_source" AS ENUM('csv_contacts', 'competitor_contacts');--> statement-breakpoint
CREATE TYPE "public"."import_batch_status" AS ENUM('pending', 'processing', 'staged', 'committed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."import_row_status" AS ENUM('needs_review', 'ready', 'ignored', 'imported');--> statement-breakpoint
CREATE TYPE "public"."import_run_status" AS ENUM('pending', 'processing', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."import_run_type" AS ENUM('sweepandgo_contacts', 'sweepandgo_invoices', 'csv_contacts', 'csv_routes');--> statement-breakpoint
CREATE TYPE "public"."inbound_email_status" AS ENUM('matched', 'unmatched', 'ignored');--> statement-breakpoint
CREATE TYPE "public"."invoice_frequency" AS ENUM('per_service', 'per_week', 'per_month');--> statement-breakpoint
CREATE TYPE "public"."invoice_status" AS ENUM('draft', 'sent', 'pending', 'paid', 'failed', 'refunded', 'voided');--> statement-breakpoint
CREATE TYPE "public"."invoice_timing" AS ENUM('before_service', 'after_service');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('draft', 'approved', 'active', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."job_type" AS ENUM('one_off', 'recurring');--> statement-breakpoint
CREATE TYPE "public"."lead_status" AS ENUM('lead', 'estimate', 'active', 'paused', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."message_channel" AS ENUM('email', 'sms');--> statement-breakpoint
CREATE TYPE "public"."message_direction" AS ENUM('inbound', 'outbound');--> statement-breakpoint
CREATE TYPE "public"."message_status" AS ENUM('queued', 'sent', 'delivered', 'failed', 'received');--> statement-breakpoint
CREATE TYPE "public"."notification_type" AS ENUM('invoice_paid', 'invoice_overdue', 'visit_completed', 'new_lead', 'payment_failed', 'service_paused', 'service_resumed', 'portal_login', 'team_joined', 'general', 'portal_message', 'new_message', 'system_warning');--> statement-breakpoint
CREATE TYPE "public"."overhead_cost_type" AS ENUM('fixed', 'variable');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('cash', 'check', 'card', 'ach', 'other', 'imported');--> statement-breakpoint
CREATE TYPE "public"."payment_source" AS ENUM('stripe', 'manual', 'imported');--> statement-breakpoint
CREATE TYPE "public"."price_recommendation_source" AS ENUM('manual', 'auto', 'ai_optimizer');--> statement-breakpoint
CREATE TYPE "public"."pricing_category" AS ENUM('recurring_service', 'one_time_service', 'add_on', 'package');--> statement-breakpoint
CREATE TYPE "public"."profitability_status" AS ENUM('profitable', 'marginal', 'unprofitable');--> statement-breakpoint
CREATE TYPE "public"."qbo_sync_status" AS ENUM('pending', 'synced', 'error');--> statement-breakpoint
CREATE TYPE "public"."quote_status" AS ENUM('draft', 'sent', 'accepted', 'declined', 'expired', 'converted');--> statement-breakpoint
CREATE TYPE "public"."quote_tier" AS ENUM('essential', 'premium', 'deluxe');--> statement-breakpoint
CREATE TYPE "public"."quote_type" AS ENUM('residential', 'commercial');--> statement-breakpoint
CREATE TYPE "public"."review_branch" AS ENUM('positive', 'negative');--> statement-breakpoint
CREATE TYPE "public"."rover_ticket_status" AS ENUM('open', 'in_progress', 'resolved', 'closed');--> statement-breakpoint
CREATE TYPE "public"."rover_ticket_type" AS ENUM('bug', 'feature_request', 'question');--> statement-breakpoint
CREATE TYPE "public"."service_frequency" AS ENUM('weekly', 'biweekly', 'monthly', 'onetime');--> statement-breakpoint
CREATE TYPE "public"."sms_direction" AS ENUM('inbound', 'outbound');--> statement-breakpoint
CREATE TYPE "public"."sms_status" AS ENUM('queued', 'sent', 'delivered', 'failed', 'received');--> statement-breakpoint
CREATE TYPE "public"."subscription_status" AS ENUM('active', 'past_due', 'cancelled', 'trialing', 'suspended', 'pending_approval');--> statement-breakpoint
CREATE TYPE "public"."subscription_tier" AS ENUM('free_trial', 'tier_starter', 'tier_1', 'tier_1_3', 'tier_3_5', 'tier_6_10', 'tier_10_plus');--> statement-breakpoint
CREATE TYPE "public"."system_message_severity" AS ENUM('info', 'warning', 'error');--> statement-breakpoint
CREATE TYPE "public"."time_window_type" AS ENUM('anytime', 'morning', 'afternoon', 'specific');--> statement-breakpoint
CREATE TYPE "public"."usage_event_type" AS ENUM('sms_segment', 'voice_minute', 'user_seat', 'api_call');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('owner', 'admin', 'tech', 'lead_response_operator');--> statement-breakpoint
CREATE TYPE "public"."visit_status" AS ENUM('scheduled', 'in_progress', 'completed', 'skipped', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."webhook_delivery_status" AS ENUM('pending', 'success', 'failed');--> statement-breakpoint
CREATE TYPE "public"."yard_difficulty" AS ENUM('flat', 'moderate', 'difficult');--> statement-breakpoint
CREATE TABLE "account_daily_metrics" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"date" date NOT NULL,
	"logins" integer DEFAULT 0 NOT NULL,
	"jobs_scheduled" integer DEFAULT 0 NOT NULL,
	"jobs_completed" integer DEFAULT 0 NOT NULL,
	"invoices_sent" integer DEFAULT 0 NOT NULL,
	"payments_count" integer DEFAULT 0 NOT NULL,
	"payments_gross_cents" integer DEFAULT 0 NOT NULL,
	"payments_net_cents" integer DEFAULT 0 NOT NULL,
	"twilio_sms_outbound" integer DEFAULT 0 NOT NULL,
	"twilio_sms_inbound" integer DEFAULT 0 NOT NULL,
	"twilio_cost_cents_est" integer DEFAULT 0 NOT NULL,
	"sendgrid_emails_sent" integer DEFAULT 0 NOT NULL,
	"sendgrid_cost_cents_est" integer DEFAULT 0 NOT NULL,
	"churn_risk_score" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "account_daily_metrics_company_id_date_unique" UNIQUE("company_id","date")
);
--> statement-breakpoint
CREATE TABLE "activity_log" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"contact_id" varchar,
	"user_id" varchar,
	"action" "activity_action" NOT NULL,
	"details" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "admin_audit_logs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admin_user_id" varchar,
	"admin_email" varchar(255) NOT NULL,
	"action" varchar(100) NOT NULL,
	"resource_type" varchar(100),
	"resource_id" varchar(255),
	"details" jsonb,
	"ip_address" varchar(45),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "admin_notes" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"content" text NOT NULL,
	"created_by" varchar NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "admin_sessions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admin_user_id" varchar NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "admin_users" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(255) NOT NULL,
	"password_hash" text NOT NULL,
	"previous_password_hashes" text[] DEFAULT '{}'::text[] NOT NULL,
	"password_changed_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "admin_users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "agreements" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"contact_id" varchar NOT NULL,
	"frequency" "service_frequency" NOT NULL,
	"price_per_visit" numeric(10, 2) NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"paused_at" timestamp,
	"start_date" date NOT NULL,
	"end_date" date,
	"ends_after_count" integer,
	"ends_after_unit" "ends_after_unit",
	"estimate_id" varchar,
	"service_plan_id" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"name" varchar(255) NOT NULL,
	"key_hash" varchar(255) NOT NULL,
	"key_prefix" varchar(10) NOT NULL,
	"scopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_used_at" timestamp,
	"expires_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_usage_daily" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"date" date NOT NULL,
	"provider" varchar(50) NOT NULL,
	"metric" varchar(50) NOT NULL,
	"calls" integer DEFAULT 0 NOT NULL,
	"company_id" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attachments" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"contact_id" varchar,
	"property_id" varchar,
	"visit_id" varchar,
	"file_name" varchar(255) NOT NULL,
	"file_url" text NOT NULL,
	"file_type" varchar(50),
	"file_size" integer,
	"document_category" varchar(100),
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_trail" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"user_id" varchar,
	"entity_type" varchar(50) NOT NULL,
	"entity_id" varchar(255) NOT NULL,
	"action" "audit_action" NOT NULL,
	"changes" jsonb,
	"ip_address" varchar(45),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "autocomplete_cache" (
	"query_key" varchar(512) PRIMARY KEY NOT NULL,
	"results" jsonb NOT NULL,
	"cached_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "automation_event_logs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"rule_id" varchar,
	"trigger" varchar(50) NOT NULL,
	"payload" jsonb,
	"result" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "automation_rules" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"trigger" "automation_trigger" NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"action_config" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "business_assessments" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"score" integer NOT NULL,
	"verdict" text NOT NULL,
	"fact_sheet_hash" varchar,
	"full_result" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "companies" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"email" varchar(255),
	"phone" varchar(50),
	"address" text,
	"start_address" text,
	"start_latitude" numeric(10, 7),
	"start_longitude" numeric(10, 7),
	"logo_url" text,
	"stripe_customer_id" varchar(255),
	"stripe_subscription_id" varchar(255),
	"stripe_connect_account_id" varchar(255),
	"stripe_connect_onboarded" boolean DEFAULT false NOT NULL,
	"subscription_tier" "subscription_tier" DEFAULT 'tier_1' NOT NULL,
	"subscription_status" "subscription_status" DEFAULT 'trialing' NOT NULL,
	"charge_timing" charge_timing DEFAULT 'day_before' NOT NULL,
	"invoice_theme" text,
	"mrr_cents" integer DEFAULT 0 NOT NULL,
	"reminders_enabled" boolean DEFAULT false NOT NULL,
	"reminder_settings" jsonb,
	"invoice_reminder_settings" jsonb,
	"auto_visits_enabled" boolean DEFAULT false NOT NULL,
	"dashboard_layout" jsonb,
	"settings_layout" jsonb,
	"dashboard_notes" text,
	"ai_import_mapping_enabled" boolean DEFAULT true NOT NULL,
	"rover_ai_enabled" boolean DEFAULT true NOT NULL,
	"pricing_config" jsonb,
	"quote_defaults" jsonb,
	"voice_agent_service_area" text,
	"voice_agent_pricing_summary" text,
	"voice_agent_policies" text,
	"voice_agent_special_lines" text,
	"voice_agent_greeting" text,
	"slug" varchar(100),
	"lead_webhook_sms_template" text,
	"quote_auto_follow_up_enabled" boolean DEFAULT false NOT NULL,
	"quote_follow_up_sms_template" text,
	"quote_follow_up_email_enabled" boolean DEFAULT false NOT NULL,
	"quote_follow_up_email_subject" text,
	"quote_follow_up_email_body" text,
	"quote_form_layout" varchar(20) DEFAULT 'stepper' NOT NULL,
	"qbo_realm_id" varchar(50),
	"qbo_access_token" text,
	"qbo_refresh_token" text,
	"qbo_token_expires_at" timestamp,
	"qbo_connected_at" timestamp,
	"qbo_income_account_ref" varchar(50),
	"qbo_fee_account_ref" varchar(50),
	"timezone" varchar(100) DEFAULT 'America/New_York' NOT NULL,
	"last_auto_invoice_run" date,
	"frozen_at" timestamp,
	"trial_ends_at" timestamp,
	"canceled_at" timestamp,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"cancel_at" timestamp,
	"subscription_updated_at" timestamp,
	"churn_reason" varchar(100),
	"signup_country" varchar(5),
	"verification_url" text,
	"churn_notes" text,
	"voice_plan_tier" varchar(50),
	"voice_plan_status" varchar(50),
	"voice_plan_included_minutes" integer,
	"voice_plan_overage_rate" numeric(5, 2),
	"stripe_voice_subscription_id" varchar(255),
	"dedicated_phone_number" varchar(20),
	"sms_provider" varchar(20) DEFAULT 'telnyx' NOT NULL,
	"telnyx_api_key" text,
	"telnyx_phone_number" varchar(20),
	"telnyx_messaging_profile_id" varchar(255),
	"retell_agent_id" varchar(255),
	"retell_knowledge_base_id" varchar(255),
	"porting_phone_number" varchar(20),
	"voice_area_code_preference" varchar(3),
	"voice_number_porting_status" varchar(20),
	"venmo_handle" varchar(100),
	"billing_cadence" text DEFAULT 'per_visit' NOT NULL,
	"billing_trigger" text DEFAULT 'after_job' NOT NULL,
	"default_payment_behavior" text DEFAULT 'send_invoice' NOT NULL,
	"max_stops_per_route" integer DEFAULT 50,
	"min_stops_per_day" integer DEFAULT 3,
	"max_route_duration_hours" real DEFAULT 7.5,
	"route_planning_mode" varchar(10) DEFAULT 'stops' NOT NULL,
	"avg_minutes_per_stop" integer DEFAULT 12,
	"min_route_duration_hours" real DEFAULT 1,
	"custom_max_users" integer,
	"message_retention_days" integer DEFAULT 30 NOT NULL,
	"country" varchar(5) DEFAULT 'us' NOT NULL,
	"currency" varchar(5) DEFAULT 'usd' NOT NULL,
	"tax_rate_percent" numeric(5, 2),
	"demo_bypass_limits" boolean DEFAULT false NOT NULL,
	"demo_auto_complete_today" boolean DEFAULT false NOT NULL,
	"demo_auto_pay_invoices" boolean DEFAULT false NOT NULL,
	"demo_live_playback_enabled" boolean DEFAULT false NOT NULL,
	"review_request_enabled" boolean DEFAULT false NOT NULL,
	"review_router_enabled" boolean DEFAULT true NOT NULL,
	"google_review_url" text,
	"review_request_after_visits" integer DEFAULT 3 NOT NULL,
	"review_request_custom_message" text,
	"client_notifications_suppressed" boolean DEFAULT true NOT NULL,
	"onboarding_complete_sent_at" timestamp,
	"pass_stripe_fees" boolean DEFAULT false NOT NULL,
	"require_card_on_signup" boolean DEFAULT true NOT NULL,
	"widget_field_config" jsonb,
	"yard_size_tier_config" jsonb,
	"require_document_signing" boolean DEFAULT false NOT NULL,
	"business_onboarding_step" integer DEFAULT 0 NOT NULL,
	"business_onboarding_complete" boolean DEFAULT false NOT NULL,
	"website_url" text,
	"business_description" text,
	"service_area_description" text,
	"calendar_token" text DEFAULT gen_random_uuid(),
	"calendar_feed_mode" "calendar_feed_mode" DEFAULT 'summary' NOT NULL,
	"inbound_email" text,
	"inbound_email_slug" text,
	"new_client_deposit_enabled" boolean DEFAULT false NOT NULL,
	"new_client_deposit_type" varchar(10),
	"new_client_deposit_value" numeric(10, 2),
	"deleted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "companies_slug_unique" UNIQUE("slug"),
	CONSTRAINT "companies_calendar_token_unique" UNIQUE("calendar_token"),
	CONSTRAINT "companies_inbound_email_unique" UNIQUE("inbound_email"),
	CONSTRAINT "companies_inbound_email_slug_unique" UNIQUE("inbound_email_slug")
);
--> statement-breakpoint
CREATE TABLE "company_users" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"user_id" varchar NOT NULL,
	"role" "user_role" DEFAULT 'tech' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"invite_pending" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "company_users_company_id_user_id_unique" UNIQUE("company_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "competitor_pricing" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"zip_code" varchar(20) NOT NULL,
	"competitor_name" varchar(255) NOT NULL,
	"frequency" "service_frequency" DEFAULT 'weekly' NOT NULL,
	"price_cents" integer NOT NULL,
	"dog_count_range" varchar(20) DEFAULT '1-2',
	"yard_size_category" varchar(50) DEFAULT 'medium',
	"source" "competitor_source" DEFAULT 'manual' NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contact_tags" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contact_id" varchar NOT NULL,
	"tag_id" varchar NOT NULL,
	CONSTRAINT "contact_tags_contact_id_tag_id_unique" UNIQUE("contact_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"first_name" varchar(255) NOT NULL,
	"last_name" varchar(255) DEFAULT '' NOT NULL,
	"email" varchar(255),
	"phone" varchar(50),
	"street_address" varchar(255),
	"address_2" varchar(255),
	"city" varchar(100),
	"state" varchar(50),
	"zip_code" varchar(20),
	"yard_size" varchar(50),
	"number_of_dogs" integer,
	"yard_access" varchar(255),
	"dog_temperament" varchar(50),
	"custom_fields" jsonb,
	"service_frequency" varchar(50),
	"lead_source" varchar(50),
	"service_day" "day_of_week",
	"status" "lead_status" DEFAULT 'lead' NOT NULL,
	"has_portal_access" boolean DEFAULT false NOT NULL,
	"portal_user_id" varchar,
	"stripe_customer_id" varchar(255),
	"invoice_timing" "invoice_timing" DEFAULT 'after_service',
	"invoice_frequency" "invoice_frequency" DEFAULT 'per_service',
	"referral_source" varchar(255),
	"portal_password_hash" varchar(255),
	"auto_pay_enabled" boolean DEFAULT true NOT NULL,
	"auto_invoice_enabled" boolean DEFAULT true NOT NULL,
	"referral_code" varchar(20),
	"reminder_preferences" jsonb DEFAULT '{"email":true,"sms":false}'::jsonb,
	"pending_email" varchar(255),
	"email_verification_token" varchar(255),
	"email_verification_expiry" timestamp,
	"reset_token" varchar(255),
	"reset_token_expiry" timestamp,
	"qbo_customer_id" varchar(50),
	"notes" text,
	"cost_overrides" jsonb,
	"billing_cadence_override" text,
	"billing_trigger_override" text,
	"payment_behavior_override" text,
	"visits_since_last_review_request" integer DEFAULT 0 NOT NULL,
	"review_request_sent_count" integer DEFAULT 0 NOT NULL,
	"last_review_request_sent_at" timestamp,
	"google_review_left" boolean DEFAULT false NOT NULL,
	"dismissed_opportunities" jsonb DEFAULT '[]'::jsonb,
	"contact_type" "contact_type" DEFAULT 'residential' NOT NULL,
	"company_name" varchar(255),
	"lead_response_status" varchar(50),
	"deposit_amount" numeric(10, 2),
	"deposit_paid_at" timestamp,
	"deposit_invoice_id" varchar(255),
	"billing_onboarding_stage" varchar(30) DEFAULT 'none',
	"utm_source" varchar(255),
	"utm_medium" varchar(255),
	"utm_campaign" varchar(255),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cost_config" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" varchar(100) NOT NULL,
	"value_cents" integer DEFAULT 0 NOT NULL,
	"value_pct" numeric(8, 4),
	"description" text,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "cost_config_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "custom_field_definitions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"label" varchar(100) NOT NULL,
	"key" varchar(100) NOT NULL,
	"field_type" varchar(20) DEFAULT 'text' NOT NULL,
	"entity_type" varchar(20) DEFAULT 'contact' NOT NULL,
	"options" jsonb,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "depots" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"name" varchar(255) NOT NULL,
	"address" text NOT NULL,
	"latitude" numeric(10, 7) NOT NULL,
	"longitude" numeric(10, 7) NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_requests" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"contact_id" varchar NOT NULL,
	"token" varchar(128) NOT NULL,
	"status" "document_request_status" DEFAULT 'pending' NOT NULL,
	"sent_at" timestamp,
	"completed_at" timestamp,
	"certificate_url" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "document_requests_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "document_signatures" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" varchar NOT NULL,
	"template_id" varchar NOT NULL,
	"signer_name" varchar(255) NOT NULL,
	"signer_ip" varchar(64),
	"signature_image_path" text,
	"certificate_path" text,
	"signed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_templates" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"name" varchar(255) NOT NULL,
	"file_path" text NOT NULL,
	"file_size" integer,
	"mime_type" varchar(100),
	"is_active" boolean DEFAULT true NOT NULL,
	"is_required" boolean DEFAULT true NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_verification_tokens" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar NOT NULL,
	"first_name" varchar NOT NULL,
	"last_name" varchar,
	"company_name" varchar NOT NULL,
	"token_hash" varchar NOT NULL,
	"expires_at" timestamp NOT NULL,
	"used" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "emails_sent" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"contact_id" varchar,
	"category" varchar(100) DEFAULT 'general',
	"email_log_status" "email_status" DEFAULT 'sent' NOT NULL,
	"to_address" varchar(255) NOT NULL,
	"subject" varchar(500),
	"sendgrid_message_id" varchar(255),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "error_fix_tasks" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"error_report_id" varchar NOT NULL,
	"title" text NOT NULL,
	"status" varchar DEFAULT 'open' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "error_reports" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"message" text NOT NULL,
	"stack" text,
	"error_type" "error_report_type" DEFAULT 'js' NOT NULL,
	"page_url" text,
	"user_id" varchar(255),
	"company_id" varchar(255),
	"user_agent" text,
	"status" "error_report_status" DEFAULT 'open' NOT NULL,
	"severity" "error_report_severity" DEFAULT 'medium' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "estimates" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"contact_id" varchar NOT NULL,
	"property_id" varchar,
	"description" text NOT NULL,
	"items" jsonb NOT NULL,
	"total_cents" integer NOT NULL,
	"status" "estimate_status" DEFAULT 'pending' NOT NULL,
	"sent_at" timestamp,
	"responded_at" timestamp,
	"response_note" text,
	"admin_note" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fallback_log" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"channel" varchar(20) DEFAULT 'sms' NOT NULL,
	"trigger_phrase" text,
	"agent_response" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "geocode_cache" (
	"address_key" varchar(512) PRIMARY KEY NOT NULL,
	"latitude" varchar(32),
	"longitude" varchar(32),
	"cached_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_batches" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"source_type" "import_batch_source" DEFAULT 'csv_contacts' NOT NULL,
	"file_name" varchar(500),
	"status" "import_batch_status" DEFAULT 'pending' NOT NULL,
	"total_rows" integer DEFAULT 0 NOT NULL,
	"staged_rows" integer DEFAULT 0 NOT NULL,
	"ready_rows" integer DEFAULT 0 NOT NULL,
	"needs_review_rows" integer DEFAULT 0 NOT NULL,
	"ignored_rows" integer DEFAULT 0 NOT NULL,
	"imported_rows" integer DEFAULT 0 NOT NULL,
	"created_by" varchar,
	"import_run_id" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "import_mappings" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" varchar NOT NULL,
	"source_column" varchar(255) NOT NULL,
	"target_field" varchar(100) NOT NULL,
	"confidence" integer DEFAULT 0 NOT NULL,
	"is_user_override" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_rows" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" varchar NOT NULL,
	"company_id" varchar NOT NULL,
	"row_index" integer NOT NULL,
	"raw_json" jsonb,
	"mapped_contact_json" jsonb,
	"mapped_service_json" jsonb,
	"confidence_json" jsonb,
	"missing_fields" text[],
	"validation_errors" jsonb,
	"status" "import_row_status" DEFAULT 'needs_review' NOT NULL,
	"created_contact_id" varchar,
	"needs_service_setup" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_rule_suggestions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" varchar NOT NULL,
	"row_id" varchar NOT NULL,
	"suggested_frequency" varchar(50),
	"suggested_service_day" varchar(50),
	"suggested_next_date" varchar(20),
	"suggested_price_cents" integer,
	"suggested_billing_rule" varchar(100),
	"confidence_score" integer DEFAULT 0 NOT NULL,
	"reason" text,
	"is_accepted" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_runs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"type" "import_run_type" NOT NULL,
	"status" "import_run_status" DEFAULT 'pending' NOT NULL,
	"file_name" varchar(500),
	"file_hash" varchar(128),
	"total_rows" integer DEFAULT 0 NOT NULL,
	"imported_rows" integer DEFAULT 0 NOT NULL,
	"skipped_rows" integer DEFAULT 0 NOT NULL,
	"errors" jsonb,
	"mapping_config" jsonb,
	"ai_suggestions" jsonb,
	"user_overrides" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "inbound_emails" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" varchar NOT NULL,
	"from_address" text NOT NULL,
	"from_name" text,
	"subject" text,
	"body_text" text,
	"body_html" text,
	"matched_contact_id" varchar,
	"raw_headers" jsonb,
	"status" "inbound_email_status" DEFAULT 'unmatched' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoice_line_items" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" varchar NOT NULL,
	"visit_id" varchar,
	"service_pricing_id" varchar,
	"description" text NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"unit_price" numeric(10, 2) NOT NULL,
	"total" numeric(10, 2) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoice_payments" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"invoice_id" varchar NOT NULL,
	"amount_cents" integer NOT NULL,
	"paid_at" timestamp NOT NULL,
	"method" "payment_method" DEFAULT 'other' NOT NULL,
	"reference" text,
	"source" "payment_source" DEFAULT 'manual' NOT NULL,
	"external_id" varchar(255),
	"import_run_id" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"contact_id" varchar NOT NULL,
	"invoice_number" varchar(50) NOT NULL,
	"due_date" date NOT NULL,
	"subtotal" numeric(10, 2) NOT NULL,
	"tax_rate" numeric(5, 2) DEFAULT '0',
	"tax" numeric(10, 2) DEFAULT '0' NOT NULL,
	"discount_type" "discount_type",
	"discount_value" numeric(10, 2) DEFAULT '0',
	"discount_amount" numeric(10, 2) DEFAULT '0',
	"total" numeric(10, 2) NOT NULL,
	"tip_amount" numeric(10, 2) DEFAULT '0',
	"status" "invoice_status" DEFAULT 'draft' NOT NULL,
	"auto_generated" boolean DEFAULT false,
	"paid_at" timestamp,
	"stripe_payment_intent_id" varchar(255),
	"payment_attempts" integer DEFAULT 0 NOT NULL,
	"last_payment_attempt" timestamp,
	"source" varchar(50) DEFAULT 'manual',
	"external_source" varchar(100),
	"external_id" varchar(255),
	"qbo_invoice_id" varchar(50),
	"import_run_id" varchar,
	"issued_date" date,
	"notes" text,
	"exclude_from_reminders" boolean DEFAULT false NOT NULL,
	"last_reminder_sent_at" timestamp,
	"reminder_count" integer DEFAULT 0 NOT NULL,
	"is_onboarding_invoice" boolean DEFAULT false NOT NULL,
	"pay_token" varchar(64),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "invoices_pay_token_unique" UNIQUE("pay_token"),
	CONSTRAINT "invoices_company_id_invoice_number_unique" UNIQUE("company_id","invoice_number")
);
--> statement-breakpoint
CREATE TABLE "job_add_ons" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" varchar NOT NULL,
	"service_pricing_id" varchar NOT NULL,
	"name" varchar(255) NOT NULL,
	"price" numeric(10, 2) NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"agreement_id" varchar NOT NULL,
	"property_id" varchar NOT NULL,
	"route_id" varchar,
	"stop_order" integer DEFAULT 0 NOT NULL,
	"day_of_week" "day_of_week",
	"service_name" varchar(255),
	"job_type" "job_type" DEFAULT 'recurring',
	"job_status" "job_status" DEFAULT 'active',
	"start_time" varchar(10),
	"end_time" varchar(10),
	"anytime" boolean DEFAULT true,
	"visit_instructions" text,
	"assigned_user_id" varchar,
	"is_stop_only" boolean DEFAULT false NOT NULL,
	"service_plan_id" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lead_response_config" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"lead_response_active" boolean DEFAULT false NOT NULL,
	"lead_response_active_until" timestamp,
	"telnyx_number_release_date" timestamp,
	"stripe_subscription_id" varchar(255),
	"stripe_session_id" varchar(255),
	"hcp_api_key" varchar(1024),
	"lr_phone_number" varchar(20),
	"porting_requested" boolean DEFAULT false NOT NULL,
	"billing_mode" varchar(20),
	"deposit_percent" numeric(5, 2),
	"scheduling_platform" varchar(50),
	"service_zip_codes" text,
	"out_of_area_message" text,
	"pricing_tiers" jsonb,
	"per_dog_adder" numeric(8, 2),
	"first_time_cleanup_fee" numeric(8, 2),
	"airtable_operator_id" varchar(255),
	"setup_complete" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "lead_response_config_company_id_unique" UNIQUE("company_id")
);
--> statement-breakpoint
CREATE TABLE "lead_sources" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"name" varchar(100) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "lead_sources_company_id_name_unique" UNIQUE("company_id","name")
);
--> statement-breakpoint
CREATE TABLE "message_attachments" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"message_id" varchar NOT NULL,
	"company_id" varchar NOT NULL,
	"mime_type" varchar(100) NOT NULL,
	"original_filename" varchar(255),
	"original_size_bytes" integer,
	"compressed_size_bytes" integer,
	"storage_url" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "message_exceptions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider_message_id" varchar(255),
	"from_address" varchar(255) NOT NULL,
	"to_address" varchar(255) NOT NULL,
	"body" text,
	"raw_payload" jsonb,
	"reason" varchar(255) NOT NULL,
	"candidate_company_ids" text[] DEFAULT '{}',
	"resolved_at" timestamp,
	"resolved_by" varchar,
	"resolved_company_id" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "message_routing" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shared_number" varchar(50) NOT NULL,
	"customer_phone" varchar(50) NOT NULL,
	"company_id" varchar NOT NULL,
	"contact_id" varchar,
	"channel" varchar(20) DEFAULT 'sms' NOT NULL,
	"last_used_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "uq_mr_shared_customer_company" UNIQUE("shared_number","customer_phone","company_id")
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"contact_id" varchar,
	"channel" "message_channel" NOT NULL,
	"direction" "message_direction" NOT NULL,
	"status" "message_status" DEFAULT 'queued' NOT NULL,
	"from_address" varchar(255) NOT NULL,
	"to_address" varchar(255) NOT NULL,
	"subject" varchar(500),
	"body" text NOT NULL,
	"html_body" text,
	"external_id" varchar(255),
	"metadata" jsonb,
	"sent_by" varchar,
	"error_message" text,
	"is_read" boolean DEFAULT false NOT NULL,
	"media_urls" text[] DEFAULT '{}',
	"media_count" integer DEFAULT 0,
	"email_thread_id" varchar(255),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"type" "notification_type" DEFAULT 'general' NOT NULL,
	"title" varchar(255) NOT NULL,
	"message" text NOT NULL,
	"is_read" boolean DEFAULT false NOT NULL,
	"link_url" varchar(500),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "overhead_costs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"category" varchar(100) NOT NULL,
	"name" varchar(255) NOT NULL,
	"monthly_cost_cents" integer DEFAULT 0 NOT NULL,
	"type" "overhead_cost_type" DEFAULT 'fixed' NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"variable_rate_pct" numeric(8, 4),
	"variable_flat_cents" integer,
	"cost_driver_type" "cost_driver_type",
	"driver_rate" numeric(10, 4),
	"driver_params" jsonb
);
--> statement-breakpoint
CREATE TABLE "password_reset_tokens" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"token_hash" varchar NOT NULL,
	"expires_at" timestamp NOT NULL,
	"used" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "portal_sessions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contact_id" varchar NOT NULL,
	"company_id" varchar NOT NULL,
	"token_hash" varchar(255) NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "price_recommendations" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"property_id" varchar,
	"service_frequency" varchar(50) NOT NULL,
	"yard_size_acres" numeric(10, 4),
	"dog_count" integer DEFAULT 1 NOT NULL,
	"yard_difficulty_calc" "yard_difficulty" DEFAULT 'flat',
	"route_id" varchar,
	"minimum_price_cents" integer NOT NULL,
	"recommended_price_cents" integer NOT NULL,
	"premium_price_cents" integer NOT NULL,
	"job_minutes" numeric(10, 2),
	"service_minutes" numeric(10, 2),
	"travel_minutes" numeric(10, 2),
	"density_multiplier" numeric(5, 3),
	"breakdown_json" jsonb,
	"inputs_json" jsonb,
	"calculated_at" timestamp DEFAULT now() NOT NULL,
	"calculation_version" varchar(20) DEFAULT '1.0' NOT NULL,
	"created_by_user_id" varchar,
	"source" "price_recommendation_source" DEFAULT 'manual' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profitability_snapshots" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"contact_id" varchar NOT NULL,
	"property_id" varchar,
	"snapshot_date" date NOT NULL,
	"revenue_cents" integer DEFAULT 0 NOT NULL,
	"total_cost_cents" integer DEFAULT 0 NOT NULL,
	"profit_cents" integer DEFAULT 0 NOT NULL,
	"profit_margin_pct" numeric(8, 2) DEFAULT '0' NOT NULL,
	"visit_count" integer DEFAULT 0 NOT NULL,
	"avg_revenue_per_visit_cents" integer DEFAULT 0 NOT NULL,
	"avg_cost_per_visit_cents" integer DEFAULT 0 NOT NULL,
	"status" "profitability_status" DEFAULT 'profitable' NOT NULL,
	"breakdown_json" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "properties" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"contact_id" varchar NOT NULL,
	"street_address" varchar(255) NOT NULL,
	"city" varchar(100) NOT NULL,
	"state" varchar(50) NOT NULL,
	"zip_code" varchar(20) NOT NULL,
	"number_of_dogs" integer DEFAULT 1,
	"yard_size" varchar(50),
	"gate_code" varchar(100),
	"special_instructions" text,
	"latitude" numeric(10, 7),
	"longitude" numeric(10, 7),
	"lot_size" varchar(50),
	"yard_polygon" jsonb,
	"measured_yard_sqft" integer,
	"yard_difficulty" "yard_difficulty" DEFAULT 'flat',
	"has_dangerous_dog" boolean DEFAULT false,
	"dangerous_dog_notes" text,
	"onboarding_token" varchar(36),
	"onboarding_token_expires_at" timestamp,
	"onboarding_completed_at" timestamp,
	"dog_names" text,
	"dog_breeds" text,
	"custom_fields" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "properties_onboarding_token_unique" UNIQUE("onboarding_token")
);
--> statement-breakpoint
CREATE TABLE "qbo_sync_logs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"entity_type" varchar(50) NOT NULL,
	"entity_id" varchar(255) NOT NULL,
	"qbo_entity_id" varchar(50),
	"status" "qbo_sync_status" DEFAULT 'pending' NOT NULL,
	"action" varchar(20) NOT NULL,
	"error_message" text,
	"synced_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quote_form_events" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"session_id" varchar(64) NOT NULL,
	"event" varchar(50) NOT NULL,
	"step" integer,
	"zip_code" varchar(10),
	"is_embed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quotes" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"contact_id" varchar,
	"property_id" varchar,
	"quote_number" varchar(50) NOT NULL,
	"type" "quote_type" NOT NULL,
	"status" "quote_status" DEFAULT 'draft' NOT NULL,
	"contact_name" varchar(255),
	"contact_email" varchar(255),
	"contact_phone" varchar(50),
	"property_address" text,
	"dog_count" integer,
	"yard_size" varchar(50),
	"station_count" integer,
	"common_area_minutes" integer,
	"time_per_station" integer,
	"mileage_distance" numeric(10, 2),
	"dump_fee" numeric(10, 2),
	"crew_size" integer,
	"site_sqft" integer,
	"frequency" varchar(50),
	"is_first_time" boolean DEFAULT true,
	"essential_price" numeric(10, 2),
	"premium_price" numeric(10, 2),
	"deluxe_price" numeric(10, 2),
	"initial_clean_fee" numeric(10, 2),
	"selected_tier" "quote_tier",
	"selected_price" numeric(10, 2),
	"essential_features" jsonb,
	"premium_features" jsonb,
	"deluxe_features" jsonb,
	"pricing_breakdown" jsonb,
	"images" jsonb,
	"line_items" jsonb,
	"notes" text,
	"internal_notes" text,
	"expires_at" timestamp,
	"sent_at" timestamp,
	"accepted_at" timestamp,
	"declined_at" timestamp,
	"quote_token" varchar(36),
	"approval_enabled" boolean DEFAULT true NOT NULL,
	"accepted_via" varchar(20),
	"converted_service_plan_id" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "quotes_quote_token_unique" UNIQUE("quote_token"),
	CONSTRAINT "quotes_company_id_quote_number_unique" UNIQUE("company_id","quote_number")
);
--> statement-breakpoint
CREATE TABLE "reminder_logs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"contact_id" varchar NOT NULL,
	"visit_id" varchar,
	"invoice_id" varchar,
	"rule_id" varchar(100),
	"reminder_type" varchar(50) NOT NULL,
	"channel" varchar(10) NOT NULL,
	"message_preview" text,
	"delivery_status" varchar(20) DEFAULT 'sent' NOT NULL,
	"sent_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "retell_webhook_repairs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar,
	"agent_id" varchar(255) NOT NULL,
	"old_url" text,
	"new_url" text NOT NULL,
	"triggered_by" varchar(10) DEFAULT 'auto' NOT NULL,
	"repaired_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_responses" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_id" varchar NOT NULL,
	"rating" integer NOT NULL,
	"feedback_text" text,
	"branch" "review_branch" NOT NULL,
	"submitted_at" timestamp DEFAULT now() NOT NULL,
	"alert_sent" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_tokens" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"contact_id" varchar NOT NULL,
	"token" varchar(36) NOT NULL,
	"google_review_url" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL,
	"used_at" timestamp,
	CONSTRAINT "review_tokens_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "routes" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"name" varchar(255) NOT NULL,
	"day_of_week" "day_of_week",
	"date" date,
	"technician_id" varchar,
	"depot_id" varchar,
	"color" varchar(7) DEFAULT '#3b82f6',
	"is_locked" boolean DEFAULT false NOT NULL,
	"last_optimized_at" timestamp,
	"optimized_stop_hash" varchar(64),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "routific_usage_log" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar,
	"stop_count" integer NOT NULL,
	"success" boolean NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rover_tickets" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"user_id" varchar,
	"type" "rover_ticket_type" NOT NULL,
	"status" "rover_ticket_status" DEFAULT 'open' NOT NULL,
	"subject" varchar(255) NOT NULL,
	"description" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "saas_costs_monthly" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"month" varchar(7) NOT NULL,
	"hosting_cents" integer DEFAULT 0 NOT NULL,
	"db_cents" integer DEFAULT 0 NOT NULL,
	"email_platform_cents" integer DEFAULT 0 NOT NULL,
	"sms_platform_cents" integer DEFAULT 0 NOT NULL,
	"monitoring_cents" integer DEFAULT 0 NOT NULL,
	"other_cents" integer DEFAULT 0 NOT NULL,
	"support_labor_cents" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "saas_costs_monthly_month_unique" UNIQUE("month")
);
--> statement-breakpoint
CREATE TABLE "service_billing_rules" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"service_pricing_id" varchar NOT NULL,
	"billing_cadence" text,
	"billing_trigger" text,
	"payment_behavior" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "service_billing_rules_company_id_service_pricing_id_unique" UNIQUE("company_id","service_pricing_id")
);
--> statement-breakpoint
CREATE TABLE "service_change_requests" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"contact_id" varchar NOT NULL,
	"service_plan_id" varchar,
	"request_type" "change_request_type" NOT NULL,
	"current_value" varchar(255),
	"requested_value" varchar(255),
	"note" text,
	"status" "change_request_status" DEFAULT 'pending' NOT NULL,
	"admin_note" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"responded_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "service_packages" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"frequency" varchar(50) NOT NULL,
	"base_price" numeric(10, 2) NOT NULL,
	"included_items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_plan_add_ons" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"service_plan_id" varchar NOT NULL,
	"service_pricing_id" varchar NOT NULL,
	"name" varchar(255) NOT NULL,
	"price" numeric(10, 2) NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_plans" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"contact_id" varchar NOT NULL,
	"property_id" varchar NOT NULL,
	"frequency" "service_frequency" NOT NULL,
	"day_of_week" "day_of_week",
	"price_per_visit" numeric(10, 2) NOT NULL,
	"discount" numeric(5, 2),
	"is_active" boolean DEFAULT true NOT NULL,
	"paused_at" timestamp,
	"start_date" date NOT NULL,
	"end_date" date,
	"route_id" varchar,
	"stop_order" integer DEFAULT 0 NOT NULL,
	"service_name" varchar(255),
	"job_type" "job_type" DEFAULT 'recurring',
	"job_status" "job_status" DEFAULT 'active',
	"start_time" varchar(10),
	"end_time" varchar(10),
	"anytime" boolean DEFAULT true,
	"ends_after_count" integer,
	"ends_after_unit" "ends_after_unit",
	"visit_instructions" text,
	"assigned_user_id" varchar,
	"estimate_id" varchar,
	"is_stop_only" boolean DEFAULT false NOT NULL,
	"prorated_through" date,
	"billing_terms" varchar(20),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_pricing" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"category" "pricing_category" NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"base_price" numeric(10, 2) NOT NULL,
	"unit" varchar(50) DEFAULT 'per_visit' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_zones" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"zip_code" varchar(20) NOT NULL,
	"day_of_week" "day_of_week" DEFAULT 'tbd' NOT NULL,
	"label" varchar(100),
	"price_surcharge_percent" integer DEFAULT 0 NOT NULL,
	"latitude" numeric(10, 7),
	"longitude" numeric(10, 7),
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"sid" varchar PRIMARY KEY NOT NULL,
	"sess" jsonb NOT NULL,
	"expire" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sms_messages" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"contact_id" varchar,
	"direction" "sms_direction" NOT NULL,
	"segments" integer DEFAULT 1 NOT NULL,
	"to_number" varchar(50) NOT NULL,
	"from_number" varchar(50) NOT NULL,
	"to_country" varchar(10) DEFAULT 'US',
	"status" "sms_status" DEFAULT 'queued' NOT NULL,
	"twilio_sid" varchar(255),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sms_sessions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"from_number" varchar(30) NOT NULL,
	"to_number" varchar(30) NOT NULL,
	"messages" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "sms_sessions_from_number_to_number_unique" UNIQUE("from_number","to_number")
);
--> statement-breakpoint
CREATE TABLE "stripe_events" (
	"id" varchar PRIMARY KEY NOT NULL,
	"event_type" varchar(255) NOT NULL,
	"processed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscription_tiers" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tier_key" varchar(50) NOT NULL,
	"name" varchar(100) NOT NULL,
	"max_users" integer NOT NULL,
	"price" numeric(10, 2) NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "subscription_tiers_tier_key_unique" UNIQUE("tier_key")
);
--> statement-breakpoint
CREATE TABLE "system_health_checks" (
	"check_name" varchar(100) PRIMARY KEY NOT NULL,
	"status" varchar(10) NOT NULL,
	"severity" varchar(10) NOT NULL,
	"message" text NOT NULL,
	"last_run_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "system_messages" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"type" varchar(100) NOT NULL,
	"severity" "system_message_severity" DEFAULT 'info' NOT NULL,
	"title" varchar(255) NOT NULL,
	"body" text,
	"metadata" jsonb,
	"read_at" timestamp,
	"dismissed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tags" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"name" varchar(100) NOT NULL,
	"color" varchar(7) DEFAULT '#3b82f6',
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "tags_company_id_name_unique" UNIQUE("company_id","name")
);
--> statement-breakpoint
CREATE TABLE "time_entries" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"user_id" varchar NOT NULL,
	"visit_id" varchar,
	"route_id" varchar,
	"clock_in" timestamp NOT NULL,
	"clock_out" timestamp,
	"duration_minutes" integer,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usage_events" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"event_type" "usage_event_type" NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"metadata" jsonb,
	"recorded_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar,
	"password_hash" varchar,
	"first_name" varchar,
	"last_name" varchar,
	"profile_image_url" varchar,
	"must_change_password" boolean DEFAULT false NOT NULL,
	"last_login_at" timestamp,
	"tour_completions" jsonb DEFAULT '{}'::jsonb,
	"onboarding_email_sent_at" timestamp,
	"import_mode" boolean DEFAULT false NOT NULL,
	"default_depot_id" varchar,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "vacation_holds" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"service_plan_id" varchar NOT NULL,
	"agreement_id" varchar,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "visits" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"service_plan_id" varchar NOT NULL,
	"job_id" varchar,
	"property_id" varchar NOT NULL,
	"route_id" varchar,
	"scheduled_date" date NOT NULL,
	"status" "visit_status" DEFAULT 'scheduled' NOT NULL,
	"en_route_at" timestamp,
	"started_at" timestamp,
	"completed_at" timestamp,
	"completed_by" varchar,
	"proof_of_service_photo" text,
	"proof_of_service_photo_before" text,
	"gate_closed_photo" text,
	"extra_photos" jsonb,
	"technician_notes" text,
	"invoice_id" varchar,
	"service_reminder_sent_at" timestamp,
	"scheduled_time_start" time,
	"scheduled_time_end" time,
	"time_window_type" time_window_type DEFAULT 'anytime' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "visits_service_plan_id_scheduled_date_unique" UNIQUE("service_plan_id","scheduled_date")
);
--> statement-breakpoint
CREATE TABLE "voice_calls" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"contact_id" varchar,
	"retell_call_id" varchar(255),
	"caller_phone" varchar(30),
	"agent_phone" varchar(30),
	"duration_seconds" integer DEFAULT 0 NOT NULL,
	"duration_minutes" integer DEFAULT 0 NOT NULL,
	"outcome" varchar(50),
	"summary" text,
	"recording_url" text,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_deliveries" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"webhook_id" varchar NOT NULL,
	"event" varchar(100) NOT NULL,
	"payload" jsonb NOT NULL,
	"status" "webhook_delivery_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_attempt" timestamp,
	"next_retry" timestamp,
	"response_code" integer,
	"response_body" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhooks" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"url" varchar(500) NOT NULL,
	"events" jsonb NOT NULL,
	"secret" varchar(255) NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm_activities" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"type" text NOT NULL,
	"description" text NOT NULL,
	"contact_id" varchar,
	"deal_id" varchar,
	"crm_company_id" varchar,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "crm_audit_logs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"action" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" varchar,
	"changes" jsonb DEFAULT '{}'::jsonb,
	"details" jsonb DEFAULT '{}'::jsonb,
	"user_id" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "crm_automations" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"trigger_type" text,
	"trigger_conditions" jsonb DEFAULT '{}'::jsonb,
	"trigger" text NOT NULL,
	"conditions" jsonb DEFAULT '{}'::jsonb,
	"actions" jsonb DEFAULT '[]'::jsonb,
	"active" boolean DEFAULT true NOT NULL,
	"run_count" integer DEFAULT 0,
	"last_run_at" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "crm_campaign_recipients" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"campaign_id" varchar NOT NULL,
	"contact_id" varchar NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"opened_at" timestamp,
	"clicked_at" timestamp,
	"tracking_token" text
);
--> statement-breakpoint
CREATE TABLE "crm_companies" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"name" text NOT NULL,
	"domain" text,
	"industry" text,
	"size" text,
	"status" text DEFAULT 'active' NOT NULL,
	"custom_fields" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "crm_contacts" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"email" text,
	"phone" text,
	"company" text,
	"title" text,
	"status" text DEFAULT 'active' NOT NULL,
	"source" text DEFAULT 'manual',
	"lead_score" integer DEFAULT 0,
	"assigned_to" text,
	"tags" text[] DEFAULT '{}'::text[],
	"custom_fields" jsonb DEFAULT '{}'::jsonb,
	"main_contact_id" varchar,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "crm_deals" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"title" text NOT NULL,
	"value" integer DEFAULT 0,
	"currency" text DEFAULT 'USD' NOT NULL,
	"stage" text DEFAULT 'lead' NOT NULL,
	"probability" integer DEFAULT 0,
	"expected_close_date" timestamp,
	"description" text,
	"contact_id" varchar,
	"crm_company_id" varchar,
	"assigned_to" text,
	"status" text DEFAULT 'open' NOT NULL,
	"custom_fields" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "crm_documents" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"name" text NOT NULL,
	"type" text DEFAULT 'other' NOT NULL,
	"url" text NOT NULL,
	"mime_type" text,
	"size_bytes" integer,
	"size" integer DEFAULT 0,
	"contact_id" varchar,
	"deal_id" varchar,
	"crm_company_id" varchar,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "crm_email_campaigns" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"name" text NOT NULL,
	"type" text,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"body_html" text,
	"body_text" text,
	"from_email" text,
	"from_name" text,
	"segment_rules" jsonb DEFAULT '{}'::jsonb,
	"status" text DEFAULT 'draft' NOT NULL,
	"scheduled_at" timestamp,
	"sent_at" timestamp,
	"sent_count" integer DEFAULT 0,
	"open_count" integer DEFAULT 0,
	"click_count" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "crm_emails" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"from_address" text NOT NULL,
	"to_address" text NOT NULL,
	"direction" text DEFAULT 'outbound' NOT NULL,
	"status" text DEFAULT 'sent' NOT NULL,
	"contact_id" varchar,
	"deal_id" varchar,
	"thread_id" varchar,
	"sent_at" timestamp DEFAULT now(),
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "crm_form_submissions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"form_id" varchar NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ip_address" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "crm_lead_scoring_rules" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"name" text NOT NULL,
	"field" text NOT NULL,
	"operator" text NOT NULL,
	"value" text NOT NULL,
	"score" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "crm_notes" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"content" text NOT NULL,
	"body" text,
	"contact_id" varchar,
	"deal_id" varchar,
	"crm_company_id" varchar,
	"author_id" varchar,
	"pinned" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "crm_notifications" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"user_id" varchar,
	"type" text DEFAULT 'info' NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"entity_type" text,
	"entity_id" varchar,
	"read" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "crm_project_tasks" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"project_id" varchar NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"completed" boolean DEFAULT false,
	"step_number" integer,
	"status" text DEFAULT 'pending' NOT NULL,
	"assigned_to" text,
	"due_date" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "crm_projects" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'active' NOT NULL,
	"contact_id" varchar,
	"crm_company_id" varchar,
	"deal_id" varchar,
	"start_date" timestamp,
	"end_date" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "crm_quotes" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"title" text NOT NULL,
	"deal_id" varchar,
	"contact_id" varchar,
	"crm_company_id" varchar,
	"items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"subtotal" integer DEFAULT 0,
	"tax_rate" integer DEFAULT 0,
	"total" integer DEFAULT 0,
	"currency" text DEFAULT 'USD' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"valid_until" timestamp,
	"signature_token" varchar,
	"signed_at" timestamp,
	"signed_by_name" text,
	"signed_by_email" text,
	"signature_data" text,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "crm_quotes_signature_token_unique" UNIQUE("signature_token")
);
--> statement-breakpoint
CREATE TABLE "crm_sequence_enrollments" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sequence_id" varchar NOT NULL,
	"contact_id" varchar NOT NULL,
	"company_id" varchar NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"current_step" integer DEFAULT 0 NOT NULL,
	"next_run_at" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "crm_sequence_steps" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"sequence_id" varchar NOT NULL,
	"step_number" integer DEFAULT 1 NOT NULL,
	"type" text DEFAULT 'email' NOT NULL,
	"subject" text,
	"body" text,
	"delay_days" integer DEFAULT 0 NOT NULL,
	"delay_hours" integer DEFAULT 0,
	"email_subject" text,
	"email_body" text,
	"task_title" text,
	"task_type" text DEFAULT 'call',
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "crm_sequences" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"active" boolean DEFAULT true,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "crm_tasks" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"type" text DEFAULT 'todo' NOT NULL,
	"priority" text DEFAULT 'medium' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"due_date" timestamp,
	"assigned_to" text,
	"contact_id" varchar,
	"deal_id" varchar,
	"crm_company_id" varchar,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "crm_web_forms" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"name" text NOT NULL,
	"fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"submit_action" text DEFAULT 'create_contact',
	"redirect_url" text,
	"active" boolean DEFAULT true NOT NULL,
	"submission_count" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "crm_webhook_deliveries" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"webhook_id" varchar NOT NULL,
	"event" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb,
	"status" text DEFAULT 'pending' NOT NULL,
	"response_status" integer,
	"response_body" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "crm_webhooks" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"secret" text,
	"events" text[] DEFAULT '{}'::text[],
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "account_daily_metrics" ADD CONSTRAINT "account_daily_metrics_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_log" ADD CONSTRAINT "activity_log_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_log" ADD CONSTRAINT "activity_log_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_log" ADD CONSTRAINT "activity_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_audit_logs" ADD CONSTRAINT "admin_audit_logs_admin_user_id_admin_users_id_fk" FOREIGN KEY ("admin_user_id") REFERENCES "public"."admin_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_notes" ADD CONSTRAINT "admin_notes_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_sessions" ADD CONSTRAINT "admin_sessions_admin_user_id_admin_users_id_fk" FOREIGN KEY ("admin_user_id") REFERENCES "public"."admin_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agreements" ADD CONSTRAINT "agreements_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agreements" ADD CONSTRAINT "agreements_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agreements" ADD CONSTRAINT "agreements_estimate_id_estimates_id_fk" FOREIGN KEY ("estimate_id") REFERENCES "public"."estimates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_usage_daily" ADD CONSTRAINT "api_usage_daily_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_visit_id_visits_id_fk" FOREIGN KEY ("visit_id") REFERENCES "public"."visits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_trail" ADD CONSTRAINT "audit_trail_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_trail" ADD CONSTRAINT "audit_trail_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_event_logs" ADD CONSTRAINT "automation_event_logs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_event_logs" ADD CONSTRAINT "automation_event_logs_rule_id_automation_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."automation_rules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_rules" ADD CONSTRAINT "automation_rules_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_assessments" ADD CONSTRAINT "business_assessments_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_users" ADD CONSTRAINT "company_users_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_users" ADD CONSTRAINT "company_users_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competitor_pricing" ADD CONSTRAINT "competitor_pricing_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_tags" ADD CONSTRAINT "contact_tags_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_tags" ADD CONSTRAINT "contact_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_portal_user_id_users_id_fk" FOREIGN KEY ("portal_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_field_definitions" ADD CONSTRAINT "custom_field_definitions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "depots" ADD CONSTRAINT "depots_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_requests" ADD CONSTRAINT "document_requests_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_requests" ADD CONSTRAINT "document_requests_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_signatures" ADD CONSTRAINT "document_signatures_request_id_document_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."document_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_signatures" ADD CONSTRAINT "document_signatures_template_id_document_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."document_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_templates" ADD CONSTRAINT "document_templates_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "emails_sent" ADD CONSTRAINT "emails_sent_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "error_fix_tasks" ADD CONSTRAINT "error_fix_tasks_error_report_id_error_reports_id_fk" FOREIGN KEY ("error_report_id") REFERENCES "public"."error_reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "estimates" ADD CONSTRAINT "estimates_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "estimates" ADD CONSTRAINT "estimates_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "estimates" ADD CONSTRAINT "estimates_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fallback_log" ADD CONSTRAINT "fallback_log_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_import_run_id_import_runs_id_fk" FOREIGN KEY ("import_run_id") REFERENCES "public"."import_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_mappings" ADD CONSTRAINT "import_mappings_batch_id_import_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."import_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_batch_id_import_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."import_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_created_contact_id_contacts_id_fk" FOREIGN KEY ("created_contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_rule_suggestions" ADD CONSTRAINT "import_rule_suggestions_batch_id_import_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."import_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_rule_suggestions" ADD CONSTRAINT "import_rule_suggestions_row_id_import_rows_id_fk" FOREIGN KEY ("row_id") REFERENCES "public"."import_rows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_runs" ADD CONSTRAINT "import_runs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_emails" ADD CONSTRAINT "inbound_emails_tenant_id_companies_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_emails" ADD CONSTRAINT "inbound_emails_matched_contact_id_contacts_id_fk" FOREIGN KEY ("matched_contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_line_items" ADD CONSTRAINT "invoice_line_items_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_line_items" ADD CONSTRAINT "invoice_line_items_visit_id_visits_id_fk" FOREIGN KEY ("visit_id") REFERENCES "public"."visits"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_line_items" ADD CONSTRAINT "invoice_line_items_service_pricing_id_service_pricing_id_fk" FOREIGN KEY ("service_pricing_id") REFERENCES "public"."service_pricing"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_payments" ADD CONSTRAINT "invoice_payments_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_payments" ADD CONSTRAINT "invoice_payments_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_payments" ADD CONSTRAINT "invoice_payments_import_run_id_import_runs_id_fk" FOREIGN KEY ("import_run_id") REFERENCES "public"."import_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_add_ons" ADD CONSTRAINT "job_add_ons_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_add_ons" ADD CONSTRAINT "job_add_ons_service_pricing_id_service_pricing_id_fk" FOREIGN KEY ("service_pricing_id") REFERENCES "public"."service_pricing"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_agreement_id_agreements_id_fk" FOREIGN KEY ("agreement_id") REFERENCES "public"."agreements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_route_id_routes_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."routes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_assigned_user_id_users_id_fk" FOREIGN KEY ("assigned_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_response_config" ADD CONSTRAINT "lead_response_config_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_sources" ADD CONSTRAINT "lead_sources_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_attachments" ADD CONSTRAINT "message_attachments_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_attachments" ADD CONSTRAINT "message_attachments_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_exceptions" ADD CONSTRAINT "message_exceptions_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_exceptions" ADD CONSTRAINT "message_exceptions_resolved_company_id_companies_id_fk" FOREIGN KEY ("resolved_company_id") REFERENCES "public"."companies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_routing" ADD CONSTRAINT "message_routing_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_routing" ADD CONSTRAINT "message_routing_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_sent_by_users_id_fk" FOREIGN KEY ("sent_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "overhead_costs" ADD CONSTRAINT "overhead_costs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_sessions" ADD CONSTRAINT "portal_sessions_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_sessions" ADD CONSTRAINT "portal_sessions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_recommendations" ADD CONSTRAINT "price_recommendations_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_recommendations" ADD CONSTRAINT "price_recommendations_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_recommendations" ADD CONSTRAINT "price_recommendations_route_id_routes_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."routes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profitability_snapshots" ADD CONSTRAINT "profitability_snapshots_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profitability_snapshots" ADD CONSTRAINT "profitability_snapshots_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profitability_snapshots" ADD CONSTRAINT "profitability_snapshots_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "properties" ADD CONSTRAINT "properties_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "properties" ADD CONSTRAINT "properties_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qbo_sync_logs" ADD CONSTRAINT "qbo_sync_logs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_form_events" ADD CONSTRAINT "quote_form_events_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_converted_service_plan_id_service_plans_id_fk" FOREIGN KEY ("converted_service_plan_id") REFERENCES "public"."service_plans"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminder_logs" ADD CONSTRAINT "reminder_logs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminder_logs" ADD CONSTRAINT "reminder_logs_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminder_logs" ADD CONSTRAINT "reminder_logs_visit_id_visits_id_fk" FOREIGN KEY ("visit_id") REFERENCES "public"."visits"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminder_logs" ADD CONSTRAINT "reminder_logs_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retell_webhook_repairs" ADD CONSTRAINT "retell_webhook_repairs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_responses" ADD CONSTRAINT "review_responses_token_id_review_tokens_id_fk" FOREIGN KEY ("token_id") REFERENCES "public"."review_tokens"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_tokens" ADD CONSTRAINT "review_tokens_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_tokens" ADD CONSTRAINT "review_tokens_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routes" ADD CONSTRAINT "routes_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routes" ADD CONSTRAINT "routes_technician_id_users_id_fk" FOREIGN KEY ("technician_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routes" ADD CONSTRAINT "routes_depot_id_depots_id_fk" FOREIGN KEY ("depot_id") REFERENCES "public"."depots"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rover_tickets" ADD CONSTRAINT "rover_tickets_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rover_tickets" ADD CONSTRAINT "rover_tickets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_billing_rules" ADD CONSTRAINT "service_billing_rules_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_billing_rules" ADD CONSTRAINT "service_billing_rules_service_pricing_id_service_pricing_id_fk" FOREIGN KEY ("service_pricing_id") REFERENCES "public"."service_pricing"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_change_requests" ADD CONSTRAINT "service_change_requests_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_change_requests" ADD CONSTRAINT "service_change_requests_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_change_requests" ADD CONSTRAINT "service_change_requests_service_plan_id_service_plans_id_fk" FOREIGN KEY ("service_plan_id") REFERENCES "public"."service_plans"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_packages" ADD CONSTRAINT "service_packages_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_plan_add_ons" ADD CONSTRAINT "service_plan_add_ons_service_plan_id_service_plans_id_fk" FOREIGN KEY ("service_plan_id") REFERENCES "public"."service_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_plan_add_ons" ADD CONSTRAINT "service_plan_add_ons_service_pricing_id_service_pricing_id_fk" FOREIGN KEY ("service_pricing_id") REFERENCES "public"."service_pricing"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_plans" ADD CONSTRAINT "service_plans_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_plans" ADD CONSTRAINT "service_plans_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_plans" ADD CONSTRAINT "service_plans_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_plans" ADD CONSTRAINT "service_plans_route_id_routes_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."routes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_plans" ADD CONSTRAINT "service_plans_assigned_user_id_users_id_fk" FOREIGN KEY ("assigned_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_plans" ADD CONSTRAINT "service_plans_estimate_id_estimates_id_fk" FOREIGN KEY ("estimate_id") REFERENCES "public"."estimates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_pricing" ADD CONSTRAINT "service_pricing_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_zones" ADD CONSTRAINT "service_zones_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sms_messages" ADD CONSTRAINT "sms_messages_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sms_sessions" ADD CONSTRAINT "sms_sessions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "system_messages" ADD CONSTRAINT "system_messages_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tags" ADD CONSTRAINT "tags_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_visit_id_visits_id_fk" FOREIGN KEY ("visit_id") REFERENCES "public"."visits"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_route_id_routes_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."routes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vacation_holds" ADD CONSTRAINT "vacation_holds_service_plan_id_service_plans_id_fk" FOREIGN KEY ("service_plan_id") REFERENCES "public"."service_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vacation_holds" ADD CONSTRAINT "vacation_holds_agreement_id_agreements_id_fk" FOREIGN KEY ("agreement_id") REFERENCES "public"."agreements"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_service_plan_id_service_plans_id_fk" FOREIGN KEY ("service_plan_id") REFERENCES "public"."service_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_route_id_routes_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."routes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_completed_by_users_id_fk" FOREIGN KEY ("completed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_calls" ADD CONSTRAINT "voice_calls_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_calls" ADD CONSTRAINT "voice_calls_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_webhook_id_webhooks_id_fk" FOREIGN KEY ("webhook_id") REFERENCES "public"."webhooks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhooks" ADD CONSTRAINT "webhooks_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_adm_company" ON "account_daily_metrics" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "idx_adm_date" ON "account_daily_metrics" USING btree ("date");--> statement-breakpoint
CREATE INDEX "idx_al_company" ON "activity_log" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "idx_al_contact" ON "activity_log" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "idx_al_created" ON "activity_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_agreements_company" ON "agreements" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "idx_agreements_contact" ON "agreements" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "idx_agreements_active" ON "agreements" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "idx_apikeys_company" ON "api_keys" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "idx_apikeys_prefix" ON "api_keys" USING btree ("key_prefix");--> statement-breakpoint
CREATE INDEX "idx_api_usage_daily_date" ON "api_usage_daily" USING btree ("date");--> statement-breakpoint
CREATE INDEX "idx_api_usage_daily_provider" ON "api_usage_daily" USING btree ("provider");--> statement-breakpoint
CREATE INDEX "idx_api_usage_daily_company" ON "api_usage_daily" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "idx_audit_company" ON "audit_trail" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "idx_audit_entity" ON "audit_trail" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "idx_audit_created" ON "audit_trail" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_autocomplete_cache_cached_at" ON "autocomplete_cache" USING btree ("cached_at");--> statement-breakpoint
CREATE INDEX "idx_ar_company" ON "automation_rules" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "idx_ba_company" ON "business_assessments" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "idx_ba_created" ON "business_assessments" USING btree ("company_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_cu_company" ON "company_users" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "idx_cu_user" ON "company_users" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_comp_pricing_company" ON "competitor_pricing" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "idx_comp_pricing_zip" ON "competitor_pricing" USING btree ("company_id","zip_code");--> statement-breakpoint
CREATE INDEX "idx_contacts_company" ON "contacts" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "idx_contacts_status" ON "contacts" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_contacts_email" ON "contacts" USING btree ("email");--> statement-breakpoint
CREATE INDEX "idx_contacts_phone" ON "contacts" USING btree ("phone");--> statement-breakpoint
CREATE INDEX "idx_contacts_qbo_customer" ON "contacts" USING btree ("qbo_customer_id");--> statement-breakpoint
CREATE INDEX "idx_custom_field_defs_company" ON "custom_field_definitions" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "idx_depots_company" ON "depots" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "idx_depots_primary" ON "depots" USING btree ("company_id","is_primary");--> statement-breakpoint
CREATE INDEX "idx_doc_requests_company" ON "document_requests" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "idx_doc_requests_contact" ON "document_requests" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "idx_doc_requests_token" ON "document_requests" USING btree ("token");--> statement-breakpoint
CREATE INDEX "idx_doc_signatures_request" ON "document_signatures" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "idx_doc_signatures_template" ON "document_signatures" USING btree ("template_id");--> statement-breakpoint
CREATE INDEX "idx_doc_templates_company" ON "document_templates" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "idx_doc_templates_order" ON "document_templates" USING btree ("company_id","display_order");--> statement-breakpoint
CREATE INDEX "idx_evt_email" ON "email_verification_tokens" USING btree ("email");--> statement-breakpoint
CREATE INDEX "idx_emails_company" ON "emails_sent" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "idx_emails_created" ON "emails_sent" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_eft_report" ON "error_fix_tasks" USING btree ("error_report_id");--> statement-breakpoint
CREATE INDEX "idx_er_status" ON "error_reports" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_er_created" ON "error_reports" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_er_severity" ON "error_reports" USING btree ("severity");--> statement-breakpoint
CREATE INDEX "idx_estimates_company" ON "estimates" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "idx_estimates_contact" ON "estimates" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "idx_estimates_status" ON "estimates" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_fallback_log_company" ON "fallback_log" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "idx_fallback_log_created_at" ON "fallback_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_geocode_cache_cached_at" ON "geocode_cache" USING btree ("cached_at");--> statement-breakpoint
CREATE INDEX "idx_ib_company" ON "import_batches" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "idx_ib_status" ON "import_batches" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_ib_created" ON "import_batches" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_imap_batch" ON "import_mappings" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "idx_irow_batch" ON "import_rows" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "idx_irow_company" ON "import_rows" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "idx_irow_status" ON "import_rows" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_irs_batch" ON "import_rule_suggestions" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "idx_irs_row" ON "import_rule_suggestions" USING btree ("row_id");--> statement-breakpoint
CREATE INDEX "idx_ir_company" ON "import_runs" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "idx_ir_status" ON "import_runs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_ir_file_hash" ON "import_runs" USING btree ("file_hash");--> statement-breakpoint
CREATE INDEX "idx_ie_tenant" ON "inbound_emails" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_ie_status" ON "inbound_emails" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_ie_contact" ON "inbound_emails" USING btree ("matched_contact_id");--> statement-breakpoint
CREATE INDEX "idx_ie_created" ON "inbound_emails" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_ip_company" ON "invoice_payments" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "idx_ip_invoice" ON "invoice_payments" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "idx_ip_source" ON "invoice_payments" USING btree ("source");--> statement-breakpoint
CREATE INDEX "idx_invoices_company" ON "invoices" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "idx_invoices_contact" ON "invoices" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "idx_invoices_status" ON "invoices" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_invoices_source" ON "invoices" USING btree ("source");--> statement-breakpoint
CREATE INDEX "idx_invoices_qbo_invoice" ON "invoices" USING btree ("qbo_invoice_id");--> statement-breakpoint
CREATE INDEX "idx_invoices_pay_token" ON "invoices" USING btree ("pay_token");--> statement-breakpoint
CREATE INDEX "idx_jao_job" ON "job_add_ons" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "idx_jobs_company" ON "jobs" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "idx_jobs_agreement" ON "jobs" USING btree ("agreement_id");--> statement-breakpoint
CREATE INDEX "idx_jobs_property" ON "jobs" USING btree ("property_id");--> statement-breakpoint
CREATE INDEX "idx_jobs_route" ON "jobs" USING btree ("route_id");--> statement-breakpoint
CREATE INDEX "idx_jobs_status" ON "jobs" USING btree ("job_status");--> statement-breakpoint
CREATE INDEX "idx_ma_message" ON "message_attachments" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "idx_ma_company" ON "message_attachments" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "idx_me_created" ON "message_exceptions" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_me_resolved" ON "message_exceptions" USING btree ("resolved_at");--> statement-breakpoint
CREATE INDEX "idx_mr_shared_customer" ON "message_routing" USING btree ("shared_number","customer_phone");--> statement-breakpoint
CREATE INDEX "idx_mr_company" ON "message_routing" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "idx_messages_company" ON "messages" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "idx_messages_contact" ON "messages" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "idx_messages_channel" ON "messages" USING btree ("channel");--> statement-breakpoint
CREATE INDEX "idx_messages_email_thread" ON "messages" USING btree ("email_thread_id");--> statement-breakpoint
CREATE INDEX "idx_messages_from_address" ON "messages" USING btree ("from_address");--> statement-breakpoint
CREATE INDEX "idx_messages_to_address" ON "messages" USING btree ("to_address");--> statement-breakpoint
CREATE INDEX "idx_messages_external_id" ON "messages" USING btree ("external_id");--> statement-breakpoint
CREATE INDEX "idx_notif_company" ON "notifications" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "idx_notif_read" ON "notifications" USING btree ("company_id","is_read");--> statement-breakpoint
CREATE INDEX "idx_prt_user" ON "password_reset_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_ps_contact" ON "portal_sessions" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "idx_ps_token" ON "portal_sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "idx_pricerec_company_property" ON "price_recommendations" USING btree ("company_id","property_id");--> statement-breakpoint
CREATE INDEX "idx_pricerec_company_calcdate" ON "price_recommendations" USING btree ("company_id","calculated_at");--> statement-breakpoint
CREATE INDEX "idx_profsnap_company_contact" ON "profitability_snapshots" USING btree ("company_id","contact_id");--> statement-breakpoint
CREATE INDEX "idx_profsnap_company_date" ON "profitability_snapshots" USING btree ("company_id","snapshot_date");--> statement-breakpoint
CREATE INDEX "idx_profsnap_company_status" ON "profitability_snapshots" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "idx_properties_company" ON "properties" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "idx_properties_contact" ON "properties" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "idx_qbo_sync_company" ON "qbo_sync_logs" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "idx_qbo_sync_entity" ON "qbo_sync_logs" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "idx_qfe_company" ON "quote_form_events" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "idx_qfe_session" ON "quote_form_events" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "idx_qfe_event" ON "quote_form_events" USING btree ("company_id","event");--> statement-breakpoint
CREATE INDEX "idx_qfe_created" ON "quote_form_events" USING btree ("company_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_qfe_zip" ON "quote_form_events" USING btree ("company_id","zip_code");--> statement-breakpoint
CREATE INDEX "idx_quotes_company" ON "quotes" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "idx_quotes_contact" ON "quotes" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "idx_quotes_status" ON "quotes" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_rl_company" ON "reminder_logs" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "idx_rl_visit" ON "reminder_logs" USING btree ("visit_id");--> statement-breakpoint
CREATE INDEX "idx_rl_invoice" ON "reminder_logs" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "idx_rl_sent" ON "reminder_logs" USING btree ("sent_at");--> statement-breakpoint
CREATE INDEX "idx_retell_webhook_repairs_company" ON "retell_webhook_repairs" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "idx_retell_webhook_repairs_repaired_at" ON "retell_webhook_repairs" USING btree ("repaired_at");--> statement-breakpoint
CREATE INDEX "idx_rr_token" ON "review_responses" USING btree ("token_id");--> statement-breakpoint
CREATE INDEX "idx_rt_token" ON "review_tokens" USING btree ("token");--> statement-breakpoint
CREATE INDEX "idx_rt_company" ON "review_tokens" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "idx_rt_contact" ON "review_tokens" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "idx_routes_company" ON "routes" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "idx_routes_date" ON "routes" USING btree ("company_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_routes_company_date" ON "routes" USING btree ("company_id","date") WHERE date IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_routific_usage_log_company" ON "routific_usage_log" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "idx_routific_usage_log_created_at" ON "routific_usage_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_rover_company" ON "rover_tickets" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "idx_rover_type" ON "rover_tickets" USING btree ("type");--> statement-breakpoint
CREATE INDEX "idx_sbr_company" ON "service_billing_rules" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "idx_sbr_service" ON "service_billing_rules" USING btree ("service_pricing_id");--> statement-breakpoint
CREATE INDEX "idx_scr_company" ON "service_change_requests" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "idx_scr_contact" ON "service_change_requests" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "idx_scr_status" ON "service_change_requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_spkg_company" ON "service_packages" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "idx_spa_plan" ON "service_plan_add_ons" USING btree ("service_plan_id");--> statement-breakpoint
CREATE INDEX "idx_sp_company" ON "service_plans" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "idx_sp_property" ON "service_plans" USING btree ("property_id");--> statement-breakpoint
CREATE INDEX "idx_sp_job_status" ON "service_plans" USING btree ("job_status");--> statement-breakpoint
CREATE INDEX "idx_svcpricing_company" ON "service_pricing" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "idx_svcpricing_category" ON "service_pricing" USING btree ("category");--> statement-breakpoint
CREATE INDEX "idx_sz_company" ON "service_zones" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "idx_sz_zip" ON "service_zones" USING btree ("company_id","zip_code");--> statement-breakpoint
CREATE INDEX "IDX_session_expire" ON "sessions" USING btree ("expire");--> statement-breakpoint
CREATE INDEX "idx_sms_company" ON "sms_messages" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "idx_sms_created" ON "sms_messages" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_sms_sessions_updated_at" ON "sms_sessions" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "idx_sms_sessions_company" ON "sms_sessions" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "idx_stripe_events_processed" ON "stripe_events" USING btree ("processed_at");--> statement-breakpoint
CREATE INDEX "idx_sm_company" ON "system_messages" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "idx_sm_dismissed" ON "system_messages" USING btree ("company_id","dismissed_at");--> statement-breakpoint
CREATE INDEX "idx_te_company" ON "time_entries" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "idx_te_user" ON "time_entries" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_te_clockin" ON "time_entries" USING btree ("clock_in");--> statement-breakpoint
CREATE INDEX "idx_usage_company" ON "usage_events" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "idx_usage_type" ON "usage_events" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "idx_usage_recorded" ON "usage_events" USING btree ("recorded_at");--> statement-breakpoint
CREATE INDEX "idx_visits_company" ON "visits" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "idx_visits_date" ON "visits" USING btree ("scheduled_date");--> statement-breakpoint
CREATE INDEX "idx_visits_status" ON "visits" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_visits_route" ON "visits" USING btree ("route_id");--> statement-breakpoint
CREATE INDEX "idx_visits_job" ON "visits" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "idx_visits_invoice" ON "visits" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "idx_voice_calls_company" ON "voice_calls" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "idx_voice_calls_retell_id" ON "voice_calls" USING btree ("retell_call_id");--> statement-breakpoint
CREATE INDEX "idx_voice_calls_created" ON "voice_calls" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_wd_webhook" ON "webhook_deliveries" USING btree ("webhook_id");--> statement-breakpoint
CREATE INDEX "idx_wd_status" ON "webhook_deliveries" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_wd_next_retry" ON "webhook_deliveries" USING btree ("next_retry");