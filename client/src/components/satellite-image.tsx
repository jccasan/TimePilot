import { useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { MapPin } from "lucide-react";

interface SatelliteImageProps {
  address?: string;
  lat?: number;
  lng?: number;
  className?: string;
  size?: string;
  zoom?: number;
  clickToNavigate?: boolean;
}

function buildSatelliteUrl(
  address?: string,
  lat?: number,
  lng?: number,
  size?: string,
  zoom?: number
): string {
  const params = new URLSearchParams();
  if (lat != null && lng != null) {
    params.set("lat", String(lat));
    params.set("lng", String(lng));
  } else if (address) {
    params.set("address", address);
  }
  if (size) params.set("size", size);
  if (zoom) params.set("zoom", String(zoom));
  return `/api/satellite?${params.toString()}`;
}

function buildGoogleMapsUrl(address?: string, lat?: number, lng?: number): string {
  const base = "https://www.google.com/maps";
  if (lat != null && lng != null) {
    return `${base}/@${lat},${lng},19z/data=!3m1!1e3`;
  }
  if (address) {
    return `${base}/place/${encodeURIComponent(address)}/@0,0,19z/data=!3m1!1e3`;
  }
  return "#";
}

export function SatelliteImage({
  address,
  lat,
  lng,
  className = "",
  size,
  zoom,
  clickToNavigate = true,
}: SatelliteImageProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  if (!address && lat == null && lng == null) return null;

  const imgUrl = buildSatelliteUrl(address, lat, lng, size, zoom);
  const mapsUrl = buildGoogleMapsUrl(address, lat, lng);

  if (error) {
    return (
      <div
        className={`flex items-center justify-center bg-muted rounded-md border ${className}`}
        style={{ minHeight: "120px" }}
        data-testid="img-satellite-fallback"
      >
        <div className="text-center text-muted-foreground">
          <MapPin className="h-8 w-8 mx-auto mb-1 opacity-40" />
          <p className="text-xs opacity-60">No satellite view available</p>
        </div>
      </div>
    );
  }

  const image = (
    <div className={`relative overflow-hidden rounded-md border ${className}`}>
      {loading && <Skeleton className="absolute inset-0 rounded-md" />}
      <img
        src={imgUrl}
        alt={`Satellite view of ${address || "property"}`}
        className={`w-full h-full object-contain transition-opacity duration-300 ${loading ? "opacity-0" : "opacity-100"}`}
        loading="lazy"
        onLoad={() => setLoading(false)}
        onError={() => {
          setLoading(false);
          setError(true);
        }}
        data-testid="img-satellite"
      />
    </div>
  );

  if (clickToNavigate) {
    return (
      <a
        href={mapsUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="block hover:opacity-90 transition-opacity"
        data-testid="link-satellite-navigate"
      >
        {image}
      </a>
    );
  }

  return image;
}
