-- CRM Six-Fix Bundle (#1142): pipeline stages, call logging, task reminders
-- Minimal CRM-only DDL — all statements use IF NOT EXISTS guards.

CREATE TABLE IF NOT EXISTS "crm_pipeline_stages" (
    "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "company_id" varchar NOT NULL,
    "name" text NOT NULL,
    "slug" text NOT NULL,
    "color" text DEFAULT '#6b7280' NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    "is_won" boolean DEFAULT false NOT NULL,
    "is_lost" boolean DEFAULT false NOT NULL,
    "created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "crm_activities" ADD COLUMN IF NOT EXISTS "call_direction" text;
--> statement-breakpoint
ALTER TABLE "crm_activities" ADD COLUMN IF NOT EXISTS "call_outcome" text;
--> statement-breakpoint
ALTER TABLE "crm_activities" ADD COLUMN IF NOT EXISTS "call_duration_minutes" integer;
--> statement-breakpoint
ALTER TABLE "crm_activities" ADD COLUMN IF NOT EXISTS "next_action_date" timestamp;
--> statement-breakpoint
ALTER TABLE "crm_tasks" ADD COLUMN IF NOT EXISTS "last_reminder_sent_at" timestamp;
--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "crm_grandfathered" boolean DEFAULT false NOT NULL;
