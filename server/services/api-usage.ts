import { sql } from "drizzle-orm";
import { db } from "../db";

export type ApiProvider = "mapbox" | "mapbox_searchbox" | "openai" | "claude" | "routific";
export type ApiMetric =
  | "geocode"
  | "autocomplete"
  | "directions"
  | "matrix"
  | "rover_chat"
  | "optimize";

const DAILY_THRESHOLD = parseInt(process.env.GEOCODE_DAILY_THRESHOLD || "1000", 10);

/** The date from which per-tenant Mapbox/OpenAI attribution is tracked in api_usage_daily. */
export const API_ATTRIBUTION_START_DATE = process.env.API_ATTRIBUTION_START_DATE || "2026-05-07";

let thresholdNotifiedForDay = "";

export function trackApiCall(
  provider: ApiProvider,
  metric: ApiMetric,
  count = 1,
  companyId?: string | null
): void {
  const upsertPromise = companyId
    ? db.execute(
        sql`
        INSERT INTO api_usage_daily (id, date, provider, metric, company_id, calls)
        VALUES (gen_random_uuid(), CURRENT_DATE, ${provider}, ${metric}, ${companyId}, ${count})
        ON CONFLICT (date, provider, metric, company_id) WHERE company_id IS NOT NULL
        DO UPDATE SET calls = api_usage_daily.calls + ${count}
      `
      )
    : db.execute(
        sql`
        INSERT INTO api_usage_daily (id, date, provider, metric, calls)
        VALUES (gen_random_uuid(), CURRENT_DATE, ${provider}, ${metric}, ${count})
        ON CONFLICT (date, provider, metric) WHERE company_id IS NULL
        DO UPDATE SET calls = api_usage_daily.calls + ${count}
      `
      );

  upsertPromise
    .then(() => {
      if (provider === "mapbox" && (metric === "geocode" || metric === "autocomplete")) {
        checkDailyThreshold().catch(() => {});
      }
    })
    .catch(() => {});
}

async function checkDailyThreshold(): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  if (thresholdNotifiedForDay === today) return;

  const result = await db.execute(sql`
    SELECT COALESCE(SUM(calls), 0) AS total
    FROM api_usage_daily
    WHERE date = CURRENT_DATE AND provider = 'mapbox'
      AND metric IN ('geocode', 'autocomplete')
  `);
  const row = result.rows[0];
  const total = Number(row?.total ?? 0);

  if (total >= DAILY_THRESHOLD) {
    thresholdNotifiedForDay = today;
    console.warn(
      `[geocode-budget] Daily geocode API calls reached ${total} ` +
        `(threshold: ${DAILY_THRESHOLD}). Check for unexpected spikes.`
    );
  }
}

export interface ApiUsageStats {
  today: number;
  thisWeek: number;
  dailyThreshold: number;
  isOverThreshold: boolean;
  breakdown: { metric: string; today: number; thisWeek: number }[];
}

export async function getApiUsageStats(): Promise<ApiUsageStats> {
  const result = await db.execute(sql`
    SELECT
      metric,
      SUM(CASE WHEN date = CURRENT_DATE THEN calls ELSE 0 END) AS today,
      SUM(CASE WHEN date >= DATE_TRUNC('week', CURRENT_DATE) THEN calls ELSE 0 END) AS this_week
    FROM api_usage_daily
    WHERE provider = 'mapbox'
      AND metric IN ('geocode', 'autocomplete')
      AND date >= DATE_TRUNC('week', CURRENT_DATE)
    GROUP BY metric
  `);

  const breakdown = result.rows.map((r) => ({
    metric: String(r.metric),
    today: Number(r.today ?? 0),
    thisWeek: Number(r.this_week ?? 0),
  }));

  const todayTotal = breakdown.reduce((s, r) => s + r.today, 0);
  const weekTotal = breakdown.reduce((s, r) => s + r.thisWeek, 0);

  return {
    today: todayTotal,
    thisWeek: weekTotal,
    dailyThreshold: DAILY_THRESHOLD,
    isOverThreshold: todayTotal >= DAILY_THRESHOLD,
    breakdown,
  };
}

const MAPBOX_COST_PER_CALL: Record<string, number> = {
  geocode: 0.005,
  autocomplete: 0.005,
  directions: 0.001,
  matrix: 0.002,
};
const OPENAI_ROVER_CHAT_COST_PER_CALL = 0.0001;
const TELNYX_COST_PER_SEGMENT = 0.005;
const ROUTIFIC_COST_PER_CALL = 0.25;

/** Raw per-provider/per-metric daily rows for the last 30 days, plus Telnyx SMS segment rows. */
export interface RawApiUsageStats {
  dailyRows: { provider: string; metric: string; date: string; calls: number }[];
  telnyxRows: { date: string; segments: number }[];
}

export async function getAllApiUsageStats(): Promise<RawApiUsageStats> {
  const [dailyResult, telnyxResult] = await Promise.all([
    db.execute(sql`
      SELECT provider, metric, date::text AS date, calls
      FROM api_usage_daily
      WHERE date >= CURRENT_DATE - INTERVAL '30 days'
      ORDER BY provider, metric, date
    `),
    db.execute(sql`
      SELECT
        DATE(created_at)::text AS date,
        COALESCE(SUM(segments), 0)::int AS segments
      FROM sms_messages
      WHERE direction = 'outbound'
        AND created_at >= CURRENT_DATE - INTERVAL '30 days'
      GROUP BY DATE(created_at)
      ORDER BY date
    `),
  ]);

  return {
    dailyRows: dailyResult.rows as {
      provider: string;
      metric: string;
      date: string;
      calls: number;
    }[],
    telnyxRows: telnyxResult.rows as { date: string; segments: number }[],
  };
}

export interface ProviderCostSummary {
  today: number;
  thisMonth: number;
  estimatedMonthlyCostUsd: number;
  dailyTrend: { date: string; calls: number }[];
  breakdown?: { metric: string; today: number; thisMonth: number; costPerCall: number }[];
}

export interface AllApiCosts {
  mapbox: ProviderCostSummary;
  openai: ProviderCostSummary;
  telnyx: ProviderCostSummary;
  routific: ProviderCostSummary;
}

export interface RoutificTenantStat {
  companyId: number | null;
  companyName: string;
  totalCalls: number;
  successCalls: number;
  fallbackCalls: number;
  avgStopCount: number;
  lastCallAt: string | null;
}

function buildTrend(byDate: Record<string, number>): { date: string; calls: number }[] {
  const trend: { date: string; calls: number }[] = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const ds = d.toISOString().slice(0, 10);
    trend.push({ date: ds, calls: byDate[ds] || 0 });
  }
  return trend;
}

function buildMonthTrend(
  byDate: Record<string, number>,
  monthStartStr: string
): { date: string; calls: number }[] {
  const trend: { date: string; calls: number }[] = [];
  const todayStr = new Date().toISOString().slice(0, 10);
  const start = new Date(monthStartStr + "T00:00:00Z");
  const end = new Date(todayStr + "T00:00:00Z");
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const ds = d.toISOString().slice(0, 10);
    trend.push({ date: ds, calls: byDate[ds] || 0 });
  }
  return trend;
}

export async function getAllApiCosts(): Promise<AllApiCosts> {
  const todayStr = new Date().toISOString().slice(0, 10);
  const now = new Date();
  const monthStartStr = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);

  const [{ dailyRows, telnyxRows }, routificResult] = await Promise.all([
    getAllApiUsageStats(),
    db.execute(sql`
      SELECT
        DATE(created_at)::text AS date,
        COUNT(*)::int AS calls
      FROM routific_usage_log
      WHERE created_at >= CURRENT_DATE - INTERVAL '30 days'
      GROUP BY DATE(created_at)
      ORDER BY date
    `),
  ]);

  const mapboxByDate: Record<string, number> = {};
  // Pre-seed all four required Mapbox metric types with zero defaults
  const mapboxBreakdown: Record<string, { today: number; thisMonth: number }> = {
    geocode: { today: 0, thisMonth: 0 },
    autocomplete: { today: 0, thisMonth: 0 },
    directions: { today: 0, thisMonth: 0 },
    matrix: { today: 0, thisMonth: 0 },
  };

  for (const row of dailyRows.filter(
    (r) => r.provider === "mapbox" || r.provider === "mapbox_searchbox"
  )) {
    const calls = Number(row.calls);
    mapboxByDate[row.date] = (mapboxByDate[row.date] || 0) + calls;
    if (!mapboxBreakdown[row.metric]) mapboxBreakdown[row.metric] = { today: 0, thisMonth: 0 };
    if (row.date === todayStr) mapboxBreakdown[row.metric].today += calls;
    if (row.date >= monthStartStr) mapboxBreakdown[row.metric].thisMonth += calls;
  }

  const mapboxTodayTotal = Object.values(mapboxBreakdown).reduce((s, b) => s + b.today, 0);
  const mapboxMonthTotal = Object.values(mapboxBreakdown).reduce((s, b) => s + b.thisMonth, 0);
  const mapboxCost = Object.entries(mapboxBreakdown).reduce(
    (cost, [metric, counts]) => cost + counts.thisMonth * (MAPBOX_COST_PER_CALL[metric] ?? 0.005),
    0
  );
  const mapboxBreakdownArr = Object.entries(mapboxBreakdown).map(([metric, counts]) => ({
    metric,
    today: counts.today,
    thisMonth: counts.thisMonth,
    costPerCall: MAPBOX_COST_PER_CALL[metric] ?? 0.005,
  }));

  const openaiByDate: Record<string, number> = {};
  let openaiToday = 0;
  let openaiMonth = 0;

  for (const row of dailyRows.filter(
    (r) => (r.provider === "openai" || r.provider === "claude") && r.metric === "rover_chat"
  )) {
    const calls = Number(row.calls);
    openaiByDate[row.date] = (openaiByDate[row.date] || 0) + calls;
    if (row.date === todayStr) openaiToday += calls;
    if (row.date >= monthStartStr) openaiMonth += calls;
  }

  const telnyxByDate: Record<string, number> = {};
  let telnyxToday = 0;
  let telnyxMonth = 0;

  for (const row of telnyxRows) {
    const segs = Number(row.segments);
    telnyxByDate[row.date] = segs;
    if (row.date === todayStr) telnyxToday = segs;
    if (row.date >= monthStartStr) telnyxMonth += segs;
  }

  const routificByDate: Record<string, number> = {};
  let routificToday = 0;
  let routificMonth = 0;

  for (const row of routificResult.rows as { date: string; calls: number }[]) {
    const calls = Number(row.calls);
    routificByDate[row.date] = calls;
    if (row.date === todayStr) routificToday = calls;
    if (row.date >= monthStartStr) routificMonth += calls;
  }

  return {
    mapbox: {
      today: mapboxTodayTotal,
      thisMonth: mapboxMonthTotal,
      estimatedMonthlyCostUsd: mapboxCost,
      dailyTrend: buildTrend(mapboxByDate),
      breakdown: mapboxBreakdownArr,
    },
    openai: {
      today: openaiToday,
      thisMonth: openaiMonth,
      estimatedMonthlyCostUsd: openaiMonth * OPENAI_ROVER_CHAT_COST_PER_CALL,
      dailyTrend: buildTrend(openaiByDate),
    },
    telnyx: {
      today: telnyxToday,
      thisMonth: telnyxMonth,
      estimatedMonthlyCostUsd: telnyxMonth * TELNYX_COST_PER_SEGMENT,
      dailyTrend: buildTrend(telnyxByDate),
    },
    routific: {
      today: routificToday,
      thisMonth: routificMonth,
      estimatedMonthlyCostUsd: routificMonth * ROUTIFIC_COST_PER_CALL,
      dailyTrend: buildTrend(routificByDate),
    },
  };
}

/** Log a single Routific optimization call for usage tracking. */
export function trackRoutificCall(
  companyId: number | null,
  stopCount: number,
  success: boolean
): void {
  trackApiCall("routific", "optimize");
  db.execute(
    sql`
    INSERT INTO routific_usage_log (id, company_id, stop_count, success)
    VALUES (gen_random_uuid(), ${companyId}, ${stopCount}, ${success})
  `
  ).catch(() => {});
}

/** Per-tenant Routific usage stats for the last 30 days. */
export async function getRoutificTenantStats(): Promise<RoutificTenantStat[]> {
  const result = await db.execute(sql`
    SELECT
      r.company_id,
      COALESCE(c.name, 'Unknown') AS company_name,
      COUNT(*)::int AS total_calls,
      SUM(CASE WHEN r.success THEN 1 ELSE 0 END)::int AS success_calls,
      SUM(CASE WHEN NOT r.success THEN 1 ELSE 0 END)::int AS fallback_calls,
      ROUND(AVG(r.stop_count))::int AS avg_stop_count,
      MAX(r.created_at)::text AS last_call_at
    FROM routific_usage_log r
    LEFT JOIN companies c ON c.id = r.company_id
    WHERE r.created_at >= CURRENT_DATE - INTERVAL '30 days'
    GROUP BY r.company_id, c.name
    ORDER BY total_calls DESC
    LIMIT 50
  `);

  return (
    result.rows as {
      company_id: number | null;
      company_name: string;
      total_calls: number;
      success_calls: number;
      fallback_calls: number;
      avg_stop_count: number;
      last_call_at: string | null;
    }[]
  ).map((row) => ({
    companyId: row.company_id,
    companyName: row.company_name,
    totalCalls: Number(row.total_calls),
    successCalls: Number(row.success_calls),
    fallbackCalls: Number(row.fallback_calls),
    avgStopCount: Number(row.avg_stop_count),
    lastCallAt: row.last_call_at,
  }));
}

export interface TenantUsageRow {
  companyId: string | null;
  companyName: string;
  totalCalls: number;
  estimatedCostUsd: number;
  firstActivity: string | null;
  lastActivity: string | null;
  dailyTrend: { date: string; calls: number }[];
}

export async function getProviderBreakdown(provider: string): Promise<TenantUsageRow[]> {
  const now = new Date();
  const monthStartStr = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);

  if (provider === "telnyx") {
    const result = await db.execute(sql`
      SELECT
        sm.company_id,
        COALESCE(c.name, 'Unknown') AS company_name,
        COALESCE(SUM(sm.segments), 0)::int AS total_calls,
        MIN(DATE(sm.created_at))::text AS first_activity,
        MAX(DATE(sm.created_at))::text AS last_activity
      FROM sms_messages sm
      LEFT JOIN companies c ON c.id = sm.company_id
      WHERE sm.direction = 'outbound'
        AND sm.created_at >= ${monthStartStr}
      GROUP BY sm.company_id, c.name
      ORDER BY total_calls DESC
    `);

    const dailyResult = await db.execute(sql`
      SELECT
        sm.company_id,
        DATE(sm.created_at)::text AS date,
        COALESCE(SUM(sm.segments), 0)::int AS calls
      FROM sms_messages sm
      WHERE sm.direction = 'outbound'
        AND sm.created_at >= ${monthStartStr}
      GROUP BY sm.company_id, DATE(sm.created_at)
      ORDER BY sm.company_id, date
    `);

    const dailyByCompany: Record<string, Record<string, number>> = {};
    for (const r of dailyResult.rows as {
      company_id: string | null;
      date: string;
      calls: number;
    }[]) {
      const key = r.company_id ?? "__null__";
      if (!dailyByCompany[key]) dailyByCompany[key] = {};
      dailyByCompany[key][r.date] = Number(r.calls);
    }

    return (
      result.rows as {
        company_id: string | null;
        company_name: string;
        total_calls: number;
        first_activity: string | null;
        last_activity: string | null;
      }[]
    ).map((r) => {
      const key = r.company_id ?? "__null__";
      const byDate = dailyByCompany[key] ?? {};
      return {
        companyId: r.company_id,
        companyName: r.company_name,
        totalCalls: Number(r.total_calls),
        estimatedCostUsd: Number(r.total_calls) * TELNYX_COST_PER_SEGMENT,
        firstActivity: r.first_activity,
        lastActivity: r.last_activity,
        dailyTrend: buildMonthTrend(byDate, monthStartStr),
      };
    });
  }

  const providerFilter =
    provider === "openai" ? ["openai", "claude"] : ["mapbox", "mapbox_searchbox"];

  const isMapbox = provider === "mapbox";
  const costExpr = isMapbox
    ? sql`COALESCE(SUM(aud.calls * CASE
          WHEN aud.metric = 'geocode' THEN ${MAPBOX_COST_PER_CALL.geocode}
          WHEN aud.metric = 'autocomplete' THEN ${MAPBOX_COST_PER_CALL.autocomplete}
          WHEN aud.metric = 'directions' THEN ${MAPBOX_COST_PER_CALL.directions}
          WHEN aud.metric = 'matrix' THEN ${MAPBOX_COST_PER_CALL.matrix}
          ELSE 0.005
        END), 0)`
    : sql`COALESCE(SUM(aud.calls) * ${OPENAI_ROVER_CHAT_COST_PER_CALL}, 0)`;

  const result = await db.execute(sql`
    SELECT
      aud.company_id,
      COALESCE(c.name, 'Unattributed') AS company_name,
      COALESCE(SUM(aud.calls), 0)::int AS total_calls,
      ${costExpr} AS estimated_cost_usd,
      MIN(aud.date)::text AS first_activity,
      MAX(aud.date)::text AS last_activity
    FROM api_usage_daily aud
    LEFT JOIN companies c ON c.id = aud.company_id
    WHERE aud.provider = ANY(${providerFilter})
      AND aud.date >= ${monthStartStr}
    GROUP BY aud.company_id, c.name
    ORDER BY total_calls DESC
  `);

  const dailyResult = await db.execute(sql`
    SELECT
      aud.company_id,
      aud.date::text AS date,
      COALESCE(SUM(aud.calls), 0)::int AS calls
    FROM api_usage_daily aud
    WHERE aud.provider = ANY(${providerFilter})
      AND aud.date >= ${monthStartStr}
    GROUP BY aud.company_id, aud.date
    ORDER BY aud.company_id, aud.date
  `);

  const dailyByCompany: Record<string, Record<string, number>> = {};
  for (const r of dailyResult.rows as {
    company_id: string | null;
    date: string;
    calls: number;
  }[]) {
    const key = r.company_id ?? "__null__";
    if (!dailyByCompany[key]) dailyByCompany[key] = {};
    dailyByCompany[key][r.date] = Number(r.calls);
  }

  return (
    result.rows as {
      company_id: string | null;
      company_name: string;
      total_calls: number;
      estimated_cost_usd: number;
      first_activity: string | null;
      last_activity: string | null;
    }[]
  ).map((r) => {
    const key = r.company_id ?? "__null__";
    const byDate = dailyByCompany[key] ?? {};
    return {
      companyId: r.company_id,
      companyName: r.company_name,
      totalCalls: Number(r.total_calls),
      estimatedCostUsd: Number(r.estimated_cost_usd),
      firstActivity: r.first_activity,
      lastActivity: r.last_activity,
      dailyTrend: buildMonthTrend(byDate, monthStartStr),
    };
  });
}
