// Travel-leg cache. In-memory by default; the interface is intentionally
// minimal so a Postgres / Supabase / Redis / Replit DB backend can be plugged
// in later without touching planner code.

import { roundCoord, type LatLng } from "./geoUtils.js";
import type { RoutingProfile, TravelLegCacheRecord } from "./types.js";

export interface TravelLegCacheService {
  get(
    origin: LatLng,
    destination: LatLng,
    profile: RoutingProfile,
  ): Promise<TravelLegCacheRecord | null>;

  set(record: TravelLegCacheRecord): Promise<void>;

  // Force-refresh helper — drops the cached entry so the next get() misses.
  invalidate(
    origin: LatLng,
    destination: LatLng,
    profile: RoutingProfile,
  ): Promise<void>;

  buildCacheKey(
    origin: LatLng,
    destination: LatLng,
    profile: RoutingProfile,
    precision: number,
  ): string;
}

// Recommended freshness windows (ms).
export const CACHE_TTL_MS = {
  drivingDistance: 180 * 24 * 60 * 60 * 1000, // 180 days
  drivingDuration: 90 * 24 * 60 * 60 * 1000, // 90 days
  drivingTrafficDuration: 24 * 60 * 60 * 1000, // 24 hours
};

export function defaultExpiry(profile: RoutingProfile, fetchedAt: Date): Date {
  const ms =
    profile === "driving-traffic"
      ? CACHE_TTL_MS.drivingTrafficDuration
      : CACHE_TTL_MS.drivingDuration;
  return new Date(fetchedAt.getTime() + ms);
}

export class InMemoryTravelLegCache implements TravelLegCacheService {
  private store = new Map<string, TravelLegCacheRecord>();

  constructor(private precision = 5) {}

  buildCacheKey(
    origin: LatLng,
    destination: LatLng,
    profile: RoutingProfile,
    precision: number = this.precision,
  ): string {
    const oLat = roundCoord(origin.latitude, precision);
    const oLng = roundCoord(origin.longitude, precision);
    const dLat = roundCoord(destination.latitude, precision);
    const dLng = roundCoord(destination.longitude, precision);
    return `${profile}|p${precision}|${oLat},${oLng}->${dLat},${dLng}`;
  }

  async get(
    origin: LatLng,
    destination: LatLng,
    profile: RoutingProfile,
  ): Promise<TravelLegCacheRecord | null> {
    const key = this.buildCacheKey(origin, destination, profile, this.precision);
    const rec = this.store.get(key);
    if (!rec) return null;
    if (rec.expiresAt && new Date(rec.expiresAt).getTime() < Date.now()) {
      this.store.delete(key);
      return null;
    }
    return rec;
  }

  async set(record: TravelLegCacheRecord): Promise<void> {
    this.store.set(record.cacheKey, record);
  }

  async invalidate(
    origin: LatLng,
    destination: LatLng,
    profile: RoutingProfile,
  ): Promise<void> {
    const key = this.buildCacheKey(origin, destination, profile, this.precision);
    this.store.delete(key);
  }

  size(): number {
    return this.store.size;
  }
}
