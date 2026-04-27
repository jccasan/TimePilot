import os
import re
import uuid
import json
from datetime import datetime
from pathlib import Path
from flask import (
    Flask, render_template, request, redirect, url_for,
    jsonify, send_from_directory, abort, Response, flash
)
from tinydb import TinyDB, Query
from dotenv import load_dotenv
from werkzeug.utils import secure_filename

load_dotenv()

BASE_DIR = Path(__file__).parent
app = Flask(__name__, template_folder=str(BASE_DIR / "templates"), static_folder=str(BASE_DIR / "static"))
app.secret_key = os.environ.get("FLASK_SECRET", "scoopilot-wizard-dev-secret")

# Directories
UPLOADS_DIR = BASE_DIR / "uploads"
OUTPUT_DIR = BASE_DIR / "output"
DB_DIR = BASE_DIR / "data"
for d in [UPLOADS_DIR, OUTPUT_DIR, DB_DIR]:
    d.mkdir(parents=True, exist_ok=True)

db = TinyDB(str(DB_DIR / "wizard.json"))
Tenant = Query()

RETELL_API_KEY = os.environ.get("RETELL_API_KEY", "")
SCOOPILOT_API = "https://app.scooppilot.com"

# Auth keys — fail-closed: if not set, those endpoints are unreachable
_WIZARD_API_KEY = os.environ.get("WIZARD_API_KEY", "")
_WIZARD_ADMIN_KEY = os.environ.get("WIZARD_ADMIN_KEY", "")

def _check_wizard_key(provided: str) -> bool:
    if not _WIZARD_API_KEY:
        return False  # env var not set → deny all
    return provided == _WIZARD_API_KEY

def _check_admin_key(provided: str) -> bool:
    if not _WIZARD_ADMIN_KEY:
        return False
    return provided == _WIZARD_ADMIN_KEY

ALLOWED_EXTENSIONS = {
    "csv", "xlsx", "xls", "pdf", "png", "jpg", "jpeg", "gif",
    "doc", "docx", "txt", "zip",
}

UPLOAD_CATEGORIES = [
    "Company Info", "Competitor Pricing", "Contract / Service Agreement",
    "Customer List", "Employee / Technician List", "Logo",
    "Pricing List", "Routes", "Service Area", "Other",
]

FREQUENCIES = ["One-Time", "Twice Weekly", "Weekly", "Bi-Weekly", "Monthly"]
TIMEZONES = [
    "America/New_York", "America/Chicago", "America/Denver",
    "America/Los_Angeles", "America/Anchorage", "Pacific/Honolulu",
    "America/Phoenix", "America/Indiana/Indianapolis",
    "America/Toronto", "America/Vancouver",
]


# ──────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────

def normalize_phone(phone: str) -> str:
    digits = re.sub(r"\D", "", phone)
    if len(digits) == 10:
        digits = "1" + digits
    return "+" + digits


def get_tenant(phone: str):
    return db.get(Tenant.phone == phone)


def upsert_tenant(phone: str, data: dict):
    existing = db.get(Tenant.phone == phone)
    data["updatedAt"] = datetime.utcnow().isoformat()
    if existing:
        db.update(data, Tenant.phone == phone)
    else:
        data["phone"] = phone
        data["createdAt"] = data["updatedAt"]
        db.insert(data)


def merge_tenant(phone: str, partial: dict):
    existing = get_tenant(phone) or {}
    merged = {**existing, **partial}
    merged["updatedAt"] = datetime.utcnow().isoformat()
    if db.get(Tenant.phone == phone):
        db.update(merged, Tenant.phone == phone)
    else:
        merged["phone"] = phone
        merged["createdAt"] = merged["updatedAt"]
        db.insert(merged)
    return get_tenant(phone)


def completeness(tenant: dict) -> dict:
    profile = tenant.get("profile", {})
    territory = tenant.get("territory", {})
    pricing = tenant.get("pricing", {})
    policies = tenant.get("policies", {})
    voice = tenant.get("voiceAgent", {})
    docs = tenant.get("documents", [])
    creds = tenant.get("credentials", {})

    sections = {
        "General Profile": bool(profile.get("businessName") and profile.get("email")),
        "Territory": bool(territory.get("zipList") or territory.get("radiusMiles")),
        "Pricing": bool(pricing.get("baseGrid")),
        "Policies": bool(policies.get("disposal")),
        "API Credentials": bool(creds.get("xApiKey")),
        "Voice Config": bool(voice.get("greeting")),
        "Documents": len(docs) > 0,
    }
    total = len(sections)
    completed = sum(sections.values())
    return {"sections": sections, "completed": completed, "total": total}


def fetch_scoopilot_profile(phone: str) -> dict | None:
    if not RETELL_API_KEY:
        return None
    try:
        r = __import__("requests").get(
            f"{SCOOPILOT_API}/api/retell/tenant-profile",
            params={"to": phone},
            headers={"Authorization": f"Bearer {RETELL_API_KEY}"},
            timeout=6,
        )
        if r.status_code == 200:
            return r.json()
    except Exception:
        pass
    return None


def allowed_file(filename: str) -> bool:
    return "." in filename and filename.rsplit(".", 1)[1].lower() in ALLOWED_EXTENSIONS


def preview_file(filepath: Path, filename: str) -> str | None:
    """Return HTML table of first 5 rows for CSV/Excel."""
    ext = filename.rsplit(".", 1)[-1].lower()
    try:
        import pandas as pd
        if ext == "csv":
            df = pd.read_csv(filepath, nrows=5, dtype=str, encoding_errors="replace")
        elif ext in ("xlsx", "xls"):
            df = pd.read_excel(filepath, nrows=5, dtype=str)
        else:
            return None
        return df.to_html(classes="preview-table", index=False, border=0, na_rep="")
    except Exception:
        return None


# ──────────────────────────────────────────
# Routes: Dashboard
# ──────────────────────────────────────────

@app.get("/")
def dashboard():
    all_tenants = db.all()
    all_tenants.sort(key=lambda t: t.get("updatedAt", ""), reverse=True)
    enriched = []
    for t in all_tenants:
        c = completeness(t)
        enriched.append({**t, "completeness": c})
    return render_template("dashboard.html", tenants=enriched)


# ──────────────────────────────────────────
# Routes: Landing / Start
# ──────────────────────────────────────────

@app.route("/start", methods=["GET", "POST"])
def landing():
    error = None
    if request.method == "POST":
        raw_phone = request.form.get("phone", "").strip()
        agent_types = request.form.getlist("agentTypes")
        if not raw_phone:
            error = "Please enter a phone number."
        else:
            phone = normalize_phone(raw_phone)
            existing = get_tenant(phone)
            if existing:
                return redirect(url_for("onboard", phone=phone))

            # Try ScooPilot API pre-fill
            sp = fetch_scoopilot_profile(phone)
            profile = {}
            if sp:
                profile = {
                    "businessName": sp.get("businessName", ""),
                    "legalName": sp.get("businessName", ""),
                    "email": sp.get("businessEmail", ""),
                    "phone": sp.get("businessPhone", phone),
                    "businessAddress": sp.get("serviceArea", ""),
                    "primaryService": "Pet Waste",
                    "timezone": "America/New_York",
                }
                if sp.get("zipRouting"):
                    agent_types = list(set(agent_types + ["voice"]))

            record = {
                "phone": phone,
                "agentTypes": agent_types if agent_types else [],
                "profile": profile,
                "territory": {"mode": "zip", "zipList": [], "zipCentroids": {}},
                "pricing": {"baseGrid": {f: {} for f in FREQUENCIES},
                            "yardMultipliers": {}, "cleanupSurcharges": {}},
                "policies": {},
                "voiceAgent": {},
                "chatAgent": {},
                "documents": [],
                "credentials": {"xApiKey": str(uuid.uuid4())},
                "source": "api" if sp else "manual",
                "complete": False,
                "createdAt": datetime.utcnow().isoformat(),
                "updatedAt": datetime.utcnow().isoformat(),
            }
            db.insert(record)
            return redirect(url_for("onboard", phone=phone))

    return render_template("landing.html", error=error)


# ──────────────────────────────────────────
# Routes: Onboard
# ──────────────────────────────────────────

@app.get("/onboard/<phone>")
def onboard(phone: str):
    tenant = get_tenant(phone)
    if not tenant:
        return redirect(url_for("landing"))
    c = completeness(tenant)
    return render_template(
        "onboard.html",
        tenant=tenant,
        phone=phone,
        completeness=c,
        frequencies=FREQUENCIES,
        timezones=TIMEZONES,
        upload_categories=UPLOAD_CATEGORIES,
    )


@app.post("/onboard/<phone>")
def onboard_save(phone: str):
    tenant = get_tenant(phone)
    if not tenant:
        return redirect(url_for("landing"))

    f = request.form

    profile = {
        "legalName": f.get("legalName", ""),
        "businessName": f.get("businessName", ""),
        "email": f.get("email", ""),
        "phone": f.get("bizPhone", ""),
        "primaryService": f.get("primaryService", ""),
        "timezone": f.get("timezone", ""),
        "businessAddress": f.get("businessAddress", ""),
    }

    # Territory
    territory_mode = f.get("territoryMode", "zip")
    zip_raw = f.get("selectedZips", "")
    zip_list = [z.strip() for z in zip_raw.split(",") if z.strip()]
    zip_centroids_raw = f.get("zipCentroids", "{}")
    try:
        zip_centroids = json.loads(zip_centroids_raw)
    except Exception:
        zip_centroids = {}
    territory = {
        "mode": territory_mode,
        "zipList": zip_list,
        "zipCentroids": zip_centroids,
        "hqLat": float(f["hqLat"]) if f.get("hqLat") else None,
        "hqLon": float(f["hqLon"]) if f.get("hqLon") else None,
        "hqAddress": f.get("businessAddress", ""),
        "radiusMiles": float(f["radiusMiles"]) if f.get("radiusMiles") else None,
    }

    # Pricing base grid
    base_grid = {}
    for freq in FREQUENCIES:
        key = freq.replace(" ", "_").replace("-", "_")
        row = {}
        for col in ["1", "2", "3", "4p"]:
            val = f.get(f"price_{key}_{col}", "").strip()
            if val:
                row[col] = val
        if row:
            base_grid[freq] = row
    # Quick fill rules (formula: base + floor((dogs-1)/Y) * X)
    qf_x = f.get("qf_X_saved", "").strip()
    qf_y = f.get("qf_Y_saved", "").strip()
    quick_fill_rules = {}
    if qf_x:
        quick_fill_rules["X"] = qf_x
    if qf_y:
        quick_fill_rules["Y"] = qf_y

    pricing = {
        "baseGrid": base_grid,
        "yardMultipliers": {
            "small": f.get("yard_small", ""),
            "medium": f.get("yard_medium", ""),
            "large": f.get("yard_large", ""),
        },
        "cleanupSurcharges": {
            "light": f.get("cleanup_light", ""),
            "medium": f.get("cleanup_medium", ""),
            "heavy": f.get("cleanup_heavy", ""),
        },
        "quickFillRules": quick_fill_rules,
    }

    policies = {
        "disposal": f.get("disposal", ""),
        "gateCode": f.get("gateCode", ""),
        "aggressiveDog": f.get("aggressiveDog", ""),
        "guarantee": f.get("guarantee", ""),
        "leadTimeHours": f.get("leadTimeHours", ""),
        "vacationHold": f.get("vacationHold", ""),
        "rescheduling": f.get("rescheduling", ""),
        "managerPhone": f.get("managerPhone", ""),
    }

    biz_name = profile["businessName"] or "Us"
    default_greeting = f.get("greeting") or f"Thanks for calling {biz_name}, how can I help you today?"
    voice_agent = {
        "greeting": default_greeting,
        "serviceAreaOverride": f.get("serviceAreaOverride", ""),
        "specialLines": f.get("specialLines", ""),
    }

    chat_agent = {
        "placeholder": True,
        "notes": f.get("chatNotes", ""),
    }

    agent_types = request.form.getlist("agentTypes")

    merged = merge_tenant(phone, {
        "agentTypes": agent_types,
        "profile": profile,
        "territory": territory,
        "pricing": pricing,
        "policies": policies,
        "voiceAgent": voice_agent,
        "chatAgent": chat_agent,
        "complete": True,
    })

    # Generate output files
    from file_gen import write_all_files
    write_all_files(merged)

    return redirect(url_for("ready", phone=phone))


@app.post("/update-agent-types/<phone>")
def update_agent_types(phone: str):
    agent_types = request.json.get("agentTypes", [])
    merge_tenant(phone, {"agentTypes": agent_types})
    return jsonify({"ok": True})


@app.post("/geocode")
def geocode():
    address = request.json.get("address", "").strip()
    if not address:
        return jsonify({"error": "No address"}), 400
    from geo import geocode_address
    result = geocode_address(address)
    if result:
        return jsonify(result)
    return jsonify({"error": "Not found"}), 404


@app.get("/api/zips-in-bounds")
def zips_in_bounds():
    try:
        lat = float(request.args["lat"])
        lon = float(request.args["lon"])
        miles = float(request.args.get("miles", 30))
        miles = min(miles, 100)
    except (KeyError, ValueError):
        return jsonify({"error": "lat, lon required"}), 400
    from geo import zips_in_radius
    zips = zips_in_radius(lat, lon, miles)
    return jsonify({"zips": zips})


# Census TIGER API for ZCTA polygon GeoJSON — with server-side disk cache
_TIGER_URL = (
    "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb"
    "/PUMA_TAD_TAZ_UGA_ZCTA/MapServer/1/query"
)
_POLY_CACHE_DIR = DB_DIR / "polygon_cache"
_POLY_CACHE_DIR.mkdir(parents=True, exist_ok=True)

import requests as _http


@app.get("/api/zip-polygons")
def zip_polygons():
    """Return GeoJSON FeatureCollection of ZCTA polygon boundaries.
    Accepts ?zips=23220,23221,... (up to 50 per call).
    Results cached on disk to avoid repeated Census API calls.
    """
    raw = request.args.get("zips", "")
    requested = [z.strip().zfill(5) for z in raw.split(",") if z.strip()][:50]
    if not requested:
        return jsonify({"type": "FeatureCollection", "features": []})

    features = []
    need_fetch = []

    for zip_code in requested:
        cache_path = _POLY_CACHE_DIR / f"{zip_code}.json"
        if cache_path.exists():
            try:
                feat = json.loads(cache_path.read_text())
                features.append(feat)
                continue
            except Exception:
                pass
        need_fetch.append(zip_code)

    if need_fetch:
        # Batch fetch from Census TIGER (up to 50 at once)
        where_clause = "ZCTA5 IN (" + ",".join(f"'{z}'" for z in need_fetch) + ")"
        try:
            resp = _http.get(
                _TIGER_URL,
                params={
                    "where": where_clause,
                    "outFields": "ZCTA5",
                    "outSR": "4326",
                    "f": "geojson",
                    "simplifyFactor": "0.002",
                    "resultRecordCount": "50",
                },
                timeout=15,
            )
            if resp.status_code == 200:
                data = resp.json()
                for feat in data.get("features", []):
                    zip_code = feat.get("properties", {}).get("ZCTA5", "")
                    if zip_code:
                        cache_path = _POLY_CACHE_DIR / f"{zip_code.zfill(5)}.json"
                        cache_path.write_text(json.dumps(feat))
                    features.append(feat)
        except Exception as exc:
            app.logger.warning(f"[wizard] Census TIGER fetch failed: {exc}")

    return jsonify({"type": "FeatureCollection", "features": features})


# ──────────────────────────────────────────
# Routes: Document Uploads
# ──────────────────────────────────────────

@app.post("/upload/<phone>")
def upload_doc(phone: str):
    tenant = get_tenant(phone)
    if not tenant:
        return jsonify({"error": "Tenant not found"}), 404

    category = request.form.get("category", "Other")
    file = request.files.get("file")
    if not file or not file.filename:
        return jsonify({"error": "No file"}), 400
    if not allowed_file(file.filename):
        return jsonify({"error": "File type not allowed"}), 400

    safe_phone = phone.replace("+", "").replace(" ", "")
    upload_dir = UPLOADS_DIR / safe_phone
    upload_dir.mkdir(parents=True, exist_ok=True)

    filename = secure_filename(file.filename)
    # Deduplicate
    target = upload_dir / filename
    counter = 1
    stem = target.stem
    suffix = target.suffix
    while target.exists():
        target = upload_dir / f"{stem}_{counter}{suffix}"
        counter += 1

    file.save(str(target))

    preview_html = preview_file(target, filename)

    doc_entry = {
        "filename": filename,
        "savedAs": target.name,
        "category": category,
        "path": str(target),
        "preview": preview_html,
        "uploadedAt": datetime.utcnow().isoformat(),
    }

    docs = tenant.get("documents", [])
    docs.append(doc_entry)
    merge_tenant(phone, {"documents": docs})

    return jsonify({"ok": True, "doc": doc_entry})


@app.post("/remove-doc/<phone>")
def remove_doc(phone: str):
    tenant = get_tenant(phone)
    if not tenant:
        return jsonify({"error": "Tenant not found"}), 404

    filename = request.json.get("filename")
    docs = tenant.get("documents", [])
    to_remove = next((d for d in docs if d["filename"] == filename or d["savedAs"] == filename), None)
    if to_remove:
        try:
            Path(to_remove["path"]).unlink(missing_ok=True)
        except Exception:
            pass
        docs = [d for d in docs if d is not to_remove]
        merge_tenant(phone, {"documents": docs})
    return jsonify({"ok": True})


@app.get("/uploads/<phone>/<filename>")
def serve_upload(phone: str, filename: str):
    safe_phone = phone.replace("+", "").replace(" ", "")
    upload_dir = UPLOADS_DIR / safe_phone
    return send_from_directory(str(upload_dir), filename)


# ──────────────────────────────────────────
# Routes: Ready Page
# ──────────────────────────────────────────

@app.get("/ready/<phone>")
def ready(phone: str):
    tenant = get_tenant(phone)
    if not tenant:
        return redirect(url_for("landing"))
    c = completeness(tenant)
    safe_phone = phone.replace("+", "").replace(" ", "")
    out_dir = OUTPUT_DIR / safe_phone
    output_files = {
        "tenantConfig": (out_dir / "tenant_config.json").exists(),
        "territoryData": (out_dir / "territory_data.json").exists(),
        "agentHandbook": (out_dir / "agent_handbook.md").exists(),
        "apiCredentials": (out_dir / "api_credentials.json").exists(),
    }
    return render_template("ready.html", tenant=tenant, phone=phone, completeness=c, output_files=output_files)


@app.get("/download/<phone>/<filename>")
def download_output(phone: str, filename: str):
    safe_phone = phone.replace("+", "").replace(" ", "")
    out_dir = OUTPUT_DIR / safe_phone
    if not (out_dir / filename).exists():
        abort(404)
    return send_from_directory(str(out_dir), filename, as_attachment=True)


# ──────────────────────────────────────────
# Routes: Handbook
# ──────────────────────────────────────────

@app.get("/handbook/<phone>")
def handbook(phone: str):
    safe_phone = phone.replace("+", "").replace(" ", "")
    md_path = OUTPUT_DIR / safe_phone / "agent_handbook.md"
    if md_path.exists():
        content = md_path.read_text()
    else:
        tenant = get_tenant(phone)
        if not tenant:
            abort(404)
        from file_gen import _render_handbook, generate_tenant_config
        config = generate_tenant_config(tenant)
        content = _render_handbook(tenant, config)
    return Response(content, mimetype="text/plain; charset=utf-8")


# ──────────────────────────────────────────
# Routes: JSON Config API
# ──────────────────────────────────────────

@app.get("/api/config/<path:phone>")
def api_config(phone: str):
    key = request.headers.get("X-Wizard-Key", "") or request.args.get("key", "")
    if not _check_wizard_key(key):
        abort(401)
    phone = normalize_phone(phone) if not phone.startswith("+") else phone
    safe_phone = phone.replace("+", "").replace(" ", "")
    config_path = OUTPUT_DIR / safe_phone / "tenant_config.json"
    if config_path.exists():
        return Response(config_path.read_text(), mimetype="application/json")
    tenant = get_tenant(phone)
    if not tenant:
        abort(404)
    from file_gen import generate_tenant_config
    return jsonify(generate_tenant_config(tenant))


@app.post("/api/verify-location")
def verify_location_api():
    data = request.json or {}
    phone = data.get("phone", "")
    if phone and not phone.startswith("+"):
        phone = normalize_phone(phone)

    # Source-of-truth: load from territory_data.json first
    safe_phone = phone.replace("+", "").replace(" ", "")
    territory_path = OUTPUT_DIR / safe_phone / "territory_data.json"
    territory = None

    if territory_path.exists():
        try:
            raw = json.loads(territory_path.read_text())
            # Normalise keys to match geo.verify_location expectations
            territory = {
                "mode": raw.get("mode", "zip"),
                "zipList": raw.get("zipList", []),
                "hqLat": raw.get("hqLat"),
                "hqLon": raw.get("hqLon"),
                "radiusMiles": raw.get("radiusMiles"),
            }
        except Exception:
            pass

    # Fallback to TinyDB record if file not available yet
    if territory is None:
        tenant = get_tenant(phone)
        if not tenant:
            abort(404)
        t = tenant.get("territory", {})
        if not t:
            abort(404, description="Territory not configured for this tenant")
        territory = t

    caller_zip = data.get("callerZip")
    caller_lat = data.get("callerLat")
    caller_lon = data.get("callerLon")
    from geo import verify_location
    return jsonify(verify_location(territory, caller_zip, caller_lat, caller_lon))


# ──────────────────────────────────────────
# Routes: Sysadmin Credentials
# ──────────────────────────────────────────

@app.route("/admin/credentials/<phone>", methods=["GET", "POST"])
def admin_credentials(phone: str):
    # Auth via header or query param
    provided_key = (
        request.headers.get("X-Admin-Key", "")
        or request.args.get("admin_key", "")
        or request.form.get("admin_key", "")
    )
    if not _check_admin_key(provided_key):
        return render_template("admin_creds.html", phone=phone, tenant=None,
                               error="Invalid admin key. Access denied.", admin_key=""), 403

    tenant = get_tenant(phone)
    if not tenant:
        abort(404)

    saved = False
    if request.method == "POST":
        new_key = request.form.get("xApiKey", "").strip()
        if new_key:
            merge_tenant(phone, {"credentials": {"xApiKey": new_key}})
            tenant = get_tenant(phone)
            saved = True

    return render_template(
        "admin_creds.html",
        phone=phone,
        tenant=tenant,
        error=None,
        admin_key=provided_key,
        saved=saved,
    )


# ──────────────────────────────────────────
# Run
# ──────────────────────────────────────────

def _startup_preload():
    """Preload ZIP centroid data in a background thread so the first map
    request is fast.  Runs once at startup; safe to call multiple times."""
    import threading
    def _load():
        try:
            from geo import preload_zip_data
            n = preload_zip_data()
            app.logger.info(f"[wizard] ZIP centroid cache ready — {n} ZIPs loaded")
        except Exception as exc:
            app.logger.warning(f"[wizard] ZIP preload failed: {exc}")
    t = threading.Thread(target=_load, daemon=True)
    t.start()


if __name__ == "__main__":
    _startup_preload()
    port = int(os.environ.get("WIZARD_PORT", 5001))
    app.run(host="0.0.0.0", port=port, debug=False)
