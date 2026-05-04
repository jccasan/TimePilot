// Local geometric helpers. Used for fast clustering and as a fallback distance
// estimator. Mapbox is the source of truth for final routing distances/times.

export interface LatLng {
  latitude: number;
  longitude: number;
}

const EARTH_RADIUS_MILES = 3958.7613;
// Average local driving speed (mph) for fallback drive-time estimates.
// Intentionally conservative so MockRoutingProvider produces realistic numbers.
const FALLBACK_AVG_SPEED_MPH = 28;
// Detour factor — straight-line is shorter than actual drive distance.
const DETOUR_FACTOR = 1.25;

export function haversineMiles(a: LatLng, b: LatLng): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);

  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);
  const h = sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLng * sinDLng;
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  return EARTH_RADIUS_MILES * c;
}

export function approximateDriveMiles(a: LatLng, b: LatLng): number {
  return haversineMiles(a, b) * DETOUR_FACTOR;
}

export function approximateDriveMinutes(a: LatLng, b: LatLng): number {
  const miles = approximateDriveMiles(a, b);
  return (miles / FALLBACK_AVG_SPEED_MPH) * 60;
}

export function roundCoord(n: number, precision: number): number {
  const factor = Math.pow(10, precision);
  return Math.round(n * factor) / factor;
}

export function centroid(points: LatLng[]): LatLng {
  if (points.length === 0) return { latitude: 0, longitude: 0 };
  let lat = 0;
  let lng = 0;
  for (const p of points) {
    lat += p.latitude;
    lng += p.longitude;
  }
  return { latitude: lat / points.length, longitude: lng / points.length };
}
