import { sql } from "drizzle-orm";
import { db } from "../db";

export type ApiProvider = "mapbox" | "mapbox_searchbox" | "openai";
export type ApiMetric =
  | "geocode"
  | "autocomplete"
  | "directions"
  | "matrix"
  | "rover_chat";

const DAILY_THRESHOLD = parseInt(process.env.GEOCODE_DAILY_THRESHOLD || "1000", 10);

let thresholdNotifiedForDay = "";

export function trackApiCall(provider: ApiProvider, metric: ApiMetric, count = 1): void {
  db.execute(sql`
    INSERT INTO api_usage_daily (id, date, provider, metric, calls)
    VALUES (gen_random_uuid(), CURRENT_DATE, ${provider}, ${metric}, ${count})
    ON CONFLICT (date, provider, metric)
    DO UPDATE SET calls = api_usage_daily.calls + ${count}
  `).then(() => {
    if (provider === "mapbox" && (metric === "geocode" || metric === "autocomplete")) {
      checkDailyThreshold().catch(() => {});
    }
  }).catch(() => {});
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
