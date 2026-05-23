/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useAddressLabels } from "@/hooks/use-address-labels";

const ESRI_ZIP_URL =
  "https://services.arcgis.com/P3ePLMYs2RVChkJx/arcgis/rest/services/USA_ZIP_Code_Areas_anaylsis/FeatureServer/0/query";

const COLOR_UNSEL = "#4b9e5f";
const COLOR_SEL = "#16a34a";
const COLOR_HOVER = "#bbf7d0";
const MILES_TO_M = 1609.34;
const DEFAULT_ZOOM = 11;
const FALLBACK: L.LatLngExpression = [38.5, -97];

function isZip(s: string) {
  return /^\d{5}$/.test(s);
}

// Canadian Forward Sortation Area: letter-digit-letter (e.g. "M5V")
function isFSA(s: string) {
  return /^[A-Za-z]\d[A-Za-z]$/.test(s);
}

function isCanadianPostal(s: string) {
  return /^[A-Za-z]\d[A-Za-z]\s?\d[A-Za-z]\d$/.test(s);
}

function isPostal(s: string) {
  return isZip(s) || isCanadianPostal(s) || isFSA(s);
}

// Stitch OSM way-member segments into closed polygon rings.
// OSM boundary relations are composed of multiple partial way segments that must
// be joined end-to-end before they form valid GeoJSON ring coordinates.
// The algorithm greedily picks the next unvisited segment whose start or end
// matches the current ring tip, reversing it if necessary, until the ring closes.
function buildRingsFromOverpassMembers(members: any[]): number[][][] {
  // Collect outer way coordinate arrays
  const segments: number[][][] = [];
  for (const m of members) {
    if (!m.geometry?.length) continue;
    if (m.role !== "outer" && m.role !== "") continue;
    const coords: number[][] = m.geometry.map((pt: any) => [pt.lon, pt.lat]);
    if (coords.length >= 2) segments.push(coords);
  }
  if (segments.length === 0) return [];

  const EPS = 1e-7; // coordinate comparison tolerance

  function ptEq(a: number[], b: number[]) {
    return Math.abs(a[0] - b[0]) < EPS && Math.abs(a[1] - b[1]) < EPS;
  }

  const used = new Array(segments.length).fill(false);
  const rings: number[][][] = [];

  for (let start = 0; start < segments.length; start++) {
    if (used[start]) continue;

    // Begin a new ring with this segment
    let ring: number[][] = [...segments[start]];
    used[start] = true;

    // Greedily stitch additional segments until the ring closes or no more fit
    let changed = true;
    while (changed) {
      changed = false;
      const tip = ring[ring.length - 1];
      const head = ring[0];

      // Check if ring is already closed (tip == head, length > 3)
      if (ring.length > 3 && ptEq(tip, head)) break;

      for (let i = 0; i < segments.length; i++) {
        if (used[i]) continue;
        const seg = segments[i];
        const sStart = seg[0];
        const sEnd = seg[seg.length - 1];

        if (ptEq(tip, sStart)) {
          // Forward — append all but the duplicate first point
          ring = ring.concat(seg.slice(1));
          used[i] = true;
          changed = true;
          break;
        } else if (ptEq(tip, sEnd)) {
          // Reversed — append reversed seg, skipping its last point (== our tip)
          ring = ring.concat([...seg].reverse().slice(1));
          used[i] = true;
          changed = true;
          break;
        }
      }
    }

    // Close the ring if it isn't already
    if (ring.length >= 4) {
      if (!ptEq(ring[0], ring[ring.length - 1])) ring.push([...ring[0]]);
      rings.push(ring);
    }
  }

  return rings;
}

async function geocodeAddress(address: string): Promise<L.LatLngExpression | null> {
  try {
    const r = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(address)}`,
      { headers: { "Accept-Language": "en" } }
    );
    const d = await r.json();
    if (d?.[0]) return [parseFloat(d[0].lat), parseFloat(d[0].lon)];
  } catch {}
  return null;
}

function addOsmLayer(map: L.Map) {
  L.tileLayer("/api/map/tiles/{z}/{x}/{y}", {
    maxZoom: 19,
    attribution:
      "© <a href='https://www.openstreetmap.org/copyright'>OpenStreetMap</a> contributors",
  }).addTo(map);
}

async function fetchUSZipPolygonsInViewport(
  w: number,
  s: number,
  e: number,
  n: number
): Promise<GeoJSON.FeatureCollection> {
  const p = new URLSearchParams({
    geometry: `${w},${s},${e},${n}`,
    geometryType: "esriGeometryEnvelope",
    spatialRel: "esriSpatialRelIntersects",
    inSR: "4326",
    outSR: "4326",
    outFields: "ZIP_CODE,PO_NAME,STATE",
    returnGeometry: "true",
    f: "geojson",
    resultRecordCount: "200",
  });
  try {
    const r = await fetch(`${ESRI_ZIP_URL}?${p}`);
    return await r.json();
  } catch {
    return { type: "FeatureCollection", features: [] };
  }
}

// Fetch Canadian FSA (Forward Sortation Area) polygon boundaries from the
// OpenStreetMap Overpass API. Boundaries are stored as "boundary=postal_code"
// relations in OSM with a "postal_code" tag like "M5V".
async function fetchCanadianFSAPolygonsInViewport(
  w: number,
  s: number,
  e: number,
  n: number
): Promise<GeoJSON.FeatureCollection> {
  // [out:json] with "out geom" returns member geometry inline so we can build polygons
  const query =
    `[out:json][timeout:25];` +
    `(relation["boundary"="postal_code"](${s},${w},${n},${e}););` +
    `out geom;`;
  try {
    const r = await fetch("https://overpass-api.de/api/interpreter", {
      method: "POST",
      body: query,
      headers: { "Content-Type": "text/plain" },
      signal: AbortSignal.timeout(30000),
    });
    const data = await r.json();
    const features: GeoJSON.Feature[] = [];
    for (const el of data.elements ?? []) {
      if (el.type !== "relation") continue;
      // OSM stores FSA as "postal_code" tag, e.g. "M5V" or "M5V 3A8"
      const raw: string = (el.tags?.postal_code ?? el.tags?.["addr:postal_code"] ?? "")
        .toUpperCase()
        .replace(/\s+/g, "");
      // Only render FSA-level (3-char) codes — full 6-char postal codes are too granular
      if (!raw || !isFSA(raw)) continue;
      const rings = buildRingsFromOverpassMembers(el.members ?? []);
      if (!rings.length) continue;
      features.push({
        type: "Feature",
        // Normalise to ZIP_CODE key so the rest of loadZips works unchanged
        properties: { ZIP_CODE: raw },
        geometry:
          rings.length === 1
            ? ({ type: "Polygon", coordinates: rings } as GeoJSON.Geometry)
            : ({ type: "MultiPolygon", coordinates: rings.map((r) => [r]) } as GeoJSON.Geometry),
      });
    }
    return { type: "FeatureCollection", features };
  } catch {
    return { type: "FeatureCollection", features: [] };
  }
}

// Returns true when the majority of the visible viewport area is within Canada.
// Uses the fraction of overlap with the Canadian bounding box rather than just
// the center point, so border-straddling views pick the dominant country.
function viewportIsMostlyCanada(w: number, s: number, e: number, n: number): boolean {
  // Canadian bounding box
  const CA_W = -141.5,
    CA_E = -52.0,
    CA_S = 41.7,
    CA_N = 83.5;

  const overlapW = Math.max(w, CA_W);
  const overlapE = Math.min(e, CA_E);
  const overlapS = Math.max(s, CA_S);
  const overlapN = Math.min(n, CA_N);

  if (overlapW >= overlapE || overlapS >= overlapN) return false; // no overlap

  const overlapArea = (overlapE - overlapW) * (overlapN - overlapS);
  const viewportArea = (e - w) * (n - s);

  // Use Canadian data when more than half the viewport is inside Canada
  return viewportArea > 0 && overlapArea / viewportArea > 0.5;
}

async function fetchZipPolygonsInViewport(
  w: number,
  s: number,
  e: number,
  n: number
): Promise<GeoJSON.FeatureCollection> {
  if (viewportIsMostlyCanada(w, s, e, n)) {
    return fetchCanadianFSAPolygonsInViewport(w, s, e, n);
  }
  return fetchUSZipPolygonsInViewport(w, s, e, n);
}

// ─── ZIP Map ──────────────────────────────────────────────────────────────────

type ZipMapProps = {
  value: string;
  onChange: (zips: string) => void;
  addressHint?: string | null;
};

export function ZipMapSelector({ value, onChange, addressHint }: ZipMapProps) {
  const { country } = useAddressLabels();
  const isCanada = country === "ca";
  const postalSingular = isCanada ? "postal code" : "ZIP";
  const postalPlural = isCanada ? "postal codes" : "ZIPs";
  const postalAreaLabel = isCanada ? "postal code areas" : "ZIP code areas";

  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layersRef = useRef<Map<string, L.GeoJSON>>(new Map());
  const selectedRef = useRef<Set<string>>(new Set());
  const loadingRef = useRef(false);

  const [selectedZips, setSelectedZips] = useState<string[]>(() => {
    const initial = value
      ? value
          .split(",")
          .map((z) => z.trim())
          .filter(isPostal)
      : [];
    selectedRef.current = new Set(initial);
    return initial;
  });
  const [loading, setLoading] = useState(false);
  const [textInput, setTextInput] = useState("");
  const [inputError, setInputError] = useState<string | null>(null);
  const [canadaNoData, setCanadaNoData] = useState(false);

  function syncSelected(next: Set<string>) {
    selectedRef.current = next;
    const arr = Array.from(next).sort();
    setSelectedZips(arr);
    onChange(arr.join(","));
  }

  function handleTextAdd() {
    const raw = textInput.trim();
    if (!raw) return;
    const tokens = raw
      .split(",")
      .map((t) => t.trim().toUpperCase())
      .filter(Boolean);
    const invalid: string[] = [];
    const toAdd: string[] = [];
    for (const token of tokens) {
      if (isZip(token) || isFSA(token)) {
        toAdd.push(token);
      } else {
        invalid.push(token);
      }
    }
    if (invalid.length > 0) {
      setInputError(
        `Invalid ${invalid.length === 1 ? "code" : "codes"}: ${invalid.join(", ")}. Use 5-digit ZIP (e.g. 90210) or 3-character FSA (e.g. M5V).`
      );
      return;
    }
    setInputError(null);
    const next = new Set(selectedRef.current);
    toAdd.forEach((code) => next.add(code));
    syncSelected(next);
    setTextInput("");
  }

  useEffect(() => {
    const el = containerRef.current;
    if (!el || mapRef.current) return;

    let cancelled = false;
    let map: L.Map | null = null;
    let ro: ResizeObserver | null = null;
    const timers: ReturnType<typeof setTimeout>[] = [];

    async function loadZips() {
      if (!mapRef.current || loadingRef.current || mapRef.current.getZoom() < 8) return;
      loadingRef.current = true;
      setLoading(true);
      setCanadaNoData(false);
      try {
        const b = mapRef.current.getBounds();
        const w = b.getWest(),
          s = b.getSouth(),
          e = b.getEast(),
          n = b.getNorth();
        const isCanadaViewport = viewportIsMostlyCanada(w, s, e, n);
        const geo = await fetchZipPolygonsInViewport(w, s, e, n);
        if (cancelled) return;
        if (isCanadaViewport && geo.features.length === 0) {
          setCanadaNoData(true);
        }
        geo.features.forEach((feat) => {
          if (!mapRef.current) return;
          const zip = (feat.properties as any)?.ZIP_CODE as string;
          if (!zip || (!isZip(zip) && !isFSA(zip)) || layersRef.current.has(zip)) return;
          const isSel = selectedRef.current.has(zip);
          const layer = L.geoJSON(feat as any, {
            style: {
              color: "#15803d",
              weight: 1.5,
              fillColor: isSel ? COLOR_SEL : COLOR_UNSEL,
              fillOpacity: isSel ? 0.45 : 0.12,
            },
          });
          layer.on("mouseover", () => {
            if (!selectedRef.current.has(zip))
              layer.setStyle({ fillColor: COLOR_HOVER, fillOpacity: 0.35 });
          });
          layer.on("mouseout", () => {
            if (!selectedRef.current.has(zip))
              layer.setStyle({ fillColor: COLOR_UNSEL, fillOpacity: 0.12 });
          });
          layer.on("click", () => {
            const next = new Set(selectedRef.current);
            if (next.has(zip)) {
              next.delete(zip);
              layer.setStyle({ fillColor: COLOR_UNSEL, fillOpacity: 0.12 });
            } else {
              next.add(zip);
              layer.setStyle({ fillColor: COLOR_SEL, fillOpacity: 0.45 });
            }
            syncSelected(next);
          });
          const ring =
            feat.geometry.type === "Polygon"
              ? feat.geometry.coordinates[0]
              : feat.geometry.type === "MultiPolygon"
                ? feat.geometry.coordinates[0][0]
                : null;
          if (ring?.length) {
            const xs = (ring as number[][]).map((c) => c[0]);
            const ys = (ring as number[][]).map((c) => c[1]);
            const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
            const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
            L.marker([cy, cx], {
              icon: L.divIcon({
                className: "",
                html: `<span style="font-size:10px;font-weight:700;color:#14532d;text-shadow:0 0 3px #fff,0 0 3px #fff">${zip}</span>`,
                iconSize: [40, 14],
                iconAnchor: [20, 7],
              }),
              interactive: false,
            }).addTo(mapRef.current!);
          }
          layer.addTo(mapRef.current!);
          layersRef.current.set(zip, layer);
        });
      } finally {
        if (!cancelled) {
          loadingRef.current = false;
          setLoading(false);
        }
      }
    }

    // Geocode-first approach:
    //   1. Wait for container to have real dimensions (rAF loop)
    //   2. Geocode BEFORE creating the Leaflet map
    //   3. Create map + setView in one synchronous block — no async gap between
    //      creation and first view, so Leaflet always reads the correct dimensions
    let rafId: number;

    async function init() {
      const container = el as HTMLElement;

      // Step 1: Wait for a non-zero layout
      await new Promise<void>((resolve) => {
        function check() {
          if (cancelled) {
            resolve();
            return;
          }
          if (container.clientWidth > 0 && container.clientHeight > 0) {
            resolve();
            return;
          }
          rafId = requestAnimationFrame(check);
        }
        check();
      });
      if (cancelled) return;

      // Step 2: Geocode — container is correctly sized and stable
      let pos: L.LatLngExpression = FALLBACK;
      if (addressHint) {
        const geocoded = await geocodeAddress(addressHint);
        if (geocoded && !cancelled) pos = geocoded;
      }
      if (cancelled) return;

      // Step 3: Create map + setView synchronously. Leaflet reads clientWidth/clientHeight
      // inside setView() — at this point the container has been stable for 0-2 seconds.
      map = L.map(container, { zoomControl: true });
      mapRef.current = map;
      addOsmLayer(map);
      map.setView(pos, DEFAULT_ZOOM, { animate: false });
      map.on("moveend zoomend", loadZips);

      // Restore previously selected ZIPs styling (loaded lazily via loadZips below)

      // ResizeObserver handles any future resize after the map is loaded
      ro = new ResizeObserver(() => {
        if (mapRef.current) mapRef.current.invalidateSize({ animate: false });
      });
      ro.observe(el as HTMLElement);

      // Trigger initial ZIP load after a short delay to let tiles settle
      timers.push(setTimeout(loadZips, 300));
    }

    init();

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
      timers.forEach(clearTimeout);
      ro?.disconnect();
      if (map) {
        map.remove();
        mapRef.current = null;
        layersRef.current.clear();
      }
    };
  }, []);

  useEffect(() => {
    layersRef.current.forEach((layer, zip) => {
      layer.setStyle(
        selectedRef.current.has(zip)
          ? { fillColor: COLOR_SEL, fillOpacity: 0.45 }
          : { fillColor: COLOR_UNSEL, fillOpacity: 0.12 }
      );
    });
  }, [selectedZips]);

  return (
    <div className="space-y-2">
      <div
        className="relative border border-border rounded-md"
        style={{ height: 340, overflow: "hidden" }}
      >
        <div ref={containerRef} style={{ width: "100%", height: "100%" }} data-testid="zip-map" />
        {loading && (
          <div className="absolute top-2 right-2 z-[1000] bg-white/90 text-xs text-muted-foreground px-2 py-1 rounded shadow">
            Loading {postalPlural}…
          </div>
        )}
        {canadaNoData && !loading && (
          <div
            className="absolute bottom-2 left-2 right-2 z-[1000] bg-white/95 dark:bg-gray-900/95 border border-amber-300 dark:border-amber-700 text-xs text-amber-800 dark:text-amber-300 px-3 py-2 rounded shadow"
            data-testid="canada-no-data-notice"
          >
            Postal boundary shapes are not available for this area. You can type FSA codes manually
            in the field below.
          </div>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        Click {postalAreaLabel} to select your service territory. Zoom in for more detail.
      </p>
      <div className="flex gap-2">
        <input
          type="text"
          value={textInput}
          onChange={(e) => {
            setTextInput(e.target.value);
            if (inputError) setInputError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              handleTextAdd();
            }
          }}
          placeholder={
            isCanada ? "Type FSA codes, e.g. M5V, K1A" : "Type ZIP codes, e.g. 90210, 10001"
          }
          className="flex-1 h-8 rounded-md border border-input bg-background px-3 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          data-testid="input-postal-codes"
        />
        <button
          type="button"
          onClick={handleTextAdd}
          className="h-8 px-3 rounded-md bg-green-700 text-white text-sm font-medium hover:bg-green-800 disabled:opacity-50 shrink-0"
          disabled={!textInput.trim()}
          data-testid="button-add-postal-codes"
        >
          Add
        </button>
      </div>
      {inputError && (
        <p className="text-xs text-destructive" data-testid="text-postal-error">
          {inputError}
        </p>
      )}
      {selectedZips.length > 0 ? (
        <div className="flex items-center justify-between gap-2 bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-900 rounded-md px-3 py-2">
          <div className="text-sm">
            <span className="font-semibold text-green-800 dark:text-green-300">
              {selectedZips.length} {selectedZips.length !== 1 ? postalPlural : postalSingular}{" "}
              selected:
            </span>{" "}
            <span className="text-muted-foreground">
              {selectedZips.slice(0, 8).join(", ")}
              {selectedZips.length > 8 ? ` +${selectedZips.length - 8} more` : ""}
            </span>
          </div>
          <button
            type="button"
            onClick={() => syncSelected(new Set())}
            className="text-xs text-red-500 hover:text-red-700 shrink-0"
            data-testid="button-clear-zips"
          >
            Clear all
          </button>
        </div>
      ) : (
        <div className="text-xs text-muted-foreground italic">No {postalPlural} selected yet</div>
      )}
    </div>
  );
}

// ─── Radius Map ───────────────────────────────────────────────────────────────

type RadiusMapProps = {
  radiusMiles: number;
  addressHint?: string | null;
};

export function RadiusMapSelector({ radiusMiles, addressHint }: RadiusMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const circleRef = useRef<L.Circle | null>(null);
  const centerRef = useRef<L.LatLngExpression>(FALLBACK);
  const radiusRef = useRef(radiusMiles);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || mapRef.current) return;

    let cancelled = false;
    let map: L.Map | null = null;
    let ro: ResizeObserver | null = null;
    const timers: ReturnType<typeof setTimeout>[] = [];
    let rafId: number;

    async function init() {
      const container = el as HTMLElement;

      // Step 1: Wait for container to have real dimensions
      await new Promise<void>((resolve) => {
        function check() {
          if (cancelled) {
            resolve();
            return;
          }
          if (container.clientWidth > 0 && container.clientHeight > 0) {
            resolve();
            return;
          }
          rafId = requestAnimationFrame(check);
        }
        check();
      });
      if (cancelled) return;

      // Step 2: Geocode before creating the map
      if (addressHint) {
        const pos = await geocodeAddress(addressHint);
        if (pos && !cancelled) centerRef.current = pos;
      }
      if (cancelled) return;

      // Step 3: Create map + set initial view + add circle + fitBounds synchronously
      // setView() must come before circle.getBounds() — Leaflet needs a projection
      // to compute geographic bounds from a pixel-radius circle.
      map = L.map(container, { zoomControl: true, scrollWheelZoom: false });
      mapRef.current = map;
      addOsmLayer(map);
      map.setView(centerRef.current, 10, { animate: false });

      const circle = L.circle(centerRef.current, {
        radius: radiusRef.current * MILES_TO_M,
        color: "#15803d",
        fillColor: "#16a34a",
        fillOpacity: 0.2,
        weight: 2,
      }).addTo(map);
      circleRef.current = circle;
      map.fitBounds(circle.getBounds(), { padding: [24, 24], animate: false });

      ro = new ResizeObserver(() => {
        if (mapRef.current) mapRef.current.invalidateSize({ animate: false });
      });
      ro.observe(container);
    }

    init();

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
      timers.forEach(clearTimeout);
      ro?.disconnect();
      if (map) {
        map.remove();
        mapRef.current = null;
        circleRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    radiusRef.current = radiusMiles;
    if (!circleRef.current || !mapRef.current) return;
    circleRef.current.setRadius(radiusMiles * MILES_TO_M);
    mapRef.current.fitBounds(circleRef.current.getBounds(), { padding: [24, 24] });
  }, [radiusMiles]);

  return (
    <div className="space-y-2">
      <div
        className="relative border border-border rounded-md"
        style={{ height: 260, overflow: "hidden" }}
      >
        <div
          ref={containerRef}
          style={{ width: "100%", height: "100%" }}
          data-testid="radius-map"
        />
      </div>
      <p className="text-xs text-muted-foreground">
        Shaded area = your {radiusMiles}-mile service radius from your business address.
      </p>
    </div>
  );
}
