import { useEffect, useRef, useState } from "react";
import "leaflet/dist/leaflet.css";

const TIGER_URL =
  "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/PUMA_TAD_TAZ_UGA_ZCTA/MapServer/1/query";

const COLOR_DEFAULT = "#4b9e5f";
const COLOR_SELECTED = "#16a34a";
const COLOR_HOVER = "#bbf7d0";

async function geocodeAddress(address: string): Promise<{ lat: number; lon: number } | null> {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(address)}`,
      { headers: { "Accept-Language": "en" } }
    );
    const data = await res.json();
    if (data?.[0]) return { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon) };
  } catch {}
  return null;
}

async function fetchZipPolygons(zips: string[]): Promise<GeoJSON.FeatureCollection> {
  if (!zips.length) return { type: "FeatureCollection", features: [] };
  const where = "ZCTA5 IN (" + zips.map((z) => `'${z}'`).join(",") + ")";
  const params = new URLSearchParams({
    where,
    outFields: "ZCTA5",
    outSR: "4326",
    f: "geojson",
    simplifyFactor: "0.002",
    resultRecordCount: "150",
  });
  try {
    const res = await fetch(`${TIGER_URL}?${params}`);
    return await res.json();
  } catch {
    return { type: "FeatureCollection", features: [] };
  }
}

async function fetchZipsInViewport(
  west: number, south: number, east: number, north: number
): Promise<string[]> {
  const params = new URLSearchParams({
    geometry: `${west},${south},${east},${north}`,
    geometryType: "esriGeometryEnvelope",
    spatialRel: "esriSpatialRelIntersects",
    outFields: "ZCTA5",
    outSR: "4326",
    f: "json",
    resultRecordCount: "150",
  });
  try {
    const res = await fetch(`${TIGER_URL}?${params}`);
    const data = await res.json();
    return (data.features ?? [])
      .map((f: any) => f.attributes?.ZCTA5 as string)
      .filter(Boolean);
  } catch {
    return [];
  }
}

function addTileLayer(L: typeof import("leaflet"), map: import("leaflet").Map) {
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "© OpenStreetMap contributors",
  }).addTo(map);
}

// ── ZIP code map ─────────────────────────────────────────────────────────────

type ZipMapProps = {
  value: string;
  onChange: (zips: string) => void;
  addressHint?: string | null;
};

export function ZipMapSelector({ value, onChange, addressHint }: ZipMapProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const leafletMap = useRef<import("leaflet").Map | null>(null);
  const polygonLayersRef = useRef<Map<string, import("leaflet").GeoJSON>>(new Map());
  const selectedRef = useRef<Set<string>>(new Set());
  const loadingRef = useRef(false);
  const [selectedZips, setSelectedZips] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  function syncSelected(zips: Set<string>) {
    selectedRef.current = zips;
    const arr = Array.from(zips).sort();
    setSelectedZips(arr);
    onChange(arr.join(","));
  }

  useEffect(() => {
    const initial = value
      ? value.split(",").map((z) => z.trim()).filter(Boolean)
      : [];
    selectedRef.current = new Set(initial);
    setSelectedZips(initial);
  }, []);

  useEffect(() => {
    if (!mapRef.current || leafletMap.current) return;
    let cancelled = false;

    import("leaflet").then((L) => {
      if (cancelled || !mapRef.current) return;

      const map = L.map(mapRef.current, { zoomControl: true }).setView([38.5, -97], 5);
      leafletMap.current = map;
      addTileLayer(L, map);

      // Fix tile rendering after layout settles
      setTimeout(() => map.invalidateSize(), 100);

      async function loadZips() {
        if (loadingRef.current || map.getZoom() < 8) return;
        loadingRef.current = true;
        setLoading(true);
        try {
          const b = map.getBounds();
          const zips = await fetchZipsInViewport(
            b.getWest(), b.getSouth(), b.getEast(), b.getNorth()
          );
          const newZips = zips.filter((z) => !polygonLayersRef.current.has(z));
          if (!newZips.length) return;

          for (let i = 0; i < newZips.length; i += 50) {
            const batch = newZips.slice(i, i + 50);
            const geo = await fetchZipPolygons(batch);
            geo.features.forEach((feat) => {
              const zip = (feat.properties as any)?.ZCTA5 as string;
              if (!zip || polygonLayersRef.current.has(zip)) return;

              const isSel = selectedRef.current.has(zip);
              const layer = L.geoJSON(feat as any, {
                style: {
                  color: "#15803d",
                  weight: 1.5,
                  fillColor: isSel ? COLOR_SELECTED : COLOR_DEFAULT,
                  fillOpacity: isSel ? 0.45 : 0.12,
                },
              });

              layer.on("mouseover", () => {
                if (!selectedRef.current.has(zip))
                  layer.setStyle({ fillColor: COLOR_HOVER, fillOpacity: 0.35 });
              });
              layer.on("mouseout", () => {
                if (!selectedRef.current.has(zip))
                  layer.setStyle({ fillColor: COLOR_DEFAULT, fillOpacity: 0.12 });
              });
              layer.on("click", () => {
                const next = new Set(selectedRef.current);
                if (next.has(zip)) {
                  next.delete(zip);
                  layer.setStyle({ fillColor: COLOR_DEFAULT, fillOpacity: 0.12 });
                } else {
                  next.add(zip);
                  layer.setStyle({ fillColor: COLOR_SELECTED, fillOpacity: 0.45 });
                }
                syncSelected(next);
              });

              // Label at centroid
              const coords =
                feat.geometry.type === "Polygon"
                  ? feat.geometry.coordinates[0]
                  : feat.geometry.type === "MultiPolygon"
                  ? feat.geometry.coordinates[0][0]
                  : null;
              if (coords?.length) {
                const lats = (coords as number[][]).map((c) => c[1]);
                const lons = (coords as number[][]).map((c) => c[0]);
                const clat = (Math.min(...lats) + Math.max(...lats)) / 2;
                const clon = (Math.min(...lons) + Math.max(...lons)) / 2;
                L.marker([clat, clon], {
                  icon: L.divIcon({
                    className: "",
                    html: `<span style="font-size:10px;font-weight:600;color:#14532d;text-shadow:0 0 2px #fff,0 0 2px #fff">${zip}</span>`,
                    iconSize: [40, 14],
                    iconAnchor: [20, 7],
                  }),
                  interactive: false,
                }).addTo(map);
              }

              layer.addTo(map);
              polygonLayersRef.current.set(zip, layer);
            });
          }
        } finally {
          loadingRef.current = false;
          setLoading(false);
        }
      }

      map.on("moveend", loadZips);
      map.on("zoomend", loadZips);

      (async () => {
        if (addressHint) {
          const pos = await geocodeAddress(addressHint);
          if (pos && !cancelled) {
            map.setView([pos.lat, pos.lon], 11);
            setTimeout(() => map.invalidateSize(), 100);
          }
        }
        if (!cancelled) loadZips();
      })();
    });

    return () => {
      cancelled = true;
      leafletMap.current?.remove();
      leafletMap.current = null;
      polygonLayersRef.current.clear();
    };
  }, []);

  // Sync polygon colours when selection changes externally
  useEffect(() => {
    polygonLayersRef.current.forEach((layer, zip) => {
      if (selectedRef.current.has(zip)) {
        layer.setStyle({ fillColor: COLOR_SELECTED, fillOpacity: 0.45 });
      } else {
        layer.setStyle({ fillColor: COLOR_DEFAULT, fillOpacity: 0.12 });
      }
    });
  }, [selectedZips]);

  return (
    <div className="space-y-2">
      <div className="relative rounded-md overflow-hidden border border-border" style={{ height: 340 }}>
        <div ref={mapRef} style={{ height: "100%", width: "100%" }} data-testid="zip-map" />
        {loading && (
          <div className="absolute top-2 right-2 z-[1000] bg-white/90 text-xs text-muted-foreground px-2 py-1 rounded shadow">
            Loading ZIPs…
          </div>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        Zoom in (level 8+) and click ZIP code areas to select your service territory.
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

// ── Radius map ────────────────────────────────────────────────────────────────

type RadiusMapProps = {
  radiusMiles: number;
  addressHint?: string | null;
};

const MILES_TO_METERS = 1609.34;

export function RadiusMapSelector({ radiusMiles, addressHint }: RadiusMapProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const leafletMap = useRef<import("leaflet").Map | null>(null);
  const circleRef = useRef<import("leaflet").Circle | null>(null);
  const centerRef = useRef<[number, number]>([38.5, -97]);

  useEffect(() => {
    if (!mapRef.current || leafletMap.current) return;
    let cancelled = false;

    import("leaflet").then((L) => {
      if (cancelled || !mapRef.current) return;

      const map = L.map(mapRef.current, { zoomControl: true, scrollWheelZoom: false })
        .setView(centerRef.current, 9);
      leafletMap.current = map;
      addTileLayer(L, map);
      setTimeout(() => map.invalidateSize(), 100);

      const circle = L.circle(centerRef.current, {
        radius: radiusMiles * MILES_TO_METERS,
        color: "#15803d",
        fillColor: "#16a34a",
        fillOpacity: 0.18,
        weight: 2,
      }).addTo(map);
      circleRef.current = circle;

      // Fit map to circle
      map.fitBounds(circle.getBounds(), { padding: [20, 20] });

      (async () => {
        if (addressHint) {
          const pos = await geocodeAddress(addressHint);
          if (pos && !cancelled) {
            const latlng: [number, number] = [pos.lat, pos.lon];
            centerRef.current = latlng;
            circle.setLatLng(latlng);
            map.fitBounds(circle.getBounds(), { padding: [20, 20] });
            setTimeout(() => map.invalidateSize(), 100);
          }
        }
      })();
    });

    return () => {
      cancelled = true;
      leafletMap.current?.remove();
      leafletMap.current = null;
      circleRef.current = null;
    };
  }, []);

  // Update circle radius when slider changes
  useEffect(() => {
    if (!circleRef.current || !leafletMap.current) return;
    const r = radiusMiles * MILES_TO_METERS;
    circleRef.current.setRadius(r);
    leafletMap.current.fitBounds(circleRef.current.getBounds(), { padding: [20, 20] });
  }, [radiusMiles]);

  return (
    <div className="space-y-2">
      <div className="rounded-md overflow-hidden border border-border" style={{ height: 280 }}>
        <div ref={mapRef} style={{ height: "100%", width: "100%" }} data-testid="radius-map" />
      </div>
      <p className="text-xs text-muted-foreground">
        The shaded area shows your {radiusMiles}-mile service radius from your business address.
      </p>
    </div>
  );
}
