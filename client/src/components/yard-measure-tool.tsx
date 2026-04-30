import { useState, useRef, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Undo2, Trash2, Save, MousePointerClick, ZoomIn, ZoomOut } from "lucide-react";

interface YardMeasureToolProps {
  lat: number;
  lng: number;
  propertyId?: string;
  existingPolygon?: number[][] | null;
  existingArea?: number | null;
  onSave: (polygon: number[][], areaSqft: number) => void;
  onCancel?: () => void;
}

function calculatePolygonArea(coords: number[][]): number {
  if (coords.length < 3) return 0;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const R = 6371000;
  let area = 0;
  for (let i = 0; i < coords.length; i++) {
    const j = (i + 1) % coords.length;
    const lat1 = toRad(coords[i][1]);
    const lat2 = toRad(coords[j][1]);
    const dLng = toRad(coords[j][0] - coords[i][0]);
    area += dLng * (2 + Math.sin(lat1) + Math.sin(lat2));
  }
  area = Math.abs((area * R * R) / 2);
  return Math.round(area * 10.7639);
}

function getYardCategory(sqft: number): { label: string; color: string } {
  if (sqft < 6500) return { label: "Small", color: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200" };
  if (sqft <= 10890) return { label: "Standard", color: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200" };
  if (sqft <= 21780) return { label: "Large", color: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200" };
  return { label: "Extra Large", color: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200" };
}

function formatArea(sqft: number): string {
  const acres = sqft / 43560;
  if (acres >= 1) {
    return `${sqft.toLocaleString()} sq ft / ${acres.toFixed(2)} acres`;
  }
  return `${sqft.toLocaleString()} sq ft / ${acres.toFixed(3)} acres`;
}

export { getYardCategory, formatArea };

const IMG_W = 640;
const IMG_H = 400;

function lngLatToPixel(lngLat: number[], centerLng: number, centerLat: number, zoom: number, imgW: number, imgH: number): { x: number; y: number } {
  const scale = Math.pow(2, zoom) * 256;
  const toMerc = (lng: number, lat: number) => {
    const x = ((lng + 180) / 360) * scale;
    const latRad = (lat * Math.PI) / 180;
    const y = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * scale;
    return { x, y };
  };
  const center = toMerc(centerLng, centerLat);
  const point = toMerc(lngLat[0], lngLat[1]);
  return {
    x: imgW / 2 + (point.x - center.x),
    y: imgH / 2 + (point.y - center.y),
  };
}

function pixelToLngLat(px: number, py: number, centerLng: number, centerLat: number, zoom: number, imgW: number, imgH: number): number[] {
  const scale = Math.pow(2, zoom) * 256;
  const toMerc = (lng: number, lat: number) => {
    const x = ((lng + 180) / 360) * scale;
    const latRad = (lat * Math.PI) / 180;
    const y = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * scale;
    return { x, y };
  };
  const center = toMerc(centerLng, centerLat);
  const worldX = center.x + (px - imgW / 2);
  const worldY = center.y + (py - imgH / 2);
  const lng = (worldX / scale) * 360 - 180;
  const latRad = Math.atan(Math.sinh(Math.PI * (1 - (2 * worldY) / scale)));
  const lat = (latRad * 180) / Math.PI;
  return [lng, lat];
}

function StaticMapMeasure({ lat, lng, existingPolygon, onSave, onCancel }: {
  lat: number;
  lng: number;
  existingPolygon?: number[][] | null;
  onSave: (polygon: number[][], areaSqft: number) => void;
  onCancel?: () => void;
}) {
  const [zoom, setZoom] = useState(19);
  const [points, setPoints] = useState<number[][]>(existingPolygon || []);
  const [closed, setClosed] = useState(!!existingPolygon && existingPolygon.length >= 3);
  const [imgError, setImgError] = useState(false);
  const [imgLoading, setImgLoading] = useState(true);
  const [imgBlobUrl, setImgBlobUrl] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerSize, setContainerSize] = useState({ w: IMG_W, h: IMG_H });

  useEffect(() => {
    if (!containerRef.current) return;
    const obs = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        setContainerSize({ w: entry.contentRect.width, h: entry.contentRect.height });
      }
    });
    obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, []);

  const imgW = Math.min(Math.round(containerSize.w), 1280);
  const imgH = Math.min(Math.round(containerSize.h), 1280);

  useEffect(() => {
    if (imgW <= 0 || imgH <= 0) return;
    let cancelled = false;
    setImgLoading(true);
    setImgError(false);

    const headers: Record<string, string> = {};
    const token = localStorage.getItem("sessionToken");
    if (token) headers["Authorization"] = `Bearer ${token}`;

    fetch(`/api/mapbox-static-image?lat=${lat}&lng=${lng}&zoom=${zoom}&w=${imgW}&h=${imgH}`, {
      credentials: "include",
      headers,
    })
      .then((r) => {
        if (!r.ok) throw new Error("Failed");
        return r.blob();
      })
      .then((blob) => {
        if (cancelled) return;
        const url = URL.createObjectURL(blob);
        setImgBlobUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return url; });
        setImgLoading(false);
      })
      .catch(() => {
        if (!cancelled) { setImgLoading(false); setImgError(true); }
      });

    return () => { cancelled = true; };
  }, [lat, lng, zoom, imgW, imgH]);

  const areaSqft = points.length >= 3 ? calculatePolygonArea(points) : 0;
  const category = areaSqft > 0 ? getYardCategory(areaSqft) : null;

  const handleClick = (e: React.MouseEvent<SVGSVGElement>) => {
    if (closed) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const coord = pixelToLngLat(px, py, lng, lat, zoom, imgW, imgH);
    setPoints((prev) => [...prev, coord]);
  };

  const handleClose = () => {
    if (points.length < 3) return;
    setClosed(true);
  };

  const handleUndo = () => {
    if (points.length === 0) return;
    setPoints((prev) => prev.slice(0, -1));
    setClosed(false);
  };

  const handleClear = () => {
    setPoints([]);
    setClosed(false);
  };

  const handleSave = () => {
    if (points.length >= 3 && areaSqft > 0) {
      onSave(points, areaSqft);
    }
  };

  const pixelPoints = points.map((p) => lngLatToPixel(p, lng, lat, zoom, imgW, imgH));
  const polyPoints = closed && pixelPoints.length >= 3 ? [...pixelPoints, pixelPoints[0]] : [];

  return (
    <div className="space-y-3" data-testid="yard-measure-tool">
      <div
        ref={containerRef}
        className="w-full h-[350px] rounded-md border overflow-hidden relative select-none"
        data-testid="yard-measure-map"
      >
        {imgLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-muted">
            <p className="text-sm text-muted-foreground">Loading satellite view...</p>
          </div>
        )}
        {imgError && (
          <div className="absolute inset-0 flex items-center justify-center bg-muted">
            <p className="text-sm text-muted-foreground">Satellite view unavailable</p>
          </div>
        )}
        {imgBlobUrl && (
          <img
            src={imgBlobUrl}
            alt="Satellite view"
            className={`absolute inset-0 w-full h-full object-cover transition-opacity ${imgLoading || imgError ? "opacity-0" : "opacity-100"}`}
            draggable={false}
          />
        )}
        <svg
          className="absolute inset-0 w-full h-full"
          style={{ cursor: closed ? "default" : "crosshair" }}
          onClick={handleClick}
          data-testid="svg-measure-overlay"
        >
          {polyPoints.length > 0 && (
            <polygon
              points={polyPoints.map((p) => `${p.x},${p.y}`).join(" ")}
              fill="rgba(34,197,94,0.25)"
              stroke="#22c55e"
              strokeWidth="2"
            />
          )}
          {!closed && pixelPoints.length >= 2 && (
            <polyline
              points={pixelPoints.map((p) => `${p.x},${p.y}`).join(" ")}
              fill="none"
              stroke="#ffffff"
              strokeWidth="2"
              strokeDasharray="6 4"
            />
          )}
          {pixelPoints.map((p, i) => (
            <circle
              key={i}
              cx={p.x}
              cy={p.y}
              r={5}
              fill="white"
              stroke="#22c55e"
              strokeWidth="2"
            />
          ))}
        </svg>
        <div className="absolute top-2 right-2 flex flex-col gap-1 z-10">
          <Button
            size="icon"
            variant="secondary"
            className="h-7 w-7"
            onClick={(e) => { e.stopPropagation(); setZoom((z) => Math.min(z + 1, 22)); }}
            data-testid="button-zoom-in"
          >
            <ZoomIn className="h-4 w-4" />
          </Button>
          <Button
            size="icon"
            variant="secondary"
            className="h-7 w-7"
            onClick={(e) => { e.stopPropagation(); setZoom((z) => Math.max(z - 1, 15)); }}
            data-testid="button-zoom-out"
          >
            <ZoomOut className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          {areaSqft > 0 ? (
            <>
              <span className="text-sm font-medium" data-testid="text-yard-area">{formatArea(areaSqft)}</span>
              {category && (
                <Badge className={`text-xs ${category.color}`} data-testid="badge-yard-category">
                  {category.label}
                </Badge>
              )}
            </>
          ) : (
            <span className="text-sm text-muted-foreground flex items-center gap-1">
              <MousePointerClick className="h-4 w-4" />
              Click on the map to draw yard boundary
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <span className="text-xs text-muted-foreground mr-1">{points.length} points</span>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        {!closed && points.length >= 3 && (
          <Button size="sm" onClick={handleClose} data-testid="button-close-shape">
            Close Shape
          </Button>
        )}
        <Button size="sm" variant="outline" onClick={handleUndo} disabled={points.length === 0} data-testid="button-undo-point">
          <Undo2 className="h-3.5 w-3.5 mr-1" />
          Undo
        </Button>
        <Button size="sm" variant="outline" onClick={handleClear} disabled={points.length === 0} data-testid="button-clear-points">
          <Trash2 className="h-3.5 w-3.5 mr-1" />
          Clear
        </Button>
        {closed && areaSqft > 0 && (
          <Button size="sm" onClick={handleSave} data-testid="button-save-measurement">
            <Save className="h-3.5 w-3.5 mr-1" />
            Save Measurement
          </Button>
        )}
        {onCancel && (
          <Button size="sm" variant="ghost" onClick={onCancel} data-testid="button-cancel-measure">
            Cancel
          </Button>
        )}
      </div>
    </div>
  );
}

export function YardMeasureTool({ lat, lng, propertyId: _propertyId, existingPolygon, existingArea: _existingArea, onSave, onCancel }: YardMeasureToolProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const markersRef = useRef<any[]>([]);
  const polygonLayerAdded = useRef(false);
  const [points, setPoints] = useState<number[][]>(existingPolygon || []);
  const [closed, setClosed] = useState(!!existingPolygon && existingPolygon.length >= 3);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [mapError, setMapError] = useState(false);
  const [mapboxToken, setMapboxToken] = useState<string | null>(null);
  const [tokenLoaded, setTokenLoaded] = useState(false);

  useEffect(() => {
    const headers: Record<string, string> = {};
    const token = localStorage.getItem("sessionToken");
    if (token) headers["Authorization"] = `Bearer ${token}`;
    fetch("/api/mapbox-token", { credentials: "include", headers })
      .then((r) => r.json())
      .then((d) => {
        if (d.token) {
          setMapboxToken(d.token);
        } else {
          setMapError(true);
        }
        setTokenLoaded(true);
      })
      .catch(() => {
        setMapError(true);
        setTokenLoaded(true);
      });
  }, []);

  const areaSqft = points.length >= 3 ? calculatePolygonArea(points) : 0;

  const updateMapLayers = useCallback((map: any, pts: number[][], isClosed: boolean) => {
    if (!map) return;

    const lineCoords = isClosed && pts.length >= 3 ? [...pts, pts[0]] : pts;
    const polyCoords = isClosed && pts.length >= 3 ? [[...pts, pts[0]]] : [];

    if (map.getSource("measure-line")) {
      map.getSource("measure-line").setData({
        type: "Feature",
        geometry: { type: "LineString", coordinates: lineCoords.length >= 2 ? lineCoords : [[0, 0], [0, 0]] },
        properties: {},
      });
    }

    if (map.getSource("measure-polygon")) {
      map.getSource("measure-polygon").setData({
        type: "Feature",
        geometry: { type: "Polygon", coordinates: polyCoords.length > 0 ? polyCoords : [[[0, 0], [0, 0], [0, 0], [0, 0]]] },
        properties: {},
      });
    }
  }, []);

  useEffect(() => {
    if (!mapboxToken || !mapContainerRef.current || mapRef.current || mapError) return;

    const initMap = async () => {
      try {
      const mapboxgl = (await import("mapbox-gl")).default;
      await import("mapbox-gl/dist/mapbox-gl.css");
      (mapboxgl as any).accessToken = mapboxToken;

      if (!mapboxgl.supported()) {
        setMapError(true);
        return;
      }

      const map = new mapboxgl.Map({
        container: mapContainerRef.current!,
        style: "mapbox://styles/mapbox/satellite-streets-v12",
        center: [lng, lat],
        zoom: 19,
        attributionControl: false,
      });

      map.on("error", (e: any) => {
        console.warn("Mapbox error:", e);
      });

      map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "top-right");
      mapRef.current = map;

      map.on("load", () => {
        map.addSource("measure-polygon", {
          type: "geojson",
          data: { type: "Feature", geometry: { type: "Polygon", coordinates: [[[0, 0], [0, 0], [0, 0], [0, 0]]] }, properties: {} },
        });
        map.addLayer({
          id: "measure-polygon-fill",
          type: "fill",
          source: "measure-polygon",
          paint: { "fill-color": "#22c55e", "fill-opacity": 0.25 },
        });
        map.addLayer({
          id: "measure-polygon-outline",
          type: "line",
          source: "measure-polygon",
          paint: { "line-color": "#22c55e", "line-width": 2 },
        });

        map.addSource("measure-line", {
          type: "geojson",
          data: { type: "Feature", geometry: { type: "LineString", coordinates: [[0, 0], [0, 0]] }, properties: {} },
        });
        map.addLayer({
          id: "measure-line-layer",
          type: "line",
          source: "measure-line",
          paint: { "line-color": "#ffffff", "line-width": 2, "line-dasharray": [2, 2] },
        });

        polygonLayerAdded.current = true;
        setMapLoaded(true);

        if (existingPolygon && existingPolygon.length >= 3) {
          const mapboxgl2 = mapboxgl;
          existingPolygon.forEach((coord) => {
            const el = document.createElement("div");
            el.className = "w-3 h-3 bg-white border-2 border-green-500 rounded-full shadow-md";
            const marker = new mapboxgl2.Marker({ element: el }).setLngLat(coord as [number, number]).addTo(map);
            markersRef.current.push(marker);
          });
          updateMapLayers(map, existingPolygon, true);
        }
      });
      } catch (err) {
        console.warn("Failed to initialize map:", err);
        setMapError(true);
      }
    };

    initMap();

    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
      markersRef.current = [];
      polygonLayerAdded.current = false;
    };
  }, [mapboxToken, lat, lng, existingPolygon, updateMapLayers, mapError]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

    const handleClick = (e: any) => {
      if (closed) return;
      const coord = [e.lngLat.lng, e.lngLat.lat];

      setPoints((prev) => {
        const updated = [...prev, coord];
        const mapboxgl = (window as any).mapboxgl || null;
        if (mapboxgl) {
          const el = document.createElement("div");
          el.className = "w-3 h-3 bg-white border-2 border-green-500 rounded-full shadow-md cursor-pointer";
          const marker = new mapboxgl.Marker({ element: el }).setLngLat(coord as [number, number]).addTo(map);
          markersRef.current.push(marker);
        } else {
          import("mapbox-gl").then((mod) => {
            const el = document.createElement("div");
            el.className = "w-3 h-3 bg-white border-2 border-green-500 rounded-full shadow-md cursor-pointer";
            const marker = new mod.default.Marker({ element: el }).setLngLat(coord as [number, number]).addTo(map);
            markersRef.current.push(marker);
          });
        }

        updateMapLayers(map, updated, false);
        return updated;
      });
    };

    map.on("click", handleClick);
    map.getCanvas().style.cursor = closed ? "default" : "crosshair";

    return () => {
      map.off("click", handleClick);
    };
  }, [mapLoaded, closed, updateMapLayers]);

  const handleClose = () => {
    if (points.length < 3) return;
    setClosed(true);
    updateMapLayers(mapRef.current, points, true);
  };

  const handleUndo = () => {
    if (points.length === 0) return;
    const lastMarker = markersRef.current.pop();
    if (lastMarker) lastMarker.remove();
    const updated = points.slice(0, -1);
    setPoints(updated);
    setClosed(false);
    updateMapLayers(mapRef.current, updated, false);
  };

  const handleClear = () => {
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];
    setPoints([]);
    setClosed(false);
    updateMapLayers(mapRef.current, [], false);
  };

  const handleSave = () => {
    if (points.length >= 3 && areaSqft > 0) {
      onSave(points, areaSqft);
    }
  };

  const category = areaSqft > 0 ? getYardCategory(areaSqft) : null;

  if (mapError) {
    return (
      <StaticMapMeasure
        lat={lat}
        lng={lng}
        existingPolygon={existingPolygon}
        onSave={onSave}
        onCancel={onCancel}
      />
    );
  }

  if (!tokenLoaded) {
    return (
      <div className="space-y-3" data-testid="yard-measure-tool">
        <div className="w-full h-[350px] rounded-md border flex items-center justify-center bg-muted" data-testid="yard-measure-map">
          <div className="text-center text-muted-foreground">
            <p className="text-sm">Loading map...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3" data-testid="yard-measure-tool">
      <div
        ref={mapContainerRef}
        className="w-full h-[350px] rounded-md border overflow-hidden"
        data-testid="yard-measure-map"
      />

      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          {areaSqft > 0 ? (
            <>
              <span className="text-sm font-medium" data-testid="text-yard-area">{formatArea(areaSqft)}</span>
              {category && (
                <Badge className={`text-xs ${category.color}`} data-testid="badge-yard-category">
                  {category.label}
                </Badge>
              )}
            </>
          ) : (
            <span className="text-sm text-muted-foreground flex items-center gap-1">
              <MousePointerClick className="h-4 w-4" />
              Click on the map to draw yard boundary
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <span className="text-xs text-muted-foreground mr-1">{points.length} points</span>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        {!closed && points.length >= 3 && (
          <Button size="sm" onClick={handleClose} data-testid="button-close-shape">
            Close Shape
          </Button>
        )}
        <Button size="sm" variant="outline" onClick={handleUndo} disabled={points.length === 0} data-testid="button-undo-point">
          <Undo2 className="h-3.5 w-3.5 mr-1" />
          Undo
        </Button>
        <Button size="sm" variant="outline" onClick={handleClear} disabled={points.length === 0} data-testid="button-clear-points">
          <Trash2 className="h-3.5 w-3.5 mr-1" />
          Clear
        </Button>
        {closed && areaSqft > 0 && (
          <Button size="sm" onClick={handleSave} data-testid="button-save-measurement">
            <Save className="h-3.5 w-3.5 mr-1" />
            Save Measurement
          </Button>
        )}
        {onCancel && (
          <Button size="sm" variant="ghost" onClick={onCancel} data-testid="button-cancel-measure">
            Cancel
          </Button>
        )}
      </div>
    </div>
  );
}
