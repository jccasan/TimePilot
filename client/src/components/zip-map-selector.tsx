import { useEffect, useRef, useState } from "react";
import L from "leaflet";

const TIGER_URL =
  "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/PUMA_TAD_TAZ_UGA_ZCTA/MapServer/1/query";

const COLOR_UNSEL = "#4b9e5f";
const COLOR_SEL   = "#16a34a";
const COLOR_HOVER = "#bbf7d0";
const MILES_TO_M  = 1609.34;
const DEFAULT_ZOOM = 11;   // ~15-mile view

function isZip(s: string) { return /^\d{5}$/.test(s); }

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
    attribution: "© <a href='https://www.openstreetmap.org/copyright'>OpenStreetMap</a> contributors",
  }).addTo(map);
}

function invalidate(map: L.Map) {
  // Run after paint so the container has its final dimensions
  requestAnimationFrame(() => {
    requestAnimationFrame(() => { map.invalidateSize(); });
  });
}

async function fetchZipsInViewport(w: number, s: number, e: number, n: number): Promise<string[]> {
  const p = new URLSearchParams({
    geometry: `${w},${s},${e},${n}`,
    geometryType: "esriGeometryEnvelope",
    spatialRel: "esriSpatialRelIntersects",
    outFields: "ZCTA5",
    outSR: "4326",
    f: "json",
    resultRecordCount: "150",
  });
  try {
    const r = await fetch(`${TIGER_URL}?${p}`);
    const d = await r.json();
    return (d.features ?? []).map((f: any) => f.attributes?.ZCTA5 as string).filter(isZip);
  } catch { return []; }
}

async function fetchZipPolygons(zips: string[]): Promise<GeoJSON.FeatureCollection> {
  if (!zips.length) return { type: "FeatureCollection", features: [] };
  const where = "ZCTA5 IN (" + zips.map(z => `'${z}'`).join(",") + ")";
  const p = new URLSearchParams({
    where, outFields: "ZCTA5", outSR: "4326", f: "geojson",
    simplifyFactor: "0.002", resultRecordCount: "150",
  });
  try {
    const r = await fetch(`${TIGER_URL}?${p}`);
    return await r.json();
  } catch { return { type: "FeatureCollection", features: [] }; }
}

// ─── ZIP Map ──────────────────────────────────────────────────────────────────

type ZipMapProps = {
  value: string;
  onChange: (zips: string) => void;
  addressHint?: string | null;
};

export function ZipMapSelector({ value, onChange, addressHint }: ZipMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef       = useRef<L.Map | null>(null);
  const layersRef    = useRef<Map<string, L.GeoJSON>>(new Map());
  const selectedRef  = useRef<Set<string>>(new Set());
  const loadingRef   = useRef(false);

  // Only keep valid 5-digit ZIP codes from the stored value
  const [selectedZips, setSelectedZips] = useState<string[]>(() => {
    const initial = value
      ? value.split(",").map(z => z.trim()).filter(isZip)
      : [];
    selectedRef.current = new Set(initial);
    return initial;
  });
  const [loading, setLoading] = useState(false);

  function syncSelected(next: Set<string>) {
    selectedRef.current = next;
    const arr = Array.from(next).sort();
    setSelectedZips(arr);
    onChange(arr.join(","));
  }

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    // Start without a view — we'll set it after geocoding
    const map = L.map(containerRef.current, { zoomControl: true });
    mapRef.current = map;
    addOsmLayer(map);

    async function loadZips() {
      if (loadingRef.current || map.getZoom() < 8) return;
      loadingRef.current = true;
      setLoading(true);
      try {
        const b = map.getBounds();
        const all = await fetchZipsInViewport(b.getWest(), b.getSouth(), b.getEast(), b.getNorth());
        const fresh = all.filter(z => !layersRef.current.has(z));
        if (!fresh.length) return;
        for (let i = 0; i < fresh.length; i += 50) {
          const geo = await fetchZipPolygons(fresh.slice(i, i + 50));
          geo.features.forEach(feat => {
            const zip = (feat.properties as any)?.ZCTA5 as string;
            if (!zip || !isZip(zip) || layersRef.current.has(zip)) return;
            const isSel = selectedRef.current.has(zip);
            const layer = L.geoJSON(feat as any, {
              style: {
                color: "#15803d", weight: 1.5,
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
            // ZIP label at polygon centroid
            const ring =
              feat.geometry.type === "Polygon" ? feat.geometry.coordinates[0] :
              feat.geometry.type === "MultiPolygon" ? feat.geometry.coordinates[0][0] : null;
            if (ring?.length) {
              const xs = (ring as number[][]).map(c => c[0]);
              const ys = (ring as number[][]).map(c => c[1]);
              const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
              const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
              L.marker([cy, cx], {
                icon: L.divIcon({
                  className: "",
                  html: `<span style="font-size:10px;font-weight:700;color:#14532d;text-shadow:0 0 3px #fff,0 0 3px #fff,0 0 3px #fff">${zip}</span>`,
                  iconSize: [40, 14],
                  iconAnchor: [20, 7],
                }),
                interactive: false,
              }).addTo(map);
            }
            layer.addTo(map);
            layersRef.current.set(zip, layer);
          });
        }
      } finally {
        loadingRef.current = false;
        setLoading(false);
      }
    }

    map.on("moveend zoomend", loadZips);

    (async () => {
      // Geocode address to center the map at the saved business location
      let pos: L.LatLngExpression = [38.5, -97]; // US fallback
      if (addressHint) {
        const geocoded = await geocodeAddress(addressHint);
        if (geocoded) pos = geocoded;
      }
      if (mapRef.current) {
        map.setView(pos, DEFAULT_ZOOM);
        invalidate(map);
        // Load ZIPs for the initial view automatically
        setTimeout(loadZips, 300);
      }
    })();

    return () => {
      map.remove();
      mapRef.current = null;
      layersRef.current.clear();
    };
  }, []);

  // Recolour layers when selection changes externally
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
      {/* overflow:clip clips visually but does NOT create a scroll container
          that breaks Leaflet's tile-position calculations */}
      <div
        className="relative rounded-md border border-border"
        style={{ height: 340, overflow: "clip" }}
      >
        <div ref={containerRef} style={{ height: "100%", width: "100%" }} data-testid="zip-map" />
        {loading && (
          <div className="absolute top-2 right-2 z-[1000] bg-white/90 text-xs text-muted-foreground px-2 py-1 rounded shadow">
            Loading ZIPs…
          </div>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        Click ZIP code areas to select your service territory. Zoom in for more detail.
      </p>
      {selectedZips.length > 0 ? (
        <div className="flex items-center justify-between gap-2 bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-900 rounded-md px-3 py-2">
          <div className="text-sm">
            <span className="font-semibold text-green-800 dark:text-green-300">
              {selectedZips.length} ZIP{selectedZips.length !== 1 ? "s" : ""} selected:
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
        <div className="text-xs text-muted-foreground italic">No ZIP codes selected yet</div>
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
  const mapRef       = useRef<L.Map | null>(null);
  const circleRef    = useRef<L.Circle | null>(null);
  const centerRef    = useRef<L.LatLngExpression>([38.5, -97]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, { zoomControl: true, scrollWheelZoom: false });
    mapRef.current = map;
    addOsmLayer(map);

    (async () => {
      if (addressHint) {
        const pos = await geocodeAddress(addressHint);
        if (pos) centerRef.current = pos;
      }
      if (!mapRef.current) return;
      const circle = L.circle(centerRef.current, {
        radius: radiusMiles * MILES_TO_M,
        color: "#15803d",
        fillColor: "#16a34a",
        fillOpacity: 0.2,
        weight: 2,
      }).addTo(map);
      circleRef.current = circle;
      map.fitBounds(circle.getBounds(), { padding: [24, 24] });
      invalidate(map);
    })();

    return () => {
      map.remove();
      mapRef.current = null;
      circleRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!circleRef.current || !mapRef.current) return;
    circleRef.current.setRadius(radiusMiles * MILES_TO_M);
    mapRef.current.fitBounds(circleRef.current.getBounds(), { padding: [24, 24] });
  }, [radiusMiles]);

  return (
    <div className="space-y-2">
      <div
        className="rounded-md border border-border"
        style={{ height: 260, overflow: "clip" }}
      >
        <div ref={containerRef} style={{ height: "100%", width: "100%" }} data-testid="radius-map" />
      </div>
      <p className="text-xs text-muted-foreground">
        Shaded area = your {radiusMiles}-mile service radius from your business address.
      </p>
    </div>
  );
}
