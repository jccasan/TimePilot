import { useState, useRef, useCallback } from "react";

// ─── PLATFORM / FLOW DEFINITIONS ────────────────────────────────────────────

const FLOWS = {

  // ── JOBBER ──────────────────────────────────────────────────────────────
  jobber: {
    platform: "jobber",
    label: "Jobber",
    sublabel: "All clients",
    color: "#F59E0B",
    icon: "J",
    clientType: "residential",
    emailExport: true,
    files: [
      {
        id: "clients",
        label: "Client List",
        required: true,
        nav: "Clients → More Actions → Export Clients → CSV",
        instructions: [
          'Click "Clients" in the left sidebar',
          'In the top right corner, click "More Actions"',
          'Click "Export Clients"',
          'In the pop-up, click "CSV"',
          "Jobber will email you the file — download the CSV attachment and upload it here",
        ],
        tip: "Contact info, addresses, custom fields (dog count, notes), tags, lead source.",
      },
      {
        id: "jobs",
        label: "Recurring Jobs Report",
        required: true,
        nav: "Insights → Reports → Recurring Jobs Report → Export to CSV",
        instructions: [
          'Click "Insights" in the left sidebar, then select "Reports"',
          'Under Work Reports, click "Recurring Jobs Report"',
          'Click the "Columns" button and enable: Client name, Client email, Client phone number, Service street, Service city, Service state/province, Service zip/postal code, Line items, Total ($), Schedule start date, Billing type',
          'Set the Active filter to "Active" and Started date to "All time"',
          'Click "Export to CSV" and select "All columns"',
          "Jobber will email you the file — download the CSV attachment and upload it here",
        ],
        tip: "Pricing, frequency, and start dates live here. Enabling the right columns before exporting is critical — don't skip that step.",
      },
    ],
    aiMode: "residential",
  },

  // ── SWEEP & GO — RESIDENTIAL ────────────────────────────────────────────
  sweepgo_residential: {
    platform: "sweepgo",
    label: "Sweep & Go",
    sublabel: "Residential clients",
    color: "#10B981",
    icon: "SR",
    clientType: "residential",
    files: [
      {
        id: "clients",
        label: "Residential Client List",
        required: true,
        nav: "Clients → Residential → CSV",
        instructions: [
          "Log into Sweep & Go",
          'Click "Clients" in the left sidebar',
          'Click "Residential"',
          'Click "CSV" to export',
          "Upload that file here",
        ],
        tip: "Name, email, phone, address, status, referral source.",
      },
      {
        id: "subscriptions",
        label: "Residential Subscriptions",
        required: true,
        nav: "Billing → Residential Subscriptions → CSV",
        instructions: [
          'Click "Billing" in the left sidebar',
          'Click "Residential Subscriptions"',
          'Click "CSV" to export',
          "Upload that file here",
        ],
        tip: "Subscription name, billing interval, revenue, start/end dates.",
      },
      {
        id: "schedule",
        label: "Master Schedule",
        required: true,
        nav: "Scheduler → Schedule → CSV",
        instructions: [
          'Click "Scheduler" in the left sidebar',
          'Click "Schedule"',
          'Click "CSV" to export',
          "Upload that file here",
        ],
        tip: "Service days, cleanup frequency, dog count. The most critical file.",
      },
    ],
    aiMode: "residential",
  },

  // ── SWEEP & GO — COMMERCIAL ─────────────────────────────────────────────
  sweepgo_commercial: {
    platform: "sweepgo",
    label: "Sweep & Go",
    sublabel: "Commercial clients",
    color: "#06B6D4",
    icon: "SC",
    clientType: "commercial",
    commercialNote: true,
    files: [
      {
        id: "clients",
        label: "Commercial Client List",
        required: true,
        nav: "Clients → Commercial → CSV",
        instructions: [
          "Log into Sweep & Go",
          'Click "Clients" in the left sidebar',
          'Click "Commercial"',
          'Click "CSV" to export',
          "Upload that file here",
        ],
        tip: "Business name, location name, billing contact, email, phone.",
      },
      {
        id: "subscriptions",
        label: "Commercial Subscriptions",
        required: true,
        nav: "Billing → Commercial Subscriptions → CSV",
        instructions: [
          'Click "Billing" in the left sidebar',
          'Click "Commercial Subscriptions"',
          'Click "CSV" to export',
          "Upload that file here",
        ],
        tip: "Subscription details, billing interval, revenue, dates.",
      },
      {
        id: "schedule",
        label: "Master Schedule",
        required: true,
        nav: "Scheduler → Schedule → CSV",
        instructions: [
          'Click "Scheduler" in the left sidebar',
          'Click "Schedule"',
          'Click "CSV" to export',
          "Same file as residential — the AI will pull only commercial records.",
        ],
        tip: "Service days and cleanup frequency for commercial accounts.",
      },
    ],
    aiMode: "commercial",
  },

  // ── HOUSECALL PRO — RESIDENTIAL ─────────────────────────────────────────
  housecallpro_residential: {
    platform: "housecallpro",
    label: "HouseCall Pro",
    sublabel: "Residential clients",
    color: "#6366F1",
    icon: "HR",
    clientType: "residential",
    emailExport: true,
    files: [
      {
        id: "customers",
        label: "Customer Export",
        required: true,
        nav: "Customers → Actions → Export",
        instructions: [
          'Click "Customers" in the navigation bar at the top of your HCP account',
          'Click the "Actions" button on the right side of your screen',
          'Select "Export" from the drop-down',
          "Confirm your email address and click the blue Send File button",
          "Wait for the email from notifications@housecallpro.com, download the CSV attachment",
          "Upload that file here",
        ],
        tip: "HCP emails the file — usually arrives within a few minutes. Check spam if it doesn't show up.",
      },
      {
        id: "jobs",
        label: "Jobs Export",
        required: true,
        nav: "Customers → Jobs → Actions → Export",
        instructions: [
          'Click "Customers" in the navigation bar at the top of your HCP account',
          'Click "Jobs" from the menu on the left',
          'Click the "Actions" button on the right side of your screen',
          'Select "Export" from the drop-down',
          "Verify your email address and click Send File",
          "Wait for the email from notifications@housecallpro.com, download the CSV attachment",
          "Upload that file here",
        ],
        tip: "Grab both exports before coming back to upload — they both arrive via email.",
      },
    ],
    aiMode: "residential",
  },

  // ── HOUSECALL PRO — COMMERCIAL ──────────────────────────────────────────
  housecallpro_commercial: {
    platform: "housecallpro",
    label: "HouseCall Pro",
    sublabel: "Commercial clients",
    color: "#8B5CF6",
    icon: "HC",
    clientType: "commercial",
    emailExport: true,
    commercialNote: true,
    files: [
      {
        id: "customers",
        label: "Customer Export",
        required: true,
        nav: "Customers → Actions → Export",
        instructions: [
          'Click "Customers" in the navigation bar at the top of your HCP account',
          'Click the "Actions" button on the right side of your screen',
          'Select "Export" from the drop-down',
          "Confirm your email address and click the blue Send File button",
          "Wait for the email from notifications@housecallpro.com, download the CSV attachment",
          "Upload that file here — the AI will filter for commercial accounts",
        ],
        tip: "Export all customers. The AI separates commercial from residential automatically.",
      },
      {
        id: "jobs",
        label: "Jobs Export",
        required: true,
        nav: "Customers → Jobs → Actions → Export",
        instructions: [
          'Click "Customers" in the navigation bar at the top of your HCP account',
          'Click "Jobs" from the menu on the left',
          'Click the "Actions" button on the right side of your screen',
          'Select "Export" from the drop-down',
          "Verify your email address and click Send File",
          "Wait for the email from notifications@housecallpro.com, download the CSV attachment",
          "Upload that file here",
        ],
        tip: "Grab both exports before coming back — they both arrive via email.",
      },
    ],
    aiMode: "commercial",
  },

  // ── OTHER ────────────────────────────────────────────────────────────────
  other: {
    platform: "other",
    label: "Other",
    sublabel: "Any system",
    color: "#94A3B8",
    icon: "?",
    clientType: "residential",
    files: [
      {
        id: "clients",
        label: "All Clients Export",
        required: true,
        nav: "Wherever your system stores client exports",
        instructions: [
          "In your current software, find the client or customer list",
          "Export all clients as a CSV — include every column available",
          "Do not filter or trim anything before uploading",
          "Upload that file here",
        ],
        tip: "Name, email, phone, address, status — grab it all.",
      },
      {
        id: "jobs",
        label: "All Jobs / Service Plans Export",
        required: false,
        nav: "Wherever your system stores job or schedule exports",
        instructions: [
          "Find your jobs, work orders, or service plans section",
          "Export all active jobs as a CSV — include every column available",
          "If your system combines clients and jobs in one export, just upload that above and skip this",
          "Upload that file here",
        ],
        tip: "Skip this if your client export already includes frequency, pricing, and service day. Otherwise this is where that data lives.",
      },
    ],
    aiMode: "residential",
  },
};

// ─── PLATFORM GROUPS (for the picker UI) ────────────────────────────────────

const PLATFORM_GROUPS = {
  jobber:       { label: "Jobber",        color: "#F59E0B", icon: "J", flows: ["jobber"] },
  sweepgo:      { label: "Sweep & Go",    color: "#10B981", icon: "S", flows: ["sweepgo_residential", "sweepgo_commercial"] },
  housecallpro: { label: "HouseCall Pro", color: "#6366F1", icon: "H", flows: ["housecallpro_residential", "housecallpro_commercial"] },
  other:        { label: "Other",         color: "#94A3B8", icon: "?", flows: ["other"] },
};

// ─── SCOOPILOT TARGET FIELDS ─────────────────────────────────────────────────

const RESIDENTIAL_FIELDS = [
  "first_name", "last_name", "email", "phone", "mobile_phone",
  "service_street", "service_city", "service_state", "service_zip",
  "billing_street", "billing_city", "billing_state", "billing_zip",
  "dog_count", "dog_names", "dog_breeds",
  "service_frequency", "service_day", "price_per_visit",
  "billing_frequency", "start_date", "notes", "gate_code",
  "lead_source", "tags", "status", "client_type",
];

const COMMERCIAL_FIELDS = [
  "business_name", "location_name", "billing_contact_first", "billing_contact_last",
  "email", "phone",
  "service_street", "service_city", "service_state", "service_zip",
  "service_frequency", "service_day", "price_per_visit",
  "billing_frequency", "start_date", "notes", "status", "client_type",
];

// ─── AI PROMPT BUILDER ───────────────────────────────────────────────────────

function buildPrompt(flow, fileContents) {
  const isCommercial = flow.aiMode === "commercial";
  const fields = isCommercial ? COMMERCIAL_FIELDS : RESIDENTIAL_FIELDS;

  const fileSections = Object.entries(fileContents).map(([id, content]) => {
    const fileConfig = flow.files.find(f => f.id === id);
    const lines = content.split("\n");
    const preview = lines.slice(0, 8).join("\n");
    return `=== ${fileConfig?.label || id} (${lines.length} total rows) ===\n${preview}`;
  }).join("\n\n");

  const modeRules = isCommercial ? `
- client_type: always set to "commercial"
- business_name: the company or property name
- location_name: specific location if the business has multiple sites (HOA unit, apartment complex name, etc.)
- billing_contact_first / billing_contact_last: the human contact at the business
- price_per_visit: numeric only, no $ sign — pull from subscription revenue if available, otherwise leave blank
- Do NOT include station count or per-station pricing — those fields are not in these exports
` : `
- client_type: always set to "residential"
- service_frequency: must be one of: weekly, biweekly, monthly, bimonthly — infer from subscription name or job title if not explicit
- service_day: day of week spelled out (Monday, Tuesday, etc.) — pull from schedule export if available
- dog_count: integer — pull from schedule export if available
- price_per_visit: numeric only, no $ sign — pull from subscriptions or jobs export
- start_date: YYYY-MM-DD format if available, otherwise leave blank
- Normalize all phone numbers to (XXX) XXX-XXXX format
`;

  return `You are a data migration specialist converting ${flow.label} exports into a ScooPilot import CSV.

Target CSV columns — use exactly these header names, in this order:
${fields.join(", ")}

Rules:
- JOIN all provided files on client name + address to produce ONE unified row per client
- Name matching should be fuzzy-tolerant: "Smith, John" and "John Smith" are the same person
- Omit any clients who are archived, cancelled, or inactive
- If a field has no source data, leave it blank — do not guess or fabricate values
- Return ONLY raw CSV text. No explanation, no markdown, no code fences. Start with the header row.
${modeRules}
Source files from ${flow.label}:

${fileSections}`;
}

// ─── UTILITIES ───────────────────────────────────────────────────────────────

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result);
    reader.onerror = reject;
    reader.readAsText(file);
  });
}

function downloadCSV(content, filename) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── SUB-COMPONENTS ──────────────────────────────────────────────────────────

function NavPill({ text, color }) {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center",
      background: `${color}12`, border: `1px solid ${color}30`,
      borderRadius: 5, padding: "2px 8px",
      fontSize: 11, fontWeight: 600, color,
      fontFamily: "monospace", letterSpacing: "0.01em",
      whiteSpace: "nowrap",
    }}>
      {text}
    </span>
  );
}

function FileDropZone({ fileConfig, color, onFileAdded, uploadedFile }) {
  const inputRef = useRef();
  const [dragging, setDragging] = useState(false);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) onFileAdded(fileConfig.id, file);
  }, [fileConfig.id, onFileAdded]);

  return (
    <div style={{ marginBottom: 24 }}>
      {/* Label row */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: "#E2E8F0" }}>
          {fileConfig.label}
        </span>
        <NavPill text={fileConfig.nav} color={color} />
        {fileConfig.required
          ? <span style={{ fontSize: 11, color: "#EF4444", fontWeight: 600 }}>required</span>
          : <span style={{ fontSize: 11, color: "#64748B" }}>optional</span>
        }
      </div>

      {/* Instructions card */}
      <div style={{
        background: "rgba(255,255,255,0.02)",
        border: "1px solid rgba(255,255,255,0.05)",
        borderRadius: 8, padding: "12px 14px", marginBottom: 8,
      }}>
        {fileConfig.instructions.map((step, i) => (
          <div key={i} style={{
            display: "flex", gap: 10,
            marginBottom: i < fileConfig.instructions.length - 1 ? 6 : 0,
          }}>
            <span style={{
              minWidth: 18, height: 18, borderRadius: "50%", flexShrink: 0, marginTop: 2,
              background: `${color}18`, border: `1px solid ${color}35`,
              color, fontSize: 10, fontWeight: 700,
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>{i + 1}</span>
            <span style={{ fontSize: 13, color: "#CBD5E1", lineHeight: 1.5 }}>{step}</span>
          </div>
        ))}
        <div style={{
          marginTop: 10, padding: "5px 10px",
          background: `${color}0a`, border: `1px solid ${color}20`,
          borderRadius: 6, fontSize: 12, color: "#64748B", fontStyle: "italic",
        }}>
          {fileConfig.tip}
        </div>
      </div>

      {/* Drop zone */}
      <div
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        style={{
          border: `2px dashed ${uploadedFile ? color : dragging ? "#94A3B8" : "rgba(255,255,255,0.09)"}`,
          borderRadius: 8, padding: "13px 18px",
          background: uploadedFile ? `${color}0a` : "transparent",
          cursor: "pointer", transition: "all 0.15s ease",
          display: "flex", alignItems: "center", gap: 12,
        }}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".csv,.xlsx,.xls"
          style={{ display: "none" }}
          onChange={(e) => { if (e.target.files[0]) onFileAdded(fileConfig.id, e.target.files[0]); }}
        />
        {uploadedFile ? (
          <>
            <span style={{ color, fontSize: 16 }}>✓</span>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color }}>{uploadedFile.name}</div>
              <div style={{ fontSize: 11, color: "#475569" }}>
                {(uploadedFile.size / 1024).toFixed(1)} KB · Click to replace
              </div>
            </div>
          </>
        ) : (
          <>
            <span style={{ fontSize: 16, opacity: 0.2 }}>📂</span>
            <span style={{ fontSize: 13, color: "#475569" }}>Drop CSV here or click to browse</span>
          </>
        )}
      </div>
    </div>
  );
}

// ─── MAIN COMPONENT ──────────────────────────────────────────────────────────

export default function MigrationTool() {
  const [platformKey, setPlatformKey]   = useState(null);
  const [flowKey, setFlowKey]           = useState(null);
  const [uploads, setUploads]           = useState({});
  const [status, setStatus]             = useState("idle"); // idle | processing | done | error
  const [result, setResult]             = useState(null);
  const [errorMsg, setErrorMsg]         = useState("");
  const [logLines, setLogLines]         = useState([]);

  const flow    = flowKey ? FLOWS[flowKey] : null;
  const color   = flow?.color ?? "#94A3B8";
  const addLog  = (msg) => setLogLines(prev => [...prev, msg]);

  const handleFileAdded = useCallback((fileId, file) => {
    setUploads(prev => ({ ...prev, [fileId]: file }));
  }, []);

  const allRequiredUploaded = () =>
    flow ? flow.files.filter(f => f.required).every(f => uploads[f.id]) : false;

  const isMultiFlow = (key) => key && PLATFORM_GROUPS[key].flows.length > 1;
  const uploadStepNum = isMultiFlow(platformKey) ? 3 : 2;

  const selectPlatform = (key) => {
    setPlatformKey(key);
    if (!isMultiFlow(key)) setFlowKey(PLATFORM_GROUPS[key].flows[0]);
    else setFlowKey(null);
    setUploads({});
  };

  const selectFlow = (fk) => {
    setFlowKey(fk);
    setUploads({});
  };

  const runMigration = async () => {
    setStatus("processing");
    setLogLines([]);
    setResult(null);
    setErrorMsg("");

    try {
      addLog("Reading uploaded files...");
      const fileContents = {};
      for (const [id, file] of Object.entries(uploads)) {
        fileContents[id] = await readFileAsText(file);
        addLog(`✓ ${file.name} (${(file.size / 1024).toFixed(1)} KB)`);
      }

      addLog("Sending to AI for merge and normalization...");

      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 8000,
          messages: [{ role: "user", content: buildPrompt(flow, fileContents) }],
        }),
      });

      if (!response.ok) throw new Error(`API error: ${response.status}`);

      const data = await response.json();
      let csv = data.content?.find(b => b.type === "text")?.text ?? "";
      csv = csv.replace(/^```[a-z]*\n?/i, "").replace(/```\s*$/i, "").trim();

      if (!csv.split("\n")[0]?.includes(",")) {
        throw new Error("Unexpected output format. Try again.");
      }

      const rows = csv.split("\n").filter(r => r.trim()).length - 1;
      addLog(`✓ ${rows} client records ready`);

      const filename = `scoopilot_${flow.clientType}_import.csv`;
      setResult({ csv, rowCount: rows, filename, isCommercial: !!flow.commercialNote });
      setStatus("done");

    } catch (err) {
      setErrorMsg(err.message || "Something went wrong.");
      setStatus("error");
    }
  };

  const reset = () => {
    setPlatformKey(null); setFlowKey(null); setUploads({});
    setStatus("idle"); setResult(null); setErrorMsg(""); setLogLines([]);
  };

  // ─── STYLES ────────────────────────────────────────────────────────────────

  const s = {
    root: {
      minHeight: "100vh",
      background: "#080E1A",
      color: "#E2E8F0",
      fontFamily: "'DM Sans', 'Segoe UI', sans-serif",
      padding: "40px 20px",
    },
    wrap: { maxWidth: 680, margin: "0 auto" },
    logoBar: { display: "flex", alignItems: "center", gap: 10, marginBottom: 40 },
    logoMark: {
      width: 34, height: 34, borderRadius: 8, flexShrink: 0,
      background: "linear-gradient(135deg, #14B8A6, #0EA5E9)",
      display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: 14, fontWeight: 900, color: "#fff",
    },
    h1: { fontSize: 26, fontWeight: 800, letterSpacing: "-0.03em", marginBottom: 8, color: "#F8FAFC" },
    sub: { fontSize: 14, color: "#64748B", marginBottom: 36, lineHeight: 1.65 },
    sectionLabel: {
      display: "block", fontSize: 11, fontWeight: 700,
      letterSpacing: "0.09em", textTransform: "uppercase",
      color: "#475569", marginBottom: 12,
    },
    grid2: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 28 },
    pCard: (key, selected) => ({
      padding: "13px 15px",
      border: `1.5px solid ${selected ? PLATFORM_GROUPS[key].color : "rgba(255,255,255,0.07)"}`,
      borderRadius: 10,
      background: selected ? `${PLATFORM_GROUPS[key].color}0e` : "rgba(255,255,255,0.02)",
      cursor: "pointer", transition: "all 0.15s ease",
      display: "flex", alignItems: "center", gap: 11,
    }),
    pIcon: (c) => ({
      width: 31, height: 31, borderRadius: 7, flexShrink: 0,
      background: `${c}18`, border: `1px solid ${c}35`,
      color: c, fontSize: 11, fontWeight: 800,
      display: "flex", alignItems: "center", justifyContent: "center",
    }),
    fCard: (fk, selected) => ({
      padding: "13px 15px",
      border: `1.5px solid ${selected ? FLOWS[fk].color : "rgba(255,255,255,0.07)"}`,
      borderRadius: 10,
      background: selected ? `${FLOWS[fk].color}0e` : "rgba(255,255,255,0.02)",
      cursor: "pointer", transition: "all 0.15s ease",
    }),
    card: {
      background: "rgba(255,255,255,0.025)",
      border: "1px solid rgba(255,255,255,0.06)",
      borderRadius: 12, padding: 22, marginBottom: 20,
    },
    divider: { borderTop: "1px solid rgba(255,255,255,0.05)", margin: "20px 0" },
    btn: (variant = "primary", disabled = false) => ({
      padding: "11px 22px", borderRadius: 8, border: "none",
      cursor: disabled ? "not-allowed" : "pointer",
      fontSize: 14, fontWeight: 600,
      opacity: disabled ? 0.3 : 1,
      transition: "all 0.15s ease",
      ...(variant === "primary"
        ? { background: "linear-gradient(135deg, #14B8A6, #0EA5E9)", color: "#fff" }
        : { background: "rgba(255,255,255,0.05)", color: "#CBD5E1", border: "1px solid rgba(255,255,255,0.09)" }
      ),
    }),
    log: {
      background: "#040810", border: "1px solid rgba(255,255,255,0.05)",
      borderRadius: 8, padding: 14, fontFamily: "monospace",
      fontSize: 12, color: "#64748B", lineHeight: 1.9, minHeight: 72,
    },
    successCard: {
      background: "rgba(20,184,166,0.07)", border: "1.5px solid rgba(20,184,166,0.22)",
      borderRadius: 12, padding: 28, textAlign: "center", marginBottom: 20,
    },
    warnCard: {
      background: "rgba(245,158,11,0.07)", border: "1px solid rgba(245,158,11,0.22)",
      borderRadius: 10, padding: "13px 17px", marginBottom: 18,
      fontSize: 13, color: "#FCD34D", lineHeight: 1.6,
    },
    infoCard: {
      background: "rgba(99,102,241,0.07)", border: "1px solid rgba(99,102,241,0.28)",
      borderRadius: 10, padding: "13px 17px", marginBottom: 18,
      fontSize: 13, color: "#A5B4FC", lineHeight: 1.6,
    },
  };

  // ─── RENDER ────────────────────────────────────────────────────────────────

  return (
    <div style={s.root}>
      <div style={s.wrap}>

        {/* Logo */}
        <div style={s.logoBar}>
          <div style={s.logoMark}>SP</div>
          <div>
            <span style={{ fontSize: 17, fontWeight: 700, color: "#F8FAFC", letterSpacing: "-0.02em" }}>
              ScooPilot
            </span>
            <span style={{ fontSize: 12, color: "#475569", marginLeft: 4 }}>
              Migration Tool
            </span>
          </div>
        </div>

        <h1 style={s.h1}>Switch to ScooPilot in minutes.</h1>
        <p style={s.sub}>
          Export your data from your current software, upload the files here, and we'll build a
          clean import file — contacts, service plans, dog info, pricing — ready to go straight
          into ScooPilot.
        </p>

        {/* ── IDLE ── */}
        {status === "idle" && (
          <>
            {/* Step 1: Platform */}
            <span style={s.sectionLabel}>Step 1 — Where are you coming from?</span>
            <div style={s.grid2}>
              {Object.entries(PLATFORM_GROUPS).map(([key, pg]) => (
                <div key={key} style={s.pCard(key, platformKey === key)} onClick={() => selectPlatform(key)}>
                  <div style={s.pIcon(pg.color)}>{pg.icon}</div>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: "#E2E8F0" }}>{pg.label}</div>
                    <div style={{ fontSize: 11, color: "#64748B" }}>
                      {pg.flows.length > 1 ? "Residential + Commercial" : "All clients"}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Step 2: Sub-flow (multi-flow platforms only) */}
            {isMultiFlow(platformKey) && (
              <>
                <span style={s.sectionLabel}>Step 2 — Which clients are you importing?</span>
                <div style={s.grid2}>
                  {PLATFORM_GROUPS[platformKey].flows.map(fk => (
                    <div key={fk} style={s.fCard(fk, flowKey === fk)} onClick={() => selectFlow(fk)}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: FLOWS[fk].color, marginBottom: 3 }}>
                        {FLOWS[fk].sublabel}
                      </div>
                      <div style={{ fontSize: 11, color: "#64748B" }}>
                        {FLOWS[fk].files.length} files needed
                      </div>
                      <div style={{ fontSize: 11, color: "#334155", marginTop: 2 }}>
                        {FLOWS[fk].files.map(f => f.label).join(" · ")}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}

            {/* Step 3 (or 2): Upload files */}
            {flow && (
              <>
                <span style={s.sectionLabel}>
                  Step {uploadStepNum} — Export & upload your files
                </span>

                {/* Email export warning — Jobber and HouseCall Pro */}
                {flow.emailExport && (
                  <div style={s.infoCard}>
                    <strong>{flow.label} emails your exports.</strong> After clicking the export
                    buttons below, watch for an email from{" "}
                    {flow.platform === "jobber"
                      ? "Jobber (check the email you use to log in)"
                      : "notifications@housecallpro.com"
                    }. Download the CSV attachments, then come back here to upload them.
                    Check spam if they don't arrive within a few minutes.
                  </div>
                )}

                {/* Commercial warning */}
                {flow.commercialNote && (
                  <div style={s.warnCard}>
                    <strong>Heads up:</strong> Commercial imports include contact info, address,
                    frequency, and billing data. Station count and per-station pricing aren't
                    exportable from {flow.label} — you'll enter those manually in ScooPilot after
                    the import completes.
                  </div>
                )}

                <div style={s.card}>
                  {flow.files.map((fileConfig, i) => (
                    <div key={fileConfig.id}>
                      {i > 0 && <div style={s.divider} />}
                      <FileDropZone
                        fileConfig={fileConfig}
                        color={color}
                        onFileAdded={handleFileAdded}
                        uploadedFile={uploads[fileConfig.id]}
                      />
                    </div>
                  ))}
                </div>

                <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  <button
                    style={s.btn("primary", !allRequiredUploaded())}
                    disabled={!allRequiredUploaded()}
                    onClick={runMigration}
                  >
                    Build my import file →
                  </button>
                  <button style={s.btn("secondary")} onClick={reset}>
                    Start over
                  </button>
                </div>

                {!allRequiredUploaded() && (
                  <div style={{ fontSize: 12, color: "#334155", marginTop: 10 }}>
                    Upload all required files above to continue.
                  </div>
                )}
              </>
            )}
          </>
        )}

        {/* ── PROCESSING ── */}
        {status === "processing" && (
          <>
            <span style={s.sectionLabel}>Processing</span>
            <div style={s.card}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
                <div style={{
                  width: 15, height: 15, borderRadius: "50%", flexShrink: 0,
                  border: "2px solid #14B8A6", borderTopColor: "transparent",
                  animation: "spin 0.8s linear infinite",
                }} />
                <span style={{ fontSize: 14, color: "#94A3B8" }}>
                  Merging files and normalizing data...
                </span>
              </div>
              <div style={s.log}>
                {logLines.map((l, i) => <div key={i}>{l}</div>)}
              </div>
            </div>
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          </>
        )}

        {/* ── ERROR ── */}
        {status === "error" && (
          <div style={{ ...s.card, borderColor: "rgba(239,68,68,0.22)", background: "rgba(239,68,68,0.04)" }}>
            <div style={{ fontWeight: 700, color: "#EF4444", marginBottom: 8 }}>
              Something went wrong
            </div>
            <div style={{ fontSize: 13, color: "#94A3B8", marginBottom: 16 }}>{errorMsg}</div>
            <button style={s.btn("secondary")} onClick={reset}>Start over</button>
          </div>
        )}

        {/* ── DONE ── */}
        {status === "done" && result && (
          <>
            <div style={s.successCard}>
              <div style={{ fontSize: 34, marginBottom: 10 }}>✅</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: "#F8FAFC", marginBottom: 4 }}>
                Your import file is ready.
              </div>
              <div style={{ fontSize: 14, color: "#64748B", marginBottom: 24 }}>
                {result.rowCount} client records · {result.filename}
              </div>
              <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
                <button
                  style={s.btn("primary")}
                  onClick={() => downloadCSV(result.csv, result.filename)}
                >
                  Download {result.filename}
                </button>
                <button style={s.btn("secondary")} onClick={reset}>
                  Import another batch
                </button>
              </div>
            </div>

            {result.isCommercial && (
              <div style={s.warnCard}>
                <strong>Before you import:</strong> Verify pricing looks correct in the CSV.
                Station-based details will need to be added manually in ScooPilot after the
                import completes.
              </div>
            )}

            {/* Next steps */}
            <div style={s.card}>
              <span style={s.sectionLabel}>What to do next</span>
              {[
                ["Log into ScooPilot", "Go to app.scoopilot.com"],
                ["Open the Import Wizard", "Settings → Import → Start New Import"],
                ["Upload your file", `Select your platform and upload ${result.filename}`],
                ["Resolve any gaps", "ScooPilot flags rows with missing info. Use the Missing Logic Resolver to fill in bulk."],
                ["Commit to production", "Once clean, commit — your clients go live instantly."],
              ].map(([title, desc], i) => (
                <div key={i} style={{ display: "flex", gap: 12, marginBottom: i < 4 ? 12 : 0 }}>
                  <span style={{
                    minWidth: 21, height: 21, borderRadius: "50%", flexShrink: 0, marginTop: 2,
                    background: "rgba(20,184,166,0.10)", border: "1px solid rgba(20,184,166,0.22)",
                    color: "#14B8A6", fontSize: 10, fontWeight: 700,
                    display: "flex", alignItems: "center", justifyContent: "center",
                  }}>{i + 1}</span>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "#E2E8F0" }}>{title}</div>
                    <div style={{ fontSize: 12, color: "#475569" }}>{desc}</div>
                  </div>
                </div>
              ))}
            </div>

            {/* CSV preview */}
            <div style={s.card}>
              <span style={s.sectionLabel}>CSV Preview — first 5 rows</span>
              <div style={{ overflowX: "auto" }}>
                <pre style={{ ...s.log, fontSize: 10, whiteSpace: "pre", margin: 0 }}>
                  {result.csv.split("\n").slice(0, 6).join("\n")}
                </pre>
              </div>
            </div>
          </>
        )}

      </div>
    </div>
  );
}
