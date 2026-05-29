const MI_TO_KM = 1.60934;

export function distanceUnit(country: string): "km" | "mi" {
  return country === "ca" ? "km" : "mi";
}

export function formatDistance(
  miles: number,
  country: string
): { value: number; label: string; formatted: string } {
  const unit = distanceUnit(country);
  if (unit === "km") {
    const km = miles * MI_TO_KM;
    return { value: km, label: "km", formatted: `${km.toFixed(1)} km` };
  }
  return { value: miles, label: "mi", formatted: `${miles.toFixed(1)} mi` };
}

export function formatDistanceShort(miles: number, country: string): string {
  const unit = distanceUnit(country);
  if (unit === "km") {
    const km = miles * MI_TO_KM;
    return km < 0.1 ? "<0.1 km" : `${km.toFixed(1)} km`;
  }
  return miles < 0.1 ? "<0.1 mi" : `${miles.toFixed(1)} mi`;
}

export function formatRadius(miles: number, country: string): { value: number; label: string } {
  if (country === "ca") {
    return { value: Math.round(miles * MI_TO_KM), label: "km" };
  }
  return { value: miles, label: "miles" };
}
