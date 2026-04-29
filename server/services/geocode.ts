const TTL_MS = 24 * 60 * 60 * 1000;

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

export function getAutocompleteCached(query: string, country: string = "us"): any[] | null {
  const key = `${country}:${normalizeAutocompleteQuery(query)}`;
  const entry = autocompleteCache.get(key);
  if (entry && isFresh(entry)) return entry.value;
  return null;
}

export function setAutocompleteCache(query: string, country: string = "us", result: any[]): void {
  const key = `${country}:${normalizeAutocompleteQuery(query)}`;
  autocompleteCache.set(key, { value: result, storedAt: Date.now() });
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

export async function geocodeAddress(
  streetAddress: string,
  city?: string | null,
  state?: string | null,
  zipCode?: string | null,
  country?: string | null
): Promise<{ latitude: string; longitude: string } | null> {
  const tokens = [
    process.env.MAPBOX_PUBLIC_TOKEN,
    process.env.MAPBOX_SECRET_TOKEN,
  ].filter(Boolean) as string[];
  if (tokens.length === 0) return null;

  const parts = [streetAddress, city, state, zipCode].filter(Boolean).join(", ");
  if (!parts || parts.length < 5) return null;

  const countryFilter = country === "ca" ? "ca" : "us";
  const cacheKey = `${countryFilter}:${normalizeAddress(parts)}`;
  const cached = geocodeCache.get(cacheKey);
  if (cached && isFresh(cached)) return cached.value;

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
        geocodeCache.set(cacheKey, { value: null, storedAt: Date.now() });
        return null;
      }
      const coords = feature.geometry?.coordinates;
      if (!coords || coords.length < 2) {
        geocodeCache.set(cacheKey, { value: null, storedAt: Date.now() });
        return null;
      }
      const result = {
        latitude: String(coords[1]),
        longitude: String(coords[0]),
      };
      geocodeCache.set(cacheKey, { value: result, storedAt: Date.now() });
      return result;
    } catch {
      continue;
    }
  }
  return null;
}
