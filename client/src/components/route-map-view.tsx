import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import "mapbox-gl/dist/mapbox-gl.css";

export type RouteStop = {
  stopNumber: number;
  contactName: string;
  streetAddress: string;
  latitude: number;
  longitude: number;
};

type RouteMapViewProps = {
  stops: RouteStop[];
  routeName: string;
};

const GREEN_MARKER = "#22c55e";

export default function RouteMapView({ stops, routeName }: RouteMapViewProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const markersRef = useRef<any[]>([]);
  const [mapLoaded, setMapLoaded] = useState(false);

  const { data: tokenData, isLoading: tokenLoading } = useQuery<{ token: string }>({
    queryKey: ["/api/mapbox-token"],
  });

  useEffect(() => {
    if (!tokenData?.token || !mapContainerRef.current) return;
    if (mapRef.current) return;

    let cancelled = false;

    (async () => {
      const mapboxgl = (await import("mapbox-gl")).default;
      if (cancelled) return;

      mapboxgl.accessToken = tokenData.token;

      const center: [number, number] =
        stops.length > 0
          ? [stops[0].longitude, stops[0].latitude]
          : [-98.5795, 39.8283];

      const map = new mapboxgl.Map({
        container: mapContainerRef.current!,
        style: "mapbox://styles/mapbox/streets-v12",
        center,
        zoom: stops.length > 0 ? 12 : 4,
      });

      mapRef.current = map;

      map.on("load", () => {
        if (cancelled) return;
        setMapLoaded(true);

        const validStops = stops.filter(
          (s) => s.latitude && s.longitude
        );

        validStops.forEach((stop) => {
          const el = document.createElement("div");
          el.className = "route-map-marker";
          el.setAttribute("data-testid", `marker-stop-${stop.stopNumber}`);
          el.style.width = "28px";
          el.style.height = "28px";
          el.style.borderRadius = "50%";
          el.style.backgroundColor = GREEN_MARKER;
          el.style.color = "white";
          el.style.display = "flex";
          el.style.alignItems = "center";
          el.style.justifyContent = "center";
          el.style.fontSize = "12px";
          el.style.fontWeight = "bold";
          el.style.border = "2px solid white";
          el.style.boxShadow = "0 2px 4px rgba(0,0,0,0.3)";
          el.style.cursor = "pointer";
          el.textContent = String(stop.stopNumber);

          const popup = new mapboxgl.Popup({ offset: 25 }).setHTML(
            `<div data-testid="popup-stop-${stop.stopNumber}" style="padding:4px;">
              <strong>Stop #${stop.stopNumber}</strong><br/>
              <span>${stop.streetAddress}</span><br/>
              <span style="color:#666;">${stop.contactName}</span>
            </div>`
          );

          const marker = new mapboxgl.Marker({ element: el })
            .setLngLat([stop.longitude, stop.latitude])
            .setPopup(popup)
            .addTo(map);

          markersRef.current.push(marker);
        });

        if (validStops.length >= 2) {
          const coordinates = validStops.map((s) => [s.longitude, s.latitude]);

          map.addSource("route-line", {
            type: "geojson",
            data: {
              type: "Feature",
              properties: {},
              geometry: {
                type: "LineString",
                coordinates,
              },
            },
          });

          map.addLayer({
            id: "route-line-layer",
            type: "line",
            source: "route-line",
            layout: {
              "line-join": "round",
              "line-cap": "round",
            },
            paint: {
              "line-color": GREEN_MARKER,
              "line-width": 3,
              "line-opacity": 0.7,
            },
          });
        }

        if (validStops.length > 1) {
          const bounds = new mapboxgl.LngLatBounds();
          validStops.forEach((s) => bounds.extend([s.longitude, s.latitude]));
          map.fitBounds(bounds, { padding: 60 });
        }
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
  }, [tokenData?.token, stops]);

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
    <div className="w-full h-full relative" data-testid="route-map-container">
      {!mapLoaded && (
        <div className="absolute inset-0 flex items-center justify-center z-10 bg-background/50">
          <Skeleton className="w-full h-full" />
        </div>
      )}
      <div className="absolute top-3 left-3 z-20 bg-background/90 px-3 py-1.5 rounded-md text-sm font-medium shadow" data-testid="map-route-name">
        {routeName} — {stops.length} {stops.length === 1 ? "stop" : "stops"}
      </div>
      <div ref={mapContainerRef} className="w-full h-full" data-testid="map-canvas" />
    </div>
  );
}
