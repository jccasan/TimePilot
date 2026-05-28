CREATE TYPE "public"."pay_period_type" AS ENUM('weekly', 'bi-weekly', 'semi-monthly', 'monthly');--> statement-breakpoint
CREATE TYPE "public"."timecard_status" AS ENUM('draft', 'submitted', 'approved', 'rejected');--> statement-breakpoint
CREATE TABLE "time_entry_breaks" (
"id" varchar(255) PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
"company_id" varchar(255) NOT NULL,
"time_entry_id" varchar(255) NOT NULL,
"break_start" timestamp NOT NULL,
"break_end" timestamp,
"duration_minutes" integer,
"notes" text,
"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "timecard_periods" (
"id" varchar(255) PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
"company_id" varchar(255) NOT NULL,
"user_id" varchar(255) NOT NULL,
"period_start" date NOT NULL,
"period_end" date NOT NULL,
"status" timecard_status DEFAULT 'draft' NOT NULL,
"submitted_at" timestamp,
"approved_by" varchar(255),
"approved_at" timestamp,
"rejected_by" varchar(255),
"rejected_at" timestamp,
"rejection_notes" text,
"total_regular_minutes" integer,
"total_overtime_minutes" integer,
"total_break_minutes" integer,
"created_at" timestamp DEFAULT now() NOT NULL,
"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "timecard_settings" (
"id" varchar(255) PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
"company_id" varchar(255) NOT NULL,
"pay_period_type" "pay_period_type" DEFAULT 'bi-weekly' NOT NULL,
"pay_period_anchor_date" date NOT NULL,
"overtime_weekly_hours" numeric(4, 1) DEFAULT '40.0' NOT NULL,
"overtime_daily_hours" numeric(4, 1),
"export_templates" jsonb DEFAULT '[]'::jsonb NOT NULL,
"created_at" timestamp DEFAULT now() NOT NULL,
"updated_at" timestamp DEFAULT now() NOT NULL,
CONSTRAINT "timecard_settings_company_id_unique" UNIQUE("company_id")
);
--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "timecard_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "timecard_trial_ends_at" timestamp;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "stripe_timecard_subscription_id" varchar(255);--> statement-breakpoint
ALTER TABLE "time_entries" ADD COLUMN "period_id" varchar(255);--> statement-breakpoint
ALTER TABLE "time_entries" ADD COLUMN "edited_by" varchar(255);--> statement-breakpoint
ALTER TABLE "time_entries" ADD COLUMN "edited_at" timestamp;--> statement-breakpoint
ALTER TABLE "time_entry_breaks" ADD CONSTRAINT "time_entry_breaks_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entry_breaks" ADD CONSTRAINT "time_entry_breaks_time_entry_id_time_entries_id_fk" FOREIGN KEY ("time_entry_id") REFERENCES "public"."time_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timecard_periods" ADD CONSTRAINT "timecard_periods_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timecard_periods" ADD CONSTRAINT "timecard_periods_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timecard_periods" ADD CONSTRAINT "timecard_periods_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timecard_periods" ADD CONSTRAINT "timecard_periods_rejected_by_users_id_fk" FOREIGN KEY ("rejected_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timecard_settings" ADD CONSTRAINT "timecard_settings_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "time_entry_breaks_company_entry_idx" ON "time_entry_breaks" USING btree ("company_id","time_entry_id");--> statement-breakpoint
CREATE INDEX "timecard_periods_company_user_idx" ON "timecard_periods" USING btree ("company_id","user_id");--> statement-breakpoint
CREATE INDEX "timecard_periods_company_status_idx" ON "timecard_periods" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "timecard_periods_company_period_idx" ON "timecard_periods" USING btree ("company_id","period_start","period_end");--> statement-breakpoint
CREATE UNIQUE INDEX "timecard_periods_unique_company_user_period" ON "timecard_periods" USING btree ("company_id","user_id","period_start");--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_edited_by_users_id_fk" FOREIGN KEY ("edited_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
