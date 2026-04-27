import { useEffect, useRef, useState } from "react";
import L from "leaflet";

const TIGER_URL =
  "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/PUMA_TAD_TAZ_UGA_ZCTA/MapServer/1/query";

const COLOR_UNSEL = "#4b9e5f";
const COLOR_SEL   = "#16a34a";
const COLOR_HOVER = "#bbf7d0";
const MILES_TO_M  = 1609.34;
const DEFAULT_ZOOM = 11;
const FALLBACK: L.LatLngExpression = [38.5, -97];

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

/**
 * Correct call order to reposition Leaflet tiles:
 *   1. invalidateSize  → updates Leaflet's stored container dimensions
 *   2. setView         → positions tiles using the now-correct dimensions
 */
function resync(map: L.Map, pos: L.LatLngExpression, zoom: number) {
  map.invalidateSize({ animate: false });
  map.setView(pos, zoom, { animate: false });
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
    const el = containerRef.current;
    if (!el || mapRef.current) return;

    let cancelled = false;
    let map: L.Map | null = null;
    let ro: ResizeObserver | null = null;
    const timers: ReturnType<typeof setTimeout>[] = [];

    function createMap() {
      if (cancelled || mapRef.current || !el) return;

      map = L.map(el as HTMLElement, { zoomControl: true });
      mapRef.current = map;
      addOsmLayer(map);

      ro = new ResizeObserver(() => {
        if (mapRef.current) mapRef.current.invalidateSize({ animate: false });
      });
      ro.observe(el as HTMLElement);
    }

    async function loadZips() {
      if (!mapRef.current || loadingRef.current || mapRef.current.getZoom() < 8) return;
      loadingRef.current = true;
      setLoading(true);
      try {
        const b = mapRef.current.getBounds();
        const all = await fetchZipsInViewport(b.getWest(), b.getSouth(), b.getEast(), b.getNorth());
        if (cancelled) return;
        const fresh = all.filter(z => !layersRef.current.has(z));
        if (!fresh.length) return;
        for (let i = 0; i < fresh.length; i += 50) {
          if (cancelled || !mapRef.current) return;
          const geo = await fetchZipPolygons(fresh.slice(i, i + 50));
          geo.features.forEach(feat => {
            if (!mapRef.current) return;
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
        }
      } finally {
        if (!cancelled) {
          loadingRef.current = false;
          setLoading(false);
        }
      }
    }

    // Use rAF to wait until the container has non-zero clientWidth/clientHeight.
    // rAF fires after paint, guaranteeing CSS layout is complete.
    let rafId: number;
    function tryInit() {
      if (cancelled || !el) return;
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (w === 0 || h === 0) {
        // Container not sized yet — try again next frame
        rafId = requestAnimationFrame(tryInit);
        return;
      }

      // Container has correct dimensions → create map synchronously
      createMap();
      if (!map) return;

      map.on("moveend zoomend", loadZips);

      // Geocode then apply correct view.
      // Key: invalidateSize() BEFORE setView() so Leaflet knows the right dimensions.
      (async () => {
        let pos: L.LatLngExpression = FALLBACK;
        if (addressHint) {
          const geocoded = await geocodeAddress(addressHint);
          if (geocoded && !cancelled) pos = geocoded;
        }
        if (cancelled || !mapRef.current) return;

        // ① First sync — correct order: invalidate → setView
        resync(mapRef.current, pos, DEFAULT_ZOOM);

        // ② 150 ms pass — catches any layout settling after first paint
        timers.push(setTimeout(() => {
          if (cancelled || !mapRef.current) return;
          resync(mapRef.current, pos, DEFAULT_ZOOM);
        }, 150));

        // ③ 600 ms pass — safety net for slow renderers / transitions
        timers.push(setTimeout(() => {
          if (cancelled || !mapRef.current) return;
          resync(mapRef.current, pos, DEFAULT_ZOOM);
          timers.push(setTimeout(loadZips, 50));
        }, 600));
      })();
    }
    rafId = requestAnimationFrame(tryInit);

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
        <div
          ref={containerRef}
          style={{ width: "100%", height: "100%" }}
          data-testid="zip-map"
        />
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
  const centerRef    = useRef<L.LatLngExpression>(FALLBACK);
  const radiusRef    = useRef(radiusMiles);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || mapRef.current) return;

    let cancelled = false;
    let map: L.Map | null = null;
    let ro: ResizeObserver | null = null;
    const timers: ReturnType<typeof setTimeout>[] = [];
    let rafId: number;

    function tryInit() {
      if (cancelled || !el) return;
      if (el.clientWidth === 0 || el.clientHeight === 0) {
        rafId = requestAnimationFrame(tryInit);
        return;
      }

      map = L.map(el as HTMLElement, { zoomControl: true, scrollWheelZoom: false });
      mapRef.current = map;
      addOsmLayer(map);

      ro = new ResizeObserver(() => {
        if (mapRef.current) mapRef.current.invalidateSize({ animate: false });
      });
      ro.observe(el as HTMLElement);

      (async () => {
        if (addressHint) {
          const pos = await geocodeAddress(addressHint);
          if (pos && !cancelled) centerRef.current = pos;
        }
        if (cancelled || !mapRef.current) return;

        const circle = L.circle(centerRef.current, {
          radius: radiusRef.current * MILES_TO_M,
          color: "#15803d", fillColor: "#16a34a",
          fillOpacity: 0.2, weight: 2,
        }).addTo(map!);
        circleRef.current = circle;

        mapRef.current.invalidateSize({ animate: false });
        mapRef.current.fitBounds(circle.getBounds(), { padding: [24, 24] });

        timers.push(setTimeout(() => {
          if (cancelled || !mapRef.current || !circleRef.current) return;
          mapRef.current.invalidateSize({ animate: false });
          mapRef.current.fitBounds(circleRef.current.getBounds(), { padding: [24, 24] });
        }, 400));
      })();
    }
    rafId = requestAnimationFrame(tryInit);

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
      timers.forEach(clearTimeout);
      ro?.disconnect();
      if (map) { map.remove(); mapRef.current = null; circleRef.current = null; }
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
