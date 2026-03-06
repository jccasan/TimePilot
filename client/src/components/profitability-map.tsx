import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import "mapbox-gl/dist/mapbox-gl.css";

export type MapStop = {
  propertyId: string;
  contactId: string;
  contactName: string;
  propertyAddress: string;
  latitude: number;
  longitude: number;
  frequency: string;
  dogCount: number;
  yardSize: string;
  revenuePerVisitCents: number;
  costPerVisitCents: number;
  profitPerVisitCents: number;
  profitMarginPct: number;
  status: "profitable" | "marginal" | "unprofitable";
  stopOrder: number;
};

export type MapRoute = {
  routeId: string;
  routeName: string;
  dayOfWeek: string;
  color: string;
  totalStops: number;
  totalRevenueCents: number;
  totalCostCents: number;
  totalProfitCents: number;
  avgMarginPct: number;
  status: "profitable" | "marginal" | "unprofitable";
  stops: MapStop[];
};

type ProfitabilityMapProps = {
  routes: MapRoute[];
  visibleRouteIds: Set<string>;
  viewMode: "stops" | "zones";
  focusRouteId?: string | null;
  onStopClick?: (stop: MapStop) => void;
};

const STATUS_COLORS = {
  profitable: "#22c55e",
  marginal: "#eab308",
  unprofitable: "#ef4444",
};

function formatDollars(cents: number): string {
  const abs = Math.abs(cents);
  const formatted = `$${(abs / 100).toFixed(2)}`;
  return cents < 0 ? `-${formatted}` : formatted;
}

export default function ProfitabilityMap({
  routes,
  visibleRouteIds,
  viewMode,
  focusRouteId,
  onStopClick,
}: ProfitabilityMapProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const markersRef = useRef<any[]>([]);
  const [mapLoaded, setMapLoaded] = useState(false);
  const mapboxglRef = useRef<any>(null);

  const { data: tokenData, isLoading: tokenLoading } = useQuery<{ token: string }>({
    queryKey: ["/api/mapbox-token"],
  });

  useEffect(() => {
    if (!tokenData?.token || !mapContainerRef.current) return;

    let cancelled = false;

    (async () => {
      const mapboxgl = (await import("mapbox-gl")).default;
      if (cancelled) return;

      mapboxglRef.current = mapboxgl;
      mapboxgl.accessToken = tokenData.token;

      const allStops = routes.flatMap((r) => r.stops);
      const center: [number, number] =
        allStops.length > 0
          ? [allStops[0].longitude, allStops[0].latitude]
          : [-98.5795, 39.8283];

      const map = new mapboxgl.Map({
        container: mapContainerRef.current!,
        style: "mapbox://styles/mapbox/light-v11",
        center,
        zoom: allStops.length > 0 ? 11 : 4,
      });

      mapRef.current = map;

      map.on("load", () => {
        if (cancelled) return;
        setMapLoaded(true);
      });
    })();

    return () => {
      cancelled = true;
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
      setMapLoaded(false);
    };
  }, [tokenData?.token]);

  useEffect(() => {
    const map = mapRef.current;
    const mapboxgl = mapboxglRef.current;
    if (!map || !mapboxgl || !mapLoaded) return;

    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];

    const layerIds = ["heatmap-profit-layer", "heatmap-loss-layer"];
    const sourceIds = ["heatmap-profit-source", "heatmap-loss-source"];
    layerIds.forEach((id) => { if (map.getLayer(id)) map.removeLayer(id); });
    sourceIds.forEach((id) => { if (map.getSource(id)) map.removeSource(id); });

    routes.forEach((route) => {
      const lineId = `route-line-${route.routeId}`;
      if (map.getLayer(lineId)) map.removeLayer(lineId);
      if (map.getSource(lineId)) map.removeSource(lineId);
    });

    const visibleRoutes = routes.filter((r) => visibleRouteIds.has(r.routeId));
    const allVisibleStops = visibleRoutes.flatMap((r) => r.stops);

    if (viewMode === "zones") {
      const profitStops = allVisibleStops.filter(s => s.profitPerVisitCents >= 0);
      const lossStops = allVisibleStops.filter(s => s.profitPerVisitCents < 0);

      if (profitStops.length > 0) {
        map.addSource("heatmap-profit-source", {
          type: "geojson",
          data: {
            type: "FeatureCollection",
            features: profitStops.map((s) => ({
              type: "Feature" as const,
              properties: { weight: Math.min(s.profitPerVisitCents / 100, 50) },
              geometry: { type: "Point" as const, coordinates: [s.longitude, s.latitude] },
            })),
          },
        });

        map.addLayer({
          id: "heatmap-profit-layer",
          type: "heatmap",
          source: "heatmap-profit-source",
          paint: {
            "heatmap-weight": ["get", "weight"],
            "heatmap-intensity": 1,
            "heatmap-radius": 40,
            "heatmap-color": [
              "interpolate", ["linear"], ["heatmap-density"],
              0, "rgba(34,197,94,0)",
              0.3, "rgba(34,197,94,0.3)",
              0.6, "rgba(22,163,74,0.5)",
              1, "rgba(21,128,61,0.7)",
            ],
            "heatmap-opacity": 0.8,
          },
        });
      }

      if (lossStops.length > 0) {
        map.addSource("heatmap-loss-source", {
          type: "geojson",
          data: {
            type: "FeatureCollection",
            features: lossStops.map((s) => ({
              type: "Feature" as const,
              properties: { weight: Math.min(Math.abs(s.profitPerVisitCents) / 100, 50) },
              geometry: { type: "Point" as const, coordinates: [s.longitude, s.latitude] },
            })),
          },
        });

        map.addLayer({
          id: "heatmap-loss-layer",
          type: "heatmap",
          source: "heatmap-loss-source",
          paint: {
            "heatmap-weight": ["get", "weight"],
            "heatmap-intensity": 1,
            "heatmap-radius": 40,
            "heatmap-color": [
              "interpolate", ["linear"], ["heatmap-density"],
              0, "rgba(239,68,68,0)",
              0.3, "rgba(239,68,68,0.3)",
              0.6, "rgba(220,38,38,0.5)",
              1, "rgba(185,28,28,0.7)",
            ],
            "heatmap-opacity": 0.8,
          },
        });
      }

      allVisibleStops.forEach((stop) => {
        const el = document.createElement("div");
        el.style.width = "10px";
        el.style.height = "10px";
        el.style.borderRadius = "50%";
        el.style.backgroundColor = STATUS_COLORS[stop.status];
        el.style.border = "1px solid white";
        el.style.opacity = "0.7";

        const marker = new mapboxgl.Marker({ element: el })
          .setLngLat([stop.longitude, stop.latitude])
          .addTo(map);
        markersRef.current.push(marker);
      });

    } else {
      for (const route of visibleRoutes) {
        const validStops = route.stops.filter(
          (s) => s.latitude && s.longitude
        );

        if (validStops.length >= 2) {
          const coordinates = validStops.map((s) => [s.longitude, s.latitude]);
          const lineId = `route-line-${route.routeId}`;
          const lineColor = STATUS_COLORS[route.status];

          map.addSource(lineId, {
            type: "geojson",
            data: {
              type: "Feature",
              properties: {},
              geometry: { type: "LineString", coordinates },
            },
          });

          map.addLayer({
            id: lineId,
            type: "line",
            source: lineId,
            layout: { "line-join": "round", "line-cap": "round" },
            paint: {
              "line-color": lineColor,
              "line-width": 3,
              "line-opacity": 0.6,
              "line-dasharray": [2, 2],
            },
          });
        }

        validStops.forEach((stop) => {
          const color = STATUS_COLORS[stop.status];
          const el = document.createElement("div");
          el.setAttribute("data-testid", `marker-stop-${stop.propertyId}`);
          el.style.width = "24px";
          el.style.height = "24px";
          el.style.borderRadius = "50%";
          el.style.backgroundColor = color;
          el.style.color = "white";
          el.style.display = "flex";
          el.style.alignItems = "center";
          el.style.justifyContent = "center";
          el.style.fontSize = "10px";
          el.style.fontWeight = "bold";
          el.style.border = "2px solid white";
          el.style.boxShadow = "0 2px 4px rgba(0,0,0,0.3)";
          el.style.cursor = "pointer";
          el.textContent = String(stop.stopOrder || "");

          const popup = new mapboxgl.Popup({ offset: 25, maxWidth: "260px" }).setHTML(
            `<div data-testid="popup-stop-${stop.propertyId}" style="padding:6px;font-family:system-ui,sans-serif;">
              <div style="font-weight:600;margin-bottom:4px;">${stop.contactName}</div>
              <div style="font-size:12px;color:#666;margin-bottom:6px;">${stop.propertyAddress}</div>
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:2px 8px;font-size:12px;">
                <span style="color:#888;">Revenue:</span><span style="font-weight:500;">${formatDollars(stop.revenuePerVisitCents)}</span>
                <span style="color:#888;">Cost:</span><span style="font-weight:500;">${formatDollars(stop.costPerVisitCents)}</span>
                <span style="color:#888;">Profit:</span><span style="font-weight:500;color:${stop.profitPerVisitCents >= 0 ? "#16a34a" : "#dc2626"}">${formatDollars(stop.profitPerVisitCents)}</span>
                <span style="color:#888;">Margin:</span><span style="font-weight:500;color:${stop.profitMarginPct >= 15 ? "#16a34a" : stop.profitMarginPct >= 0 ? "#ca8a04" : "#dc2626"}">${stop.profitMarginPct.toFixed(1)}%</span>
              </div>
              <div style="margin-top:6px;font-size:11px;color:#888;">${stop.frequency} | ${stop.dogCount} dog${stop.dogCount !== 1 ? "s" : ""} | ${stop.yardSize}</div>
            </div>`
          );

          el.addEventListener("click", () => {
            if (onStopClick) onStopClick(stop);
          });

          const marker = new mapboxgl.Marker({ element: el })
            .setLngLat([stop.longitude, stop.latitude])
            .setPopup(popup)
            .addTo(map);

          markersRef.current.push(marker);
        });
      }
    }

    if (allVisibleStops.length > 0) {
      const mapboxgl = mapboxglRef.current;
      const bounds = new mapboxgl.LngLatBounds();
      allVisibleStops.forEach((s) => bounds.extend([s.longitude, s.latitude]));
      map.fitBounds(bounds, { padding: 60, maxZoom: 14 });
    }
  }, [routes, visibleRouteIds, viewMode, mapLoaded]);

  useEffect(() => {
    if (!focusRouteId || !mapRef.current || !mapboxglRef.current || !mapLoaded) return;
    const route = routes.find((r) => r.routeId === focusRouteId);
    if (!route || route.stops.length === 0) return;

    const bounds = new mapboxglRef.current.LngLatBounds();
    route.stops.forEach((s) => bounds.extend([s.longitude, s.latitude]));
    mapRef.current.fitBounds(bounds, { padding: 80, maxZoom: 15 });
  }, [focusRouteId, mapLoaded]);

  if (tokenLoading) {
    return (
      <div className="w-full h-full flex items-center justify-center" data-testid="map-loading">
        <Skeleton className="w-full h-full" />
      </div>
    );
  }

  if (!tokenData?.token) {
    return (
      <div className="w-full h-full flex items-center justify-center text-muted-foreground" data-testid="map-no-token">
        Mapbox token not configured. Set MAPBOX_PUBLIC_TOKEN to enable map view.
      </div>
    );
  }

  return (
    <div className="w-full h-full relative" data-testid="profitability-map-container">
      {!mapLoaded && (
        <div className="absolute inset-0 flex items-center justify-center z-10 bg-background/50">
          <Skeleton className="w-full h-full" />
        </div>
      )}
      <div ref={mapContainerRef} className="w-full h-full" data-testid="profitability-map-canvas" />
    </div>
  );
}
