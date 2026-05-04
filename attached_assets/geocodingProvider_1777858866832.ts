// GeocodingProvider interface and a non-network mock used for the demo.
// Real address review uses MapboxGeocodingProvider (Temporary Geocoding by
// default). Permanent Geocoding is opt-in.

export interface GeocodeSuggestion {
  formattedAddress: string;
  latitude: number;
  longitude: number;
  confidence: number; // 0..1
  // What kind of result Mapbox returned. Used to drive needs_review heuristics.
  matchType?: "rooftop" | "street" | "place" | "approximate" | "unknown";
}

export interface GeocodingProvider {
  readonly name: "mapbox_temporary" | "mapbox_permanent" | "mock";
  geocode(address: string): Promise<GeocodeSuggestion | null>;
}

// Mock used by the demo. Returns deterministic but fake suggestions so we can
// exercise the bulk-review flow without spending Mapbox quota.
export class MockGeocodingProvider implements GeocodingProvider {
  readonly name = "mock" as const;

  async geocode(address: string): Promise<GeocodeSuggestion | null> {
    // Refuse a couple of patterns to model the failure path.
    if (/unknown|invalid|xxx/i.test(address)) return null;
    // Hash the address into stable lat/lng noise around a centerpoint so the
    // demo produces plausible spatial spread.
    const hash = simpleHash(address);
    const lat = 38.9 + ((hash % 1000) / 1000) * 0.4;
    const lng = -77.4 + (((hash >> 10) % 1000) / 1000) * 0.4;
    const confidence = 0.55 + ((hash >> 20) % 100) / 200; // 0.55..1.0
    return {
      formattedAddress: address,
      latitude: round5(lat),
      longitude: round5(lng),
      confidence: round5(confidence),
      matchType: confidence > 0.85 ? "rooftop" : "street",
    };
  }
}

function simpleHash(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = (h * 33) ^ s.charCodeAt(i);
  }
  return Math.abs(h >>> 0);
}

function round5(n: number): number {
  return Math.round(n * 1e5) / 1e5;
}
