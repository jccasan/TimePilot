import os
import json
from pathlib import Path
from geopy.geocoders import Nominatim
from geopy.distance import geodesic
import pgeocode

_geocoder = Nominatim(user_agent="scoopilot-wizard/1.0")
_nomi = None
_zip_cache: dict = {}


def _get_nomi():
    global _nomi
    if _nomi is None:
        _nomi = pgeocode.Nominatim("us")
    return _nomi


def geocode_address(address: str) -> dict | None:
    """Geocode a free-text address. Returns {lat, lon, display} or None."""
    try:
        result = _geocoder.geocode(address, country_codes="us", timeout=8)
        if result:
            return {
                "lat": result.latitude,
                "lon": result.longitude,
                "display": result.address,
            }
    except Exception:
        pass
    return None


def zips_in_radius(lat: float, lon: float, miles: float) -> list[dict]:
    """Return ZIP codes whose centroid is within `miles` of (lat, lon).
    Returns list of {zip, city, state, lat, lon}.
    """
    nomi = _get_nomi()
    # pgeocode doesn't have a radius query, so we load all US zips and filter.
    # Cache on first call.
    global _zip_cache
    cache_key = "all_us"
    if cache_key not in _zip_cache:
        import pandas as pd
        df = nomi._data  # internal dataframe
        _zip_cache[cache_key] = df[
            ["postal_code", "place_name", "state_code", "latitude", "longitude"]
        ].dropna(subset=["latitude", "longitude"])

    df = _zip_cache[cache_key]
    center = (lat, lon)
    results = []
    for _, row in df.iterrows():
        zip_center = (row["latitude"], row["longitude"])
        dist = geodesic(center, zip_center).miles
        if dist <= miles:
            results.append({
                "zip": str(row["postal_code"]).zfill(5),
                "city": row.get("place_name", ""),
                "state": row.get("state_code", ""),
                "lat": float(row["latitude"]),
                "lon": float(row["longitude"]),
                "distMiles": round(dist, 1),
            })
    return results


def verify_location(territory: dict, caller_zip: str | None, caller_lat: float | None, caller_lon: float | None) -> dict:
    """Check if a caller is inside the configured territory.
    Returns {inTerritory, method, distanceMiles?}
    """
    mode = territory.get("mode", "zip")
    zip_list = [str(z).zfill(5) for z in territory.get("zipList", [])]
    hq_lat = territory.get("hqLat")
    hq_lon = territory.get("hqLon")
    radius_miles = territory.get("radiusMiles", 0)

    # Step 1: ZIP check
    if caller_zip and zip_list:
        if str(caller_zip).zfill(5) in zip_list:
            return {"inTerritory": True, "method": "zip"}
        if mode == "zip":
            return {"inTerritory": False, "method": "zip"}

    # Step 2: Radius check
    if caller_lat is not None and caller_lon is not None and hq_lat and hq_lon and radius_miles:
        dist = geodesic((hq_lat, hq_lon), (caller_lat, caller_lon)).miles
        return {
            "inTerritory": dist <= radius_miles,
            "method": "radius",
            "distanceMiles": round(dist, 2),
        }

    return {"inTerritory": False, "method": "unknown"}
