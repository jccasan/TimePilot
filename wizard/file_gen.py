import json
import os
from pathlib import Path
from datetime import datetime

STATIC_PROTOCOL = {
    "backchannelWords": ["Gotcha", "Right", "I see", "yeah", "yes", "ok"],
    "spellingProtocol": "common_words",
    "spellingExamples": {
        "A": "Apple", "B": "Banana", "C": "Car", "D": "Dog", "E": "Echo",
        "F": "Frank", "G": "George", "H": "Henry", "I": "Igloo", "J": "John",
        "K": "King", "L": "Larry", "M": "Mary", "N": "Nancy", "O": "Ocean",
        "P": "Peter", "Q": "Queen", "R": "Robert", "S": "Sam", "T": "Tom",
        "U": "Uncle", "V": "Victor", "W": "William", "X": "X-ray",
        "Y": "Yellow", "Z": "Zebra",
    },
    "voicemailDetection": False,
    "callDirection": "inbound",
}

OUTPUT_BASE = Path(__file__).parent / "output"


def _dir(phone: str) -> Path:
    safe = phone.replace("+", "").replace(" ", "")
    d = OUTPUT_BASE / safe
    d.mkdir(parents=True, exist_ok=True)
    return d


def generate_tenant_config(tenant: dict) -> dict:
    profile = tenant.get("profile", {})
    pricing = tenant.get("pricing", {})
    territory = tenant.get("territory", {})
    policies = tenant.get("policies", {})
    voice = tenant.get("voiceAgent", {})
    chat = tenant.get("chatAgent", {})

    config = {
        "tenantId": tenant.get("phone", ""),
        "businessName": profile.get("businessName", ""),
        "legalName": profile.get("legalName", ""),
        "businessPhone": profile.get("phone", ""),
        "businessEmail": profile.get("email", ""),
        "primaryService": profile.get("primaryService", ""),
        "timezone": profile.get("timezone", ""),
        "businessAddress": profile.get("businessAddress", ""),
        "agentTypes": tenant.get("agentTypes", []),
        "serviceArea": {
            "mode": territory.get("mode", "zip"),
            "zipList": territory.get("zipList", []),
            "hqLat": territory.get("hqLat"),
            "hqLon": territory.get("hqLon"),
            "radiusMiles": territory.get("radiusMiles"),
            "hqAddress": territory.get("hqAddress", ""),
        },
        "pricing": {
            "baseGrid": pricing.get("baseGrid", {}),
            "yardMultipliers": pricing.get("yardMultipliers", {}),
            "cleanupSurcharges": pricing.get("cleanupSurcharges", {}),
        },
        "policies": {
            "disposalMethod": policies.get("disposal", ""),
            "gateCode": policies.get("gateCode", ""),
            "aggressiveDog": policies.get("aggressiveDog", ""),
            "satisfactionGuarantee": policies.get("guarantee", ""),
            "minBookingLeadTimeHours": policies.get("leadTimeHours", ""),
            "vacationHold": policies.get("vacationHold", ""),
            "rescheduling": policies.get("rescheduling", ""),
            "managerPhone": policies.get("managerPhone", ""),
        },
        "voiceAgent": {
            "greeting": voice.get("greeting", ""),
            "serviceAreaOverride": voice.get("serviceAreaOverride", ""),
            "specialLines": voice.get("specialLines", ""),
        },
        "chatAgent": chat,
        **STATIC_PROTOCOL,
        "generatedAt": datetime.utcnow().isoformat() + "Z",
    }
    return config


def write_all_files(tenant: dict) -> dict:
    phone = tenant.get("phone", "unknown")
    out_dir = _dir(phone)

    config = generate_tenant_config(tenant)

    # 1. tenant_config.json
    config_path = out_dir / "tenant_config.json"
    config_path.write_text(json.dumps(config, indent=2, default=str))

    # 2. territory_data.json
    territory = tenant.get("territory", {})
    territory_data = {
        "tenantId": phone,
        "mode": territory.get("mode", "zip"),
        "zipList": territory.get("zipList", []),
        "zipCentroids": territory.get("zipCentroids", {}),
        "hqLat": territory.get("hqLat"),
        "hqLon": territory.get("hqLon"),
        "hqAddress": territory.get("hqAddress", ""),
        "radiusMiles": territory.get("radiusMiles"),
    }
    (out_dir / "territory_data.json").write_text(json.dumps(territory_data, indent=2))

    # 3. agent_handbook.md
    (out_dir / "agent_handbook.md").write_text(_render_handbook(tenant, config))

    # 4. api_credentials.json — tenantId + xApiKey only (strict contract)
    creds = tenant.get("credentials", {})
    creds_data = {
        "tenantId": phone,
        "xApiKey": creds.get("xApiKey", ""),
    }
    (out_dir / "api_credentials.json").write_text(json.dumps(creds_data, indent=2))

    return {
        "tenantConfig": str(config_path),
        "territoryData": str(out_dir / "territory_data.json"),
        "agentHandbook": str(out_dir / "agent_handbook.md"),
        "apiCredentials": str(out_dir / "api_credentials.json"),
    }


def _render_handbook(tenant: dict, config: dict) -> str:
    p = config.get("policies", {})
    v = config.get("voiceAgent", {})
    pr = config.get("pricing", {})
    sa = config.get("serviceArea", {})
    nc = "Not configured"

    def val(x): return x if x else nc

    lines = [
        f"# Agent Handbook — {config.get('businessName', 'Unknown Business')}",
        f"*Generated: {config.get('generatedAt', '')}*",
        "",
        "---",
        "## Business Overview",
        f"- **Business Name:** {val(config.get('businessName'))}",
        f"- **Legal Name:** {val(config.get('legalName'))}",
        f"- **Phone:** {val(config.get('businessPhone'))}",
        f"- **Email:** {val(config.get('businessEmail'))}",
        f"- **Primary Service:** {val(config.get('primaryService'))}",
        f"- **Timezone:** {val(config.get('timezone'))}",
        f"- **Business Address:** {val(config.get('businessAddress'))}",
        "",
        "---",
        "## Service Area",
        f"- **Mode:** {sa.get('mode', nc)}",
    ]
    if sa.get("mode") == "zip" and sa.get("zipList"):
        lines.append(f"- **ZIP Codes:** {', '.join(sa['zipList'])}")
    elif sa.get("mode") == "radius":
        lines += [
            f"- **HQ Address:** {val(sa.get('hqAddress'))}",
            f"- **Service Radius:** {val(sa.get('radiusMiles'))} miles",
        ]

    # Pricing table
    lines += ["", "---", "## Pricing Matrix", ""]
    base_grid = pr.get("baseGrid", {})
    if base_grid:
        lines.append("| Frequency | 1 Dog | 2 Dogs | 3 Dogs | 4+ Dogs |")
        lines.append("|-----------|-------|--------|--------|---------|")
        for freq, dogs in base_grid.items():
            row = [
                f"${dogs.get('1','')}" if dogs.get('1') else nc,
                f"${dogs.get('2','')}" if dogs.get('2') else nc,
                f"${dogs.get('3','')}" if dogs.get('3') else nc,
                f"${dogs.get('4p','')}" if dogs.get('4p') else nc,
            ]
            lines.append(f"| {freq} | {' | '.join(row)} |")
    else:
        lines.append(nc)

    ym = pr.get("yardMultipliers", {})
    if any(ym.values()):
        lines += ["", "**Yard Size Multipliers:**",
                  f"- Small: {ym.get('small', nc)}x",
                  f"- Medium: {ym.get('medium', nc)}x",
                  f"- Large: {ym.get('large', nc)}x"]

    cs = pr.get("cleanupSurcharges", {})
    if any(cs.values()):
        lines += ["", "**Initial Cleanup Surcharges:**",
                  f"- Light: ${cs.get('light', nc)}",
                  f"- Medium: ${cs.get('medium', nc)}",
                  f"- Heavy: ${cs.get('heavy', nc)}"]

    lines += [
        "", "---", "## Operational Policies",
        f"- **Disposal Method:** {val(p.get('disposalMethod'))}",
        f"- **Gate / Access Code:** {val(p.get('gateCode'))}",
        f"- **Aggressive Dog Protocol:** {val(p.get('aggressiveDog'))}",
        f"- **Satisfaction Guarantee:** {val(p.get('satisfactionGuarantee'))}",
        f"- **Min Booking Lead Time:** {val(p.get('minBookingLeadTimeHours'))} hours",
        f"- **Vacation Hold:** {val(p.get('vacationHold'))}",
        f"- **Rescheduling Rules:** {val(p.get('rescheduling'))}",
        f"- **Manager / Escalation Phone:** {val(p.get('managerPhone'))}",
        "", "---", "## Voice Agent Script",
        f"**Greeting:** {val(v.get('greeting'))}",
    ]
    if v.get("specialLines"):
        lines += ["", f"**Special Handling:** {v['specialLines']}"]
    if v.get("serviceAreaOverride"):
        lines += ["", f"**Service Area Description:** {v['serviceAreaOverride']}"]

    lines += [
        "", "---", "## Agent Protocol (Hardcoded)",
        f"- **Backchannel Words:** {', '.join(STATIC_PROTOCOL['backchannelWords'])}",
        "- **Spelling Protocol:** Common Words (A as in Apple, B as in Banana, etc.)",
        "- **Voicemail Detection:** Disabled",
        "- **Call Direction:** Inbound only",
    ]

    docs = tenant.get("documents", [])
    if docs:
        lines += ["", "---", "## Uploaded Documents"]
        for d in docs:
            lines.append(f"- **{d.get('category', 'Other')}:** {d.get('filename', '')}")

    return "\n".join(lines)
