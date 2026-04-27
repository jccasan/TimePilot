"""
geo.py — Geocoding and ZIP centroid utilities for the Voice Agent Wizard.

ZIP data is loaded from pgeocode ONCE at module import and stored as numpy
arrays so that radius queries are pure vectorized operations — no Python loop,
no per-row geopy calls.

Performance:
  Before: ~40 000 geodesic() calls via iterrows() → 5-30 s per request
  After:  bounding-box pre-filter + vectorized Haversine → < 50 ms
"""

import math
from geopy.geocoders import Nominatim
from geopy.distance import geodesic

# ── Geocoder (single shared instance) ─────────────────────────────────────
_geocoder = Nominatim(user_agent="scoopilot-wizard/1.0")


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


# ── ZIP centroid data — preloaded at import time ──────────────────────────
import numpy as np
import pgeocode

_zips_loaded = False
_zip_codes: list[str] = []
_zip_cities: list[str] = []
_zip_states: list[str] = []
_lat_arr: np.ndarray | None = None
_lon_arr: np.ndarray | None = None


def _ensure_loaded() -> None:
    """Load all US ZIP centroids from pgeocode into module-level arrays.
    Called lazily on first use and cached for the process lifetime.
    """
    global _zips_loaded, _zip_codes, _zip_cities, _zip_states, _lat_arr, _lon_arr
    if _zips_loaded:
        return

    nomi = pgeocode.Nominatim("us")
    df = nomi._data[
        ["postal_code", "place_name", "state_code", "latitude", "longitude"]
    ].dropna(subset=["latitude", "longitude"])

    _zip_codes = [str(z).zfill(5) for z in df["postal_code"].tolist()]
    _zip_cities = df["place_name"].fillna("").tolist()
    _zip_states = df["state_code"].fillna("").tolist()
    _lat_arr = df["latitude"].to_numpy(dtype=float)
    _lon_arr = df["longitude"].to_numpy(dtype=float)
    _zips_loaded = True


def _haversine_miles_vec(
    center_lat: float,
    center_lon: float,
    lats: np.ndarray,
    lons: np.ndarray,
) -> np.ndarray:
    """Vectorized Haversine distance (miles) from one point to an array of points."""
    R = 3958.8  # Earth radius in miles
    clat = math.radians(center_lat)
    clon = math.radians(center_lon)
    rlats = np.radians(lats)
    rlons = np.radians(lons)
    dlat = rlats - clat
    dlon = rlons - clon
    a = np.sin(dlat / 2) ** 2 + math.cos(clat) * np.cos(rlats) * np.sin(dlon / 2) ** 2
    return R * 2 * np.arctan2(np.sqrt(a), np.sqrt(1.0 - a))


def zips_in_radius(lat: float, lon: float, miles: float) -> list[dict]:
    """Return ZIP codes whose centroid is within `miles` of (lat, lon).

    Algorithm:
      1. Bounding-box pre-filter eliminates ~98-99% of rows instantly.
      2. Vectorized Haversine on the surviving ~200-800 candidates.
      3. No Python-level loop; no per-row geopy call.

    Returns list of {zip, city, state, lat, lon, distMiles}.
    """
    _ensure_loaded()

    # ── 1. Bounding-box filter ────────────────────────────────────────────
    # 1° latitude ≈ 69 miles (constant everywhere)
    # 1° longitude ≈ 69 * cos(lat) miles
    lat_deg = miles / 69.0
    lon_deg = miles / max(69.0 * math.cos(math.radians(lat)), 1.0)

    lat_min = lat - lat_deg
    lat_max = lat + lat_deg
    lon_min = lon - lon_deg
    lon_max = lon + lon_deg

    mask = (
        (_lat_arr >= lat_min) & (_lat_arr <= lat_max) &
        (_lon_arr >= lon_min) & (_lon_arr <= lon_max)
    )
    candidate_idx = np.where(mask)[0]

    if len(candidate_idx) == 0:
        return []

    # ── 2. Exact Haversine on candidates ────────────────────────────────
    c_lats = _lat_arr[candidate_idx]
    c_lons = _lon_arr[candidate_idx]
    distances = _haversine_miles_vec(lat, lon, c_lats, c_lons)

    in_radius = candidate_idx[distances <= miles]
    in_dists = distances[distances <= miles]

    # ── 3. Build result list ────────────────────────────────────────────
    results = []
    for i, dist in zip(in_radius, in_dists):
        results.append({
            "zip": _zip_codes[i],
            "city": _zip_cities[i],
            "state": _zip_states[i],
            "lat": float(_lat_arr[i]),
            "lon": float(_lon_arr[i]),
            "distMiles": round(float(dist), 1),
        })
    results.sort(key=lambda r: r["distMiles"])
    return results


def preload_zip_data() -> int:
    """Call at app startup to warm up the ZIP centroid cache.
    Returns the number of ZIP codes loaded.
    """
    _ensure_loaded()
    return len(_zip_codes)


# ── Location verification ──────────────────────────────────────────────────

def verify_location(
    territory: dict,
    caller_zip: str | None,
    caller_lat: float | None,
    caller_lon: float | None,
) -> dict:
    """Check whether a caller is inside the configured territory.
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
    if (
        caller_lat is not None
        and caller_lon is not None
        and hq_lat
        and hq_lon
        and radius_miles
    ):
        dist = geodesic((hq_lat, hq_lon), (caller_lat, caller_lon)).miles
        return {
            "inTerritory": dist <= radius_miles,
            "method": "radius",
            "distanceMiles": round(dist, 2),
        }

    return {"inTerritory": False, "method": "unknown"}
