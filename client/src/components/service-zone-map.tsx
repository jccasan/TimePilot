import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { MapPin, Plus, Trash2, Loader2, Percent } from "lucide-react";

export type ZoneEntry = {
  zipCode: string;
  dayOfWeek: string;
  label?: string;
  priceSurchargePercent?: number;
  latitude?: number;
  longitude?: number;
  id?: string;
};

const DAYS = [
  { value: "tbd", label: "TBD" },
  { value: "monday", label: "Monday" },
  { value: "tuesday", label: "Tuesday" },
  { value: "wednesday", label: "Wednesday" },
  { value: "thursday", label: "Thursday" },
  { value: "friday", label: "Friday" },
  { value: "saturday", label: "Saturday" },
  { value: "sunday", label: "Sunday" },
];

const DAY_COLORS: Record<string, string> = {
  monday: "#ef4444",
  tuesday: "#f97316",
  wednesday: "#eab308",
  thursday: "#22c55e",
  friday: "#3b82f6",
  saturday: "#8b5cf6",
  sunday: "#ec4899",
  tbd: "#6b7280",
};

type Props = {
  zones: ZoneEntry[];
  onZonesChange: (zones: ZoneEntry[]) => void;
  companyAddress?: string;
  compact?: boolean;
};

export function ServiceZoneMap({
  zones,
  onZonesChange,
  companyAddress: _companyAddress,
  compact,
}: Props) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const markersRef = useRef<any[]>([]);
  const [zipInput, setZipInput] = useState("");
  const [adding, setAdding] = useState(false);
  const [mapLoaded, setMapLoaded] = useState(false);

  const { data: tokenData } = useQuery<{ token: string }>({
    queryKey: ["/api/mapbox-token"],
  });

  useEffect(() => {
    if (!tokenData?.token || !mapContainerRef.current || mapRef.current) return;

    let cancelled = false;

    (async () => {
      const mapboxgl = (await import("mapbox-gl")).default;
      await import("mapbox-gl/dist/mapbox-gl.css");

      if (cancelled || !mapContainerRef.current) return;

      mapboxgl.accessToken = tokenData.token;

      const map = new mapboxgl.Map({
        container: mapContainerRef.current,
        style: "mapbox://styles/mapbox/streets-v12",
        center: [-98.5, 39.8],
        zoom: 4,
      });

      map.addControl(new mapboxgl.NavigationControl(), "top-right");

      map.on("load", () => {
        setMapLoaded(true);
      });

      mapRef.current = map;
    })();

    return () => {
      cancelled = true;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, [tokenData?.token]);

  const updateMarkers = useCallback(async () => {
    if (!mapRef.current || !mapLoaded) return;

    const mapboxgl = (await import("mapbox-gl")).default;

    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];

    for (const zone of zones) {
      if (zone.latitude && zone.longitude) {
        const el = document.createElement("div");
        el.style.width = "28px";
        el.style.height = "28px";
        el.style.borderRadius = "50%";
        el.style.backgroundColor = DAY_COLORS[zone.dayOfWeek] || DAY_COLORS.tbd;
        el.style.border = "3px solid white";
        el.style.boxShadow = "0 2px 6px rgba(0,0,0,0.3)";
        el.style.display = "flex";
        el.style.alignItems = "center";
        el.style.justifyContent = "center";
        el.style.color = "white";
        el.style.fontSize = "10px";
        el.style.fontWeight = "bold";
        el.style.cursor = "pointer";
        el.textContent = zone.zipCode.slice(-2);
        el.title = `${zone.zipCode} - ${DAYS.find((d) => d.value === zone.dayOfWeek)?.label || "TBD"}`;

        const marker = new mapboxgl.Marker({ element: el })
          .setLngLat([zone.longitude, zone.latitude])
          .addTo(mapRef.current);

        markersRef.current.push(marker);
      }
    }

    if (zones.length > 0) {
      const validZones = zones.filter((z) => z.latitude && z.longitude);
      if (validZones.length === 1) {
        mapRef.current.flyTo({
          center: [validZones[0].longitude!, validZones[0].latitude!],
          zoom: 10,
        });
      } else if (validZones.length > 1) {
        const bounds = new mapboxgl.LngLatBounds();
        validZones.forEach((z) => bounds.extend([z.longitude!, z.latitude!]));
        mapRef.current.fitBounds(bounds, { padding: 60 });
      }
    }
  }, [zones, mapLoaded]);

  useEffect(() => {
    updateMarkers();
  }, [updateMarkers]);

  const geocodeZip = async (zip: string): Promise<{ lat: number; lng: number } | null> => {
    if (!tokenData?.token) return null;
    try {
      const resp = await fetch(
        `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(zip)}.json?country=US&types=postcode&access_token=${tokenData.token}`
      );
      const data = await resp.json();
      if (data.features && data.features.length > 0) {
        const [lng, lat] = data.features[0].center;
        return { lat, lng };
      }
    } catch (e) {
      console.error("Geocode error:", e);
    }
    return null;
  };

  const handleAddZip = async () => {
    const zip = zipInput.trim();
    if (!zip) return;
    if (!/^\d{5}$/.test(zip)) return;
    if (zones.some((z) => z.zipCode === zip)) {
      setZipInput("");
      return;
    }

    setAdding(true);
    const coords = await geocodeZip(zip);
    const newZone: ZoneEntry = {
      zipCode: zip,
      dayOfWeek: "tbd",
      latitude: coords?.lat,
      longitude: coords?.lng,
    };
    onZonesChange([...zones, newZone]);
    setZipInput("");
    setAdding(false);
  };

  const handleRemoveZip = (zipCode: string) => {
    onZonesChange(zones.filter((z) => z.zipCode !== zipCode));
  };

  const handleDayChange = (zipCode: string, day: string) => {
    onZonesChange(zones.map((z) => (z.zipCode === zipCode ? { ...z, dayOfWeek: day } : z)));
  };

  const handleSurchargeChange = (zipCode: string, value: string) => {
    const num = Math.max(0, Math.min(200, Math.round(Number(value) || 0)));
    onZonesChange(
      zones.map((z) => (z.zipCode === zipCode ? { ...z, priceSurchargePercent: num } : z))
    );
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleAddZip();
    }
  };

  return (
    <div className="space-y-4">
      <div
        ref={mapContainerRef}
        className={`w-full rounded-lg border bg-muted ${compact ? "h-[250px]" : "h-[350px]"}`}
        data-testid="map-service-zones"
      />

      <div className="flex gap-2">
        <div className="relative flex-1">
          <MapPin className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Enter zip code (e.g. 22031)"
            className="pl-8"
            value={zipInput}
            onChange={(e) => setZipInput(e.target.value.replace(/\D/g, "").slice(0, 5))}
            onKeyDown={handleKeyDown}
            maxLength={5}
            data-testid="input-zip-code"
          />
        </div>
        <Button
          onClick={handleAddZip}
          disabled={adding || zipInput.length !== 5}
          data-testid="button-add-zip"
        >
          {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          Add
        </Button>
      </div>

      {zones.length > 0 && (
        <div className="space-y-2">
          <Label className="text-sm font-medium">Service Zones ({zones.length})</Label>
          <div className="space-y-1.5 max-h-[280px] overflow-y-auto">
            {zones.map((zone) => (
              <div
                key={zone.zipCode}
                className="flex items-center gap-2 rounded-lg border p-2.5 bg-card"
                data-testid={`zone-row-${zone.zipCode}`}
              >
                <div
                  className="h-3 w-3 rounded-full shrink-0"
                  style={{ backgroundColor: DAY_COLORS[zone.dayOfWeek] || DAY_COLORS.tbd }}
                />
                <Badge variant="outline" className="font-mono text-xs shrink-0">
                  {zone.zipCode}
                </Badge>
                <Select
                  value={zone.dayOfWeek}
                  onValueChange={(val) => handleDayChange(zone.zipCode, val)}
                >
                  <SelectTrigger
                    className="h-8 flex-1 text-xs"
                    data-testid={`select-day-${zone.zipCode}`}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DAYS.map((d) => (
                      <SelectItem key={d.value} value={d.value}>
                        {d.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="flex items-center gap-0.5 shrink-0">
                  <Input
                    type="number"
                    min={0}
                    max={200}
                    value={zone.priceSurchargePercent ?? 0}
                    onChange={(e) => handleSurchargeChange(zone.zipCode, e.target.value)}
                    className="h-8 w-16 text-xs text-center"
                    title="Price surcharge percentage for this zone"
                    data-testid={`input-surcharge-${zone.zipCode}`}
                  />
                  <Percent className="h-3 w-3 text-muted-foreground shrink-0" />
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                  onClick={() => handleRemoveZip(zone.zipCode)}
                  data-testid={`button-remove-zip-${zone.zipCode}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      {zones.length === 0 && (
        <Card>
          <CardContent className="pt-4 text-center text-sm text-muted-foreground">
            <MapPin className="h-8 w-8 mx-auto mb-2 opacity-40" />
            <p>No service zones added yet. Enter a zip code above to get started.</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export default ServiceZoneMap;
