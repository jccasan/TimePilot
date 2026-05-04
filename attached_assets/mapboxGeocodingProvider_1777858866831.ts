// Mapbox Temporary Geocoding wrapper. Used for review-only suggestions during
// import. Per the product brief, results from this provider must NEVER be
// stored as permanent customer coordinates without owner/admin confirmation.

import type { GeocodeSuggestion, GeocodingProvider } from "./geocodingProvider.js";

export interface MapboxGeocodingConfig {
  accessToken: string;
  country?: string;
  // permanent=true uses the more expensive endpoint and the result MAY be
  // persisted as mapbox_permanent. Default is false (temporary, review-only).
  permanent?: boolean;
  requestTimeoutMs?: number;
}

export class MapboxGeocodingProvider implements GeocodingProvider {
  readonly name: "mapbox_temporary" | "mapbox_permanent";

  constructor(private config: MapboxGeocodingConfig) {
    if (!config.accessToken) {
      throw new Error("MapboxGeocodingProvider requires accessToken.");
    }
    this.name = config.permanent ? "mapbox_permanent" : "mapbox_temporary";
  }

  async geocode(address: string): Promise<GeocodeSuggestion | null> {
    try {
      const endpoint = this.config.permanent
        ? "mapbox.places-permanent"
        : "mapbox.places";
      const params = new URLSearchParams({
        access_token: this.config.accessToken,
        limit: "1",
        autocomplete: "false",
      });
      if (this.config.country) params.set("country", this.config.country);
      const url = `https://api.mapbox.com/geocoding/v5/${endpoint}/${encodeURIComponent(address)}.json?${params.toString()}`;

      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), this.config.requestTimeoutMs ?? 8000);
      let res: Response;
      try {
        res = await fetch(url, { signal: controller.signal });
      } finally {
        clearTimeout(t);
      }
      if (!res.ok) return null;
      const data = (await res.json()) as {
        features?: {
          place_name: string;
          center: [number, number];
          relevance?: number;
          properties?: { accuracy?: string };
        }[];
      };
      const feat = data.features?.[0];
      if (!feat) return null;
      const accuracy = feat.properties?.accuracy;
      const matchType =
        accuracy === "rooftop" || accuracy === "point"
          ? "rooftop"
          : accuracy === "street"
            ? "street"
            : "approximate";
      return {
        formattedAddress: feat.place_name,
        longitude: feat.center[0],
        latitude: feat.center[1],
        confidence: feat.relevance ?? 0.5,
        matchType,
      };
    } catch {
      return null;
    }
  }
}
