import { useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { Home } from "lucide-react";

interface StreetViewImageProps {
  address?: string;
  lat?: number;
  lng?: number;
  className?: string;
  size?: string;
  clickToNavigate?: boolean;
}

function buildStreetViewUrl(address?: string, lat?: number, lng?: number, size?: string): string {
  const params = new URLSearchParams();
  if (lat != null && lng != null) {
    params.set("lat", String(lat));
    params.set("lng", String(lng));
  } else if (address) {
    params.set("address", address);
  }
  if (size) params.set("size", size);
  return `/api/streetview?${params.toString()}`;
}

function buildGoogleMapsUrl(address?: string, lat?: number, lng?: number): string {
  if (lat != null && lng != null) {
    return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
  }
  if (address) {
    return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`;
  }
  return "#";
}

export function StreetViewImage({
  address,
  lat,
  lng,
  className = "",
  size,
  clickToNavigate = true,
}: StreetViewImageProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  if (!address && lat == null && lng == null) return null;

  const imgUrl = buildStreetViewUrl(address, lat, lng, size);
  const mapsUrl = buildGoogleMapsUrl(address, lat, lng);

  if (error) {
    return (
      <div
        className={`flex items-center justify-center bg-muted rounded-md border ${className}`}
        style={{ minHeight: "120px" }}
        data-testid="img-street-view-fallback"
      >
        <div className="text-center text-muted-foreground">
          <Home className="h-8 w-8 mx-auto mb-1 opacity-40" />
          <p className="text-xs opacity-60">No street view available</p>
        </div>
      </div>
    );
  }

  const image = (
    <div className={`relative overflow-hidden rounded-md border ${className}`}>
      {loading && <Skeleton className="absolute inset-0 rounded-md" />}
      <img
        src={imgUrl}
        alt={`Street view of ${address || "property"}`}
        className={`w-full h-full object-contain transition-opacity duration-300 ${loading ? "opacity-0" : "opacity-100"}`}
        loading="lazy"
        onLoad={() => setLoading(false)}
        onError={() => {
          setLoading(false);
          setError(true);
        }}
        data-testid="img-street-view"
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
        data-testid="link-street-view-navigate"
      >
        {image}
      </a>
    );
  }

  return image;
}
