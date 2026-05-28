/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";

export type RouteStop = {
  id?: string;
  stopNumber: number;
  contactName: string;
  streetAddress: string;
  latitude: number;
  longitude: number;
  routeColor?: string;
};

export type DepotPin = {
  latitude: number;
  longitude: number;
  name: string;
};

type RouteMapViewProps = {
  stops: RouteStop[];
  routeName: string;
  selectedStopId?: string | null;
  onStopClick?: (id: string) => void;
  companyLatitude?: number | null;
  companyLongitude?: number | null;
  depots?: DepotPin[];
  /** @deprecated use depots[] instead */
  depotLatitude?: number | null;
  /** @deprecated use depots[] instead */
  depotLongitude?: number | null;
  /** @deprecated use depots[] instead */
  depotName?: string | null;
};

const DEFAULT_COLOR = "#22c55e";
const SELECTED_COLOR = "#f59e0b";
const DEPOT_COLOR = "#7c3aed";

export default function RouteMapView({
  stops,
  routeName,
  selectedStopId,
  onStopClick,
  companyLatitude,
  companyLongitude,
  depots,
  depotLatitude,
  depotLongitude,
  depotName,
}: RouteMapViewProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const markerMapRef = useRef<Map<string, { marker: any; color: string }>>(new Map());
  const [mapLoaded, setMapLoaded] = useState(false);

  const { data: tokenData, isLoading: tokenLoading } = useQuery<{ token: string }>({
    queryKey: ["/api/mapbox-token"],
  });

  useEffect(() => {
    if (!tokenData?.token || !mapContainerRef.current) return;
    if (mapRef.current) return;

    let cancelled = false;
    const container = mapContainerRef.current;

    mapboxgl.accessToken = tokenData.token;

      const companyLat =
        companyLatitude != null && Number.isFinite(companyLatitude) ? companyLatitude : null;
      const companyLng =
        companyLongitude != null && Number.isFinite(companyLongitude) ? companyLongitude : null;
      const hasCompanyCoords = companyLat !== null && companyLng !== null;
      const center: [number, number] =
        stops.length > 0
          ? [stops[0].longitude, stops[0].latitude]
          : hasCompanyCoords
            ? [companyLng, companyLat]
            : [-98.5795, 39.8283];
      const defaultZoom = stops.length > 0 ? 12 : hasCompanyCoords ? 12 : 8;

      const map = new mapboxgl.Map({
        container,
        style: "mapbox://styles/mapbox/streets-v12",
        center,
        zoom: defaultZoom,
      });

      mapRef.current = map;

      map.on("load", () => {
        if (cancelled) return;
        setMapLoaded(true);

        const validStops = stops.filter((s) => s.latitude && s.longitude);

        // Render depot markers (purple square "D") for each unique starting point.
        // Supports both the new depots[] array and the legacy single-depot props.
        const depotList: DepotPin[] =
          depots && depots.length > 0
            ? depots
            : depotLatitude != null &&
                Number.isFinite(depotLatitude) &&
                depotLongitude != null &&
                Number.isFinite(depotLongitude)
              ? [
                  {
                    latitude: depotLatitude!,
                    longitude: depotLongitude!,
                    name: depotName || "Depot",
                  },
                ]
              : [];

        depotList.forEach((depot, idx) => {
          const depotEl = document.createElement("div");
          depotEl.setAttribute("data-testid", `marker-depot-${idx}`);
          depotEl.style.width = "32px";
          depotEl.style.height = "32px";
          depotEl.style.borderRadius = "6px";
          depotEl.style.backgroundColor = DEPOT_COLOR;
          depotEl.style.color = "white";
          depotEl.style.display = "flex";
          depotEl.style.alignItems = "center";
          depotEl.style.justifyContent = "center";
          depotEl.style.fontSize = "16px";
          depotEl.style.fontWeight = "bold";
          depotEl.style.border = "2px solid white";
          depotEl.style.boxShadow = "0 2px 6px rgba(0,0,0,0.4)";
          depotEl.textContent = "D";

          const depotPopupEl = document.createElement("div");
          depotPopupEl.style.padding = "4px";
          const depotLabel = document.createElement("strong");
          depotLabel.textContent = depot.name;
          depotPopupEl.appendChild(depotLabel);
          const depotPopup = new mapboxgl.Popup({ offset: 25 }).setDOMContent(depotPopupEl);

          new mapboxgl.Marker({ element: depotEl })
            .setLngLat([depot.longitude, depot.latitude])
            .setPopup(depotPopup)
            .addTo(map);
        });

        validStops.forEach((stop) => {
          const color = stop.routeColor || DEFAULT_COLOR;
          const isSelected = stop.id != null && stop.id === selectedStopId;
          const el = document.createElement("div");
          el.className = "route-map-marker";
          el.setAttribute("data-testid", `marker-stop-${stop.stopNumber}`);
          el.style.width = isSelected ? "34px" : "28px";
          el.style.height = isSelected ? "34px" : "28px";
          el.style.borderRadius = "50%";
          el.style.backgroundColor = isSelected ? SELECTED_COLOR : color;
          el.style.color = "white";
          el.style.display = "flex";
          el.style.alignItems = "center";
          el.style.justifyContent = "center";
          el.style.fontSize = "12px";
          el.style.fontWeight = "bold";
          el.style.border = isSelected ? "3px solid white" : "2px solid white";
          el.style.boxShadow = "0 2px 4px rgba(0,0,0,0.3)";
          el.style.cursor = "pointer";
          el.style.transition = "all 0.15s ease";
          el.textContent = String(stop.stopNumber);

          if (onStopClick && stop.id) {
            el.addEventListener("click", () => onStopClick(stop.id!));
          }

          const popupEl = document.createElement("div");
          popupEl.dataset.testid = `popup-stop-${stop.stopNumber}`;
          popupEl.style.padding = "4px";
          const strong = document.createElement("strong");
          strong.textContent = `Stop #${stop.stopNumber}`;
          const br1 = document.createElement("br");
          const addrSpan = document.createElement("span");
          addrSpan.textContent = stop.streetAddress;
          const br2 = document.createElement("br");
          const nameSpan = document.createElement("span");
          nameSpan.style.color = "#666";
          nameSpan.textContent = stop.contactName;
          popupEl.append(strong, br1, addrSpan, br2, nameSpan);
          const popup = new mapboxgl.Popup({ offset: 25 }).setDOMContent(popupEl);

          const marker = new mapboxgl.Marker({ element: el })
            .setLngLat([stop.longitude, stop.latitude])
            .setPopup(popup)
            .addTo(map);

          if (stop.id) {
            markerMapRef.current.set(stop.id, { marker, color });
          }
        });

        const colorGroups = new Map<string, RouteStop[]>();
        validStops.forEach((stop) => {
          const color = stop.routeColor || DEFAULT_COLOR;
          if (!colorGroups.has(color)) colorGroups.set(color, []);
          colorGroups.get(color)!.push(stop);
        });

        let lineIndex = 0;
        colorGroups.forEach((groupStops, color) => {
          if (groupStops.length < 2) return;
          const coordinates = groupStops.map((s) => [s.longitude, s.latitude]);
          const sourceId = `route-line-${lineIndex}`;
          const layerId = `route-line-layer-${lineIndex}`;
          map.addSource(sourceId, {
            type: "geojson",
            data: {
              type: "Feature",
              properties: {},
              geometry: { type: "LineString", coordinates },
            },
          });
          map.addLayer({
            id: layerId,
            type: "line",
            source: sourceId,
            layout: { "line-join": "round", "line-cap": "round" },
            paint: { "line-color": color, "line-width": 3, "line-opacity": 0.7 },
          });
          lineIndex++;
        });

        if (validStops.length > 1) {
          const bounds = new mapboxgl.LngLatBounds();
          validStops.forEach((s) => bounds.extend([s.longitude, s.latitude]));
          map.fitBounds(bounds, { padding: 60 });
        }
      });

    return () => {
      cancelled = true;
      markerMapRef.current.forEach(({ marker }) => marker.remove());
      markerMapRef.current.clear();
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
      setMapLoaded(false);
    };
  }, [tokenData?.token, stops]);

  // Re-center on company service area when coords arrive after the map is already mounted
  // and there are no stops to fit bounds to (e.g. company query resolves after map init).
  useEffect(() => {
    if (!mapRef.current || stops.length > 0) return;
    const lat =
      companyLatitude != null && Number.isFinite(companyLatitude) ? companyLatitude : null;
    const lng =
      companyLongitude != null && Number.isFinite(companyLongitude) ? companyLongitude : null;
    if (lat === null || lng === null) return;
    mapRef.current.jumpTo({ center: [lng, lat], zoom: 12 });
  }, [companyLatitude, companyLongitude, stops.length]);

  useEffect(() => {
    markerMapRef.current.forEach(({ marker, color }, id) => {
      const el = marker.getElement();
      const isSelected = id === selectedStopId;
      el.style.backgroundColor = isSelected ? SELECTED_COLOR : color;
      el.style.width = isSelected ? "34px" : "28px";
      el.style.height = isSelected ? "34px" : "28px";
      el.style.border = isSelected ? "3px solid white" : "2px solid white";
    });
    if (selectedStopId && mapRef.current) {
      const selectedStop = stops.find((s) => s.id === selectedStopId);
      if (selectedStop) {
        mapRef.current.flyTo({
          center: [selectedStop.longitude, selectedStop.latitude],
          zoom: 15,
          duration: 600,
        });
      }
    }
  }, [selectedStopId, stops]);

  if (tokenLoading) {
    return (
      <div className="w-full h-full flex items-center justify-center" data-testid="map-loading">
        <Skeleton className="w-full h-full" />
      </div>
    );
  }

  if (!tokenData?.token) {
    return (
      <div
        className="w-full h-full flex items-center justify-center text-muted-foreground"
        data-testid="map-no-token"
      >
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
      <div
        className="absolute top-3 left-3 z-20 bg-background/90 px-3 py-1.5 rounded-md text-sm font-medium shadow"
        data-testid="map-route-name"
      >
        {routeName} — {stops.length} {stops.length === 1 ? "stop" : "stops"}
      </div>
      <div ref={mapContainerRef} className="w-full h-full" data-testid="map-canvas" />
    </div>
  );
}
