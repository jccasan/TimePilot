import { sql } from "drizzle-orm";
import { db } from "../db";

export type ApiProvider = "mapbox" | "mapbox_searchbox" | "openai";
export type ApiMetric = "geocode" | "autocomplete" | "directions" | "matrix" | "rover_chat";

const DAILY_THRESHOLD = parseInt(process.env.GEOCODE_DAILY_THRESHOLD || "1000", 10);

let thresholdNotifiedForDay = "";

export function trackApiCall(provider: ApiProvider, metric: ApiMetric, count = 1): void {
  db.execute(
    sql`
    INSERT INTO api_usage_daily (id, date, provider, metric, calls)
    VALUES (gen_random_uuid(), CURRENT_DATE, ${provider}, ${metric}, ${count})
    ON CONFLICT (date, provider, metric)
    DO UPDATE SET calls = api_usage_daily.calls + ${count}
  `
  )
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
        DATE(recorded_at)::text AS date,
        COALESCE(SUM(quantity), 0)::int AS segments
      FROM usage_events
      WHERE event_type = 'sms_segment'
        AND recorded_at >= CURRENT_DATE - INTERVAL '30 days'
      GROUP BY DATE(recorded_at)
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

export async function getAllApiCosts(): Promise<AllApiCosts> {
  const todayStr = new Date().toISOString().slice(0, 10);
  const now = new Date();
  const monthStartStr = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);

  const { dailyRows, telnyxRows } = await getAllApiUsageStats();

  const mapboxByDate: Record<string, number> = {};
  const mapboxBreakdown: Record<string, { today: number; thisMonth: number }> = {};

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

  for (const row of dailyRows.filter((r) => r.provider === "openai" && r.metric === "rover_chat")) {
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
  };
}
