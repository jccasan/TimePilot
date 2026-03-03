export async function geocodeAddress(
  streetAddress: string,
  city?: string | null,
  state?: string | null,
  zipCode?: string | null
): Promise<{ latitude: string; longitude: string } | null> {
  const tokens = [
    process.env.MAPBOX_PUBLIC_TOKEN,
    process.env.MAPBOX_SECRET_TOKEN,
  ].filter(Boolean) as string[];
  if (tokens.length === 0) return null;

  const parts = [streetAddress, city, state, zipCode].filter(Boolean).join(", ");
  if (!parts || parts.length < 5) return null;

  for (const token of tokens) {
    try {
      const params = new URLSearchParams({
        q: parts,
        access_token: token,
        country: "us",
        types: "address",
        limit: "1",
      });
      const url = `https://api.mapbox.com/search/geocode/v6/forward?${params}`;
      const response = await fetch(url);
      if (!response.ok) continue;
      const data = await response.json();
      const feature = data.features?.[0];
      if (!feature) return null;
      const coords = feature.geometry?.coordinates;
      if (!coords || coords.length < 2) return null;
      return {
        latitude: String(coords[1]),
        longitude: String(coords[0]),
      };
    } catch {
      continue;
    }
  }
  return null;
}
