import { sql } from "drizzle-orm";
import { db } from "../db";

export type ApiProvider = "mapbox" | "openai";
export type ApiMetric =
  | "geocode"
  | "autocomplete"
  | "directions"
  | "rover_chat";

export function trackApiCall(provider: ApiProvider, metric: ApiMetric, count = 1): void {
  db.execute(sql`
    INSERT INTO api_usage_daily (id, date, provider, metric, calls)
    VALUES (gen_random_uuid(), CURRENT_DATE, ${provider}, ${metric}, ${count})
    ON CONFLICT (date, provider, metric)
    DO UPDATE SET calls = api_usage_daily.calls + ${count}
  `).catch(() => {});
}
