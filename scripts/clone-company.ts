/**
 * clone-company.ts
 *
 * Clones a source company and all its operational data into a new demo account.
 * Usage: npx tsx scripts/clone-company.ts
 *
 * Configured below for:
 *   Source: Lake Erie Scoopers (8089c512-bec6-47e1-9678-ec3e3eda4e95)
 *   Target: "Lake Erie Scoopers (Demo)"
 *   Owner:  jeremy@scoopilot.com / ZAfukr2121@!
 */

import { pool } from "../server/db";
import crypto from "crypto";

// ── Config ──────────────────────────────────────────────────────────────────
const SOURCE_COMPANY_ID = "8089c512-bec6-47e1-9678-ec3e3eda4e95";
const TARGET_COMPANY_NAME = "Lake Erie Scoopers (Demo)";
const NEW_USER_EMAIL = "jeremy@scoopilot.com";
const NEW_USER_PASSWORD = "ZAfukr2121@!";
const SCRYPT_KEYLEN = 64;

// ── Helpers ──────────────────────────────────────────────────────────────────

function newUuid(): string {
  return crypto.randomUUID();
}

async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16).toString("hex");
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, SCRYPT_KEYLEN, (err, key) => {
      if (err) return reject(err);
      resolve(`${salt}:${key.toString("hex")}`);
    });
  });
}

type IdMap = Map<string, string>;

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const client = await pool.connect();
  console.log("Connected to database.");

  try {
    await client.query("BEGIN");

    // ── 1. Fetch source company ──────────────────────────────────────────────
    const { rows: [srcCompany] } = await client.query(
      `SELECT * FROM companies WHERE id = $1`,
      [SOURCE_COMPANY_ID]
    );
    if (!srcCompany) throw new Error(`Source company ${SOURCE_COMPANY_ID} not found`);
    console.log(`Cloning company: ${srcCompany.name}`);

    // ── 2. Clone company row ─────────────────────────────────────────────────
    const newCompanyId = newUuid();
    const { rows: [newCompany] } = await client.query(
      `INSERT INTO companies (
        id, name, email, phone, address, start_address, start_latitude, start_longitude,
        logo_url,
        subscription_tier, subscription_status, charge_timing, invoice_theme,
        mrr_cents, route_credits, reminders_enabled, reminder_settings,
        invoice_reminder_settings, auto_visits_enabled, dashboard_layout,
        settings_layout, dashboard_notes, ai_import_mapping_enabled, rover_ai_enabled,
        pricing_config, quote_defaults, voice_agent_service_area, voice_agent_pricing_summary,
        voice_agent_policies, voice_agent_special_lines, voice_agent_greeting,
        slug, lead_webhook_sms_template, quote_auto_follow_up_enabled,
        quote_follow_up_sms_template, quote_follow_up_email_enabled,
        quote_follow_up_email_subject, quote_follow_up_email_body, quote_form_layout,
        timezone, billing_cadence, billing_trigger, default_payment_behavior,
        max_stops_per_route, message_retention_days, country, currency, tax_rate_percent,
        demo_unlimited_credits, demo_bypass_limits, demo_auto_complete_today,
        demo_auto_pay_invoices, demo_live_playback_enabled,
        review_request_enabled, review_router_enabled, google_review_url,
        review_request_after_visits, review_request_custom_message,
        client_notifications_suppressed, pass_stripe_fees,
        venmo_handle,
        -- cleared fields (third-party integrations)
        stripe_customer_id, stripe_subscription_id, stripe_connect_account_id,
        stripe_connect_onboarded, qbo_realm_id, qbo_access_token, qbo_refresh_token,
        qbo_token_expires_at, qbo_connected_at, qbo_income_account_ref, qbo_fee_account_ref,
        telnyx_api_key, telnyx_phone_number, telnyx_messaging_profile_id,
        retell_agent_id, retell_knowledge_base_id,
        dedicated_phone_number, stripe_voice_subscription_id, voice_plan_tier,
        voice_plan_status, voice_plan_included_minutes, voice_plan_overage_rate,
        created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8,
        $9,
        $10, $11, $12, $13,
        $14, $15, $16, $17,
        $18, $19, $20,
        $21, $22, $23, $24,
        $25, $26, $27, $28,
        $29, $30, $31,
        NULL, $32, $33,
        $34, $35,
        $36, $37, $38,
        $39, $40, $41, $42,
        $43, $44, $45, $46, $47,
        $48, $49, $50,
        $51, $52,
        $53, $54, $55,
        $56, $57, $58,
        $59, $60,
        $61,
        NULL, NULL, NULL,
        false, NULL, NULL, NULL,
        NULL, NULL, NULL, NULL,
        NULL, NULL, NULL,
        NULL, NULL,
        NULL, NULL, NULL,
        NULL, NULL, NULL,
        NOW(), NOW()
      ) RETURNING id, name`,
      [
        newCompanyId,                          // $1
        TARGET_COMPANY_NAME,                   // $2
        srcCompany.email,                      // $3
        srcCompany.phone,                      // $4
        srcCompany.address,                    // $5
        srcCompany.start_address,              // $6
        srcCompany.start_latitude,             // $7
        srcCompany.start_longitude,            // $8
        srcCompany.logo_url,                   // $9
        srcCompany.subscription_tier,          // $10
        srcCompany.subscription_status,        // $11
        srcCompany.charge_timing,              // $12
        srcCompany.invoice_theme,              // $13
        srcCompany.mrr_cents,                  // $14
        srcCompany.route_credits,              // $15
        srcCompany.reminders_enabled,          // $16
        srcCompany.reminder_settings,          // $17
        srcCompany.invoice_reminder_settings,  // $18
        srcCompany.auto_visits_enabled,        // $19
        srcCompany.dashboard_layout,           // $20
        srcCompany.settings_layout,            // $21
        srcCompany.dashboard_notes,            // $22
        srcCompany.ai_import_mapping_enabled,  // $23
        srcCompany.rover_ai_enabled,           // $24
        srcCompany.pricing_config,             // $25
        srcCompany.quote_defaults,             // $26
        srcCompany.voice_agent_service_area,   // $27
        srcCompany.voice_agent_pricing_summary,// $28
        srcCompany.voice_agent_policies,       // $29
        srcCompany.voice_agent_special_lines,  // $30
        srcCompany.voice_agent_greeting,       // $31
        srcCompany.lead_webhook_sms_template,  // $32
        srcCompany.quote_auto_follow_up_enabled, // $33
        srcCompany.quote_follow_up_sms_template, // $34
        srcCompany.quote_follow_up_email_enabled, // $35
        srcCompany.quote_follow_up_email_subject, // $36
        srcCompany.quote_follow_up_email_body,    // $37
        srcCompany.quote_form_layout,             // $38
        srcCompany.timezone,                   // $39
        srcCompany.billing_cadence,            // $40
        srcCompany.billing_trigger,            // $41
        srcCompany.default_payment_behavior,   // $42
        srcCompany.max_stops_per_route,        // $43
        srcCompany.message_retention_days,     // $44
        srcCompany.country,                    // $45
        srcCompany.currency,                   // $46
        srcCompany.tax_rate_percent,           // $47
        srcCompany.demo_unlimited_credits,     // $48
        srcCompany.demo_bypass_limits,         // $49
        srcCompany.demo_auto_complete_today,   // $50
        srcCompany.demo_auto_pay_invoices,     // $51
        srcCompany.demo_live_playback_enabled, // $52
        srcCompany.review_request_enabled,     // $53
        srcCompany.review_router_enabled,      // $54
        srcCompany.google_review_url,          // $55
        srcCompany.review_request_after_visits, // $56
        srcCompany.review_request_custom_message, // $57
        srcCompany.client_notifications_suppressed, // $58
        srcCompany.pass_stripe_fees,           // $59
        srcCompany.venmo_handle,               // $60
      ]
    );
    console.log(`✓ Created company: ${newCompany.name} (${newCompanyId})`);

    // ── 3. Create new user ───────────────────────────────────────────────────
    const existingUser = await client.query(
      `SELECT id FROM users WHERE email = $1`,
      [NEW_USER_EMAIL.toLowerCase()]
    );
    let newUserId: string;
    if (existingUser.rows.length > 0) {
      newUserId = existingUser.rows[0].id;
      const passwordHash = await hashPassword(NEW_USER_PASSWORD);
      await client.query(
        `UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2`,
        [passwordHash, newUserId]
      );
      console.log(`✓ Updated existing user: ${NEW_USER_EMAIL} (${newUserId})`);
    } else {
      const passwordHash = await hashPassword(NEW_USER_PASSWORD);
      newUserId = newUuid();
      await client.query(
        `INSERT INTO users (id, email, password_hash, first_name, last_name, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, NOW(), NOW())`,
        [newUserId, NEW_USER_EMAIL.toLowerCase(), passwordHash, "Jeremy", "Demo"]
      );
      console.log(`✓ Created user: ${NEW_USER_EMAIL} (${newUserId})`);
    }

    // ── 4. Link user to company as owner ────────────────────────────────────
    const existingLink = await client.query(
      `SELECT id FROM company_users WHERE company_id = $1 AND user_id = $2`,
      [newCompanyId, newUserId]
    );
    if (existingLink.rows.length === 0) {
      await client.query(
        `INSERT INTO company_users (id, company_id, user_id, role, is_active, created_at, updated_at)
         VALUES ($1, $2, $3, 'owner', true, NOW(), NOW())`,
        [newUuid(), newCompanyId, newUserId]
      );
    }
    console.log(`✓ Linked user to new company as owner`);

    // ── 5. Clone operational tables ──────────────────────────────────────────
    const counts: Record<string, number> = {};

    async function cloneSimpleTable(
      tableName: string,
      idField: string,
      extraFields: string[],
      extraCondition?: string
    ): Promise<IdMap> {
      const idMap: IdMap = new Map();
      const condition = extraCondition
        ? `company_id = $1 AND (${extraCondition})`
        : `company_id = $1`;
      const { rows } = await client.query(
        `SELECT * FROM ${tableName} WHERE ${condition}`,
        [SOURCE_COMPANY_ID]
      );

      for (const row of rows) {
        const oldId = row[idField];
        const newId = newUuid();
        idMap.set(oldId, newId);

        const allCols = Object.keys(row).filter(k => k !== idField);
        const setVals: any[] = [newId, newCompanyId];
        const setCols = [idField, "company_id"];

        for (const col of allCols) {
          if (col === "company_id") continue;
          setCols.push(col);
          setVals.push(row[col]);
        }

        const placeholders = setVals.map((_, i) => `$${i + 1}`).join(", ");
        await client.query(
          `INSERT INTO ${tableName} (${setCols.join(", ")}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`,
          setVals
        );
      }

      counts[tableName] = rows.length;
      console.log(`  ${tableName}: ${rows.length} rows`);
      return idMap;
    }

    // ─── Tier 1: No internal dependencies ───────────────────────────────────
    console.log("\n── Tier 1: Base tables ──");
    const tagMap = await cloneSimpleTable("tags", "id", []);
    const leadSourceMap = await cloneSimpleTable("lead_sources", "id", []);
    const servicePricingMap = await cloneSimpleTable("service_pricing", "id", []);
    const servicePackageMap = await cloneSimpleTable("service_packages", "id", []);
    const overheadCostMap = await cloneSimpleTable("overhead_costs", "id", []);
    const competitorPricingMap = await cloneSimpleTable("competitor_pricing", "id", []);
    const serviceZoneMap = await cloneSimpleTable("service_zones", "id", []);
    const automationRuleMap = await cloneSimpleTable("automation_rules", "id", []);

    // service_billing_rules: references service_pricing
    {
      const { rows } = await client.query(
        `SELECT * FROM service_billing_rules WHERE company_id = $1`,
        [SOURCE_COMPANY_ID]
      );
      for (const row of rows) {
        const newSvcId = servicePricingMap.get(row.service_pricing_id);
        if (!newSvcId) continue;
        await client.query(
          `INSERT INTO service_billing_rules (id, company_id, service_pricing_id, billing_cadence, billing_trigger, payment_behavior, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW()) ON CONFLICT DO NOTHING`,
          [newUuid(), newCompanyId, newSvcId, row.billing_cadence, row.billing_trigger, row.payment_behavior]
        );
      }
      counts["service_billing_rules"] = rows.length;
      console.log(`  service_billing_rules: ${rows.length} rows`);
    }

    // ─── Tier 2: contacts, routes ────────────────────────────────────────────
    console.log("\n── Tier 2: Contacts & Routes ──");

    // Contacts — clone with cleared portal/Stripe/QBO IDs
    const contactMap: IdMap = new Map();
    {
      const { rows } = await client.query(
        `SELECT * FROM contacts WHERE company_id = $1`,
        [SOURCE_COMPANY_ID]
      );
      for (const row of rows) {
        const newId = newUuid();
        contactMap.set(row.id, newId);
        await client.query(
          `INSERT INTO contacts (
            id, company_id, first_name, last_name, email, phone,
            street_address, address_2, city, state, zip_code,
            yard_size, number_of_dogs, service_frequency, lead_source,
            service_day, status, has_portal_access,
            invoice_timing, invoice_frequency, referral_source,
            auto_pay_enabled, auto_invoice_enabled, referral_code,
            reminder_preferences, notes, cost_overrides,
            billing_cadence_override, billing_trigger_override, payment_behavior_override,
            visits_since_last_review_request, review_request_sent_count,
            google_review_left, dismissed_opportunities,
            created_at, updated_at
          ) VALUES (
            $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,
            $19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,
            NOW(), NOW()
          ) ON CONFLICT DO NOTHING`,
          [
            newId, newCompanyId,
            row.first_name, row.last_name, row.email, row.phone,
            row.street_address, row.address_2, row.city, row.state, row.zip_code,
            row.yard_size, row.number_of_dogs, row.service_frequency, row.lead_source,
            row.service_day, row.status, row.has_portal_access,
            row.invoice_timing, row.invoice_frequency, row.referral_source,
            row.auto_pay_enabled, row.auto_invoice_enabled, row.referral_code,
            row.reminder_preferences, row.notes, row.cost_overrides,
            row.billing_cadence_override, row.billing_trigger_override, row.payment_behavior_override,
            row.visits_since_last_review_request, row.review_request_sent_count,
            row.google_review_left, row.dismissed_opportunities,
          ]
        );
      }
      counts["contacts"] = rows.length;
      console.log(`  contacts: ${rows.length} rows`);
    }

    // Routes — clone but clear technician_id (no user mapping for techs)
    const routeMap: IdMap = new Map();
    {
      const { rows } = await client.query(
        `SELECT * FROM routes WHERE company_id = $1`,
        [SOURCE_COMPANY_ID]
      );
      for (const row of rows) {
        const newId = newUuid();
        routeMap.set(row.id, newId);
        await client.query(
          `INSERT INTO routes (id, company_id, name, day_of_week, date, technician_id, color, is_locked, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, NULL, $6, $7, NOW(), NOW()) ON CONFLICT DO NOTHING`,
          [newId, newCompanyId, row.name, row.day_of_week, row.date, row.color, row.is_locked]
        );
      }
      counts["routes"] = rows.length;
      console.log(`  routes: ${rows.length} rows`);
    }

    // ─── Tier 3: properties, agreements, estimates, quotes ───────────────────
    console.log("\n── Tier 3: Properties, Agreements, Estimates, Quotes ──");

    const propertyMap: IdMap = new Map();
    {
      const { rows } = await client.query(
        `SELECT * FROM properties WHERE company_id = $1`,
        [SOURCE_COMPANY_ID]
      );
      for (const row of rows) {
        const newId = newUuid();
        propertyMap.set(row.id, newId);
        const newContactId = contactMap.get(row.contact_id);
        if (!newContactId) continue;
        await client.query(
          `INSERT INTO properties (
            id, company_id, contact_id, street_address, city, state, zip_code,
            number_of_dogs, yard_size, gate_code, special_instructions,
            latitude, longitude, lot_size, yard_polygon, measured_yard_sqft,
            yard_difficulty, has_dangerous_dog, dangerous_dog_notes,
            dog_names, dog_breeds, created_at, updated_at
          ) VALUES (
            $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,NOW(),NOW()
          ) ON CONFLICT DO NOTHING`,
          [
            newId, newCompanyId, newContactId,
            row.street_address, row.city, row.state, row.zip_code,
            row.number_of_dogs, row.yard_size, row.gate_code, row.special_instructions,
            row.latitude, row.longitude, row.lot_size, row.yard_polygon, row.measured_yard_sqft,
            row.yard_difficulty, row.has_dangerous_dog, row.dangerous_dog_notes,
            row.dog_names, row.dog_breeds,
          ]
        );
      }
      counts["properties"] = rows.length;
      console.log(`  properties: ${rows.length} rows`);
    }

    const estimateMap: IdMap = new Map();
    {
      const { rows } = await client.query(
        `SELECT * FROM estimates WHERE company_id = $1`,
        [SOURCE_COMPANY_ID]
      );
      for (const row of rows) {
        const newId = newUuid();
        estimateMap.set(row.id, newId);
        const newContactId = contactMap.get(row.contact_id);
        if (!newContactId) continue;
        const newPropertyId = row.property_id ? propertyMap.get(row.property_id) : null;
        await client.query(
          `INSERT INTO estimates (id, company_id, contact_id, property_id, description, items, total_cents, status, sent_at, responded_at, response_note, admin_note, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW()) ON CONFLICT DO NOTHING`,
          [newId, newCompanyId, newContactId, newPropertyId || null,
           row.description, row.items, row.total_cents, row.status,
           row.sent_at, row.responded_at, row.response_note, row.admin_note]
        );
      }
      counts["estimates"] = rows.length;
      console.log(`  estimates: ${rows.length} rows`);
    }

    const quoteMap: IdMap = new Map();
    {
      const { rows } = await client.query(
        `SELECT * FROM quotes WHERE company_id = $1`,
        [SOURCE_COMPANY_ID]
      );
      for (const row of rows) {
        const newId = newUuid();
        quoteMap.set(row.id, newId);
        const newContactId = row.contact_id ? contactMap.get(row.contact_id) : null;
        const newPropertyId = row.property_id ? propertyMap.get(row.property_id) : null;
        await client.query(
          `INSERT INTO quotes (
            id, company_id, contact_id, property_id, quote_number, type, status,
            contact_name, contact_email, contact_phone, property_address,
            dog_count, yard_size, station_count, common_area_minutes, time_per_station,
            mileage_distance, dump_fee, crew_size, site_sqft, frequency, is_first_time,
            essential_price, premium_price, deluxe_price, initial_clean_fee,
            selected_tier, selected_price, essential_features, premium_features, deluxe_features,
            pricing_breakdown, images, notes, internal_notes,
            expires_at, sent_at, accepted_at, declined_at, created_at, updated_at
          ) VALUES (
            $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
            $21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,$39,NOW(),NOW()
          ) ON CONFLICT DO NOTHING`,
          [
            newId, newCompanyId, newContactId || null, newPropertyId || null,
            row.quote_number, row.type, row.status,
            row.contact_name, row.contact_email, row.contact_phone, row.property_address,
            row.dog_count, row.yard_size, row.station_count, row.common_area_minutes, row.time_per_station,
            row.mileage_distance, row.dump_fee, row.crew_size, row.site_sqft, row.frequency, row.is_first_time,
            row.essential_price, row.premium_price, row.deluxe_price, row.initial_clean_fee,
            row.selected_tier, row.selected_price, row.essential_features, row.premium_features, row.deluxe_features,
            row.pricing_breakdown, row.images, row.notes, row.internal_notes,
            row.expires_at, row.sent_at, row.accepted_at, row.declined_at,
          ]
        );
      }
      counts["quotes"] = rows.length;
      console.log(`  quotes: ${rows.length} rows`);
    }

    const agreementMap: IdMap = new Map();
    {
      const { rows } = await client.query(
        `SELECT * FROM agreements WHERE company_id = $1`,
        [SOURCE_COMPANY_ID]
      );
      for (const row of rows) {
        const newId = newUuid();
        agreementMap.set(row.id, newId);
        const newContactId = contactMap.get(row.contact_id);
        if (!newContactId) continue;
        const newEstimateId = row.estimate_id ? estimateMap.get(row.estimate_id) : null;
        await client.query(
          `INSERT INTO agreements (
            id, company_id, contact_id, frequency, price_per_visit,
            is_active, paused_at, start_date, end_date,
            ends_after_count, ends_after_unit, estimate_id,
            created_at, updated_at
          ) VALUES (
            $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW(),NOW()
          ) ON CONFLICT DO NOTHING`,
          [
            newId, newCompanyId, newContactId,
            row.frequency, row.price_per_visit,
            row.is_active, row.paused_at, row.start_date, row.end_date,
            row.ends_after_count, row.ends_after_unit, newEstimateId || null,
          ]
        );
      }
      counts["agreements"] = rows.length;
      console.log(`  agreements: ${rows.length} rows`);
    }

    // ─── Tier 4: service_plans, jobs ────────────────────────────────────────
    console.log("\n── Tier 4: Service Plans & Jobs ──");

    const servicePlanMap: IdMap = new Map();
    {
      const { rows } = await client.query(
        `SELECT * FROM service_plans WHERE company_id = $1`,
        [SOURCE_COMPANY_ID]
      );
      for (const row of rows) {
        const newId = newUuid();
        servicePlanMap.set(row.id, newId);
        const newContactId = contactMap.get(row.contact_id);
        const newPropertyId = propertyMap.get(row.property_id);
        if (!newContactId || !newPropertyId) continue;
        const newRouteId = row.route_id ? (routeMap.get(row.route_id) || null) : null;
        const newEstimateId = row.estimate_id ? (estimateMap.get(row.estimate_id) || null) : null;
        await client.query(
          `INSERT INTO service_plans (
            id, company_id, contact_id, property_id,
            frequency, day_of_week, price_per_visit, discount, is_active, paused_at,
            start_date, end_date, route_id, stop_order, service_name, job_type,
            job_status, start_time, end_time, anytime,
            ends_after_count, ends_after_unit, visit_instructions,
            assigned_user_id, estimate_id, is_stop_only, created_at, updated_at
          ) VALUES (
            $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,NULL,$24,$25,NOW(),NOW()
          ) ON CONFLICT DO NOTHING`,
          [
            newId, newCompanyId, newContactId, newPropertyId,
            row.frequency, row.day_of_week, row.price_per_visit, row.discount, row.is_active, row.paused_at,
            row.start_date, row.end_date, newRouteId, row.stop_order, row.service_name, row.job_type,
            row.job_status, row.start_time, row.end_time, row.anytime,
            row.ends_after_count, row.ends_after_unit, row.visit_instructions,
            newEstimateId, row.is_stop_only,
          ]
        );
      }
      counts["service_plans"] = rows.length;
      console.log(`  service_plans: ${rows.length} rows`);
    }

    const jobMap: IdMap = new Map();
    {
      const { rows } = await client.query(
        `SELECT * FROM jobs WHERE company_id = $1`,
        [SOURCE_COMPANY_ID]
      );
      for (const row of rows) {
        const newId = newUuid();
        jobMap.set(row.id, newId);
        const newPropertyId = propertyMap.get(row.property_id);
        if (!newPropertyId) continue;
        const newAgreementId = agreementMap.get(row.agreement_id);
        if (!newAgreementId) continue;
        const newRouteId = row.route_id ? (routeMap.get(row.route_id) || null) : null;
        await client.query(
          `INSERT INTO jobs (
            id, company_id, agreement_id, property_id, route_id,
            stop_order, day_of_week, service_name, job_type, job_status,
            start_time, end_time, anytime, visit_instructions,
            assigned_user_id, is_stop_only, created_at, updated_at
          ) VALUES (
            $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NULL,$15,NOW(),NOW()
          ) ON CONFLICT DO NOTHING`,
          [
            newId, newCompanyId, newAgreementId, newPropertyId, newRouteId,
            row.stop_order, row.day_of_week, row.service_name, row.job_type, row.job_status,
            row.start_time, row.end_time, row.anytime, row.visit_instructions,
            row.is_stop_only,
          ]
        );
      }
      counts["jobs"] = rows.length;
      console.log(`  jobs: ${rows.length} rows`);
    }

    // ─── Tier 5: visits, invoices ────────────────────────────────────────────
    console.log("\n── Tier 5: Visits & Invoices ──");

    const visitMap: IdMap = new Map();
    {
      const { rows } = await client.query(
        `SELECT * FROM visits WHERE company_id = $1`,
        [SOURCE_COMPANY_ID]
      );
      for (const row of rows) {
        const newId = newUuid();
        visitMap.set(row.id, newId);
        const newServicePlanId = servicePlanMap.get(row.service_plan_id);
        const newPropertyId = propertyMap.get(row.property_id);
        if (!newServicePlanId || !newPropertyId) continue;
        const newJobId = row.job_id ? (jobMap.get(row.job_id) || null) : null;
        const newRouteId = row.route_id ? (routeMap.get(row.route_id) || null) : null;
        await client.query(
          `INSERT INTO visits (
            id, company_id, service_plan_id, job_id, property_id, route_id,
            scheduled_date, status, en_route_at, started_at, completed_at,
            completed_by, proof_of_service_photo, proof_of_service_photo_before,
            gate_closed_photo, extra_photos, technician_notes, invoice_id,
            service_reminder_sent_at, created_at, updated_at
          ) VALUES (
            $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NULL,$12,$13,$14,$15,$16,NULL,NULL,NOW(),NOW()
          ) ON CONFLICT DO NOTHING`,
          [
            newId, newCompanyId, newServicePlanId, newJobId, newPropertyId, newRouteId,
            row.scheduled_date, row.status, row.en_route_at, row.started_at, row.completed_at,
            row.proof_of_service_photo, row.proof_of_service_photo_before,
            row.gate_closed_photo, row.extra_photos, row.technician_notes,
          ]
        );
      }
      counts["visits"] = rows.length;
      console.log(`  visits: ${rows.length} rows`);
    }

    const invoiceMap: IdMap = new Map();
    {
      const { rows } = await client.query(
        `SELECT * FROM invoices WHERE company_id = $1`,
        [SOURCE_COMPANY_ID]
      );
      for (const row of rows) {
        const newId = newUuid();
        invoiceMap.set(row.id, newId);
        const newContactId = contactMap.get(row.contact_id);
        if (!newContactId) continue;
        await client.query(
          `INSERT INTO invoices (
            id, company_id, contact_id, invoice_number, due_date,
            subtotal, tax_rate, tax, discount_type, discount_value, discount_amount,
            total, tip_amount, status, auto_generated,
            paid_at, payment_attempts, source, issued_date, notes,
            exclude_from_reminders, reminder_count, created_at, updated_at
          ) VALUES (
            $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,NOW(),NOW()
          ) ON CONFLICT DO NOTHING`,
          [
            newId, newCompanyId, newContactId,
            row.invoice_number, row.due_date,
            row.subtotal, row.tax_rate, row.tax, row.discount_type, row.discount_value, row.discount_amount,
            row.total, row.tip_amount, row.status, row.auto_generated,
            row.paid_at, row.payment_attempts, row.source, row.issued_date, row.notes,
            row.exclude_from_reminders, row.reminder_count,
          ]
        );
      }
      counts["invoices"] = rows.length;
      console.log(`  invoices: ${rows.length} rows`);
    }

    // ─── Tier 6: line items, payments, add-ons, contact_tags ────────────────
    console.log("\n── Tier 6: Line Items, Payments, Add-ons, Tags ──");

    // invoice_line_items
    {
      const { rows } = await client.query(
        `SELECT ili.* FROM invoice_line_items ili
         JOIN invoices i ON i.id = ili.invoice_id
         WHERE i.company_id = $1`,
        [SOURCE_COMPANY_ID]
      );
      let count = 0;
      for (const row of rows) {
        const newInvoiceId = invoiceMap.get(row.invoice_id);
        if (!newInvoiceId) continue;
        const newVisitId = row.visit_id ? (visitMap.get(row.visit_id) || null) : null;
        const newSvcPricingId = row.service_pricing_id ? (servicePricingMap.get(row.service_pricing_id) || null) : null;
        await client.query(
          `INSERT INTO invoice_line_items (id, invoice_id, visit_id, service_pricing_id, description, quantity, unit_price, total, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW()) ON CONFLICT DO NOTHING`,
          [newUuid(), newInvoiceId, newVisitId, newSvcPricingId,
           row.description, row.quantity, row.unit_price, row.total]
        );
        count++;
      }
      counts["invoice_line_items"] = count;
      console.log(`  invoice_line_items: ${count} rows`);
    }

    // invoice_payments
    {
      const { rows } = await client.query(
        `SELECT ip.* FROM invoice_payments ip
         WHERE ip.company_id = $1`,
        [SOURCE_COMPANY_ID]
      );
      let count = 0;
      for (const row of rows) {
        const newInvoiceId = invoiceMap.get(row.invoice_id);
        if (!newInvoiceId) continue;
        await client.query(
          `INSERT INTO invoice_payments (id, company_id, invoice_id, amount_cents, paid_at, method, reference, source, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW()) ON CONFLICT DO NOTHING`,
          [newUuid(), newCompanyId, newInvoiceId, row.amount_cents, row.paid_at,
           row.method, row.reference, row.source]
        );
        count++;
      }
      counts["invoice_payments"] = count;
      console.log(`  invoice_payments: ${count} rows`);
    }

    // job_add_ons
    {
      const { rows } = await client.query(
        `SELECT jao.* FROM job_add_ons jao
         JOIN jobs j ON j.id = jao.job_id
         WHERE j.company_id = $1`,
        [SOURCE_COMPANY_ID]
      );
      let count = 0;
      for (const row of rows) {
        const newJobId = jobMap.get(row.job_id);
        const newSvcPricingId = servicePricingMap.get(row.service_pricing_id);
        if (!newJobId || !newSvcPricingId) continue;
        await client.query(
          `INSERT INTO job_add_ons (id, job_id, service_pricing_id, name, price, is_active, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,NOW()) ON CONFLICT DO NOTHING`,
          [newUuid(), newJobId, newSvcPricingId, row.name, row.price, row.is_active]
        );
        count++;
      }
      counts["job_add_ons"] = count;
      console.log(`  job_add_ons: ${count} rows`);
    }

    // service_plan_add_ons
    {
      const { rows } = await client.query(
        `SELECT spa.* FROM service_plan_add_ons spa
         JOIN service_plans sp ON sp.id = spa.service_plan_id
         WHERE sp.company_id = $1`,
        [SOURCE_COMPANY_ID]
      );
      let count = 0;
      for (const row of rows) {
        const newPlanId = servicePlanMap.get(row.service_plan_id);
        const newSvcPricingId = servicePricingMap.get(row.service_pricing_id);
        if (!newPlanId || !newSvcPricingId) continue;
        await client.query(
          `INSERT INTO service_plan_add_ons (id, service_plan_id, service_pricing_id, name, price, is_active, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,NOW()) ON CONFLICT DO NOTHING`,
          [newUuid(), newPlanId, newSvcPricingId, row.name, row.price, row.is_active]
        );
        count++;
      }
      counts["service_plan_add_ons"] = count;
      console.log(`  service_plan_add_ons: ${count} rows`);
    }

    // contact_tags
    {
      const { rows } = await client.query(
        `SELECT ct.* FROM contact_tags ct
         JOIN contacts c ON c.id = ct.contact_id
         WHERE c.company_id = $1`,
        [SOURCE_COMPANY_ID]
      );
      let count = 0;
      for (const row of rows) {
        const newContactId = contactMap.get(row.contact_id);
        const newTagId = tagMap.get(row.tag_id);
        if (!newContactId || !newTagId) continue;
        await client.query(
          `INSERT INTO contact_tags (id, contact_id, tag_id)
           VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
          [newUuid(), newContactId, newTagId]
        );
        count++;
      }
      counts["contact_tags"] = count;
      console.log(`  contact_tags: ${count} rows`);
    }

    // vacation_holds
    {
      const { rows } = await client.query(
        `SELECT vh.* FROM vacation_holds vh
         JOIN service_plans sp ON sp.id = vh.service_plan_id
         WHERE sp.company_id = $1`,
        [SOURCE_COMPANY_ID]
      );
      let count = 0;
      for (const row of rows) {
        const newPlanId = servicePlanMap.get(row.service_plan_id);
        if (!newPlanId) continue;
        const newAgreementId = row.agreement_id ? (agreementMap.get(row.agreement_id) || null) : null;
        await client.query(
          `INSERT INTO vacation_holds (id, service_plan_id, agreement_id, start_date, end_date, reason, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,NOW()) ON CONFLICT DO NOTHING`,
          [newUuid(), newPlanId, newAgreementId, row.start_date, row.end_date, row.reason]
        );
        count++;
      }
      counts["vacation_holds"] = count;
      console.log(`  vacation_holds: ${count} rows`);
    }

    await client.query("COMMIT");

    // ── Summary ───────────────────────────────────────────────────────────────
    console.log("\n══════════════════════════════════════");
    console.log("Clone complete!");
    console.log(`New Company ID: ${newCompanyId}`);
    console.log(`New User ID:    ${newUserId}`);
    console.log("\nRow counts per table:");
    for (const [table, count] of Object.entries(counts)) {
      console.log(`  ${table.padEnd(30)} ${count}`);
    }

  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Clone failed, transaction rolled back:", err);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
