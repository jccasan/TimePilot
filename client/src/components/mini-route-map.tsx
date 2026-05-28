import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import type { RouteStop } from "@/components/route-map-view";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";

const DEFAULT_COLOR = "#22c55e";

type MiniRouteMapProps = {
  stops: RouteStop[];
  label: string;
};

export default function MiniRouteMap({ stops, label }: MiniRouteMapProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);

  const { data: tokenData } = useQuery<{ token: string }>({
    queryKey: ["/api/mapbox-token"],
  });

  useEffect(() => {
    if (!tokenData?.token || !mapContainerRef.current) return;
    if (mapRef.current) return;

    mapboxgl.accessToken = tokenData.token;

    const validStops = stops.filter((s) => s.latitude && s.longitude);
    const center: [number, number] =
      validStops.length > 0
        ? [validStops[0].longitude, validStops[0].latitude]
        : [-98.5795, 39.8283];

    const map = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: "mapbox://styles/mapbox/streets-v12",
      center,
      zoom: 11,
      interactive: false,
      attributionControl: false,
    });

    mapRef.current = map;

    map.on("load", () => {
      setMapLoaded(true);

      validStops.forEach((stop) => {
        const color = stop.routeColor || DEFAULT_COLOR;
        const el = document.createElement("div");
        el.setAttribute(
          "data-testid",
          `mini-marker-${label.toLowerCase().replace(/\s+/g, "-")}-${stop.stopNumber}`
        );
        el.style.width = "22px";
        el.style.height = "22px";
        el.style.borderRadius = "50%";
        el.style.backgroundColor = color;
        el.style.color = "white";
        el.style.display = "flex";
        el.style.alignItems = "center";
        el.style.justifyContent = "center";
        el.style.fontSize = "10px";
        el.style.fontWeight = "bold";
        el.style.border = "2px solid white";
        el.style.boxShadow = "0 1px 3px rgba(0,0,0,0.35)";
        el.textContent = String(stop.stopNumber);

        new mapboxgl.Marker({ element: el })
          .setLngLat([stop.longitude, stop.latitude])
          .addTo(map);
      });

      if (validStops.length >= 2) {
        const coordinates = validStops.map((s) => [s.longitude, s.latitude]);
        map.addSource("route-line", {
          type: "geojson",
          data: {
            type: "Feature",
            properties: {},
            geometry: { type: "LineString", coordinates },
          },
        });
        map.addLayer({
          id: "route-line-layer",
          type: "line",
          source: "route-line",
          layout: { "line-join": "round", "line-cap": "round" },
          paint: { "line-color": DEFAULT_COLOR, "line-width": 2, "line-opacity": 0.75 },
        });
      }

      if (validStops.length > 1) {
        const bounds = new mapboxgl.LngLatBounds();
        validStops.forEach((s) => bounds.extend([s.longitude, s.latitude]));
        map.fitBounds(bounds, { padding: 32, duration: 0 });
      }
    });

    return () => {
      map.remove();
      mapRef.current = null;
      setMapLoaded(false);
    };
  }, [tokenData?.token, stops, label]);

  if (!tokenData?.token) {
    return (
      <div
        className="w-full h-full flex items-center justify-center text-xs text-muted-foreground"
        data-testid={`mini-map-no-token-${label}`}
      >
        Map unavailable
      </div>
    );
  }

  return (
    <div
      className="w-full h-full relative rounded overflow-hidden border"
      data-testid={`mini-map-${label.toLowerCase().replace(/\s+/g, "-")}`}
    >
      {!mapLoaded && (
        <div className="absolute inset-0 z-10">
          <Skeleton className="w-full h-full" />
        </div>
      )}
      <div className="absolute top-2 left-2 z-20 bg-background/90 px-2 py-0.5 rounded text-xs font-semibold shadow">
        {label}
      </div>
      <div ref={mapContainerRef} className="w-full h-full" />
    </div>
  );
}
