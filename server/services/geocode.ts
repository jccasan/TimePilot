/* eslint-disable @typescript-eslint/no-explicit-any */
import { trackApiCall } from "./api-usage";
import { storage } from "../storage";

const TTL_MS = 24 * 60 * 60 * 1000;
const DB_TTL_DAYS = 30;
const DB_TTL_MS = DB_TTL_DAYS * 24 * 60 * 60 * 1000;

const AUTOCOMPLETE_DB_TTL_DAYS = 7;
const AUTOCOMPLETE_DB_TTL_MS = AUTOCOMPLETE_DB_TTL_DAYS * 24 * 60 * 60 * 1000;

interface CacheEntry<T> {
  value: T;
  storedAt: number;
}

const geocodeCache = new Map<string, CacheEntry<{ latitude: string; longitude: string } | null>>();

const autocompleteCache = new Map<string, CacheEntry<any[]>>();

function normalizeAddress(parts: string): string {
  return parts.toLowerCase().replace(/\s+/g, " ").trim();
}

export function normalizeAutocompleteQuery(q: string): string {
  return q.toLowerCase().replace(/\s+/g, " ").trim();
}

function isFresh(entry: CacheEntry<any>): boolean {
  return Date.now() - entry.storedAt < TTL_MS;
}

export async function getAutocompleteCached(
  query: string,
  country: string = "us"
): Promise<any[] | null> {
  const key = `${country}:${normalizeAutocompleteQuery(query)}`;

  // L1: in-memory cache
  const entry = autocompleteCache.get(key);
  if (entry && isFresh(entry)) return entry.value;

  // L2: database cache
  try {
    const dbEntry = await storage.getAutocompleteCache(key);
    if (dbEntry && Date.now() - dbEntry.cachedAt.getTime() < AUTOCOMPLETE_DB_TTL_MS) {
      const results = dbEntry.results as any[];
      autocompleteCache.set(key, { value: results, storedAt: Date.now() });
      return results;
    }
  } catch (err) {
    console.warn("[AutocompleteCache] DB read failed:", err instanceof Error ? err.message : err);
  }

  return null;
}

export function setAutocompleteCache(query: string, country: string = "us", result: any[]): void {
  const key = `${country}:${normalizeAutocompleteQuery(query)}`;
  autocompleteCache.set(key, { value: result, storedAt: Date.now() });
  storage.setAutocompleteCache(key, result).catch((err) => {
    console.warn("[AutocompleteCache] DB write failed:", err instanceof Error ? err.message : err);
  });
}

const EVICTION_INTERVAL_MS = 60 * 60 * 1000;
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of geocodeCache) {
    if (now - entry.storedAt >= TTL_MS) geocodeCache.delete(key);
  }
  for (const [key, entry] of autocompleteCache) {
    if (now - entry.storedAt >= TTL_MS) autocompleteCache.delete(key);
  }
}, EVICTION_INTERVAL_MS).unref();

async function runPrune() {
  try {
    await storage.pruneGeocodeCache(DB_TTL_DAYS);
  } catch (err) {
    console.warn("[GeocodeCache] Prune failed:", err instanceof Error ? err.message : err);
  }
  try {
    await storage.pruneAutocompleteCache(AUTOCOMPLETE_DB_TTL_DAYS);
  } catch (err) {
    console.warn("[AutocompleteCache] Prune failed:", err instanceof Error ? err.message : err);
  }
}

runPrune();

const PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1000;
setInterval(runPrune, PRUNE_INTERVAL_MS).unref();

// Continental US bounding box (includes Alaska + Hawaii with generous padding).
// Results outside this box are almost certainly wrong Mapbox matches.
const US_LAT_MIN = 17.0; // southernmost Hawaii/territory
const US_LAT_MAX = 72.0; // northernmost Alaska
const US_LNG_MIN = -180.0; // westernmost Alaska
const US_LNG_MAX = -66.0; // easternmost Maine

function isWithinUSBounds(lat: number, lng: number): boolean {
  return lat >= US_LAT_MIN && lat <= US_LAT_MAX && lng >= US_LNG_MIN && lng <= US_LNG_MAX;
}

export async function geocodeAddress(
  streetAddress: string,
  city?: string | null,
  state?: string | null,
  zipCode?: string | null,
  country?: string | null,
  companyId?: string | null
): Promise<{ latitude: string; longitude: string } | null> {
  const tokens = [process.env.MAPBOX_PUBLIC_TOKEN, process.env.MAPBOX_SECRET_TOKEN].filter(
    Boolean
  ) as string[];
  if (tokens.length === 0) return null;

  const parts = [streetAddress, city, state, zipCode].filter(Boolean).join(", ");
  if (!parts || parts.length < 5) return null;

  const countryFilter = country === "ca" ? "ca" : "us";
  const cacheKey = `${countryFilter}:${normalizeAddress(parts)}`;

  // L1: in-memory cache
  const cached = geocodeCache.get(cacheKey);
  if (cached && isFresh(cached)) return cached.value;

  // L2: database cache (only serve POSITIVE hits within the 30-day DB TTL)
  // Negative (null) results are intentionally not served from the DB cache so that
  // the geocode backfill can retry properties that previously failed — e.g. due to
  // Mapbox rate-limits, a bad token, or a transient network error on a prior startup.
  try {
    const dbEntry = await storage.getGeocodeCache(cacheKey);
    if (
      dbEntry &&
      dbEntry.latitude &&
      dbEntry.longitude &&
      Date.now() - dbEntry.cachedAt.getTime() < DB_TTL_MS
    ) {
      const result = { latitude: dbEntry.latitude, longitude: dbEntry.longitude };
      geocodeCache.set(cacheKey, { value: result, storedAt: Date.now() });
      return result;
    }
  } catch (err) {
    console.warn("[GeocodeCache] DB read failed:", err instanceof Error ? err.message : err);
  }

  // L3: Mapbox API
  for (const token of tokens) {
    try {
      const params = new URLSearchParams({
        q: parts,
        access_token: token,
        country: countryFilter,
        types: "address",
        limit: "1",
      });
      const url = `https://api.mapbox.com/search/geocode/v6/forward?${params}`;
      const response = await fetch(url);
      if (!response.ok) continue;
      const data = await response.json();
      const feature = data.features?.[0];
      if (!feature) {
        // Primary API returned no results — try Search Box API fallback
        const sbResult = await trySearchBoxFallback(parts, countryFilter, token);
        if (sbResult) {
          geocodeCache.set(cacheKey, { value: sbResult, storedAt: Date.now() });
          storage.setGeocodeCache(cacheKey, sbResult.latitude, sbResult.longitude).catch((err) => {
            console.warn(
              "[GeocodeCache] DB write failed:",
              err instanceof Error ? err.message : err
            );
          });
          trackApiCall("mapbox_searchbox", "geocode", 1, companyId);
          return sbResult;
        }
        geocodeCache.set(cacheKey, { value: null, storedAt: Date.now() });
        storage.setGeocodeCache(cacheKey, null, null).catch((err) => {
          console.warn("[GeocodeCache] DB write failed:", err instanceof Error ? err.message : err);
        });
        return null;
      }
      const coords = feature.geometry?.coordinates;
      if (!coords || coords.length < 2) {
        geocodeCache.set(cacheKey, { value: null, storedAt: Date.now() });
        storage.setGeocodeCache(cacheKey, null, null).catch((err) => {
          console.warn("[GeocodeCache] DB write failed:", err instanceof Error ? err.message : err);
        });
        return null;
      }
      const lat = coords[1] as number;
      const lng = coords[0] as number;
      if (countryFilter === "us" && !isWithinUSBounds(lat, lng)) {
        console.warn(`[Geocode] Discarding out-of-bounds result for "${parts}": (${lat}, ${lng})`);
        geocodeCache.set(cacheKey, { value: null, storedAt: Date.now() });
        storage.setGeocodeCache(cacheKey, null, null).catch(() => {});
        return null;
      }
      const result = {
        latitude: String(lat),
        longitude: String(lng),
      };
      geocodeCache.set(cacheKey, { value: result, storedAt: Date.now() });
      storage.setGeocodeCache(cacheKey, result.latitude, result.longitude).catch((err) => {
        console.warn("[GeocodeCache] DB write failed:", err instanceof Error ? err.message : err);
      });
      trackApiCall("mapbox", "geocode", 1, companyId);
      return result;
    } catch {
      continue;
    }
  }
  return null;
}

async function trySearchBoxFallback(
  query: string,
  country: string,
  token: string
): Promise<{ latitude: string; longitude: string } | null> {
  console.log("[Geocode] Falling back to Search Box API");
  try {
    const params = new URLSearchParams({
      q: query,
      access_token: token,
      country,
      types: "address",
      limit: "1",
    });
    const url = `https://api.mapbox.com/search/searchbox/v1/forward?${params}`;
    const response = await fetch(url);
    if (!response.ok) return null;
    const data = await response.json();
    const feature = data.features?.[0];
    if (!feature) return null;
    const coords = feature.geometry?.coordinates;
    if (!coords || coords.length < 2) return null;
    const lat = coords[1] as number;
    const lng = coords[0] as number;
    if (country === "us" && !isWithinUSBounds(lat, lng)) {
      console.warn(
        `[Geocode] SearchBox: discarding out-of-bounds result for "${query}": (${lat}, ${lng})`
      );
      return null;
    }
    return {
      latitude: String(lat),
      longitude: String(lng),
    };
  } catch {
    return null;
  }
}
