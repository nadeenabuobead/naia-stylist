// app/routes/app.designer-intelligence.jsx
// nAia Designer Dashboard — full certification build.
// 7-section tabbed portal: Overview · Customer · Product · Recommendation ·
// Collection · Commercial · Design Opportunities
// AI Performance content absorbed into Recommendation Intelligence (Phase 1 consolidation)
//
// ── Metric definitions (canonical, for reference) ───────────────────────────
// StyleMe requests         → stylingSession rows WHERE createdAt ≥ dateFrom
// Completed outfit reviews → postOutfitReview rows WHERE createdAt ≥ dateFrom
// Registered nAia users    → customer.count() ALL-TIME
// Completed Passports      → onboardingProfile WHERE completed=true ALL-TIME
// Recommendation feedback  → recommendationFeedback rows (migration guard)
// Post-wear feedback       → postOutfitReview.didWearIt (migration guard)
// Period-following metrics → advanced.*, phase4b2.*, rel.* (use dateRangeDays)
// All-time metrics         → dashboard.totalUsers, kpis.passport.*, kpis.closet.*
//                            dashboard.onboarding.* (completed profiles, all-time)
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useCallback, createContext, useContext } from "react";
import { useLoaderData, useSearchParams, useNavigate } from "react-router";
import { requireStaffAccess } from "../lib/staff-auth.server";
import { getDesignerStats, getAdditionalKPIs } from "../lib/designer-stats.server";
import { getPhase4B2KPIs } from "../lib/ai/designer-intelligence.server";
import { getAdvancedKPIs } from "../lib/designer-advanced.server";
import { getRelationshipKPIs } from "../lib/designer-relationship.server";
import { getDesignerSampleData } from "../lib/designer-sample-data";

// ── Loader ────────────────────────────────────────────────────────────────────

export async function loader({ request }) {
  await requireStaffAccess(request);
  const url = new URL(request.url);
  const rawDays = parseInt(url.searchParams.get("days") || "30", 10);
  const dateRangeDays = [7, 30, 90, 365].includes(rawDays) ? rawDays : 30;

  // Sample Preview — env var makes the toggle visible; query param activates it.
  // Both conditions must be true. A lone ?preview=sample with no env var is silently ignored.
  const samplePreviewAvailable = process.env.DESIGNER_SAMPLE_DATA_ENABLED === "true";
  const sampleMode = samplePreviewAvailable && url.searchParams.get("preview") === "sample";

  if (sampleMode) {
    const sample = getDesignerSampleData(dateRangeDays);
    return { ...sample, dateRangeDays, sampleMode: true, samplePreviewAvailable: true };
  }

  const [dashboard, kpis, phase4b2, advanced, rel] = await Promise.all([
    getDesignerStats(dateRangeDays),
    getAdditionalKPIs(),
    getPhase4B2KPIs(dateRangeDays),
    getAdvancedKPIs(dateRangeDays),
    getRelationshipKPIs(dateRangeDays),
  ]);

  if (dashboard.error) throw new Response(dashboard.error, { status: 500 });
  return { dashboard, kpis, phase4b2, advanced, rel, dateRangeDays, sampleMode: false, samplePreviewAvailable };
}

// ── Error boundary ─────────────────────────────────────────────────────────────

export function ErrorBoundary() {
  return (
    <div style={s.wrap}>
      <GFonts />
      <div style={s.inner}>
        <div style={{ ...s.section, borderLeft: "4px solid #8b2035" }}>
          <h2 style={{ ...s.h2, color: "#8b2035" }}>Dashboard unavailable</h2>
          <p style={s.muted}>Unable to load dashboard data. Check server logs for details.</p>
        </div>
      </div>
    </div>
  );
}

// ── Sample-mode context — automatically resolves "live" → "sample" in status badges ──
const SampleModeCtx = createContext(false);

// ── Status helpers ─────────────────────────────────────────────────────────────

const STATUS_CONFIG = {
  live:                  { label: "LIVE",                 bg: "rgba(42,94,66,0.10)",   color: "#2a5e42" },
  "awaiting-integration":{ label: "AWAITING INTEGRATION", bg: "rgba(122,111,106,0.10)", color: "#5c5350" },
  "insufficient-data":   { label: "INSUFFICIENT DATA",    bg: "rgba(107,72,0,0.09)",    color: "#6b4800" },
  experimental:          { label: "EXPERIMENTAL",          bg: "rgba(34,21,22,0.06)",    color: "#4a3535" },
  "not-implemented":     { label: "NOT IMPLEMENTED",       bg: "rgba(122,111,106,0.08)", color: "#9CA3AF" },
  sample:                { label: "SAMPLE DATA",           bg: "rgba(107,72,0,0.10)",    color: "#6b4800" },
};

function StatusBadge({ status, style = {} }) {
  // In sample mode, every "live" badge becomes "SAMPLE DATA" — no live data is present.
  const isSample = useContext(SampleModeCtx);
  const resolved = (isSample && status === "live") ? "sample" : status;
  const cfg = STATUS_CONFIG[resolved] || STATUS_CONFIG["not-implemented"];
  return (
    <span style={{
      display: "inline-block", padding: "3px 8px",
      fontSize: "7px", fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif", fontWeight: 700,
      textTransform: "uppercase", letterSpacing: "2px",
      background: cfg.bg, color: cfg.color, ...style,
    }}>
      {cfg.label}
    </span>
  );
}

function AwaitingCard({ label, description }) {
  return (
    <div style={{ ...s.card, borderLeft: "3px solid #7a6f6a" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", gap: 12 }}>
        <div>
          <div style={{ ...s.cardLabel, color: "#5c5350" }}>{label}</div>
          <p style={{ ...s.muted, marginTop: 6 }}>{description}</p>
        </div>
        <StatusBadge status="awaiting-integration" />
      </div>
    </div>
  );
}

// Collapses a list of pending integration items into one compact panel
function RoadmapPanel({ title = "Integration Roadmap", items }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ ...s.card, borderLeft: "3px solid #7a6f6a", marginBottom: 0 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <div style={{ ...s.cardLabel, color: "#5c5350" }}>{title}</div>
          <p style={{ ...s.muted, marginTop: 4, fontSize: 11 }}>{items.length} metric{items.length !== 1 ? "s" : ""} pending commercial / order-data integration</p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <StatusBadge status="awaiting-integration" />
          <button type="button" onClick={() => setOpen(o => !o)} style={{ ...s.linkBtn, marginTop: 0, flexShrink: 0 }}>{open ? "Hide ↑" : "Show items ↓"}</button>
        </div>
      </div>
      {open && (
        <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 10 }}>
          {items.map((item, i) => (
            <div key={i} style={{ padding: "10px 12px", background: "#fafaf8", border: "1px solid rgba(34,21,22,0.07)", borderLeft: "2px solid rgba(34,21,22,0.12)" }}>
              <div style={{ ...s.cardLabel, color: "#5c5350", marginBottom: 4 }}>{item.label}</div>
              <p style={{ ...s.muted, fontSize: 11, marginTop: 0 }}>{item.description}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function InsufficientCard({ label, description, sampleSize, min = 5 }) {
  return (
    <div style={{ ...s.card, borderLeft: "3px solid #6b4800" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", gap: 12 }}>
        <div>
          <div style={{ ...s.cardLabel, color: "#6b4800" }}>{label}</div>
          <p style={{ ...s.muted, marginTop: 6 }}>{description}</p>
          {sampleSize !== undefined && (
            <p style={{ ...s.muted, marginTop: 4, fontSize: 11 }}>
              {sampleSize === 0
                ? `No data recorded yet.`
                : `${plural(sampleSize, "record")} collected — minimum ${min} required for reliable signals.`}
            </p>
          )}
        </div>
        <StatusBadge status="insufficient-data" />
      </div>
    </div>
  );
}

// ── Shared utilities (CP1 + CP2) ──────────────────────────────────────────────

function plural(n, singular, pluralForm) {
  const word = n === 1 ? singular : (pluralForm ?? singular + "s");
  return `${n} ${word}`;
}

function periodLabel(days) {
  if (days === 365) return "all time";
  return `last ${days} days`;
}

// Map sample size for a specific claim to a confidence tier.
// n = evidence count supporting this specific claim, not total dashboard sessions.
function sampleConfidence(n) {
  if (n === 0)  return { label: "No Data",              status: "not-implemented",   color: "#9CA3AF" };
  if (n === 1)  return { label: "Single Observation",   status: "insufficient-data", color: "#6b4800" };
  if (n <= 4)   return { label: "Early Signal",         status: "insufficient-data", color: "#6b4800" };
  if (n <= 9)   return { label: "Emerging Pattern",     status: "experimental",      color: "#5c5350" };
  if (n <= 19)  return { label: "Established Pattern",  status: "live",              color: "#2a5e42" };
  return          { label: "Strong Pattern",            status: "live",              color: "#2a5e42" };
}

// Render a percentage with its denominator so "100%" without context never appears.
function pctOf(numerator, denominator, noun) {
  if (!denominator) return "—";
  const pct = Math.round((numerator / denominator) * 100);
  return `${pct}% · ${numerator} of ${denominator}${noun ? " " + noun : ""}`;
}

// ── Normalisation layer (CP2) ─────────────────────────────────────────────────
// Client-side only — corrects raw enum values before display. Does NOT write to DB.

const _LABEL_MAP = {
  // invalid / quarantined
  "c": null,
  // moods / desired feelings (case variants and slugs)
  "more-confident":     "More confident",
  "More confident":     "More confident",
  "more confident":     "More confident",
  "moreconfident":      "More confident",
  "confident":          "Confident",
  // occasions / lifestyle
  "everyday":           "Everyday",
  "daily":              "Everyday",
  "event":              "Dressing for special events",
  "Event":              "Dressing for special events",
  // style-struggle raw slugs (onboarding)
  "Dont Style":         "I struggle to style what I own",
  "dont-style":         "I struggle to style what I own",
  "dont style":         "I struggle to style what I own",
  // colour (British English)
  "Colourful":          "Colourful",
  "colorful":           "Colourful",
  "Colorful":           "Colourful",
};

function normalizeLabel(raw) {
  if (raw === null || raw === undefined || raw === "") return raw;
  const mapped = _LABEL_MAP[raw];
  if (mapped !== undefined) return mapped; // null means quarantine
  // Convert kebab-case slugs that slipped through
  if (/^[a-z][a-z0-9-]+$/.test(raw)) {
    return raw.split("-").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
  }
  return raw;
}

function normalizeArray(arr) {
  if (!arr) return [];
  return arr.map(normalizeLabel).filter(v => v !== null && v !== undefined);
}

// ── Shared components ─────────────────────────────────────────────────────────

function GFonts() {
  return (
    <link
      href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,700;0,900;1,400;1,600;1,700&family=Cormorant+Garamond:ital,wght@0,300;0,400;0,600;1,300;1,400&family=Inter:wght@400;500;600&display=swap"
      rel="stylesheet"
    />
  );
}

function Section({ title, desc, status, children, action }) {
  return (
    <section style={s.section}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8, flexWrap: "wrap", gap: 8 }}>
        <h2 style={s.h2}>{title}</h2>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {status && <StatusBadge status={status} />}
          {action}
        </div>
      </div>
      {desc && <p style={s.sectionDesc}>{desc}</p>}
      {children}
    </section>
  );
}

function KpiCard({ label, value, suffix = "", tooltip, status }) {
  const [tip, setTip] = useState(false);
  return (
    <div style={s.kpiCard}>
      {status && <StatusBadge status={status} style={{ marginBottom: 8 }} />}
      <div style={s.kpiValue}>{value}{suffix}</div>
      <div style={s.kpiLabel}>
        {label}
        {tooltip && (
          <span
            onMouseEnter={() => setTip(true)}
            onMouseLeave={() => setTip(false)}
            style={{ marginLeft: 6, cursor: "help", color: "#9CA3AF", fontSize: 12 }}
          >ⓘ{tip && (
            <span style={{ position: "absolute", zIndex: 10, background: "#221516", color: "#f4f4f1", padding: "6px 10px", fontSize: 10, fontFamily: INTER, width: 200, marginTop: 4, lineHeight: 1.6, display: "block" }}>
              {tooltip}
            </span>
          )}
          </span>
        )}
      </div>
    </div>
  );
}

function MigrationPendingNotice({ label }) {
  return (
    <div style={{ padding: "10px 14px", background: "rgba(122,111,106,0.07)", border: "1px solid rgba(34,21,22,0.09)", fontFamily: "'Cormorant Garamond', Garamond, serif", fontSize: 14, fontStyle: "italic", color: "#7a6f6a" }}>
      {label} — migration pending. Data will appear after the database migration is applied.
    </div>
  );
}

function EmptyState({ message = "No data yet for this period." }) {
  return (
    <div style={{ padding: "32px 24px", border: "1px solid rgba(34,21,22,0.07)", textAlign: "center" }}>
      <div style={{ fontFamily: "'Cormorant Garamond', Garamond, serif", fontSize: 15, fontStyle: "italic", color: "#7a6f6a", lineHeight: 1.6 }}>
        {message}
      </div>
    </div>
  );
}

function SampleSizeWarning({ n, min = 5 }) {
  if (n >= min) return null;
  return (
    <div style={{ padding: "8px 14px", background: "rgba(107,72,0,0.07)", border: "1px solid rgba(107,72,0,0.20)", fontFamily: "'Inter', -apple-system, sans-serif", fontSize: 11, color: "#6b4800", marginBottom: 16, letterSpacing: "0.3px" }}>
      Sample size: {n} — minimum {min} required for reliable signals. Treat as directional only.
    </div>
  );
}

function ExportCSVButton({ data, filename }) {
  const isSample = useContext(SampleModeCtx);
  const handleExport = useCallback(() => {
    if (!data || data.length === 0) return;
    const keys = Object.keys(data[0]);
    const rows = [keys.join(","), ...data.map((row) => keys.map((k) => JSON.stringify(row[k] ?? "")).join(","))];
    const blob = new Blob([rows.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = isSample ? `SAMPLE-${filename}` : filename;
    a.click();
    URL.revokeObjectURL(url);
  }, [data, filename, isSample]);
  return (
    <button type="button" onClick={handleExport} style={s.linkBtn}>
      {isSample ? "↓ SAMPLE CSV" : "↓ CSV"}
    </button>
  );
}

// ── Piece cards (preserved from existing) ─────────────────────────────────────

function PieceCard({ piece, styleDNA }) {
  return (
    <div style={s.pieceCard}>
      <div style={s.pieceName}>{piece.name}</div>
      <div style={s.pieceCategory}>{piece.category}</div>
      <div style={s.pieceStats}>
        <div>★ {piece.avgRating?.toFixed(1)} ({piece.ratingCount} ratings)</div>
        <div>Would wear again: <strong>{Math.round(piece.rewear * 100)}%</strong></div>
        {piece.helpedFeel?.length > 0 && <div style={{ marginTop: 8 }}><span style={s.muted}>Helped feel: </span><span style={s.helpedFeel}>{piece.helpedFeel.join(", ")}</span></div>}
        {piece.bestOccasions?.length > 0 && <div style={{ marginTop: 8 }}><span style={s.muted}>Best for: </span><span>{piece.bestOccasions.slice(0, 2).join(", ")}</span></div>}
        {piece.positiveComments?.length > 0 && <div style={{ marginTop: 8 }}><span style={s.muted}>Top feedback: </span><span style={{ color: "#2a5e42" }}>{piece.positiveComments.join(", ")}</span></div>}
        <div style={{ marginTop: 8 }}><span style={s.muted}>Watch-outs: </span><span style={{ color: "#d97706" }}>{piece.negativeComments?.length > 0 ? piece.negativeComments.join(", ") : "None yet"}</span></div>
        <div style={{ marginTop: 8 }}><span style={s.muted}>Resonates with: </span><span style={s.dnaStyle}>{piece.topDNA?.length > 0 ? piece.topDNA.join(", ") : "More data needed"}</span></div>
      </div>
    </div>
  );
}

function FeedbackInsightCard({ insight }) {
  const thresholdColor = insight.threshold === "strong" ? "#221516" : insight.threshold === "moderate" ? "#6b4800" : "#7a6f6a";
  return (
    <div style={{ padding: "16px 20px", border: `2px solid ${thresholdColor}`, marginBottom: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", marginBottom: 8 }}>
        <div style={{ fontFamily: INTER, fontSize: 8, textTransform: "uppercase", letterSpacing: "2px", color: "#7a6f6a", fontWeight: 600 }}>{insight.category}</div>
        <span style={{ fontSize: 8, textTransform: "uppercase", letterSpacing: "1.5px", padding: "3px 8px", background: thresholdColor, color: "#faf9f7", fontFamily: INTER, fontWeight: 600 }}>{insight.threshold}</span>
      </div>
      <div style={{ fontFamily: SERIF, fontSize: 15, color: "#221516", marginBottom: 8 }}>{insight.signal}</div>
      <div style={{ fontFamily: SERIF, fontSize: 13, color: "#5c5350", fontStyle: "italic" }}><strong>Suggestion:</strong> {insight.suggestion}</div>
    </div>
  );
}

function DesignActionCard({ action }) {
  const getPriorityColor = (p) => (p === "Strong Pattern" || p === "Established Pattern") ? "#2a5e42" : p === "Emerging Pattern" ? "#5c5350" : (p === "Early Signal" || p === "Single Observation") ? "#6b4800" : "#9CA3AF";
  const color = getPriorityColor(action.priority || action.confidenceBadge);
  return (
    <div style={{ padding: 22, border: `2px solid ${color}`, marginBottom: 18, background: "#fff" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", marginBottom: 14, gap: 16 }}>
        <h4 style={{ margin: 0, fontFamily: DISPLAY, fontSize: 20, fontWeight: 600, fontStyle: "italic", color: "#221516", lineHeight: 1.2 }}>{action.piece}</h4>
        <span style={{ fontSize: 8, textTransform: "uppercase", letterSpacing: "1.5px", padding: "4px 10px", background: color, color: "#fafaf8", whiteSpace: "nowrap", fontFamily: INTER, fontWeight: 600, flexShrink: 0 }}>{action.confidenceBadge || action.priority}</span>
      </div>
      <div style={{ fontFamily: INTER, fontSize: 9, textTransform: "uppercase", letterSpacing: "2px", color: color, fontWeight: 600, marginBottom: 14 }}>{action.actionType}: {action.action}</div>
      <div style={{ marginBottom: 9, fontFamily: SERIF, fontSize: 14, color: "#221516", lineHeight: 1.6 }}><span style={{ fontFamily: INTER, fontSize: 8, fontWeight: 600, textTransform: "uppercase", letterSpacing: "1.5px", color: "#7a6f6a", marginRight: 8 }}>Performance</span>{action.performance}</div>
      <div style={{ marginBottom: 9, fontFamily: SERIF, fontSize: 14, color: "#221516", lineHeight: 1.6 }}><span style={{ fontFamily: INTER, fontSize: 8, fontWeight: 600, textTransform: "uppercase", letterSpacing: "1.5px", color: "#2a5e42", marginRight: 8 }}>Liked</span>{action.liked}</div>
      <div style={{ marginBottom: 9, fontFamily: SERIF, fontSize: 14, color: "#221516", lineHeight: 1.6 }}><span style={{ fontFamily: INTER, fontSize: 8, fontWeight: 600, textTransform: "uppercase", letterSpacing: "1.5px", color: "#6b4800", marginRight: 8 }}>Watch</span>{action.watch}</div>
      <div style={{ marginBottom: 14, fontFamily: SERIF, fontSize: 14, color: "#221516", fontStyle: "italic", lineHeight: 1.6 }}><span style={{ fontFamily: INTER, fontSize: 8, fontWeight: 600, textTransform: "uppercase", letterSpacing: "1.5px", color: "#8b2035", marginRight: 8, fontStyle: "normal" }}>Next Step</span>{action.nextStep}</div>
      <div style={{ fontFamily: MONO, fontSize: 10, color: "#7a6f6a", paddingTop: 10, borderTop: "1px solid rgba(34,21,22,0.06)" }}>{action.data}</div>
    </div>
  );
}

// ── Tab definitions ────────────────────────────────────────────────────────────

const TABS = [
  { id: "overview",        label: "Overview" },
  { id: "customer",        label: "Customer Intelligence" },
  { id: "product",         label: "Product Intelligence" },
  { id: "recommendation",  label: "Recommendation Intelligence" },
  { id: "collection",      label: "Collection Intelligence" },
  { id: "commercial",      label: "Commercial Intelligence" },
  { id: "opportunities",   label: "Design Opportunities" },
];

// ── Root component ─────────────────────────────────────────────────────────────

export default function DesignerDashboard() {
  const { dashboard: data, kpis, phase4b2, advanced, rel, overview, dateRangeDays, sampleMode, samplePreviewAvailable } = useLoaderData();
  const [activeTab, setActiveTab] = useState("overview");
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  // Navigate preserving every existing search param; only change `key`.
  // Keeps shop/host/embedded and all other Shopify params intact.
  function navWith(key, value) {
    const next = new URLSearchParams(searchParams);
    if (value == null) {
      next.delete(key);
    } else {
      next.set(key, String(value));
    }
    navigate(`?${next.toString()}`, { replace: true });
  }

  return (
    <SampleModeCtx.Provider value={sampleMode}>
    <div style={s.wrap}>
      <GFonts />
      <div style={s.inner}>

        {/* ── Sample Preview banner — only visible while sample mode is active ─ */}
        {sampleMode && (
          <div style={{ padding: "8px 20px", background: "#6b4800", color: "#fffbf0", fontFamily: "'Inter', sans-serif", fontSize: 11, letterSpacing: "0.5px", textAlign: "center" }}>
            SAMPLE PREVIEW ACTIVE — Synthetic fixture data only. No real customer records loaded.
          </div>
        )}

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div style={s.header}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 16 }}>
            <div>
              <div style={{ fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif", fontSize: 8, textTransform: "uppercase", letterSpacing: "3px", color: "#8b2035", marginBottom: 10, fontWeight: 600 }}>NADINE — Private Intelligence Platform</div>
              <h1 style={s.h1}>nAia Designer Dashboard</h1>
              <p style={s.subtitle}>Collection intelligence · Customer insights · Design direction</p>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-end" }}>
              {/* Date range selector — navWith clones all params, changes only `days` */}
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span style={{ fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif", fontSize: 8, color: "#7a6f6a", textTransform: "uppercase", letterSpacing: "2px", fontWeight: 500 }}>Period</span>
                {[7, 30, 90, 365].map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => navWith("days", d)}
                    style={{
                      ...s.periodBtn,
                      background: dateRangeDays === d ? "#221516" : "transparent",
                      color: dateRangeDays === d ? "#f4f4f1" : "#7a6f6a",
                    }}
                  >
                    {d === 365 ? "All" : `${d}d`}
                  </button>
                ))}
              </div>
              {/* Live / Sample Preview toggle — only shown when env var enables it */}
              {samplePreviewAvailable && (
                <div style={{ display: "flex", gap: 0, alignItems: "center", border: "1px solid rgba(34,21,22,0.14)", overflow: "hidden" }}>
                  <button
                    type="button"
                    onClick={() => navWith("preview", null)}
                    style={{ padding: "3px 10px", fontFamily: "'Inter', sans-serif", fontSize: 9, letterSpacing: "1px", textTransform: "uppercase", background: !sampleMode ? "#221516" : "transparent", color: !sampleMode ? "#f4f4f1" : "#7a6f6a", border: "none", cursor: "pointer" }}
                  >
                    Live Data
                  </button>
                  <button
                    type="button"
                    onClick={() => navWith("preview", "sample")}
                    style={{ padding: "3px 10px", fontFamily: "'Inter', sans-serif", fontSize: 9, letterSpacing: "1px", textTransform: "uppercase", background: sampleMode ? "#6b4800" : "transparent", color: sampleMode ? "#fffbf0" : "#7a6f6a", border: "none", cursor: "pointer" }}
                  >
                    Sample Preview
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Tab bar ──────────────────────────────────────────────────────── */}
        <div style={s.tabBar}>
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              style={{
                ...s.tabBtn,
                borderBottom: activeTab === tab.id ? "2px solid #8b2035" : "2px solid transparent",
                color: activeTab === tab.id ? "#221516" : "#7a6f6a",
                fontWeight: activeTab === tab.id ? 700 : 400,
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* ── Tab content ──────────────────────────────────────────────────── */}
        <div style={{ paddingTop: 8 }}>
          {activeTab === "overview"       && <TabOverview        data={data} kpis={kpis} phase4b2={phase4b2} advanced={advanced} rel={rel} overview={overview} sampleMode={sampleMode} dateRangeDays={dateRangeDays} />}
          {activeTab === "customer"       && <TabCustomer        data={data} kpis={kpis} advanced={advanced} rel={rel} sampleMode={sampleMode} dateRangeDays={dateRangeDays} />}
          {activeTab === "product"        && <TabProduct         data={data} phase4b2={phase4b2} advanced={advanced} rel={rel} sampleMode={sampleMode} dateRangeDays={dateRangeDays} />}
          {activeTab === "recommendation" && <TabRecommendation  data={data} kpis={kpis} phase4b2={phase4b2} advanced={advanced} rel={rel} sampleMode={sampleMode} dateRangeDays={dateRangeDays} />}
          {activeTab === "collection"     && <TabCollection      data={data} kpis={kpis} advanced={advanced} rel={rel} dateRangeDays={dateRangeDays} />}
          {activeTab === "commercial"     && <TabCommercial      data={data} advanced={advanced} rel={rel} sampleMode={sampleMode} dateRangeDays={dateRangeDays} />}
          {activeTab === "opportunities"  && <TabOpportunities   data={data} phase4b2={phase4b2} advanced={advanced} rel={rel} dateRangeDays={dateRangeDays} />}
        </div>

      </div>
    </div>
    </SampleModeCtx.Provider>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// TAB 1 — OVERVIEW
// ══════════════════════════════════════════════════════════════════════════════

function TabOverview({ data, kpis, phase4b2, advanced, rel, overview, sampleMode, dateRangeDays }) {
  const periodStr = dateRangeDays >= 365 ? "All Time" : `Last ${dateRangeDays} Days`;

  // Top 3 priority actions from opportunityFeed
  const topActions = (advanced?.opportunityFeed ?? []).slice(0, 3);

  // Platform health indicators
  const liveSourceActive = !!(kpis && !kpis.error);
  const evidenceDenominator = advanced?.explainability?.evidenceDenominator ?? 0;
  const fk = overview?.foundationKpis;

  // Changes: only show when comparison data is valid
  const evolution = advanced?.collectionEvolution;
  const hasChanges = evolution?.status !== "insufficient-data" && evolution?.current && evolution?.previous;

  return (
    <>
      {/* ── WHAT NEEDS ATTENTION ─────────────────────────────────── */}
      <Section title="What Needs Attention" desc={`Top ${topActions.length > 0 ? topActions.length : "priority"} actions for ${periodStr}`}>
        {topActions.length > 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {topActions.map((opp, i) => (
              <div key={i} style={{
                padding: "16px 20px",
                background: "#fff",
                border: "1px solid rgba(34,21,22,0.08)",
                borderLeft: `4px solid ${opp.confidence === "high" ? "#221516" : opp.confidence === "medium" ? "#8B7355" : "#9CA3AF"}`,
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap", marginBottom: 6 }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <span style={{ fontFamily: MONO, fontSize: 9, textTransform: "uppercase", letterSpacing: "2px", color: "#7a6f6a" }}>{opp.type ?? "INSIGHT"}</span>
                    <span style={{ fontFamily: INTER, fontSize: 8, fontWeight: 600, textTransform: "uppercase", letterSpacing: "1.5px", padding: "2px 7px", background: opp.estimatedCommercialRelevance === "high" ? "#2a5e42" : "#6b4800", color: "#fff" }}>
                      {opp.estimatedCommercialRelevance ?? "medium"} relevance
                    </span>
                  </div>
                  <span style={{ fontFamily: INTER, fontSize: 8, fontWeight: 600, textTransform: "uppercase", letterSpacing: "1.5px", padding: "2px 8px", background: "rgba(34,21,22,0.06)", color: "#5c5350", flexShrink: 0 }}>
                    confidence: {opp.confidence}
                  </span>
                </div>
                <div style={{ fontFamily: DISPLAY, fontSize: 16, fontWeight: 600, fontStyle: "italic", color: "#221516", marginBottom: 4 }}>{opp.insight}</div>
                <div style={{ fontSize: 12, color: "#7a6f6a", marginBottom: 8 }}>{opp.evidence} · {opp.timePeriod}</div>
                <div style={{ fontSize: 13, color: "#221516" }}>→ {opp.suggestedAction}</div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState message="No high-priority actions yet for this period. Patterns surface as post-wear data accumulates." />
        )}
      </Section>

      {/* ── STRONGEST SIGNALS ────────────────────────────────────── */}
      <TopSignalsSection data={data} kpis={kpis} phase4b2={phase4b2} advanced={advanced} rel={rel} dateRangeDays={dateRangeDays} />

      {/* ── CHANGES ──────────────────────────────────────────────── */}
      {hasChanges ? (
        <Section title="Changes" desc={`${evolution.current.label} vs ${evolution.previous.label}`} status={evolution.status}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 20 }}>
            <PeriodCard period={evolution.current} label="Current Period" />
            <PeriodCard period={evolution.previous} label="Prior Period" />
            <div style={s.card}>
              <div style={s.cardLabel}>Trend Direction</div>
              <TrendPill label="Ratings" trend={evolution.ratingTrend} />
              <TrendPill label="Sessions" trend={evolution.sessionsTrend} />
              <div style={{ marginTop: 14, fontSize: 12, color: "#7a6f6a", fontStyle: "italic", fontFamily: SERIF, lineHeight: 1.5 }}>
                Full comparison — conversion, saves, returns — available after commercial integration.
              </div>
            </div>
          </div>
          {rel?.dnaMatrix?.length > 0 && rel.status !== "insufficient-data" && (
            <div style={{ marginTop: 18 }}>
              <div style={s.subHeader}>Personality patterns this period</div>
              {rel.dnaMatrix.slice(0, 2).map((row, i) => (
                <RelationshipCard
                  key={i}
                  who={row.personality}
                  context={row.topOccasions[0] || null}
                  feature="Style Me"
                  pattern={
                    row.topProducts[0]
                      ? `${row.personality} customers${row.topDesiredFeelings[0] ? ` seeking ${row.topDesiredFeelings[0]}` : ""}${row.topOccasions[0] ? ` for ${row.topOccasions[0]}` : ""} — associated with ${row.topProducts[0]}`
                      : `${row.personality} customers (${row.sessionCount} session${row.sessionCount !== 1 ? "s" : ""})`
                  }
                  product={row.topProducts[0] || null}
                  outcome={[
                    row.avgRating != null && `★ ${row.avgRating}/5`,
                    row.rewearRate != null && `${Math.round(row.rewearRate * 100)}% rewear`,
                    row.avgConfidenceLift != null && `+${row.avgConfidenceLift} confidence`,
                    row.feelingAchievedRate != null && `${row.feelingAchievedRate}% feeling achieved`,
                  ].filter(Boolean).join(" · ")}
                />
              ))}
            </div>
          )}
        </Section>
      ) : (
        <Section title="Changes" desc="Period comparison — not enough data for this period">
          <InsufficientCard label="Period comparison" description="Need at least 3 sessions or reviews in both periods to compare meaningfully." />
        </Section>
      )}

      {/* ── PLATFORM HEALTH ──────────────────────────────────────── */}
      <Section title="Platform Health" desc="Source availability, mode, evidence coverage, and pending integrations">
        <div style={s.kpiGrid}>
          <div style={s.kpiCard}>
            <div style={{ fontFamily: INTER, fontSize: 8, textTransform: "uppercase", letterSpacing: "2px", color: "#7a6f6a", marginBottom: 8 }}>Live Data Source</div>
            <StatusBadge status={liveSourceActive ? "live" : "awaiting-integration"} />
            <div style={{ fontFamily: MONO, fontSize: 11, marginTop: 8, color: liveSourceActive ? "#2a5e42" : "#9CA3AF" }}>
              {liveSourceActive ? "Connected" : "No DB connection"}
            </div>
          </div>
          <div style={s.kpiCard}>
            <div style={{ fontFamily: INTER, fontSize: 8, textTransform: "uppercase", letterSpacing: "2px", color: "#7a6f6a", marginBottom: 8 }}>Preview Mode</div>
            <StatusBadge status={sampleMode ? "sample" : "live"} />
            <div style={{ fontFamily: MONO, fontSize: 11, marginTop: 8, color: "#7a6f6a" }}>
              {sampleMode ? "Sample — ?preview=sample" : "Live data"}
            </div>
          </div>
          <div style={s.kpiCard}>
            <div style={{ fontFamily: INTER, fontSize: 8, textTransform: "uppercase", letterSpacing: "2px", color: "#7a6f6a", marginBottom: 8 }}>Pending Integrations</div>
            <div style={{ fontFamily: DISPLAY, fontSize: 28, fontWeight: 700, color: "#d97706", marginBottom: 4 }}>4</div>
            <div style={{ fontSize: 11, color: "#9CA3AF", fontFamily: MONO }}>Commerce · Saves · FASHN.ai · Rec Feedback</div>
          </div>
          <div style={s.kpiCard}>
            <div style={{ fontFamily: INTER, fontSize: 8, textTransform: "uppercase", letterSpacing: "2px", color: "#7a6f6a", marginBottom: 8 }}>Explanation Evidence</div>
            <div style={{ fontFamily: DISPLAY, fontSize: 28, fontWeight: 700, color: evidenceDenominator > 0 ? "#8b2035" : "#9CA3AF", marginBottom: 4 }}>
              {evidenceDenominator}
            </div>
            <div style={{ fontSize: 11, color: "#9CA3AF", fontFamily: MONO }}>feedback events · {periodStr}</div>
          </div>
          <KpiCard
            label="Registered nAia Users"
            value={sampleMode ? (fk?.registeredNaiaUsers ?? data.totalUsers ?? 0) : (data.totalUsers || 0)}
            status="live"
            tooltip="All-time count of registered customers."
          />
          <KpiCard
            label="Completed Passports"
            value={sampleMode ? (fk?.completedPassports ?? 0) : (kpis?.passport?.completed ?? "—")}
            status="live"
            tooltip="All-time count of customers who completed their nAia Passport."
          />
          <KpiCard
            label="Total Outfit Reviews"
            value={sampleMode ? (fk?.totalOutfitReviews ?? data.totalLooks ?? 0) : (data.totalLooks || 0)}
            status="live"
            tooltip="All outfit reviews across all time."
          />
          <KpiCard
            label="Avg Outfit Rating"
            value={sampleMode ? (fk?.avgOutfitRating?.toFixed(1) ?? "—") : (data.avgRating != null ? data.avgRating.toFixed(1) : "—")}
            suffix="/5"
            status="live"
            tooltip="Average overall feeling rating across all outfit reviews, all time."
          />
          {liveSourceActive && (
            <>
              <KpiCard label="StyleMe Sessions" value={kpis.recentActivity.sessions} tooltip="Last 30 days — does not follow the period filter." />
              <KpiCard label="Outfit Reviews (30d)" value={kpis.recentActivity.reviews} tooltip="Last 30 days — does not follow the period filter." />
              <KpiCard label="Passport Completion" value={`${kpis.passport.completionRate}%`} tooltip="% of started passports completed, all time." />
              <KpiCard label="Closet Adoption" value={`${kpis.closet.adoptionRate}%`} tooltip="% of registered customers with ≥1 closet item, all time." />
            </>
          )}
        </div>
      </Section>
    </>
  );
}



// ── Dynamic Top Signals ───────────────────────────────────────────────────────

function buildTopSignals({ data, kpis, phase4b2, advanced, rel, dateRangeDays }) {
  const candidates = [];
  const totalProfiles = data?.onboarding?.totalProfiles || 0;
  const totalReviews  = data?.totalLooks || 0;
  const pLabel = dateRangeDays === 365 ? "All time" : `Last ${dateRangeDays} days`;
  const LOG51 = Math.log(51);

  function push(cat, title, value, denominator, source, period, n, strength) {
    if (!value) return;
    candidates.push({
      cat, title, value, denominator, source, period,
      conf: sampleConfidence(n),
      score: (Math.log(Math.min(n, 50) + 1) / LOG51) * 0.5 + Math.min(strength, 1) * 0.5,
    });
  }

  // identity
  const topStyle = data?.onboarding?.styleDNADistribution?.[0];
  if (topStyle && totalProfiles >= 3)
    push("identity", "Top Style Personality",
      normalizeLabel(topStyle.style) ?? topStyle.style,
      `${topStyle.count} of ${totalProfiles} completed profiles`,
      "Passport profiles", "All time",
      totalProfiles, topStyle.count / totalProfiles);

  // context: occasion
  const topOcc = data?.topOccasions?.[0];
  if (topOcc && totalReviews >= 3)
    push("context", "Top Styled Occasion",
      normalizeLabel(topOcc.name) ?? topOcc.name,
      `${topOcc.lookCount} of ${totalReviews} reviewed looks`,
      "Outfit reviews", "All time",
      totalReviews, topOcc.lookCount / totalReviews);

  // context: lifestyle
  const topLifestyle = data?.onboarding?.lifestyleDistribution?.[0];
  if (topLifestyle && totalProfiles >= 3)
    push("context", "Top Lifestyle Context",
      normalizeLabel(topLifestyle.lifestyle) ?? topLifestyle.lifestyle,
      `${topLifestyle.count} of ${totalProfiles} completed profiles`,
      "Passport profiles", "All time",
      totalProfiles, topLifestyle.count / totalProfiles);

  // garment: colour
  const topColor = data?.onboarding?.colorDistribution?.[0];
  if (topColor && totalProfiles >= 3)
    push("garment", "Top Preferred Colour",
      normalizeLabel(topColor.color) ?? topColor.color,
      `${topColor.count} of ${totalProfiles} completed profiles`,
      "Passport profiles", "All time",
      totalProfiles, topColor.count / totalProfiles);

  // garment: fit / silhouette
  const topFit = data?.bodyPatterns?.[0];
  if (topFit && topFit.userCount >= 3) {
    const d = totalProfiles || topFit.userCount;
    push("garment", "Top Fit Preference",
      normalizeLabel(topFit.preference) ?? topFit.preference,
      `${topFit.userCount} of ${d} customers`,
      "Passport profiles", "All time",
      topFit.userCount, topFit.userCount / Math.max(d, 1));
  }

  // emotional: desired feeling
  const topFeeling = data?.onboarding?.desiredFeelings?.[0];
  if (topFeeling && totalProfiles >= 3)
    push("emotional", "Strongest Desired Feeling",
      normalizeLabel(topFeeling.feeling) ?? topFeeling.feeling,
      `${topFeeling.count} of ${totalProfiles} completed profiles`,
      "Passport profiles", "All time",
      totalProfiles, topFeeling.count / totalProfiles);

  // emotional: confirmed shift (ONLY when achievedRate data is actually present)
  if (rel?.status !== "insufficient-data") {
    const withRate = (rel?.emotionalChain || []).filter(r => r.achievedRate != null && r.count >= 3);
    const best = [...withRate].sort((a, b) => (b.achievedRate ?? 0) - (a.achievedRate ?? 0))[0];
    if (best) {
      const achieved = Math.round((best.achievedRate / 100) * best.count);
      push("emotional", "Strongest Confirmed Emotional Shift",
        `${best.currentMood} → ${best.desiredFeeling}`,
        `${achieved} of ${best.count} sessions · ${best.achievedRate}% delivery`,
        "Styling reviews", pLabel,
        best.count, best.achievedRate / 100);
    }
  }

  // emotional: post-wear
  if (phase4b2?.postWearCompletion && !phase4b2.postWearCompletion.migrationPending) {
    const d = phase4b2.postWearCompletion.totalWithPostWear;
    if (d >= 3) {
      const pct = phase4b2.postWearCompletion.positiveExperienceRate;
      push("emotional", "Post-Wear Satisfaction",
        `${pct}% felt great or good`,
        `${phase4b2.postWearCompletion.feltPositive} of ${d} post-wear reviews`,
        "Post-wear reviews", pLabel,
        d, pct / 100);
    }
  }

  // friction: objection
  const topObj = data?.topObjections?.[0];
  if (topObj && totalReviews >= 3)
    push("friction", "Top Outfit Objection",
      normalizeLabel(topObj.name) ?? topObj.name,
      `${topObj.count} mentions across ${totalReviews} reviews`,
      "Outfit reviews", "All time",
      totalReviews, Math.min(topObj.count / Math.max(totalReviews, 1), 0.5) * 2);

  // friction: styling struggle
  const topStruggle = data?.onboarding?.commonStruggles?.[0];
  if (topStruggle && totalProfiles >= 3)
    push("friction", "Top Styling Struggle",
      normalizeLabel(topStruggle.struggle) ?? topStruggle.struggle,
      `${topStruggle.count} of ${totalProfiles} completed profiles`,
      "Passport profiles", "All time",
      totalProfiles, topStruggle.count / totalProfiles);

  // nAia: recommendation love rate
  if (advanced?.trustMetrics?.status !== "insufficient-data" && (advanced?.trustMetrics?.sampleSize ?? 0) >= 5) {
    const n = advanced.trustMetrics.sampleSize;
    const lr = advanced.trustMetrics.loveRate;
    push("naia", "Recommendation Love Rate",
      `${lr}% Love it`,
      `${Math.round(lr / 100 * n)} of ${n} sessions with responses`,
      "Recommendation feedback", pLabel,
      n, lr / 100);
  }

  // nAia: confidence lift
  if ((kpis?.confidence?.sampleSize ?? 0) >= 5) {
    const n = kpis.confidence.sampleSize;
    const lift = kpis.confidence.avgDelta;
    push("naia", "Confidence Lift",
      `+${lift} avg points`,
      `${kpis.confidence.avgBefore} → ${kpis.confidence.avgAfter} /10 · ${n} sessions`,
      "Post-outfit reviews", "All time",
      n, Math.min(lift / 5, 1));
  }

  // Sort by score descending
  candidates.sort((a, b) => b.score - a.score);

  // Balance: one from each category first, then fill to 6
  const ORDER = ["identity", "context", "garment", "emotional", "friction", "naia"];
  const selected = [];
  const used = new Set();
  for (const cat of ORDER) {
    if (selected.length >= 6) break;
    const idx = candidates.findIndex((c, i) => c.cat === cat && !used.has(i));
    if (idx !== -1) { selected.push(candidates[idx]); used.add(idx); }
  }
  for (let i = 0; i < candidates.length && selected.length < 6; i++) {
    if (!used.has(i)) { selected.push(candidates[i]); used.add(i); }
  }

  return { selected, all: candidates };
}

function TopSignalCard({ signal }) {
  const conf = signal.conf;
  return (
    <div style={{ ...s.card, borderLeft: `3px solid ${conf.color}` }}>
      <div style={{ fontFamily: MONO, fontSize: 9, textTransform: "uppercase", letterSpacing: "1.5px", color: "#7a6f6a", marginBottom: 6 }}>{signal.title}</div>
      <div style={{ fontFamily: SERIF, fontSize: 16, color: "#221516", fontWeight: 600, marginBottom: 6, lineHeight: 1.3 }}>{signal.value}</div>
      <div style={{ fontFamily: MONO, fontSize: 10, color: "#5c5350", lineHeight: 1.5 }}>{signal.denominator}</div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 4, marginTop: 8, paddingTop: 6, borderTop: "1px solid rgba(34,21,22,0.06)" }}>
        <span style={{ fontFamily: MONO, fontSize: 9, color: "#9CA3AF" }}>{signal.source} · {signal.period}</span>
        <span style={{ fontFamily: MONO, fontSize: 9, padding: "1px 5px", background: `${conf.color}18`, color: conf.color, border: `1px solid ${conf.color}40` }}>{conf.label}</span>
      </div>
    </div>
  );
}

function TopSignalsSection({ data, kpis, phase4b2, advanced, rel, dateRangeDays }) {
  const [showAll, setShowAll] = useState(false);
  const { selected, all } = buildTopSignals({ data, kpis, phase4b2, advanced, rel, dateRangeDays });
  if (all.length === 0) return null;
  const display = showAll ? all : selected;
  return (
    <Section
      title="Top Signals"
      desc="Highest-confidence intelligence selected from all data sources — balanced across identity, context, garment, emotional need, friction, and nAia behaviour"
      status="live"
    >
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 14 }}>
        {display.map((sig, i) => <TopSignalCard key={i} signal={sig} />)}
      </div>
      {all.length > 6 && (
        <button type="button" onClick={() => setShowAll(o => !o)} style={{ ...s.linkBtn, marginTop: 14 }}>
          {showAll ? "Show fewer signals ↑" : `View all ${all.length} signals ↓`}
        </button>
      )}
    </Section>
  );
}

function PeriodCard({ period, label }) {
  return (
    <div style={s.card}>
      <div style={s.cardLabel}>{label}</div>
      <div style={{ fontFamily: MONO, fontSize: 10, color: "#7a6f6a", marginBottom: 12 }}>{period.label}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <Metric label="Sessions" value={period.sessions} />
        <Metric label="Reviews" value={period.reviews} />
        <Metric label="Avg Rating" value={period.avgRating != null ? `${period.avgRating}/5` : "—"} />
        <Metric label="Rewear Rate" value={period.rewearRate != null ? `${period.rewearRate}%` : "—"} />
      </div>
    </div>
  );
}

function TrendPill({ label, trend }) {
  const config = { improving: { icon: "↑", color: "#2a5e42" }, growing: { icon: "↑", color: "#2a5e42" }, stable: { icon: "→", color: "#7a6f6a" }, declining: { icon: "↓", color: "#8b2035" }, null: { icon: "—", color: "#9CA3AF" } };
  const cfg = config[trend] || config.null;
  return (
    <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8 }}>
      <span style={{ fontFamily: SERIF, fontSize: 13, color: "#7a6f6a" }}>{label}</span>
      <span style={{ fontFamily: MONO, fontSize: 11, color: cfg.color, fontWeight: 700 }}>{cfg.icon} {trend || "—"}</span>
    </div>
  );
}

function Metric({ label, value }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between" }}>
      <span style={{ fontFamily: SERIF, fontSize: 13, color: "#7a6f6a" }}>{label}</span>
      <span style={{ fontFamily: MONO, fontSize: 11, color: "#221516" }}>{value}</span>
    </div>
  );
}

// ── Relationship intelligence shared components ────────────────────────────────

// Prescriptive recommendation block — shown at the bottom of each relevant section
function PrescriptiveBlock({ recommendation, reason, confidence = "medium", sampleSize }) {
  const borderColor = confidence === "high" ? "#2a5e42" : confidence === "medium" ? "#6b4800" : "#7a6f6a";
  const bgColor = confidence === "high" ? "rgba(42,94,66,0.05)" : confidence === "medium" ? "rgba(107,72,0,0.04)" : "rgba(122,111,106,0.04)";
  return (
    <div style={{ marginTop: 20, padding: "16px 20px", background: bgColor, borderLeft: `3px solid ${borderColor}` }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 8, flexWrap: "wrap" }}>
        <div style={{ fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif", fontSize: 7, textTransform: "uppercase", letterSpacing: "2.5px", color: borderColor, fontWeight: 600 }}>
          Designer Recommendation
        </div>
        {sampleSize != null && (
          <div style={{ fontFamily: "'Courier New', Courier, monospace", fontSize: 10, color: "#9CA3AF" }}>
            n={sampleSize}
          </div>
        )}
      </div>
      <div style={{ fontFamily: "'Cormorant Garamond', Garamond, serif", fontSize: 17, fontWeight: 600, fontStyle: "italic", color: "#221516", marginBottom: 8, lineHeight: 1.5 }}>
        {recommendation}
      </div>
      {reason && (
        <div style={{ fontFamily: "'Cormorant Garamond', Garamond, serif", fontSize: 14, color: "#7a6f6a", lineHeight: 1.6 }}>
          <strong style={{ color: "#221516", fontStyle: "normal" }}>Why:</strong> {reason}
        </div>
      )}
    </div>
  );
}

// Relationship synthesis card — shows "who × what × when × feature → outcome" pattern
function RelationshipCard({ pattern, who, context, feature, outcome, product }) {
  return (
    <div style={{ padding: "18px 20px", background: "#fafaf8", border: "1px solid rgba(34,21,22,0.07)", borderLeft: "3px solid #8b2035", marginBottom: 12 }}>
      {who && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
          {who && <span style={{ fontSize: 9, fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif", fontWeight: 600, letterSpacing: "1.5px", textTransform: "uppercase", padding: "3px 8px", background: "#8b2035", color: "#fff" }}>{who}</span>}
          {context && <span style={{ fontSize: 9, fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif", fontWeight: 500, letterSpacing: "1.5px", textTransform: "uppercase", padding: "3px 8px", background: "rgba(34,21,22,0.07)", color: "#221516" }}>{context}</span>}
          {feature && <span style={{ fontSize: 9, fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif", fontWeight: 500, letterSpacing: "1.5px", textTransform: "uppercase", padding: "3px 8px", background: "rgba(42,94,66,0.10)", color: "#2a5e42" }}>{feature}</span>}
        </div>
      )}
      <div style={{ fontFamily: "'Cormorant Garamond', Garamond, serif", fontSize: 17, fontWeight: 600, fontStyle: "italic", color: "#221516", lineHeight: 1.5, marginBottom: product ? 8 : 0 }}>
        {pattern}
      </div>
      {product && (
        <div style={{ fontSize: 11, fontFamily: "'Courier New', Courier, monospace", color: "#8b2035", marginTop: 6, letterSpacing: "0.5px" }}>
          → {product}
        </div>
      )}
      {outcome && (
        <div style={{ fontFamily: "'Cormorant Garamond', Garamond, serif", fontSize: 14, color: "#7a6f6a", marginTop: 8 }}>
          {outcome}
        </div>
      )}
    </div>
  );
}



// Emotional flow row — shows currentMood → desiredFeeling → achieved rate → top product
function EmotionalFlowRow({ chain }) {
  const achievedColor = chain.achievedRate == null ? "#9CA3AF"
    : chain.achievedRate >= 70 ? "#2a5e42"
    : chain.achievedRate >= 40 ? "#6b4800"
    : "#8b2035";
  const LABEL = { fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif", fontSize: 7, textTransform: "uppercase", letterSpacing: "2px", color: "#9CA3AF", fontWeight: 600, marginBottom: 4 };
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "12px 0", borderBottom: "1px solid rgba(34,21,22,0.06)" }}>
      <div style={{ textAlign: "center", minWidth: 80 }}>
        <div style={LABEL}>Starting</div>
        <div style={{ fontSize: 14, fontStyle: "italic", color: "#7a6f6a", fontFamily: "'Cormorant Garamond', Garamond, serif" }}>{chain.currentMood || "—"}</div>
      </div>
      <div style={{ color: "#8b2035", fontSize: 14, opacity: 0.5 }}>→</div>
      <div style={{ textAlign: "center", minWidth: 80 }}>
        <div style={LABEL}>Desired</div>
        <div style={{ fontSize: 14, fontWeight: 600, fontStyle: "italic", color: "#8b2035", fontFamily: "'Cormorant Garamond', Garamond, serif" }}>{chain.desiredFeeling || "—"}</div>
      </div>
      <div style={{ color: "#8b2035", fontSize: 14, opacity: 0.5 }}>→</div>
      <div style={{ textAlign: "center", minWidth: 60 }}>
        <div style={LABEL}>Achieved</div>
        <div style={{ fontSize: 15, fontWeight: 700, color: achievedColor, fontFamily: "'Courier New', Courier, monospace" }}>
          {chain.achievedRate != null ? `${chain.achievedRate}%` : "—"}
        </div>
      </div>
      <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", paddingLeft: 8 }}>
        {chain.topProducts?.length > 0 && (
          <div style={{ fontFamily: "'Cormorant Garamond', Garamond, serif", fontSize: 13, fontStyle: "italic", color: "#7a6f6a" }}>
            via {chain.topProducts.join(", ")}
          </div>
        )}
        <div style={{ fontFamily: "'Courier New', Courier, monospace", fontSize: 11, color: "#9CA3AF", marginLeft: "auto" }}>
          {chain.count} session{chain.count !== 1 ? "s" : ""}
          {chain.avgRating != null && ` · ★ ${chain.avgRating}`}
        </div>
      </div>
    </div>
  );
}

// DNA intelligence row — shows personality × outcomes in a single line
function DNAIntelligenceRow({ row }) {
  const MONO = { fontFamily: "'Courier New', Courier, monospace", fontSize: 11 };
  return (
    <div style={{ padding: "14px 16px", background: "#fafaf8", border: "1px solid rgba(34,21,22,0.07)", marginBottom: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12, marginBottom: 8 }}>
        <div style={{ fontFamily: "'Playfair Display', Georgia, serif", fontSize: 15, fontWeight: 700, fontStyle: "italic", color: "#221516" }}>{row.personality}</div>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          {row.avgRating != null && <span style={{ ...MONO }}>★ {row.avgRating}</span>}
          {row.rewearRate != null && <span style={{ ...MONO }}>{Math.round(row.rewearRate * 100)}% rewear</span>}
          {row.avgConfidenceLift != null && <span style={{ ...MONO, color: "#8b2035" }}>{row.avgConfidenceLift >= 0 ? "+" : ""}{row.avgConfidenceLift} confidence</span>}
          {row.feelingAchievedRate != null && (
            <span style={{ ...MONO, color: row.feelingAchievedRate >= 70 ? "#2a5e42" : row.feelingAchievedRate >= 40 ? "#6b4800" : "#8b2035" }}>
              {row.feelingAchievedRate}% feeling achieved
            </span>
          )}
          <span style={{ ...MONO, color: "#9CA3AF" }}>n={row.sessionCount}</span>
        </div>
      </div>
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: row.prescriptive ? 10 : 0, fontFamily: "'Cormorant Garamond', Garamond, serif", fontStyle: "italic", fontSize: 13, color: "#7a6f6a" }}>
        {row.topOccasions?.length > 0 && <span>Occasions: {row.topOccasions.join(", ")}</span>}
        {row.topDesiredFeelings?.length > 0 && <span>Wants to feel: {row.topDesiredFeelings.join(", ")}</span>}
        {row.topProducts?.length > 0 && <span>Top pieces: {row.topProducts.join(", ")}</span>}
      </div>
      {row.prescriptive && (
        <div style={{ fontFamily: "'Cormorant Garamond', Garamond, serif", fontStyle: "italic", fontSize: 14, color: "#221516", padding: "10px 12px", background: "rgba(34,21,22,0.02)", borderLeft: "2px solid #8b2035", lineHeight: 1.6 }}>
          {row.prescriptive}
        </div>
      )}
    </div>
  );
}

// Occasion intelligence card — shows occasion × product × personality
function OccasionIntelCard({ row }) {
  const MONO = { fontFamily: "'Courier New', Courier, monospace", fontSize: 11 };
  const EYEBROW = { fontFamily: "'Inter', -apple-system, sans-serif", fontSize: 7, textTransform: "uppercase", letterSpacing: "2px", color: "#9CA3AF", fontWeight: 600, marginBottom: 6 };
  return (
    <div style={{ ...s.card, marginBottom: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
        <div style={{ fontFamily: "'Playfair Display', Georgia, serif", fontSize: 15, fontWeight: 700, fontStyle: "italic", color: "#221516" }}>{row.occasion}</div>
        <div style={{ display: "flex", gap: 10 }}>
          <span style={{ ...MONO, color: "#7a6f6a" }}>{row.count} session{row.count !== 1 ? "s" : ""}</span>
          {row.successRate != null && (
            <span style={{ ...MONO, color: row.successRate >= 70 ? "#2a5e42" : row.successRate >= 40 ? "#6b4800" : "#8b2035" }}>
              {row.successRate}% success
            </span>
          )}
        </div>
      </div>
      <div style={{ fontFamily: "'Cormorant Garamond', Garamond, serif", fontStyle: "italic", fontSize: 13, color: "#7a6f6a", marginBottom: 10, display: "flex", gap: 16, flexWrap: "wrap" }}>
        {row.topPersonalities?.length > 0 && <span>Who: {row.topPersonalities.join(", ")}</span>}
        {row.topDesiredFeelings?.length > 0 && <span>Wants: {row.topDesiredFeelings.join(", ")}</span>}
      </div>
      {row.topProducts?.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          <div style={EYEBROW}>Top Pieces</div>
          {row.topProducts.map((p, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", fontFamily: "'Cormorant Garamond', Garamond, serif", fontSize: 13, color: "#221516", paddingBottom: 4, marginBottom: 4, borderBottom: i < row.topProducts.length - 1 ? "1px solid rgba(34,21,22,0.05)" : "none" }}>
              <span>{p.name}</span>
              <span style={{ fontFamily: "'Courier New', Courier, monospace", fontSize: 11, color: "#7a6f6a" }}>{p.avgRating != null ? `★ ${p.avgRating}` : ""}</span>
            </div>
          ))}
        </div>
      )}
      {row.prescriptive && (
        <div style={{ fontFamily: "'Cormorant Garamond', Garamond, serif", fontStyle: "italic", fontSize: 14, color: "#221516", padding: "10px 12px", background: "rgba(34,21,22,0.02)", borderLeft: "2px solid #8b2035", lineHeight: 1.6 }}>
          {row.prescriptive}
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// CANONICAL PRODUCT DETAIL PANEL — every product in every tab uses this
// ══════════════════════════════════════════════════════════════════════════════

function ProductDetailPanel({ narrative, saveVsPurchase, dateRangeDays }) {
  const [open, setOpen] = useState(false);
  if (!narrative) return null;
  const confData = sampleConfidence(narrative.sampleSize);
  const scoreColor = narrative.opportunityScore >= 70 ? "#2a5e42" : narrative.opportunityScore >= 45 ? "#d97706" : "#7a6f6a";
  const svp = saveVsPurchase?.productBreakdown?.find(p => p.product === narrative.name);

  return (
    <div style={{ border: "1px solid rgba(34,21,22,0.09)", background: "#fff" }}>
      {/* Compact header — always visible */}
      <div style={{ padding: "14px 20px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontFamily: DISPLAY, fontSize: 17, fontWeight: 600, fontStyle: "italic", color: "#221516" }}>{narrative.name}</div>
          <div style={{ fontFamily: MONO, fontSize: 10, color: "#7a6f6a", marginTop: 3 }}>
            Score {narrative.opportunityScore} · ★ {narrative.avgRating?.toFixed(1) ?? "—"} · {narrative.rewearRate != null ? `${Math.round(narrative.rewearRate * 100)}% rewear` : "—"} · n={narrative.sampleSize}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
          <span style={{ fontSize: 8, fontFamily: INTER, fontWeight: 600, textTransform: "uppercase", letterSpacing: "1.5px", padding: "3px 8px", background: confData.color, color: "#fff" }}>{confData.label}</span>
          <span style={{ fontSize: 8, fontFamily: INTER, fontWeight: 600, textTransform: "uppercase", letterSpacing: "1.5px", padding: "3px 8px", background: scoreColor, color: "#fff" }}>Score {narrative.opportunityScore}</span>
          <button type="button" onClick={() => setOpen(o => !o)} style={{ ...s.linkBtn, marginTop: 0 }}>
            {open ? "Hide ↑" : "View Detail ↓"}
          </button>
        </div>
      </div>

      {/* Full canonical detail — expanded */}
      {open && (
        <div style={{ borderTop: "1px solid rgba(34,21,22,0.07)", padding: "18px 20px 20px" }}>
          {/* Recommended action */}
          {narrative.recommendation && (
            <div style={{ marginBottom: 18, padding: "12px 16px", background: "rgba(42,94,66,0.04)", borderLeft: "3px solid #2a5e42" }}>
              <div style={{ fontFamily: INTER, fontSize: 8, fontWeight: 600, textTransform: "uppercase", letterSpacing: "2px", color: "#2a5e42", marginBottom: 4 }}>Recommended Action</div>
              <div style={{ fontSize: 14, color: "#221516", fontWeight: 600, lineHeight: 1.5 }}>{narrative.recommendation}</div>
              {narrative.recommendationReason && (
                <div style={{ fontSize: 12, color: "#7a6f6a", marginTop: 6, lineHeight: 1.5, fontStyle: "italic" }}>{narrative.recommendationReason}</div>
              )}
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: "14px 24px" }}>
            {narrative.bestPersonality && (
              <div>
                <div style={{ fontFamily: INTER, fontSize: 8, fontWeight: 600, textTransform: "uppercase", letterSpacing: "2px", color: "#7a6f6a", marginBottom: 4 }}>Best-fit Audience</div>
                <div style={{ fontSize: 13, color: "#8b2035" }}>{narrative.bestPersonality}</div>
              </div>
            )}
            {narrative.bestOccasion && (
              <div>
                <div style={{ fontFamily: INTER, fontSize: 8, fontWeight: 600, textTransform: "uppercase", letterSpacing: "2px", color: "#7a6f6a", marginBottom: 4 }}>Best Context</div>
                <div style={{ fontSize: 13, color: "#221516" }}>{narrative.bestOccasion}</div>
              </div>
            )}
            {narrative.strongestTransformation && (
              <div>
                <div style={{ fontFamily: INTER, fontSize: 8, fontWeight: 600, textTransform: "uppercase", letterSpacing: "2px", color: "#7a6f6a", marginBottom: 4 }}>Emotional Outcome</div>
                <div style={{ fontSize: 13, color: "#221516", fontStyle: "italic", fontFamily: SERIF }}>{narrative.strongestTransformation}</div>
              </div>
            )}
            {narrative.mostCommonObjection && (
              <div>
                <div style={{ fontFamily: INTER, fontSize: 8, fontWeight: 600, textTransform: "uppercase", letterSpacing: "2px", color: "#7a6f6a", marginBottom: 4 }}>Top Objection</div>
                <div style={{ fontSize: 13, color: "#c53030" }}>{narrative.mostCommonObjection}</div>
              </div>
            )}
            <div>
              <div style={{ fontFamily: INTER, fontSize: 8, fontWeight: 600, textTransform: "uppercase", letterSpacing: "2px", color: "#7a6f6a", marginBottom: 4 }}>Rating &amp; Rewear</div>
              <div style={{ fontSize: 13, color: "#221516" }}>
                {narrative.avgRating != null ? `★ ${narrative.avgRating.toFixed(1)}/5` : "—"}
                {narrative.rewearRate != null && ` · ${Math.round(narrative.rewearRate * 100)}% would wear again`}
              </div>
            </div>
            {narrative.avgConfidenceLift != null && (
              <div>
                <div style={{ fontFamily: INTER, fontSize: 8, fontWeight: 600, textTransform: "uppercase", letterSpacing: "2px", color: "#7a6f6a", marginBottom: 4 }}>Confidence Lift</div>
                <div style={{ fontSize: 13, color: narrative.avgConfidenceLift > 0 ? "#2a5e42" : "#9CA3AF" }}>
                  {narrative.avgConfidenceLift >= 0 ? "+" : ""}{narrative.avgConfidenceLift} pts · n={narrative.sampleSize}
                </div>
              </div>
            )}
            {svp && (
              <div>
                <div style={{ fontFamily: INTER, fontSize: 8, fontWeight: 600, textTransform: "uppercase", letterSpacing: "2px", color: "#7a6f6a", marginBottom: 4 }}>Save / Purchase</div>
                <div style={{ fontSize: 13, color: "#221516" }}>
                  {svp.saves} saved · {svp.purchases} purchased
                  {svp.saves > 0 && ` · ${svp.saveToP}% conversion`}
                </div>
              </div>
            )}
            <div>
              <div style={{ fontFamily: INTER, fontSize: 8, fontWeight: 600, textTransform: "uppercase", letterSpacing: "2px", color: "#7a6f6a", marginBottom: 4 }}>Evidence</div>
              <div style={{ fontFamily: MONO, fontSize: 12, fontWeight: 700, color: confData.color }}>
                {narrative.sampleSize} review{narrative.sampleSize !== 1 ? "s" : ""} · {periodLabel(dateRangeDays)}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// TAB 2 — CUSTOMER INTELLIGENCE
// ══════════════════════════════════════════════════════════════════════════════

function TabCustomer({ data, kpis, advanced, rel, sampleMode, dateRangeDays }) {
  return (
    <>
      {/* Style DNA */}
      {data.onboarding?.totalProfiles > 0 && (
        <Section title="Style DNA Distribution" desc={`Based on ${data.onboarding.totalProfiles} completed profiles`} status="live" action={<ExportCSVButton data={data.onboarding.styleDNADistribution} filename="style-dna.csv" />}>
          <div style={s.grid3}>
            {data.onboarding.styleDNADistribution.map((item, i) => (
              <div key={i} style={s.card}>
                <div style={s.cardLabel}>{normalizeLabel(item.style) ?? item.style}</div>
                <div style={{ ...s.cardValue, marginTop: 8 }}>{item.count} users · {item.percentage}%</div>
                <div style={{ marginTop: 8, height: 4, background: "rgba(34,21,22,0.07)" }}>
                  <div style={{ height: "100%", width: `${item.percentage}%`, background: "#8b2035" }} />
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Desired Feelings */}
      {data.onboarding?.desiredFeelings?.length > 0 && (
        <Section title="Desired Feelings" desc="How customers want to feel when dressed" status="live" action={<ExportCSVButton data={data.onboarding.desiredFeelings} filename="desired-feelings.csv" />}>
          <div style={s.grid3}>
            {data.onboarding.desiredFeelings.map((item, i) => (
              <div key={i} style={s.card}>
                <div style={s.cardLabel}>{normalizeLabel(item.feeling) ?? item.feeling}</div>
                <div style={s.cardValue}>{item.count} users · {item.percentage}%</div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Lifestyle */}
      {data.onboarding?.lifestyleDistribution?.length > 0 && (
        <Section title="Lifestyle & Context" desc="What occasions customers dress for" status="live">
          <div style={s.grid3}>
            {data.onboarding.lifestyleDistribution.slice(0, 9).map((item, i) => (
              <div key={i} style={s.card}>
                <div style={s.cardLabel}>{normalizeLabel(item.lifestyle) ?? item.lifestyle}</div>
                <div style={s.cardValue}>{item.count} users · {item.percentage}%</div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Colour Intelligence */}
      {(data.onboarding?.colorIntelligence || data.onboarding?.colorDistribution?.length > 0) && (
        <Section title="Colour Intelligence" desc="Palette direction, preferred and avoided colours — all profiles, all time" status="live">
          {data.onboarding?.colorIntelligence ? (
            <>
              {/* Palette Direction */}
              <div style={s.subHeader}>PALETTE DIRECTION</div>
              <div style={s.grid3}>
                {data.onboarding.colorIntelligence.paletteDirectionBreakdown.map((item, i) => (
                  <div key={i} style={{ ...s.card, borderLeft: i === 0 ? "3px solid #8b2035" : undefined }}>
                    <div style={s.cardLabel}>{item.direction}</div>
                    <div style={s.cardValue}>{item.count} of 15 users · {item.percentage}%</div>
                    <div style={{ fontSize: 12, color: "#7a6f6a", marginTop: 6, lineHeight: 1.5 }}>{item.description}</div>
                  </div>
                ))}
              </div>
              {/* Preferred */}
              <div style={{ ...s.subHeader, marginTop: 20 }}>PREFERRED COLOUR FAMILIES</div>
              <div style={s.grid3}>
                {data.onboarding.colorIntelligence.preferredColors.map((item, i) => (
                  <div key={i} style={s.card}>
                    <div style={s.cardLabel}>{normalizeLabel(item.color) ?? item.color}</div>
                    <div style={s.cardValue}>{item.count} users · {item.percentage}%</div>
                  </div>
                ))}
              </div>
              {/* Avoided */}
              {data.onboarding.colorIntelligence.avoidedColors?.length > 0 && (
                <>
                  <div style={{ ...s.subHeader, marginTop: 20 }}>AVOIDED COLOUR FAMILIES</div>
                  <div style={s.grid3}>
                    {data.onboarding.colorIntelligence.avoidedColors.map((item, i) => (
                      <div key={i} style={{ ...s.card, borderLeft: "3px solid #8b2035" }}>
                        <div style={{ ...s.cardLabel, color: "#8b2035" }}>{normalizeLabel(item.color) ?? item.color}</div>
                        <div style={s.cardValue}>{item.count} users · {item.percentage}%</div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </>
          ) : (
            <div style={s.grid3}>
              {data.onboarding.colorDistribution.slice(0, 9).map((item, i) => (
                <div key={i} style={s.card}>
                  <div style={s.cardLabel}>{normalizeLabel(item.color) ?? item.color}</div>
                  <div style={s.cardValue}>{item.count} users · {item.percentage}%</div>
                </div>
              ))}
            </div>
          )}
        </Section>
      )}

      {/* Fit & Silhouette */}
      {data.bodyPatterns?.length > 0 && (
        <Section title="Fit and Silhouette Intelligence" desc="What works for different body and fit preferences" status="live">
          <div style={s.grid3}>
            {data.bodyPatterns.map((pattern, i) => (
              <div key={i} style={s.card}>
                <div style={s.cardLabel}>{pattern.preference}</div>
                <div style={{ fontFamily: MONO, fontSize: 10, color: "#9CA3AF", marginBottom: 10 }}>{pattern.userCount} {pattern.userCount === 1 ? "user" : "users"}</div>
                {pattern.bestPieces?.length > 0 && <div style={{ marginBottom: 8 }}><div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "1.5px", color: "#7a6f6a", marginBottom: 4 }}>Best pieces</div>{pattern.bestPieces.map((p, j) => <div key={j} style={{ fontSize: 13, color: "#221516" }}>• {typeof p === "string" ? p : p.name}</div>)}</div>}
                {pattern.struggles?.length > 0 && pattern.struggles[0] !== "No repeated fit concerns yet" && <div><div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "1.5px", color: "#7a6f6a", marginBottom: 4 }}>Fit concerns</div>{pattern.struggles.map((str, j) => <div key={j} style={{ fontSize: 13, color: "#c5553a" }}>• {str}</div>)}</div>}
                <div style={{ marginTop: 10, fontSize: 12, color: "#7a6f6a", fontStyle: "italic" }}>{pattern.implication}</div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Styling Struggles */}
      {data.onboarding?.commonStruggles?.length > 0 && (
        <Section title="Common Styling Struggles" desc="What customers need help with most" status="live">
          <div style={s.grid3}>
            {data.onboarding.commonStruggles.slice(0, 6).map((item, i) => (
              <div key={i} style={s.card}>
                <div style={s.cardLabel}>{item.struggle}</div>
                <div style={s.cardValue}>{item.count} users · {item.percentage}%</div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Emotional Journey Intelligence */}
      <Section
        title="Emotional Journey Intelligence"
        desc="Aggregate rates: how reliably nAia lifts confidence, achieves desired feelings, and converts to post-wear satisfaction — measured as percentages across sessions"
        status={advanced?.emotionalJourney?.status || "insufficient-data"}
      >
        {!advanced?.emotionalJourney || advanced.emotionalJourney.status === "insufficient-data" ? (
          <InsufficientCard label="Emotional Journey" description="Not enough reviewed sessions to map emotional transformations." sampleSize={advanced?.emotionalJourney?.sampleSize ?? 0} min={5} />
        ) : (
          <>
            <SampleSizeWarning n={advanced.emotionalJourney.sampleSize} min={10} />
            {/* Feeling Outcome Rates — mutually exclusive, sum = 100% of post-wear reviews */}
            <div style={{ marginBottom: 6, fontSize: 11, color: "#7a6f6a", fontFamily: "'Inter', sans-serif" }}>
              Achieved + Partly + Not Achieved = {advanced.emotionalJourney.totalDenominator ?? advanced.emotionalJourney.sampleSize} post-wear reviews (100%). Unknown/No Response excluded from denominator.
            </div>
            <div style={s.kpiGrid}>
              <KpiCard
                label="Feeling Achieved"
                value={advanced.emotionalJourney.intendedFeelingAchievedRate != null ? `${advanced.emotionalJourney.intendedFeelingAchievedRate}%` : "—"}
                tooltip={`${advanced.emotionalJourney.achievedCount ?? "—"} of ${advanced.emotionalJourney.totalDenominator ?? "—"} post-wear reviews — desired feeling confirmed AND customer said they would wear again. Mutually exclusive with Partly Achieved and Not Achieved.`}
              />
              <KpiCard
                label="Partly Achieved"
                value={advanced.emotionalJourney.partlyAchievedRate != null ? `${advanced.emotionalJourney.partlyAchievedRate}%` : "—"}
                tooltip={`${advanced.emotionalJourney.partlyCount ?? "—"} of ${advanced.emotionalJourney.totalDenominator ?? "—"} — desired feeling was reported but customer would not wear again. Indicates the feeling was felt but the piece did not earn repeat wear.`}
              />
              <KpiCard
                label="Not Achieved"
                value={advanced.emotionalJourney.notAchievedRate != null ? `${advanced.emotionalJourney.notAchievedRate}%` : "—"}
                tooltip={`${advanced.emotionalJourney.notAchievedCount ?? "—"} of ${advanced.emotionalJourney.totalDenominator ?? "—"} — no achieved feeling recorded in post-wear review.`}
              />
              <KpiCard
                label="Confidence Lift"
                value={advanced.emotionalJourney.avgConfidenceLift != null
                  ? `${advanced.emotionalJourney.avgConfidenceBefore}/10 → ${advanced.emotionalJourney.avgConfidenceAfter}/10`
                  : "—"}
                tooltip={`+${advanced.emotionalJourney.avgConfidenceLift} points on a 10-point confidence scale · ${advanced.emotionalJourney.confidenceSampleSize ?? "—"} reviewed sessions · ${advanced.emotionalJourney.confidenceStatus ?? ""} · All time`}
              />
              <KpiCard
                label="Post-Wear Positive Rate"
                value={advanced.emotionalJourney.postWearPositiveRate != null ? `${advanced.emotionalJourney.postWearPositiveRate}%` : "—"}
                tooltip="% of post-wear reviews where a desired feeling was achieved. All time."
              />
            </div>
            {/* Would Wear Again breakdown */}
            {advanced.emotionalJourney.wouldWearAgain?.totalResponses > 0 && (
              <div style={{ marginTop: 16, padding: "12px 16px", background: "rgba(34,21,22,0.03)", border: "1px solid rgba(34,21,22,0.07)" }}>
                <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "1.5px", color: "#7a6f6a", marginBottom: 10, fontFamily: "'Inter', sans-serif" }}>
                  Would Wear Again — {advanced.emotionalJourney.wouldWearAgain.totalResponses} responses · all time
                </div>
                <div style={s.kpiGrid}>
                  <KpiCard label="Yes — Would Wear Again" value={`${advanced.emotionalJourney.wouldWearAgain.yesCount} · ${advanced.emotionalJourney.wouldWearAgain.yesRate}%`} tooltip={`${advanced.emotionalJourney.wouldWearAgain.yesCount} of ${advanced.emotionalJourney.wouldWearAgain.totalResponses} post-wear reviews`} />
                  <KpiCard label="No — Would Not Wear Again" value={`${advanced.emotionalJourney.wouldWearAgain.noCount} · ${advanced.emotionalJourney.wouldWearAgain.noRate}%`} tooltip={`${advanced.emotionalJourney.wouldWearAgain.noCount} of ${advanced.emotionalJourney.wouldWearAgain.totalResponses} post-wear reviews`} />
                  {advanced.emotionalJourney.wouldWearAgain.unsureCount > 0 && (
                    <KpiCard label="Unsure" value={`${advanced.emotionalJourney.wouldWearAgain.unsureCount} · ${advanced.emotionalJourney.wouldWearAgain.unsureRate}%`} />
                  )}
                </div>
              </div>
            )}

            {advanced.emotionalJourney.emotionalTransformations.length > 0 && (
              <div style={{ marginTop: 24 }}>
                <div style={s.subHeader}>Emotional Transformation Table</div>
                <div style={{ overflowX: "auto" }}>
                  <table style={s.table}>
                    <thead>
                      <tr>
                        <th style={s.th}>Starting Mood</th>
                        <th style={s.th}>Desired Feeling</th>
                        <th style={s.th}>Reported After-Feeling</th>
                        <th style={s.th}>Feeling Achieved</th>
                        <th style={s.th}>Post-Wear Confirmed</th>
                        <th style={s.th}>Would Wear Again</th>
                        <th style={s.th}>Sessions</th>
                        <th style={s.th}>Confidence</th>
                      </tr>
                    </thead>
                    <tbody>
                      {advanced.emotionalJourney.emotionalTransformations.map((t, i) => (
                        <tr key={i} style={{ background: i % 2 === 0 ? "rgba(255,255,255,0.6)" : "transparent" }}>
                          <td style={s.td}>{t.startingMood}</td>
                          <td style={s.td}>{t.desiredFeeling}</td>
                          <td style={{ ...s.td, color: "#7a6f6a", fontStyle: "italic" }}>{t.reportedAfterFeeling ?? "—"}</td>
                          <td style={s.td}>
                            <span style={{ color: t.achievedRate >= 70 ? "#2a5e42" : t.achievedRate >= 40 ? "#d97706" : "#8b2035", fontFamily: "'Inter', sans-serif", fontWeight: 600 }}>
                              {t.achievedCount != null ? `${t.achievedCount}/${t.achievedOf}` : "—"} · {t.achievedRate}%
                            </span>
                          </td>
                          <td style={s.td}>{t.postWearConfirmedCount != null ? `${t.postWearConfirmedCount}/${t.postWearConfirmedOf}` : "—"}</td>
                          <td style={s.td}>{t.wouldWearAgainCount != null ? `${t.wouldWearAgainCount}/${t.wouldWearAgainOf}` : "—"}</td>
                          <td style={{ ...s.td, fontFamily: "'Inter', sans-serif", fontSize: 11 }}>{t.sessions ?? t.count}</td>
                          <td style={{ ...s.td, fontFamily: "'Inter', sans-serif", fontSize: 11, color: "#7a6f6a" }}>{t.confidenceStatus ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {advanced.emotionalJourney.productsByEmotionalImpact.length > 0 && (
              <div style={{ marginTop: 24 }}>
                <div style={s.subHeader}>Products by Emotional Impact</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 16 }}>
                  {advanced.emotionalJourney.productsByEmotionalImpact.slice(0, 8).map((p, i) => (
                    <div key={i} style={s.card}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", gap: 8, marginBottom: 12 }}>
                        <div style={s.cardLabel}>{p.productTitle}</div>
                        {p.statusLabel && <span style={{ fontFamily: "'Inter', sans-serif", fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "1.5px", color: "#6b4800", background: "rgba(107,72,0,0.08)", padding: "2px 6px", flexShrink: 0 }}>{p.statusLabel}</span>}
                      </div>
                      {p.startingMood && <div style={{ fontSize: 11, color: "#7a6f6a", marginBottom: 10, fontStyle: "italic" }}>{p.startingMood} → {p.mostCommonAfterFeeling ?? p.desiredFeelings?.[0]}</div>}
                      <Metric label="Feeling achieved (strong)" value={`${p.achievedRate}%`} />
                      {p.partlyAchievedRate != null && p.partlyAchievedRate > 0 && <Metric label="Partly achieved" value={`${p.partlyAchievedRate}%`} />}
                      {p.notAchievedRate != null && p.notAchievedRate > 0 && <Metric label="Not achieved" value={`${p.notAchievedRate}%`} />}
                      <div style={{ margin: "8px 0", borderTop: "1px solid rgba(34,21,22,0.07)" }} />
                      {p.confidenceBefore != null && (
                        <Metric
                          label="Confidence lift"
                          value={`${p.confidenceBefore}/10 → ${p.confidenceAfter}/10 / +${p.avgConfidenceLift} pts`}
                        />
                      )}
                      <Metric label="Post-wear positive" value={`${p.postWearPositiveRate}%`} />
                      {p.wouldWearAgainCount != null && <Metric label="Would wear again" value={`${p.wouldWearAgainCount} of ${p.sampleSize}`} />}
                      {p.notWearAgainCount != null && p.notWearAgainCount > 0 && <Metric label="Would not wear again" value={`${p.notWearAgainCount} of ${p.sampleSize}`} />}
                      <Metric label="Sample size" value={`n=${p.sampleSize}`} />
                      {p.desiredFeelings?.length > 0 && (
                        <div style={{ marginTop: 8, fontSize: 11, color: "#8b2035", fontStyle: "italic" }}>{p.desiredFeelings.join(", ")}</div>
                      )}
                      {p.interpretation && (
                        <div style={{ marginTop: 10, fontSize: 12, color: "#5c5350", lineHeight: 1.5, borderTop: "1px solid rgba(34,21,22,0.07)", paddingTop: 8 }}>{p.interpretation}</div>
                      )}
                      {p.recommendedAction && (
                        <div style={{ marginTop: 8, fontSize: 12, color: "#2a5e42", lineHeight: 1.5 }}>→ {p.recommendedAction}</div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </Section>

      {/* Customer Journey Analytics */}
      <Section title="Customer Journey Analytics" desc="Multi-session journey mapping from first touch to repeat wear" status={advanced?.journeyAnalytics?.status || "awaiting-integration"}>
        {advanced?.journeyAnalytics?.status === "live" ? (
          <>
            <div style={s.kpiGrid}>
              <KpiCard label="Total Journey Events" value={advanced.journeyAnalytics.totalEvents} />
              {Object.entries(advanced.journeyAnalytics.eventTypeCounts).map(([type, count]) => (
                <KpiCard key={type} label={type.replace(/_/g, " ")} value={count} />
              ))}
            </div>
            <AwaitingCard
              label="Full Journey Mapping"
              description="Complete multi-session journeys (Passport → StyleMe → Saved Look → Return → Purchase → Repeat) require cart, checkout, and order events."
            />
          </>
        ) : (
          <AwaitingCard
            label="Customer Journey Analytics"
            description="Highest-converting journeys, abandonment points, time-to-purchase, same-session / 24h / 7d / 30d attribution. Requires cart and checkout events from Shopify."
          />
        )}
      </Section>

      {/* Style DNA × Outcomes Intelligence */}
      {rel?.dnaMatrix?.length > 0 && (
        <Section
          title="Style DNA × Outcomes Intelligence"
          desc="How each personality type is served — rating, rewear, confidence lift, and desired feeling achievement"
          status={rel.status}
        >
          {rel.status === "insufficient-data" ? (
            <InsufficientCard label="DNA × outcomes matrix" description="Not enough reviewed sessions to compute per-personality patterns." sampleSize={rel.sampleSize} />
          ) : (
            <>
              <SampleSizeWarning n={rel.sampleSize} min={10} />
              {rel.dnaMatrix.map((row, i) => <DNAIntelligenceRow key={i} row={row} />)}
            </>
          )}
        </Section>
      )}

      {/* Customer Quotes — qualitative evidence with context */}
      {data.quotes?.length > 0 && (
        <Section title="Customer Quotes" desc="Qualitative evidence from outfit and post-wear reviews" status="live" action={<ExportCSVButton data={data.quotes} filename="customer-quotes.csv" />}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 14 }}>
            {data.quotes.map((quote, i) => (
              <div key={i} style={{ padding: "18px 22px", background: "rgba(255,255,255,0.8)", border: "1px solid rgba(34,21,22,0.06)", borderLeft: "3px solid #8b2035" }}>
                <div style={{ fontFamily: SERIF, fontSize: 15, fontStyle: "italic", color: "#221516", marginBottom: 10, lineHeight: 1.7 }}>"{quote.text}"</div>
                {quote.piece && <div style={{ fontFamily: MONO, fontSize: 10, color: "#7a6f6a", letterSpacing: "1px" }}>— about {quote.piece}</div>}
              </div>
            ))}
          </div>
        </Section>
      )}
    </>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// TAB 3 — PRODUCT INTELLIGENCE
// ══════════════════════════════════════════════════════════════════════════════

function TabProduct({ data, phase4b2, advanced, rel, sampleMode, dateRangeDays }) {
  return (
    <>
      <Section title="Top-Performing Pieces" desc="High rating and rewear — nAia products only" status="live">
        {data.topPieces?.length > 0 ? (
          <div style={s.pieceGrid}>{data.topPieces.map((p, i) => <PieceCard key={i} piece={p} styleDNA={data.styleDNA} />)}</div>
        ) : <EmptyState message="No pieces with 2+ ratings and ≥4.0 average yet." />}
      </Section>

      <Section title="Mixed-Signal Pieces" desc="High potential with friction — high rating but low rewear, or vice versa" status="live">
        {data.mixedPieces?.length > 0 ? (
          <div style={s.pieceGrid}>{data.mixedPieces.map((p, i) => (
            <div key={i} style={{ ...s.pieceCard, borderLeft: "3px solid #f4a261" }}>
              <div style={s.pieceName}>{p.name}</div>
              <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 15, fontStyle: "italic", color: "#8b2035", marginBottom: 12 }}>{p.reason}</div>
              <div style={s.pieceStats}>
                <div>★ {p.avgRating?.toFixed(1) ?? "—"} | Rewear: {p.rewear != null ? `${Math.round(p.rewear * 100)}%` : "—"}</div>
                {p.friction && <div style={{ color: "#8b2035", fontSize: 14, marginTop: 8 }}>⚠ {p.friction}</div>}
              </div>
            </div>
          ))}</div>
        ) : <EmptyState message="No mixed-signal pieces yet (need 2+ reviews with divergent rating/rewear signals)." />}
      </Section>

      <Section title="Underperforming Pieces" desc="Low rating or low rewear — nAia products only" status="live">
        {data.underperformingPieces?.length > 0 ? (
          <div style={s.pieceGrid}>{data.underperformingPieces.map((p, i) => (
            <div key={i} style={{ ...s.pieceCard, borderLeft: "3px solid #c5553a" }}>
              <div style={s.pieceName}>{p.name}</div>
              <div style={{ fontSize: 14, color: "#8b2035", marginBottom: 12 }}>Weak signals: {p.weakSignals?.join(", ")}</div>
              {p.rejectionReasons?.length > 0 && <div><div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "1.5px", color: "#7a6f6a", marginBottom: 6 }}>Common rejections</div>{p.rejectionReasons.map((r, j) => <div key={j} style={{ fontSize: 14, color: "#8b2035" }}>• {r}</div>)}</div>}
            </div>
          ))}</div>
        ) : <EmptyState message="No underperforming pieces yet." />}
      </Section>

      <Section title="Pieces to Watch" desc="Early signals — fewer than 3 ratings" status="live">
        {data.watchPieces?.length > 0 ? (
          <div style={s.pieceGrid}>{data.watchPieces.map((p, i) => (
            <div key={i} style={{ ...s.pieceCard, opacity: 0.75 }}>
              <div style={s.pieceName}>{p.name}</div>
              <div style={{ fontSize: 14, color: "#7a6f6a", fontStyle: "italic" }}>⏱ {p.ratingCount} rating{p.ratingCount !== 1 ? "s" : ""} so far · {p.avgRating?.toFixed(1)}/5</div>
            </div>
          ))}</div>
        ) : <EmptyState />}
      </Section>

      <Section title="Style DNA by Piece" desc="Which style personalities resonate with each piece" status="live">
        {data.piecesByDNA?.length > 0 ? (
          <div style={s.pieceGrid}>{data.piecesByDNA.map((p, i) => (
            <div key={i} style={s.pieceCard}>
              <div style={s.pieceName}>{p.name}</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>{p.topDNA?.map((dna, j) => <span key={j} style={{ padding: "3px 8px", background: "#8b2035", color: "#f4f4f1", fontSize: 8, fontFamily: INTER, fontWeight: 600, textTransform: "uppercase", letterSpacing: "1.5px" }}>{dna}</span>)}</div>
            </div>
          ))}</div>
        ) : <EmptyState />}
      </Section>

      <Section title="Emotional Outcomes by Piece" desc="How pieces make customers feel" status="live">
        {data.emotionalOutcomes?.length > 0 ? (
          <div style={s.pieceGrid}>{data.emotionalOutcomes.map((p, i) => (
            <div key={i} style={s.pieceCard}>
              <div style={s.pieceName}>{p.name}</div>
              <div style={{ marginTop: 12 }}>{p.emotions?.map((e, j) => <div key={j} style={{ fontSize: 15, marginBottom: 6, color: "#8b2035", fontFamily: "'Cormorant Garamond', serif", fontStyle: "italic" }}>✨ {e}</div>)}</div>
            </div>
          ))}</div>
        ) : <EmptyState />}
      </Section>

      <Section title="Best-Performing Occasions" desc="Where the collection shines" status="live" action={<ExportCSVButton data={data.topOccasions} filename="occasions.csv" />}>
        {data.topOccasions?.length > 0 ? (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 16 }}>
            {data.topOccasions.map((occ, i) => (
              <div key={i} style={s.card}>
                <div style={s.cardLabel}>{occ.name}</div>
                <div style={{ display: "flex", gap: 16, marginTop: 8, fontFamily: MONO, fontSize: 11, color: "#7a6f6a" }}>
                  <span>★ {occ.avgRating?.toFixed(1)}</span>
                  <span>{occ.lookCount} looks</span>
                  <span>{Math.round(occ.rewear * 100)}% rewear</span>
                </div>
                {occ.topPieces?.length > 0 && <div style={{ fontSize: 12, color: "#666", marginTop: 8 }}>Best: {occ.topPieces.join(", ")}</div>}
              </div>
            ))}
          </div>
        ) : <EmptyState />}
      </Section>

      <Section title="Product Pairing Intelligence" desc="Best closet + nAia combinations" status="live">
        {data.productPairings?.length > 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {data.productPairings.map((p, i) => (
              <div key={i} style={{ padding: 16, background: "#fff", border: "1px solid rgba(34,21,22,0.08)" }}>
                <div style={{ fontSize: 16, fontWeight: 500, marginBottom: 8 }}>{p.closetItem} + {p.naiaPiece}</div>
                <div style={{ fontSize: 14, color: "#666" }}>{p.avgRating != null ? `${p.avgRating.toFixed(1)}/5` : "—"} · {p.reviewCount} review{p.reviewCount !== 1 ? "s" : ""} · {p.rewearRate != null ? `${Math.round(p.rewearRate * 100)}% would wear again` : "—"}</div>
              </div>
            ))}
          </div>
        ) : <EmptyState message="No pairing data yet. Pairings appear when outfit reviews include both closet items and nAia pieces." />}
      </Section>

      {sampleMode && advanced?.saveVsPurchase?.status === "sample" ? (
        <Section title="Save vs Purchase Intelligence" desc={`SAMPLE PREVIEW — ${advanced.saveVsPurchase.scopeLabel} save/buy events. Becoming Whole is the anchor case.`} status="sample">
          <div style={s.kpiGrid}>
            <KpiCard label="Total Saves" value={advanced.saveVsPurchase.totalSaves} status="sample" tooltip={`SAMPLE PREVIEW — Saves within the selected period (${advanced.saveVsPurchase.scopeLabel}).`} />
            <KpiCard label="Total Purchases" value={advanced.saveVsPurchase.totalPurchases} status="sample" />
            <KpiCard label="Save-to-Purchase Rate" value={`${advanced.saveVsPurchase.overallSaveToP}%`} status="sample" tooltip="SAMPLE PREVIEW — % of saved items that were eventually purchased." />
            <KpiCard label="Most Saved" value={advanced.saveVsPurchase.mostSaved ?? "—"} status="sample" />
            <KpiCard label="Most Purchased" value={advanced.saveVsPurchase.mostPurchased ?? "—"} status="sample" />
            <KpiCard label="Purchases Without Prior Save" value={advanced.saveVsPurchase.purchasesWithoutSave} status="sample" tooltip="SAMPLE PREVIEW — Number of purchases where no prior save was recorded for the same product-customer pair." />
          </div>
          {advanced.saveVsPurchase.highSaveLowBuyProducts?.length > 0 && (
            <div style={{ marginTop: 16, padding: "10px 14px", background: "rgba(139,32,53,0.04)", borderLeft: "3px solid #8b2035" }}>
              <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "1.5px", color: "#8b2035", marginBottom: 6, fontFamily: "'Inter', sans-serif" }}>High-Save, Zero-Purchase Products</div>
              <div style={{ fontSize: 13, color: "#221516" }}>{advanced.saveVsPurchase.highSaveLowBuyProducts.join(" · ")}</div>
              <div style={{ fontSize: 12, color: "#7a6f6a", marginTop: 4 }}>These products generate strong save intent but no purchase commitment — styling ambiguity is the most likely barrier.</div>
            </div>
          )}
          {advanced.saveVsPurchase.productBreakdown?.length > 0 && (
            <>
              <div style={{ ...s.subHeader, marginTop: 20 }}>SAVE VS PURCHASE BY PRODUCT</div>
              <div style={{ overflowX: "auto" }}>
                <table style={s.table}>
                  <thead><tr>
                    <th style={s.th}>Product</th>
                    <th style={s.th}>Saves</th>
                    <th style={s.th}>Purchases</th>
                    <th style={s.th}>Save → Purchase Rate</th>
                  </tr></thead>
                  <tbody>
                    {advanced.saveVsPurchase.productBreakdown.map((row, i) => (
                      <tr key={i} style={{ background: i % 2 === 0 ? "rgba(255,255,255,0.6)" : "transparent" }}>
                        <td style={{ ...s.td, fontFamily: "'Cormorant Garamond', serif", fontWeight: 600, fontSize: 14 }}>{row.product}</td>
                        <td style={s.td}>{row.saves}</td>
                        <td style={s.td}>{row.purchases}</td>
                        <td style={{ ...s.td, color: row.saveToP === 0 && row.saves > 0 ? "#8b2035" : row.saveToP >= 50 ? "#2a5e42" : "#221516", fontFamily: "'Inter', sans-serif", fontWeight: 600 }}>
                          {row.saves === 0 ? "—" : `${row.saveToP}%`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </Section>
      ) : (
        <RoadmapPanel title="Save vs Purchase Intelligence" items={[
          { label: "Most-Saved vs Most-Purchased Comparison", description: "Which pieces customers save vs. actually purchase. Requires SavedLook table (shopifyProductId) + Shopify order_placed webhook." },
        ]} />
      )}

      {/* VTO Intelligence */}
      <Section title="Virtual Try-On Intelligence" desc="VTO usage and preview fidelity signals" status={phase4b2?.vtoMetrics?.migrationPending ? "awaiting-integration" : "live"}>
        <div style={s.kpiGrid}>
          <KpiCard label="VTO Jobs (period)" value={phase4b2?.vtoMetrics?.totalJobs ?? "—"} />
          <KpiCard label="Completed" value={phase4b2?.vtoMetrics?.completedJobs ?? "—"} />
          {!phase4b2?.vtoMetrics?.migrationPending && phase4b2?.vtoMetrics?.vtoFeedbackCount > 0 && (
            <>
              <KpiCard label="VTO Feedback" value={phase4b2.vtoMetrics.vtoFeedbackCount} />
              <KpiCard label="Fidelity Concerns" value={phase4b2.vtoMetrics.fidelityConcernCount} />
              <KpiCard label="Concern Rate" value={`${phase4b2.vtoMetrics.fidelityConcernRate}%`} />
            </>
          )}
        </div>
        {phase4b2?.vtoMetrics?.migrationPending && <MigrationPendingNotice label="VTO feedback breakdown" />}
      </Section>

      {/* Product Intelligence Narratives — canonical detail via ProductDetailPanel */}
      {rel?.productNarratives?.length > 0 && (
        <Section
          title="Product Intelligence"
          desc="Every NADINE product — opportunity score, emotional outcome, best audience, top objection, recommended action. Click View Detail for the full canonical profile."
          status={rel.status}
        >
          {rel.status === "insufficient-data" ? (
            <InsufficientCard label="Product intelligence" description="Not enough reviewed sessions to build product-level relationship intelligence." sampleSize={rel.sampleSize} />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {rel.productNarratives.map((narrative, i) => (
                <ProductDetailPanel
                  key={i}
                  narrative={narrative}
                  saveVsPurchase={advanced?.saveVsPurchase}
                  dateRangeDays={dateRangeDays}
                />
              ))}
            </div>
          )}
        </Section>
      )}

      {/* Occasion × Product Intelligence */}
      {rel?.occasionProductMatrix?.length > 0 && (
        <Section
          title="Occasion × Product Intelligence"
          desc="Which pieces perform best for which occasions — with personality context and prescriptive next step"
          status={rel.status}
        >
          {rel.status === "insufficient-data" ? (
            <InsufficientCard label="Occasion × product matrix" description="Not enough occasion-tagged sessions to surface reliable occasion-product patterns." sampleSize={rel.sampleSize} />
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: 16 }}>
              {rel.occasionProductMatrix.map((row, i) => <OccasionIntelCard key={i} row={row} />)}
            </div>
          )}
        </Section>
      )}
    </>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// TAB 4 — RECOMMENDATION INTELLIGENCE
// ══════════════════════════════════════════════════════════════════════════════

function TabRecommendation({ data, kpis, phase4b2, advanced, rel, sampleMode, dateRangeDays }) {
  return (
    <>
      <Section title="Recommendation Response Engagement" desc="Immediate reactions to individual recommendation cards — separate from post-outfit reviews" status={phase4b2?.feedbackEngagement?.migrationPending ? "awaiting-integration" : "live"}>
        {phase4b2?.feedbackEngagement?.migrationPending ? (
          <MigrationPendingNotice label="Recommendation feedback (RecommendationFeedback table)" />
        ) : (
          <>
            <div style={{ padding: "8px 14px", background: "rgba(34,21,22,0.03)", border: "1px solid rgba(34,21,22,0.08)", fontFamily: "'Inter', -apple-system, sans-serif", fontSize: 11, color: "#5c5350", marginBottom: 16, lineHeight: 1.6 }}>
              This section tracks immediate Love it / Okay / Not for me taps on recommendation cards. It is <strong>not</strong> the same as post-outfit reviews, which are counted separately below.
            </div>
            <div style={s.kpiGrid}>
              <KpiCard label="StyleMe Sessions (period)" value={phase4b2.feedbackEngagement.totalSessions} tooltip={`Count of StyleMe sessions in the ${periodLabel(dateRangeDays)} — denominator for the response rate below.`} />
              <KpiCard label="Sessions With Response" value={phase4b2.feedbackEngagement.sessionsWithFeedback} />
              <KpiCard label="Response Rate" value={pctOf(phase4b2.feedbackEngagement.sessionsWithFeedback, phase4b2.feedbackEngagement.totalSessions, "sessions")} tooltip="% of styling sessions where at least one recommendation card received an immediate response." />
            </div>
          </>
        )}
      </Section>

      <Section title="Recommendation Response Distribution" desc="Breakdown of immediate Love it / Okay / Not for me responses to recommendation cards" status={phase4b2?.feedbackDistribution?.migrationPending ? "awaiting-integration" : "live"}>
        {phase4b2?.feedbackDistribution?.migrationPending ? <MigrationPendingNotice label="Recommendation response distribution (RecommendationFeedback table)" /> : phase4b2?.feedbackDistribution?.total > 0 ? (
          <div style={s.kpiGrid}>
            <KpiCard label="Love it" value={phase4b2.feedbackDistribution.love} tooltip={pctOf(phase4b2.feedbackDistribution.love, phase4b2.feedbackDistribution.total, "responses")} />
            <KpiCard label="It's okay" value={phase4b2.feedbackDistribution.okay} tooltip={pctOf(phase4b2.feedbackDistribution.okay, phase4b2.feedbackDistribution.total, "responses")} />
            <KpiCard label="Not for me" value={phase4b2.feedbackDistribution.notForMe} tooltip={pctOf(phase4b2.feedbackDistribution.notForMe, phase4b2.feedbackDistribution.total, "responses")} />
            <KpiCard label="Total Responses" value={phase4b2.feedbackDistribution.total} />
          </div>
        ) : <EmptyState message="No recommendation responses recorded yet for this period." />}
      </Section>

      <Section title="Objection Signals" desc="Reason codes from okay and not-for-me feedback" status={phase4b2?.objectionInsights?.migrationPending ? "awaiting-integration" : "live"}>
        {phase4b2?.objectionInsights?.migrationPending ? <MigrationPendingNotice label="Objection signals" /> : phase4b2?.objectionInsights?.total >= 3 ? (
          <div style={s.kpiGrid}>
            <KpiCard label="Colour" value={phase4b2.objectionInsights.colourObjections} />
            <KpiCard label="Fit / Shape" value={phase4b2.objectionInsights.fitObjections} />
            <KpiCard label="Too Revealing" value={phase4b2.objectionInsights.tooRevealingObjections} />
            <KpiCard label="Too Covered" value={phase4b2.objectionInsights.tooCoveredObjections} />
            <KpiCard label="Too Formal" value={phase4b2.objectionInsights.tooFormalObjections} />
            <KpiCard label="Too Casual" value={phase4b2.objectionInsights.tooCasualObjections} />
            <KpiCard label="Not Practical" value={phase4b2.objectionInsights.notPracticalObjections} />
            <KpiCard label="Already Own Similar" value={phase4b2.objectionInsights.alreadyOwnObjections} />
          </div>
        ) : <EmptyState message="Need 3+ okay/not-for-me responses to surface objection patterns." />}
      </Section>

      <Section title="Buy or Skip Signals" desc="How customers assess new pieces against their wardrobe — all-time counts, does not follow the period filter" status={kpis?.buyOrSkip?.total > 0 ? "live" : "insufficient-data"}>
        {kpis?.buyOrSkip?.total > 0 ? (
          <div style={s.kpiGrid}>
            <KpiCard label="Total Analyses" value={kpis.buyOrSkip.total} />
            <KpiCard label="Buy Rate" value={`${kpis.buyOrSkip.buyRate}%`} />
            <KpiCard label="Buy" value={kpis.buyOrSkip.buy} />
            <KpiCard label="Skip" value={kpis.buyOrSkip.skip} />
            <KpiCard label="Maybe" value={kpis.buyOrSkip.maybe} />
          </div>
        ) : <EmptyState message="No Buy or Skip analyses recorded yet." />}
      </Section>

      <Section title="Post-Wear Signals" desc="How customers experience looks after styling" status={phase4b2?.postWearCompletion?.migrationPending ? "awaiting-integration" : "live"}>
        {phase4b2?.postWearCompletion?.migrationPending ? <MigrationPendingNotice label="Post-wear review breakdown" /> : phase4b2?.postWearCompletion?.totalWithPostWear === 0 ? (
          <EmptyState message="No post-wear data yet." />
        ) : (
          <div style={s.kpiGrid}>
            <KpiCard label="Post-Wear Reviews" value={phase4b2.postWearCompletion.totalWithPostWear} />
            <KpiCard label="Wore the Look" value={phase4b2.postWearCompletion.didWearItYes} suffix={` (${phase4b2.postWearCompletion.wearRate}%)`} />
            <KpiCard label="Felt Great or Good" value={phase4b2.postWearCompletion.feltPositive} suffix={` (${phase4b2.postWearCompletion.positiveExperienceRate}%)`} />
          </div>
        )}
      </Section>

      <Section title="What Worked — What Didn't" desc="Tag patterns across all reviewed sessions" status={data.positiveTags?.length > 0 ? "live" : "insufficient-data"}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
          <div>
            <div style={s.subHeader}>What worked</div>
            {data.positiveTags?.length > 0 ? (
              data.positiveTags.map((tag, i) => (
                <div key={i} style={{ ...s.card, borderLeft: "3px solid #2a9d8f", marginBottom: 12 }}>
                  <div style={{ fontFamily: "'Playfair Display', serif", fontSize: 16, fontWeight: 600, marginBottom: 6 }}>{tag.name}</div>
                  <div style={{ fontFamily: MONO, fontSize: 11, color: "#7a6f6a", marginBottom: 8 }}>{tag.count} mentions</div>
                  {tag.topPieces?.length > 0 && <div style={{ fontSize: 12, color: "#666" }}>Most linked: {tag.topPieces.join(", ")}</div>}
                </div>
              ))
            ) : <EmptyState />}
          </div>
          <div>
            <div style={s.subHeader}>What didn't work</div>
            {data.negativeTags?.length > 0 ? (
              data.negativeTags.map((tag, i) => (
                <div key={i} style={{ ...s.card, borderLeft: "3px solid #c5553a", marginBottom: 12 }}>
                  <div style={{ fontFamily: "'Playfair Display', serif", fontSize: 16, fontWeight: 600, marginBottom: 6 }}>{tag.name}</div>
                  <div style={{ fontFamily: MONO, fontSize: 11, color: "#7a6f6a", marginBottom: 8 }}>{tag.count} mentions</div>
                  {tag.topPieces?.length > 0 && <div style={{ fontSize: 12, color: "#666" }}>Most linked: {tag.topPieces.join(", ")}</div>}
                </div>
              ))
            ) : <EmptyState />}
          </div>
        </div>
      </Section>

      <Section title="Outfit Objection Tracker" desc="Why customers hesitate to wear recommended looks" status={data.topObjections?.length > 0 ? "live" : "insufficient-data"}>
        {data.topObjections?.length > 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {data.topObjections.slice(0, 8).map((obj, i) => (
              <div key={i} style={{ padding: 16, background: "#fff", border: "1px solid rgba(34,21,22,0.08)", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                <div style={{ fontSize: 15, fontWeight: 500 }}>{obj.name}</div>
                <div style={{ fontFamily: MONO, fontSize: 11, color: "#6b4800", whiteSpace: "nowrap" }}>{obj.count} mentions</div>
              </div>
            ))}
          </div>
        ) : <EmptyState message="No outfit objections recorded yet." />}
      </Section>

      {sampleMode && advanced?.explainability?.status === "sample" ? (
        <Section title="Explainability Analytics" desc={`SAMPLE PREVIEW — ${advanced.explainability.scopeLabel} · n=${advanced.explainability.evidenceDenominator} explanation-feedback events`} status="sample">
          {advanced.explainability.evidenceDenominator === 0 && (
            <div style={{ padding: "10px 14px", background: "rgba(139,32,53,0.04)", borderLeft: "3px solid #8b2035", marginBottom: 16, fontSize: 13, color: "#8b2035" }}>
              Not enough sample evidence for this period — no explanation-feedback events recorded.
            </div>
          )}
          <div style={s.kpiGrid}>
            <KpiCard label="Explanation Agreement Rate" value={advanced.explainability.explanationAgreementRate != null ? `${advanced.explainability.explanationAgreementRate}%` : "—"} status="sample" tooltip="SAMPLE PREVIEW — % of recommendation feedback responses that were 'Love it'. Not enough evidence when n=0." />
            <KpiCard label="→ Click Rate" value="—" status="not-implemented" tooltip="Not enough sample evidence — no click events captured in this period." />
            <KpiCard label="→ Save Rate" value={`${advanced.explainability.saveRate}%`} status="sample" tooltip="SAMPLE PREVIEW — % of sessions that resulted in a save." />
            <KpiCard label="→ Purchase Rate" value={`${advanced.explainability.purchaseRate}%`} status="sample" tooltip="SAMPLE PREVIEW — % of sessions that resulted in a purchase." />
          </div>
          {advanced.explainability.reasonsResonate?.length > 0 && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginTop: 16 }}>
              <div style={s.card}>
                <div style={{ ...s.cardLabel, color: "#2a5e42", marginBottom: 8 }}>Reasons That Resonate</div>
                {advanced.explainability.reasonsResonate.map((r, i) => (
                  <div key={i} style={{ fontSize: 13, color: "#221516", paddingBottom: 4, borderBottom: i < advanced.explainability.reasonsResonate.length - 1 ? "1px solid rgba(34,21,22,0.06)" : "none", marginBottom: 4 }}>✓ {r}</div>
                ))}
              </div>
              {advanced.explainability.reasonsRejected?.length > 0 && (
                <div style={s.card}>
                  <div style={{ ...s.cardLabel, color: "#8b2035", marginBottom: 8 }}>Reasons Rejected</div>
                  {advanced.explainability.reasonsRejected.map((r, i) => (
                    <div key={i} style={{ fontSize: 13, color: "#221516", paddingBottom: 4, borderBottom: i < advanced.explainability.reasonsRejected.length - 1 ? "1px solid rgba(34,21,22,0.06)" : "none", marginBottom: 4 }}>✗ {r}</div>
                  ))}
                </div>
              )}
            </div>
          )}
          {advanced.explainability.byPersonality?.length > 0 && (
            <>
              <div style={{ ...s.subHeader, marginTop: 20 }}>AGREEMENT RATE BY PERSONALITY</div>
              <div style={s.grid3}>
                {advanced.explainability.byPersonality.map((row, i) => (
                  <div key={i} style={s.card}>
                    <div style={s.cardLabel}>{row.personality}</div>
                    <div style={{ ...s.cardValue, color: row.agreementRate == null ? "#7a6f6a" : row.agreementRate >= 70 ? "#2a5e42" : row.agreementRate >= 40 ? "#d97706" : "#8b2035" }}>{row.agreementRate != null ? `${row.agreementRate}%` : "—"}</div>
                    <div style={{ fontSize: 11, color: "#7a6f6a", marginTop: 4 }}>n={row.sampleSize} responses</div>
                  </div>
                ))}
              </div>
            </>
          )}
        </Section>
      ) : (
        <RoadmapPanel title="Explainability Analytics Roadmap" items={[
          { label: "Explanation Agreement Rate", description: "Whether customers agree with nAia's explanations. Requires logging explanationAgreed + explanationVersion on each feedback record." },
          { label: "Explanation → Click Rate", description: "Does the explanation drive product clicks?" },
          { label: "Explanation → Save / Purchase Rate", description: "Does agreeing with the explanation correlate with conversion?" },
          { label: "Reasons That Resonate / Rejected", description: "Which explanation types customers find compelling vs. unconvincing." },
          { label: "Explanation Performance by Segment", description: "Explanation effectiveness per style personality or occasion segment." },
        ]} />
      )}

      {/* What makes recommendations succeed */}
      {rel?.emotionalChain?.length > 0 && rel.status !== "insufficient-data" && (
        <Section
          title="What Makes Recommendations Succeed"
          desc="The mood × feeling combinations where nAia delivers — and where it doesn't"
          status={rel.status}
        >
          <div style={{ fontSize: 13, color: "#7a6f6a", marginBottom: 16, lineHeight: 1.6 }}>
            Recommendation success is measured by whether the customer achieves their desired feeling.
            High achievement rates indicate the right product was matched to the right emotional moment.
          </div>
          {rel.emotionalChain.filter(r => r.achievedRate != null).length > 0 ? (
            <>
              {rel.emotionalChain.filter(r => r.achievedRate != null).slice(0, 8).map((row, i) => <EmotionalFlowRow key={i} chain={row} />)}
              <PrescriptiveBlock
                recommendation={(() => {
                  const high = rel.emotionalChain.filter(r => (r.achievedRate ?? 0) >= 70);
                  const low = rel.emotionalChain.filter(r => r.achievedRate != null && (r.achievedRate ?? 100) < 50);
                  if (high.length > 0 && low.length > 0) {
                    return `nAia succeeds when customers want to feel ${high[0].desiredFeeling}${high[0].topProducts[0] ? ` (${high[0].topProducts[0]})` : ""}. It struggles when they want to feel ${low[0].desiredFeeling}. Prioritise expanding product options for the under-served feeling states.`;
                  }
                  if (high.length > 0) return `nAia is consistently delivering on desired feelings. Focus on expanding coverage to more mood-feeling combinations.`;
                  return `Recommendation delivery rates are forming. Continue collecting post-wear data to identify success and failure patterns.`;
                })()}
                reason="The difference between a successful and failed recommendation is usually whether the product matched the emotional aspiration, not just the style. Desired feeling achievement is the leading indicator of recommendation quality."
                confidence="medium"
                sampleSize={rel.sampleSize}
              />
            </>
          ) : (
            <InsufficientCard label="Recommendation success patterns" description="Need desiredFeelingAchieved data from post-outfit reviews." sampleSize={rel.sampleSize} />
          )}
        </Section>
      )}

      {/* ── ABSORBED FROM AI PERFORMANCE ─────────────────────────── */}

      {/* Recommendation Trust by Personality — from former AI Performance tab */}
      {rel?.dnaMatrix?.length > 0 && (
        <Section
          title="Recommendation Trust by Personality"
          desc="How well nAia delivers on desired feelings for each customer personality — the deepest available trust signal without purchase data"
          status={rel.status}
        >
          {rel.status === "insufficient-data" ? (
            <InsufficientCard label="Trust by personality" description="Not enough reviewed sessions to measure per-personality delivery rates." sampleSize={rel.sampleSize} />
          ) : (
            <>
              <SampleSizeWarning n={rel.sampleSize} min={10} />
              <div style={{ overflowX: "auto" }}>
                <table style={s.table}>
                  <thead>
                    <tr>
                      <th style={s.th}>Personality</th>
                      <th style={s.th}>Feeling Achieved</th>
                      <th style={s.th}>Avg Rating</th>
                      <th style={s.th}>Rewear</th>
                      <th style={s.th}>Confidence Lift</th>
                      <th style={s.th}>Sessions</th>
                      <th style={s.th}>Signal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rel.dnaMatrix.slice().sort((a, b) => (b.feelingAchievedRate ?? -1) - (a.feelingAchievedRate ?? -1)).map((row, i) => {
                      const rate = row.feelingAchievedRate;
                      const rateColor = rate == null ? "#9CA3AF" : rate >= 70 ? "#2a5e42" : rate >= 40 ? "#d97706" : "#8b2035";
                      return (
                        <tr key={i} style={{ background: i % 2 === 0 ? "rgba(255,255,255,0.6)" : "transparent" }}>
                          <td style={{ ...s.td, fontFamily: SERIF, fontWeight: 600, fontSize: 14 }}>{row.personality}</td>
                          <td style={{ ...s.td, fontWeight: 700, color: rateColor, fontFamily: MONO }}>{rate != null ? `${rate}%` : "—"}</td>
                          <td style={s.td}>{row.avgRating != null ? `★ ${row.avgRating}` : "—"}</td>
                          <td style={s.td}>{row.rewearRate != null ? `${Math.round(row.rewearRate * 100)}%` : "—"}</td>
                          <td style={{ ...s.td, color: row.avgConfidenceLift != null && row.avgConfidenceLift > 0 ? "#2a5e42" : "#7a6f6a" }}>
                            {row.avgConfidenceLift != null ? `${row.avgConfidenceLift >= 0 ? "+" : ""}${row.avgConfidenceLift}` : "—"}
                          </td>
                          <td style={{ ...s.td, fontFamily: MONO, fontSize: 11 }}>{row.sessionCount}</td>
                          <td style={{ ...s.td, fontSize: 11, fontFamily: MONO, color: rateColor }}>
                            {rate == null ? "—" : rate >= 70 ? "Strong" : rate >= 40 ? "Moderate" : "Weak"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </Section>
      )}

      {/* Emotional Transformation Patterns — customer mood → desired feeling delivery */}
      {rel?.emotionalChain?.length > 0 && rel.status !== "insufficient-data" && (
        <Section
          title="Emotional Transformation Patterns"
          desc="Which mood → feeling pairings customers bring — and how reliably nAia delivers each transformation"
          status={rel.status}
        >
          {rel.emotionalChain.map((row, i) => <EmotionalFlowRow key={i} chain={row} />)}
        </Section>
      )}

      {/* Feature Adoption */}
      <Section title="Feature Adoption" desc="Selfie analysis and closet try-on readiness" status="live">
        <div style={s.kpiGrid}>
          {phase4b2?.selfieAdoption?.migrationPending ? (
            <div style={s.kpiCard}><StatusBadge status="awaiting-integration" /><div style={{ ...s.kpiValue, fontSize: 18, color: "#9CA3AF", marginTop: 8 }}>—</div><div style={s.kpiLabel}>Selfie Adoption</div></div>
          ) : (
            <>
              <KpiCard label="Selfies Analysed" value={phase4b2?.selfieAdoption?.customersWithSelfie ?? "—"} suffix={` / ${phase4b2?.selfieAdoption?.totalCustomers ?? "—"}`} />
              <KpiCard label="Selfie Adoption" value={`${phase4b2?.selfieAdoption?.adoptionRate ?? "—"}%`} />
            </>
          )}
          <KpiCard label="Total Closet Items" value={phase4b2?.closetTryOnReadiness?.totalItems ?? "—"} />
          <KpiCard label="Ready for Try-On" value={`${phase4b2?.closetTryOnReadiness?.readyItems ?? "—"}`} suffix={phase4b2?.closetTryOnReadiness?.readinessRate != null ? ` (${phase4b2.closetTryOnReadiness.readinessRate}%)` : ""} />
          <KpiCard label="Pending Assessment" value={phase4b2?.closetTryOnReadiness?.pendingAssessmentItems ?? "—"} />
          <KpiCard label="Not Eligible" value={phase4b2?.closetTryOnReadiness?.ineligibleItems ?? "—"} />
        </div>
      </Section>

      {/* Feedback-Informed Design Insights */}
      <Section title="Feedback-Informed Design Insights" desc="Signals from customer feedback — internal suggestions only. No automatic changes to products or profiles." status={phase4b2?.designerInsights?.length > 0 ? "live" : "insufficient-data"}>
        {phase4b2?.designerInsights?.length > 0 ? (
          phase4b2.designerInsights.map((insight, i) => <FeedbackInsightCard key={i} insight={insight} />)
        ) : (
          <EmptyState message="No feedback patterns strong enough to surface yet. Signals appear when objections reach threshold levels." />
        )}
      </Section>

      {/* AI Learning Roadmap */}
      <RoadmapPanel title="AI Learning Roadmap" items={[
        { label: "Recommendation Accuracy Over Time", description: "Tracks whether scored recommendations are accepted, purchased, or returned. Requires a RecommendationAccuracyLog table." },
        { label: "False Positives — high score, rejected", description: "Recommendations nAia was confident about that customers rejected — the most valuable calibration signal." },
        { label: "False Negatives — moderate score, purchased", description: "Recommendations with a modest score that led to purchase — evidence of underweighted signals." },
        { label: "Match Score Calibration", description: "How well nAia's confidence score predicts actual customer acceptance rate." },
        { label: "Scoring Weight Performance", description: "Which scoring dimensions (personality, occasion, feeling, fit) most reliably predict purchase." },
        { label: "Model Improvement by Period", description: "Whether nAia's recommendation quality is improving over successive periods." },
      ]} />
    </>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// TAB 5 — COLLECTION INTELLIGENCE
// ══════════════════════════════════════════════════════════════════════════════

function TabCollection({ data, kpis, advanced, rel, dateRangeDays }) {
  return (
    <>
      {/* Balance & Coverage Summary */}
      {(() => {
        const health = advanced?.collectionHealth;
        const hasDna = rel?.dnaMatrix?.length > 0;
        const occasions = data?.topOccasions ?? [];
        const unmetNeeds = data?.stylingNeeds ?? [];
        const wellServedCount = hasDna ? rel.dnaMatrix.filter(r => r.avgRating != null && r.avgRating >= 4 && r.rewearRate != null && r.rewearRate >= 0.6).length : null;
        const totalPersonalities = hasDna ? rel.dnaMatrix.length : null;
        const coverageScore = health?.score;
        const gapLabel = health?.largestWeakness ? health.largestWeakness.replace(/([A-Z])/g, " $1").trim().toLowerCase() : null;
        const strongLabel = health?.strongestArea ? health.strongestArea.replace(/([A-Z])/g, " $1").trim().toLowerCase() : null;
        const isBalanced = coverageScore != null && coverageScore >= 60 && wellServedCount != null && wellServedCount >= Math.ceil(totalPersonalities * 0.6);
        const balanceVerdict = coverageScore == null ? "Insufficient data to assess balance." : isBalanced ? "Collection is broadly balanced." : "Collection has notable coverage gaps.";
        return (
          <div style={{ ...s.card, borderLeft: "3px solid #8b2035", marginBottom: 8, background: "linear-gradient(135deg, #fdfaf7 0%, #fff 100%)" }}>
            <div style={{ fontFamily: SERIF, fontSize: 17, fontWeight: 700, color: "#221516", marginBottom: 10 }}>
              Is the collection balanced?
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16 }}>
              <div>
                <div style={s.cardLabel}>Balance verdict</div>
                <div style={{ fontSize: 14, color: isBalanced ? "#2a5e42" : coverageScore == null ? "#9CA3AF" : "#d97706", fontWeight: 600, marginTop: 4 }}>{balanceVerdict}</div>
                {coverageScore != null && <div style={{ fontFamily: MONO, fontSize: 10, color: "#7a6f6a", marginTop: 4 }}>Health score: {coverageScore}/100</div>}
              </div>
              <div>
                <div style={s.cardLabel}>Personality coverage</div>
                <div style={{ fontSize: 14, color: "#221516", fontWeight: 600, marginTop: 4 }}>
                  {wellServedCount != null ? `${wellServedCount} of ${totalPersonalities} personality types well served` : "—"}
                </div>
              </div>
              <div>
                <div style={s.cardLabel}>Occasion demand</div>
                <div style={{ fontSize: 14, color: "#221516", fontWeight: 600, marginTop: 4 }}>
                  {occasions.length > 0 ? `${occasions.length} occasions active` : "—"}
                </div>
                {unmetNeeds.length > 0 && <div style={{ fontSize: 12, color: "#d97706", marginTop: 4 }}>{unmetNeeds.length} unmet need{unmetNeeds.length !== 1 ? "s" : ""} flagged</div>}
              </div>
              <div>
                <div style={s.cardLabel}>Gaps &amp; strengths</div>
                {gapLabel && <div style={{ fontSize: 12, color: "#d97706", marginTop: 4 }}>Gap: {gapLabel}</div>}
                {strongLabel && <div style={{ fontSize: 12, color: "#2a5e42", marginTop: 2 }}>Strong: {strongLabel}</div>}
                {!gapLabel && !strongLabel && <div style={{ fontSize: 12, color: "#9CA3AF", marginTop: 4 }}>—</div>}
              </div>
            </div>
          </div>
        );
      })()}

      {/* Collection Health Score */}
      <Section title="Collection Health Score" desc="Transparent partial score from available data factors (full score requires commercial integration)" status={advanced?.collectionHealth?.score != null ? "live" : "insufficient-data"}>
        {advanced?.collectionHealth?.sampleSizeWarning && <SampleSizeWarning n={advanced.collectionHealth.reviewCount ?? 0} min={10} />}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 20 }}>
          <div style={{ ...s.card, textAlign: "center" }}>
            <div style={{ fontFamily: "'Playfair Display', serif", fontSize: 72, fontWeight: 900, color: "#8b2035", lineHeight: 1 }}>
              {advanced?.collectionHealth?.score != null ? advanced.collectionHealth.score : "—"}
            </div>
            <div style={{ fontFamily: MONO, fontSize: 10, color: "#7a6f6a", textTransform: "uppercase", letterSpacing: "2px", marginTop: 8 }}>
              {advanced?.collectionHealth?.factorsAvailable ?? 0} of {advanced?.collectionHealth?.factorsTotal ?? 8} factors available
            </div>
            {advanced?.collectionHealth?.largestWeakness && (
              <div style={{ marginTop: 16, fontSize: 12, color: "#d97706" }}>Largest weakness: {advanced.collectionHealth.largestWeakness.replace(/([A-Z])/g, " $1").trim()}</div>
            )}
            {advanced?.collectionHealth?.strongestArea && (
              <div style={{ marginTop: 8, fontSize: 12, color: "#2a5e42" }}>Strongest area: {advanced.collectionHealth.strongestArea.replace(/([A-Z])/g, " $1").trim()}</div>
            )}
          </div>
          {advanced?.collectionHealth?.factors && (
            <div style={s.card}>
              <div style={s.cardLabel}>Factor Breakdown</div>
              <p style={{ fontFamily: "'Cormorant Garamond', Garamond, serif", fontSize: 13, color: "#7a6f6a", fontStyle: "italic", marginTop: 4, marginBottom: 14 }}>
                Each bar reflects its own metric — bars are not directly comparable.
              </p>
              {Object.entries(advanced.collectionHealth.factors).map(([key, factor]) => (
                <div key={key} style={{ marginBottom: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4, gap: 8 }}>
                    <span style={{ fontSize: 12, color: "#221516", flexShrink: 0 }}>{key.replace(/([A-Z])/g, " $1").trim()}</span>
                    <span style={{ fontFamily: MONO, fontSize: 10, color: "#7a6f6a", textAlign: "right" }}>
                      {factor.label}
                    </span>
                  </div>
                  {factor.score != null && (
                    <div style={{ height: 3, background: "rgba(34,21,22,0.07)" }}>
                      <div style={{ height: "100%", width: `${Math.min(factor.score, 100)}%`, background: factor.score >= 60 ? "#2a5e42" : factor.score >= 30 ? "#d97706" : "#8b2035" }} />
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </Section>

      {/* Collection Evolution */}
      <Section title="Collection Evolution" desc="Performance comparison between current and previous period" status={advanced?.collectionEvolution?.status || "insufficient-data"}>
        {advanced?.collectionEvolution?.status === "insufficient-data" ? (
          <InsufficientCard label="Period comparison" description="Not enough data in this period to compare meaningfully. Need 3+ sessions or reviews." />
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 20 }}>
            <PeriodCard period={advanced.collectionEvolution.current} label="Current Period" />
            <PeriodCard period={advanced.collectionEvolution.previous} label="Previous Period" />
            <div style={s.card}>
              <div style={s.cardLabel}>Trend Direction</div>
              <TrendPill label="Avg Rating" trend={advanced.collectionEvolution.ratingTrend} />
              <TrendPill label="Sessions" trend={advanced.collectionEvolution.sessionsTrend} />
              <div style={{ marginTop: 16, padding: "10px 12px", background: "#fafaf8", borderLeft: "2px solid rgba(34,21,22,0.10)", fontFamily: SERIF, fontStyle: "italic", fontSize: 13, color: "#7a6f6a" }}>
                Note: Full collection evolution (conversion, saves, returns, size coverage) requires commercial integration.
              </div>
            </div>
          </div>
        )}
      </Section>

      {/* Occasion Coverage */}
      <Section title="Occasion Coverage" desc="Which occasions nAia is successfully serving" status={data.topOccasions?.length > 0 ? "live" : "insufficient-data"}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 16 }}>
          {data.topOccasions?.map((occ, i) => (
            <div key={i} style={s.card}>
              <div style={s.cardLabel}>{occ.name}</div>
              <div style={{ fontFamily: MONO, fontSize: 10, color: "#7a6f6a", marginTop: 6 }}>{occ.lookCount} looks · ★{occ.avgRating?.toFixed(1)}</div>
            </div>
          ))}
        </div>
      </Section>

      {/* Mood Coverage */}
      <Section title="Mood Coverage" desc="Starting moods nAia handles well" status={advanced?.emotionalJourney?.moodDistribution?.length > 0 ? "live" : "insufficient-data"}>
        {advanced?.emotionalJourney?.moodDistribution?.length > 0 ? (
          <div style={s.grid3}>
            {advanced.emotionalJourney.moodDistribution.slice(0, 9).map((m, i) => (
              <div key={i} style={s.card}><div style={s.cardLabel}>{m.mood}</div><div style={s.cardValue}>{m.count} sessions</div></div>
            ))}
          </div>
        ) : <EmptyState />}
      </Section>

      {/* Colour Coverage */}
      <Section title="Colour Coverage" desc="Profile preferred colors vs. what is currently addressed" status={data.onboarding?.colorDistribution?.length > 0 ? "live" : "insufficient-data"}>
        <div style={s.grid3}>
          {data.onboarding?.colorDistribution?.slice(0, 9).map((item, i) => (
            <div key={i} style={s.card}><div style={s.cardLabel}>{normalizeLabel(item.color) ?? item.color}</div><div style={s.cardValue}>{item.count} customers prefer this</div></div>
          ))}
        </div>
      </Section>

      {/* Fit Coverage */}
      <Section title="Fit and Size Coverage" desc="Fit preferences addressed by the collection" status={data.bodyPatterns?.length > 0 ? "live" : "insufficient-data"}>
        <div style={s.grid3}>
          {data.bodyPatterns?.map((p, i) => (
            <div key={i} style={s.card}><div style={s.cardLabel}>{p.preference}</div><div style={s.cardValue}>{p.userCount} {p.userCount === 1 ? "user" : "users"}</div><div style={{ fontSize: 12, color: "#7a6f6a", marginTop: 6, fontStyle: "italic" }}>{p.implication}</div></div>
          ))}
        </div>
        <AwaitingCard label="Size Coverage" description="Size coverage analysis requires size data to be collected in StyleMe sessions and linked to product variant availability." />
      </Section>

      {/* Unmet Needs */}
      <Section title="Unmet Customer Needs" desc="Occasions and needs requested most with insufficient product coverage" status="live">
        {data.stylingNeeds?.length > 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {data.stylingNeeds.slice(0, 8).map((need, i) => (
              <div key={i} style={{ padding: 16, background: "#fff", border: "1px solid rgba(34,21,22,0.08)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 15, color: "#221516" }}>{need.occasion || need.need}</span>
                <span style={{ fontFamily: MONO, fontSize: 11, color: "#7a6f6a" }}>{need.count} requests</span>
              </div>
            ))}
          </div>
        ) : <EmptyState />}
      </Section>

      {/* Collection Coverage × Customer Intelligence */}
      {rel?.dnaMatrix?.length > 0 && (
        <Section
          title="Collection Coverage × Customer Intelligence"
          desc="Which personality types are well-served by the current collection — and which have coverage gaps"
          status={rel.status}
        >
          {rel.status === "insufficient-data" ? (
            <InsufficientCard label="Coverage × personality analysis" description="Not enough reviewed sessions to assess per-personality collection coverage." sampleSize={rel.sampleSize} />
          ) : (
            <>
              <SampleSizeWarning n={rel.sampleSize} min={10} />
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 16, marginBottom: 24 }}>
                {rel.dnaMatrix.map((row, i) => {
                  const served = row.avgRating != null && row.avgRating >= 4 && row.rewearRate != null && row.rewearRate >= 0.6;
                  const partial = !served && (row.avgRating != null || row.rewearRate != null);
                  const borderColor = served ? "#2a5e42" : partial ? "#d97706" : "#9CA3AF";
                  const label = served ? "Well Served" : partial ? "Partially Served" : "Insufficient Data";
                  const labelColor = served ? "#2a5e42" : partial ? "#d97706" : "#7a6f6a";
                  return (
                    <div key={i} style={{ ...s.card, borderLeft: `3px solid ${borderColor}` }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
                        <div style={{ fontFamily: "'Playfair Display', serif", fontSize: 15, fontWeight: 700, color: "#221516" }}>{row.personality}</div>
                        <span style={{ fontSize: 9, fontFamily: MONO, textTransform: "uppercase", letterSpacing: "1.5px", color: labelColor }}>{label}</span>
                      </div>
                      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 11, fontFamily: MONO, color: "#7a6f6a", marginBottom: 8 }}>
                        {row.avgRating != null && <span>★ {row.avgRating}</span>}
                        {row.rewearRate != null && <span>{Math.round(row.rewearRate * 100)}% rewear</span>}
                        {row.feelingAchievedRate != null && <span>{row.feelingAchievedRate}% feeling achieved</span>}
                        <span>n={row.sessionCount}</span>
                      </div>
                      {row.topOccasions?.length > 0 && (
                        <div style={{ fontSize: 12, color: "#7a6f6a" }}>Best occasions: {row.topOccasions.join(", ")}</div>
                      )}
                      {row.topProducts?.length > 0 && (
                        <div style={{ fontSize: 12, color: "#8b2035", marginTop: 4 }}>Top pieces: {row.topProducts.join(", ")}</div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Occasion × Personality cross-coverage */}
              {rel.occasionProductMatrix?.length > 0 && (
                <div style={{ marginTop: 8 }}>
                  <div style={s.subHeader}>Occasion × Personality Coverage</div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 12 }}>
                    {rel.occasionProductMatrix.slice(0, 6).map((row, i) => (
                      <div key={i} style={{ ...s.card, padding: "14px 16px" }}>
                        <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 15, fontWeight: 600, color: "#221516", marginBottom: 6 }}>{row.occasion}</div>
                        <div style={{ fontSize: 11, fontFamily: MONO, color: "#7a6f6a", marginBottom: 4 }}>
                          {row.count} session{row.count !== 1 ? "s" : ""}
                          {row.successRate != null && ` · ${row.successRate}% success`}
                        </div>
                        {row.topPersonalities?.length > 0 && (
                          <div style={{ fontSize: 11, color: "#8b2035" }}>{row.topPersonalities.join(", ")}</div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Prescriptive recommendation */}
              {(() => {
                const underserved = rel.dnaMatrix.filter(r =>
                  r.sessionCount >= 2 && (r.avgRating == null || r.avgRating < 3.5 || r.rewearRate == null || r.rewearRate < 0.5)
                );
                const wellServed = rel.dnaMatrix.filter(r =>
                  r.avgRating != null && r.avgRating >= 4 && r.rewearRate != null && r.rewearRate >= 0.6
                );
                if (underserved.length === 0 && wellServed.length === 0) return null;
                const rec = underserved.length > 0
                  ? `${underserved[0].personality} customers are showing below-threshold satisfaction${underserved[0].topOccasions[0] ? ` for ${underserved[0].topOccasions[0]}` : ""}. Review whether the collection has depth in pieces that address their desired feelings (${underserved[0].topDesiredFeelings.slice(0, 2).join(", ") || "see profiles"}).`
                  : `Current collection is performing well across all personality types with sufficient data. Focus on expanding session volume to surface signals for personality types with fewer than 3 sessions.`;
                const reason = underserved.length > 0
                  ? `Low rewear rate or rating from a consistent personality segment is the earliest signal of a collection gap — before any conversion data is available.`
                  : `Consistent performance across personality types suggests strong product-market fit within the current customer base.`;
                return (
                  <PrescriptiveBlock
                    recommendation={rec}
                    reason={reason}
                    confidence={underserved.length > 0 ? "medium" : "high"}
                    sampleSize={rel.sampleSize}
                  />
                );
              })()}
            </>
          )}
        </Section>
      )}
    </>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// TAB 6 — COMMERCIAL INTELLIGENCE
// ══════════════════════════════════════════════════════════════════════════════

function TabCommercial({ data, advanced, rel, sampleMode, dateRangeDays }) {
  return (
    <>
      {/* Revenue + LTV roadmap — both require Shopify order data */}

      <Section title="Styling-to-Shopping Conversion" desc="Does styling lead to clicks, try-ons, and saves?" status={data.conversionStats?.length > 0 ? "live" : "insufficient-data"}>
        {data.conversionStats?.length > 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {data.conversionStats.map((product, i) => (
              <div key={i} style={{ padding: 16, background: "#fff", border: "1px solid rgba(34,21,22,0.08)" }}>
                <div style={{ fontSize: 16, fontWeight: 500, marginBottom: 12 }}>{product.productTitle}</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 12, fontSize: 13 }}>
                  <div><div style={{ color: "#999" }}>Recommended</div><div style={{ fontSize: 18, fontWeight: 500 }}>{product.recommended}</div></div>
                  <div><div style={{ color: "#999" }}>Clicked</div><div style={{ fontSize: 18, fontWeight: 500 }}>{product.clicked}</div><div style={{ fontSize: 11, color: "#666" }}>{product.clickRate}% click rate</div></div>
                  <div><div style={{ color: "#999" }}>Try-on used</div><div style={{ fontSize: 18, fontWeight: 500 }}>{product.tryon}</div>{product.clicked > 0 && <div style={{ fontSize: 11, color: "#666" }}>{product.tryonRate}% of clicks</div>}</div>
                  <div><div style={{ color: "#999" }}>Wishlisted</div><div style={{ fontSize: 18, fontWeight: 500 }}>{product.wishlisted}</div></div>
                </div>
              </div>
            ))}
          </div>
        ) : <EmptyState message="No conversion events yet. Events appear when customers click products from styling results." />}
      </Section>

      {/* Commercial Opportunity Scores */}
      <Section title="Commercial Opportunity Score" desc="Transparent per-product score from available signals (0–100 partial)" status={advanced?.opportunityScores?.length > 0 ? "experimental" : "insufficient-data"}>
        {advanced?.opportunityScores?.length > 0 ? (
          <>
            <div style={{ padding: "8px 14px", background: "rgba(34,21,22,0.04)", border: "1px solid rgba(34,21,22,0.12)", fontSize: 11, fontFamily: INTER, color: "#5c5350", marginBottom: 16, lineHeight: 1.6 }}>
              Score is partial — only available factors are included. Conversion and save-intent require commercial integration. Never act on score alone.
            </div>
            <div style={{ overflowX: "auto" }}>
              <table style={s.table}>
                <thead>
                  <tr>
                    <th style={s.th}>Product</th>
                    <th style={s.th}>Score</th>
                    <th style={s.th}>Emotional Impact</th>
                    <th style={s.th}>Versatility</th>
                    <th style={s.th}>Repeat Wear</th>
                    <th style={s.th}>DNA Coverage</th>
                    <th style={s.th}>Rec. Fit</th>
                    <th style={s.th}>Sample</th>
                  </tr>
                </thead>
                <tbody>
                  {advanced.opportunityScores.map((p, i) => (
                    <tr key={i} style={{ background: i % 2 === 0 ? "rgba(255,255,255,0.6)" : "transparent" }}>
                      <td style={s.td}>{p.productTitle}</td>
                      <td style={{ ...s.td, fontWeight: 700, color: "#8b2035" }}>{p.score ?? "—"}</td>
                      <td style={s.td}>{p.breakdown.emotionalImpact ?? "—"}</td>
                      <td style={s.td}>{p.breakdown.versatility ?? "—"}</td>
                      <td style={s.td}>{p.breakdown.repeatWear ?? "—"}</td>
                      <td style={s.td}>{p.breakdown.personalityCoverage ?? "—"}</td>
                      <td style={s.td}>{p.breakdown.recommendationFit ?? "—"}</td>
                      <td style={s.td}>{p.sampleSize}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <InsufficientCard label="Commercial Opportunity Score" description="Not enough product data to compute scores. Need 3+ reviews per product." />
        )}
      </Section>

      {/* LTV Intelligence — moved from Customer Intelligence */}
      <Section
        title="LTV Intelligence"
        desc={`Customer lifetime value patterns — ${data.ltv?.scopeLabel ?? "All Time"}`}
        status={data.ltv?.status === "sample" || data.ltv?.status === "live" ? (sampleMode ? "sample" : data.ltv?.status) : "awaiting-integration"}
      >
        {data.ltv?.sampleSize > 0 ? (
          <>
            <div style={s.kpiGrid}>
              <KpiCard label="Avg LTV" value={data.ltv.avgLtv != null ? `£${data.ltv.avgLtv.toLocaleString()}` : "—"} />
              <KpiCard label="Top Customer LTV" value={data.ltv.topCustomerLtv != null ? `£${data.ltv.topCustomerLtv.toLocaleString()}` : "—"} />
              <KpiCard label="Repeat Purchase Rate" value={data.ltv.repeatPurchaseRate != null ? `${data.ltv.repeatPurchaseRate}%` : "—"} />
              <KpiCard label="Repeat Customers" value={data.ltv.repeatCustomerCount ?? "—"} suffix={data.ltv.totalCustomersWithPurchase != null ? ` / ${data.ltv.totalCustomersWithPurchase}` : ""} />
              <KpiCard label="Avg Days Between Purchases" value={data.ltv.avgDaysBetweenPurchases != null ? `${data.ltv.avgDaysBetweenPurchases}d` : "—"} />
              <KpiCard label="Purchases per Customer" value={data.ltv.purchaseFrequency ?? "—"} />
            </div>

            {data.ltv.ltvByPersonality?.length > 0 && (
              <div style={{ marginTop: 20 }}>
                <div style={s.subHeader}>LTV by Personality Type</div>
                <div style={{ overflowX: "auto", marginTop: 12 }}>
                  <table style={s.table}>
                    <thead>
                      <tr>
                        <th style={s.th}>Personality</th>
                        <th style={s.th}>Avg LTV</th>
                        <th style={s.th}>Total Revenue</th>
                        <th style={s.th}>Customers</th>
                        <th style={s.th}>Purchases</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.ltv.ltvByPersonality.map((row, i) => (
                        <tr key={i} style={{ background: i % 2 === 0 ? "rgba(255,255,255,0.6)" : "transparent" }}>
                          <td style={{ ...s.td, fontFamily: SERIF, fontWeight: 600, fontSize: 14 }}>{row.personality}</td>
                          <td style={{ ...s.td, fontWeight: 700, color: "#8b2035", fontFamily: MONO }}>£{row.avgLtv.toLocaleString()}</td>
                          <td style={{ ...s.td, fontFamily: MONO }}>£{row.totalRevenue.toLocaleString()}</td>
                          <td style={{ ...s.td, fontFamily: MONO }}>{row.customerCount}</td>
                          <td style={{ ...s.td, fontFamily: MONO }}>{row.purchases}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {data.ltv.repeatProducts?.length > 0 && (
              <div style={{ marginTop: 20 }}>
                <div style={s.subHeader}>Products Driving Repeat Customers</div>
                <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 12 }}>
                  {data.ltv.repeatProducts.map((p, i) => (
                    <div key={i} style={{ ...s.card, flex: "1 1 200px" }}>
                      <div style={{ fontFamily: SERIF, fontWeight: 600, fontSize: 14, color: "#221516" }}>{p.product}</div>
                      <div style={{ fontFamily: MONO, fontSize: 11, color: "#8b2035", marginTop: 6 }}>{p.repeatCustomers} repeat customer{p.repeatCustomers !== 1 ? "s" : ""}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        ) : (
          <AwaitingCard
            label="LTV Intelligence"
            description="LTV data is derived from purchase events. Add Shopify order integration to unlock full LTV segmentation by personality, occasion, and desired feeling."
          />
        )}
      </Section>

      <RoadmapPanel title="Commercial Integration Roadmap" items={[
        { label: "nAia-Assisted Revenue", description: "Total order value attributed to nAia styling sessions. Requires Shopify order_placed webhook + session attribution window." },
        { label: "% Sales Influenced by nAia", description: "% of sales that touched at least one nAia feature before purchase." },
        { label: "Highest-Converting Feature", description: "Which nAia feature (StyleMe, VTO, Buy or Skip) produces the highest purchase intent." },
        { label: "Revenue per Styling Session", description: "Average order value per session that leads to purchase. Requires order attribution." },
        { label: "Revenue per VTO Session", description: "Revenue attributed specifically to Virtual Try-On sessions." },
        { label: "AOV — nAia vs Non-nAia", description: "Average order value comparison between customers using nAia vs those who don't." },
        { label: "LTV by Style Personality", description: "Customer lifetime value segmented by style DNA personality type." },
        { label: "LTV by Desired Feeling", description: "LTV segmented by the feeling customers most want to achieve when dressed." },
        { label: "LTV by Occasion / Lifestyle", description: "LTV segmented by primary lifestyle occasion." },
        { label: "LTV by First nAia Feature", description: "LTV segmented by which nAia feature the customer first engaged with." },
        { label: "Products Driving Repeat Purchase", description: "Which products are associated with highest repeat purchase rates." },
        { label: "Purchase Frequency by Segment", description: "How often each personality segment purchases after an nAia styling session." },
      ]} />

      {/* Product Investment Priority */}
      {rel?.productNarratives?.length > 0 && (
        <Section
          title="Product Investment Priority"
          desc="Which products deserve more depth — ranked by Opportunity Score from real customer relationships"
          status={rel.status}
        >
          {rel.status === "insufficient-data" ? (
            <InsufficientCard label="Investment priority ranking" description="Not enough reviewed sessions to rank products by opportunity." sampleSize={rel.sampleSize} />
          ) : (
            <>
              <div style={{ padding: "8px 14px", background: "rgba(34,21,22,0.04)", border: "1px solid rgba(34,21,22,0.12)", fontFamily: INTER, fontSize: 11, color: "#5c5350", marginBottom: 20, lineHeight: 1.6 }}>
                Opportunity Score combines rating (30%), rewear rate (25%), confidence lift (25%), and data quality (20%). Score is partial until conversion data is available.
              </div>
              <div style={{ overflowX: "auto" }}>
                <table style={s.table}>
                  <thead>
                    <tr>
                      <th style={s.th}>Product</th>
                      <th style={s.th}>Score</th>
                      <th style={s.th}>Rating</th>
                      <th style={s.th}>Rewear</th>
                      <th style={s.th}>Best Audience</th>
                      <th style={s.th}>Best Occasion</th>
                      <th style={s.th}>Top Objection</th>
                      <th style={s.th}>n</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rel.productNarratives.slice(0, 12).map((p, i) => {
                      const scoreColor = p.opportunityScore >= 70 ? "#2a5e42" : p.opportunityScore >= 45 ? "#d97706" : "#7a6f6a";
                      return (
                        <tr key={i} style={{ background: i % 2 === 0 ? "rgba(255,255,255,0.6)" : "transparent" }}>
                          <td style={{ ...s.td, fontFamily: "'Cormorant Garamond', serif", fontWeight: 600, fontSize: 14 }}>{p.name}</td>
                          <td style={{ ...s.td, fontWeight: 700, color: scoreColor, fontFamily: MONO }}>{p.opportunityScore}</td>
                          <td style={s.td}>{p.avgRating?.toFixed(1) ?? "—"}</td>
                          <td style={s.td}>{p.rewearRate != null ? `${Math.round(p.rewearRate * 100)}%` : "—"}</td>
                          <td style={{ ...s.td, fontSize: 12, color: "#8b2035" }}>{p.bestPersonality ?? "—"}</td>
                          <td style={{ ...s.td, fontSize: 12 }}>{p.bestOccasion ?? "—"}</td>
                          <td style={{ ...s.td, fontSize: 12, color: "#c53030" }}>{p.mostCommonObjection ?? "—"}</td>
                          <td style={{ ...s.td, fontFamily: MONO, fontSize: 11, color: "#9CA3AF" }}>{p.sampleSize}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Prescriptive investment recommendation */}
              {(() => {
                const top = rel.productNarratives.filter(p => p.opportunityScore >= 60).slice(0, 2);
                const underutilised = rel.productNarratives.filter(p => p.opportunityScore < 40 && p.sampleSize >= 3).slice(0, 1);
                if (top.length === 0) return null;
                const rec = `${top[0].name} leads with an Opportunity Score of ${top[0].opportunityScore}${top[0].bestPersonality ? ` — strongest with ${top[0].bestPersonality} customers` : ""}${top[0].bestOccasion ? ` for ${top[0].bestOccasion}` : ""}. This is your highest-confidence investment direction from available data.${underutilised.length > 0 ? ` ${underutilised[0].name} (score ${underutilised[0].opportunityScore}) shows friction${underutilised[0].mostCommonObjection ? ` — top objection: ${underutilised[0].mostCommonObjection}` : ""} — investigate before increasing inventory.` : ""}`;
                return (
                  <PrescriptiveBlock
                    recommendation={rec}
                    reason="Opportunity Score is a leading indicator of product-market fit built from the 4 factors available before purchase data: emotional resonance, physical rewear, confidence delivery, and data maturity. Act on high-scoring products while commercial integration is pending."
                    confidence={top[0].sampleSize >= 5 ? "high" : "medium"}
                    sampleSize={rel.sampleSize}
                  />
                );
              })()}
            </>
          )}
        </Section>
      )}
    </>
  );
}



// ══════════════════════════════════════════════════════════════════════════════
// TAB 7 — DESIGN OPPORTUNITIES
// ══════════════════════════════════════════════════════════════════════════════

const TAXONOMY_COLORS = { Expand: "#2a5e42", Resolve: "#8b2035", Target: "#d97706", Adapt: "#6b4800", Unlock: "#9CA3AF" };

function oppTaxonomy(type) {
  if (!type) return "Unlock";
  const t = type.toLowerCase();
  if (t.includes("expand") || t.includes("momentum")) return "Expand";
  if (t.includes("resolve") || t.includes("gap") || t.includes("objection") || t.includes("friction")) return "Resolve";
  if (t.includes("target") || t.includes("segment") || t.includes("audience")) return "Target";
  if (t.includes("adapt") || t.includes("design") || t.includes("modify")) return "Adapt";
  return "Unlock";
}

function ActionCard({ item }) {
  const taxColor = TAXONOMY_COLORS[item.taxonomy] ?? "#9CA3AF";
  const confBg = item.confidence === "high" ? "#221516" : item.confidence === "medium" ? "#8B7355" : "#9CA3AF";
  return (
    <div style={{ ...s.card, marginBottom: 14, borderLeft: `4px solid ${taxColor}` }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: 8, fontFamily: INTER, fontWeight: 700, textTransform: "uppercase", letterSpacing: "1.5px", padding: "3px 10px", background: taxColor, color: "#fff" }}>{item.taxonomy}</span>
          <span style={{ fontSize: 8, fontFamily: INTER, fontWeight: 600, textTransform: "uppercase", letterSpacing: "1.5px", padding: "3px 8px", background: confBg, color: "#fff" }}>confidence: {item.confidence}</span>
          {item.relevance && <span style={{ fontSize: 8, fontFamily: INTER, fontWeight: 600, textTransform: "uppercase", letterSpacing: "1.5px", padding: "3px 8px", background: "rgba(34,21,22,0.06)", color: "#5c5350" }}>{item.relevance} relevance</span>}
          <span style={{ fontSize: 8, fontFamily: MONO, color: "#9CA3AF", letterSpacing: "1px" }}>{item.source}</span>
        </div>
        <span style={{ fontSize: 9, fontFamily: MONO, color: "#9CA3AF", whiteSpace: "nowrap" }}>Status: New</span>
      </div>
      <div style={{ fontFamily: SERIF, fontSize: 16, fontWeight: 600, color: "#221516", marginBottom: 6 }}>{item.headline}</div>
      {item.detail && item.detail !== item.headline && <div style={{ fontSize: 13, color: "#7a6f6a", marginBottom: 6, lineHeight: 1.5 }}>{item.detail}</div>}
      {item.evidence && <div style={{ fontSize: 11, fontFamily: MONO, color: "#9CA3AF", marginBottom: 8 }}>Evidence: {item.evidence}{item.period ? ` · ${item.period}` : ""}</div>}
      {item.action && (
        <div style={{ padding: "10px 12px", background: "rgba(34,21,22,0.03)", fontSize: 13, fontFamily: SERIF, color: "#221516", borderTop: "1px solid rgba(34,21,22,0.06)", marginTop: 8 }}>
          <strong>Action:</strong> {item.action}
        </div>
      )}
      {item.expectedOutcome && (
        <div style={{ fontSize: 12, color: "#7a6f6a", marginTop: 6, fontStyle: "italic", fontFamily: SERIF }}>Expected outcome: {item.expectedOutcome}</div>
      )}
    </div>
  );
}

function TabOpportunities({ data, phase4b2, advanced, rel, dateRangeDays }) {
  const sortOrder = { high: 0, medium: 1, low: 2 };
  const actionItems = [];

  (advanced?.opportunityFeed ?? []).forEach((opp, i) => {
    actionItems.push({
      id: `opp-${i}`,
      taxonomy: oppTaxonomy(opp.type),
      headline: opp.insight,
      detail: opp.customerNeed,
      action: opp.suggestedAction,
      evidence: opp.evidence,
      period: opp.timePeriod,
      confidence: opp.confidence ?? "medium",
      relevance: opp.estimatedCommercialRelevance,
      source: "opportunity-feed",
    });
  });

  (data?.designActions ?? []).forEach((action, i) => {
    actionItems.push({
      id: `da-${i}`,
      taxonomy: "Adapt",
      headline: action.productTitle ?? action.product ?? "Design Action",
      detail: action.recommendation,
      action: action.recommendation,
      evidence: action.evidence,
      period: null,
      confidence: action.confidence ?? "medium",
      relevance: action.impact ?? "medium",
      source: "design-actions",
    });
  });

  (rel?.productNarratives ?? []).filter(p => p.sampleSize >= 3).forEach((p, i) => {
    const taxonomy = p.opportunityScore >= 60 ? "Expand" : p.mostCommonObjection ? "Resolve" : "Target";
    const conf = sampleConfidence(p.sampleSize);
    actionItems.push({
      id: `ri-${i}`,
      taxonomy,
      headline: p.name,
      detail: [p.bestPersonality && `Best: ${p.bestPersonality}`, p.bestOccasion && `for ${p.bestOccasion}`, p.mostCommonObjection && `Objection: ${p.mostCommonObjection}`].filter(Boolean).join(" · "),
      action: p.recommendation,
      evidence: [`n=${p.sampleSize}`, p.avgRating != null && `★${p.avgRating.toFixed(1)}`, p.rewearRate != null && `${Math.round(p.rewearRate * 100)}% rewear`].filter(Boolean).join(" · "),
      period: null,
      confidence: p.sampleSize >= 5 ? "high" : "medium",
      relevance: p.opportunityScore >= 60 ? "high" : p.opportunityScore >= 40 ? "medium" : "low",
      expectedOutcome: p.recommendationReason,
      source: "product-intelligence",
    });
  });

  actionItems.sort((a, b) => (sortOrder[a.relevance] ?? 2) - (sortOrder[b.relevance] ?? 2) || (sortOrder[a.confidence] ?? 2) - (sortOrder[b.confidence] ?? 2));

  return (
    <>
      {/* Unified Design Action Plan */}
      <Section
        title="Design Action Plan"
        desc="Consolidated action plan from all intelligence sources — ranked by relevance and confidence. Action taxonomy: Expand (do more of what works) · Resolve (fix a friction) · Target (audience/occasion gap) · Adapt (modify a piece) · Unlock (new capability needed)."
        status={actionItems.length > 0 ? "live" : "insufficient-data"}
      >
        <div style={{ padding: "10px 14px", background: "#faf9f7", borderLeft: "3px solid #8B7355", marginBottom: 20, fontSize: 12, color: "#8B7355", lineHeight: 1.6 }}>
          All actions are derived from real customer data. Status tracking (Reviewing / Testing / Actioned / Dismissed) requires a DesignerOpportunity DB table — currently all items show as <strong>New</strong>. High-confidence items (n≥5) warrant direct action; medium-confidence items should inform styling content and testing, not final production decisions.
        </div>

        {/* Taxonomy legend */}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 20 }}>
          {Object.entries(TAXONOMY_COLORS).map(([label, color]) => (
            <span key={label} style={{ fontSize: 8, fontFamily: INTER, fontWeight: 700, textTransform: "uppercase", letterSpacing: "1.5px", padding: "4px 10px", background: color, color: "#fff" }}>{label}</span>
          ))}
        </div>

        {actionItems.length > 0 ? (
          actionItems.map(item => <ActionCard key={item.id} item={item} />)
        ) : (
          <EmptyState message="No actionable opportunities yet. Actions appear when patterns cross minimum data thresholds." />
        )}
      </Section>

      {/* Experiment Builder */}
      <Section title="Experiment Builder" desc="Define a structured design experiment — hypothesis, variants, and the metric that will resolve it" status="awaiting-integration">
        <div style={{ padding: "10px 14px", background: "rgba(34,21,22,0.03)", border: "1px solid rgba(34,21,22,0.10)", fontSize: 12, color: "#5c5350", marginBottom: 20, lineHeight: 1.6 }}>
          Experiment Builder is a future feature. The form below shows what a structured design experiment looks like — it will be wired to nAia's data pipeline when the DesignerExperiment table is ready.
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: 20 }}>
          <div style={s.card}>
            <div style={s.cardLabel}>Hypothesis</div>
            <div style={{ fontSize: 13, color: "#7a6f6a", marginTop: 6, fontStyle: "italic" }}>
              "If I [design change], then [customer segment] will [expected behaviour change], because [reasoning from data]."
            </div>
            <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 8 }}>
              {["Design Change", "Target Segment", "Desired Outcome", "Reasoning from Data"].map(field => (
                <div key={field} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 10px", background: "#f4f4f1", fontSize: 12, color: "#9CA3AF" }}>
                  <span style={{ fontFamily: INTER, fontSize: 9, textTransform: "uppercase", letterSpacing: "1.5px", color: "#7a6f6a" }}>{field}</span>
                  <span style={{ fontFamily: MONO, fontSize: 10 }}>[ awaiting integration ]</span>
                </div>
              ))}
            </div>
          </div>
          <div style={s.card}>
            <div style={s.cardLabel}>Variants &amp; Success Metric</div>
            <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 8 }}>
              {["Variant A (Control)", "Variant B (Change)", "Primary Metric", "Secondary Metric", "Minimum Sample Size", "Decision Deadline"].map(field => (
                <div key={field} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 10px", background: "#f4f4f1", fontSize: 12, color: "#9CA3AF" }}>
                  <span style={{ fontFamily: INTER, fontSize: 9, textTransform: "uppercase", letterSpacing: "1.5px", color: "#7a6f6a" }}>{field}</span>
                  <span style={{ fontFamily: MONO, fontSize: 10 }}>[ awaiting integration ]</span>
                </div>
              ))}
            </div>
          </div>
        </div>
        <AwaitingCard label="Experiment persistence" description="Saving, tracking, and closing experiments requires a DesignerExperiment table with experiment_id, hypothesis, variants, metric, start_date, end_date, and outcome." />
      </Section>
    </>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
// Aligned with naia-design-system.css tokens (Inter UI, Courier New mono, sharp corners)

const INTER = "'Inter', -apple-system, BlinkMacSystemFont, sans-serif";
const SERIF = "'Cormorant Garamond', Garamond, serif";
const DISPLAY = "'Playfair Display', Georgia, serif";
const MONO = "'Courier New', Courier, monospace";
const BORDER = "1px solid rgba(34,21,22,0.09)";
const BORDER_LIGHT = "1px solid rgba(34,21,22,0.06)";

const s = {
  wrap:     { background: "#f4f4f1", minHeight: "100vh", paddingBottom: 80 },
  inner:    { maxWidth: 1500, margin: "0 auto", padding: "0 40px" },
  header:   { paddingTop: 40, paddingBottom: 28, borderBottom: BORDER, marginBottom: 0 },

  h1: { fontFamily: DISPLAY, fontSize: "clamp(30px, 4vw, 48px)", fontWeight: 900, fontStyle: "italic", lineHeight: 1.05, margin: "0 0 8px", color: "#221516" },
  subtitle: { fontFamily: SERIF, fontSize: 16, fontStyle: "italic", color: "#7a6f6a", margin: 0 },

  tabBar: { display: "flex", gap: 0, overflowX: "auto", borderBottom: BORDER, marginBottom: 32, paddingTop: 12 },
  tabBtn: { background: "none", border: "none", cursor: "pointer", padding: "10px 16px", fontFamily: INTER, fontSize: 9, textTransform: "uppercase", letterSpacing: "2px", whiteSpace: "nowrap", transition: "color 0.15s", fontWeight: 500 },

  section: { marginBottom: 2, background: "rgba(255,255,255,0.48)", padding: "30px 34px", borderBottom: BORDER_LIGHT },
  h2: { fontFamily: DISPLAY, fontSize: 21, fontWeight: 600, fontStyle: "italic", margin: "0 0 6px", color: "#221516" },
  sectionDesc: { fontFamily: SERIF, fontSize: 15, color: "#7a6f6a", margin: "0 0 22px", fontStyle: "italic" },
  subHeader: { fontFamily: INTER, fontSize: 8, textTransform: "uppercase", letterSpacing: "3px", color: "#7a6f6a", fontWeight: 600, marginBottom: 14, marginTop: 8 },

  kpiGrid:  { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 1, background: "rgba(34,21,22,0.07)" },
  kpiCard:  { padding: "18px 20px", background: "#fff", position: "relative" },
  kpiValue: { fontFamily: DISPLAY, fontSize: 28, fontWeight: 700, color: "#8b2035", marginBottom: 6, marginTop: 4 },
  kpiLabel: { fontFamily: INTER, fontSize: 8, color: "#7a6f6a", textTransform: "uppercase", letterSpacing: "2px", lineHeight: 1.5, fontWeight: 500 },

  card:       { padding: "18px 22px", background: "#fafaf8", border: BORDER_LIGHT },
  cardLabel:  { fontFamily: SERIF, fontSize: 16, fontWeight: 600, color: "#221516", marginBottom: 5 },
  cardValue:  { fontFamily: MONO, fontSize: 11, letterSpacing: "0.5px", color: "#7a6f6a" },

  grid3:     { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 12 },
  pieceGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12 },
  pieceCard: { padding: 20, background: "#fafaf8", border: BORDER_LIGHT },

  pieceName:     { fontFamily: DISPLAY, fontSize: 17, fontWeight: 600, fontStyle: "italic", marginBottom: 4, color: "#221516" },
  pieceCategory: { fontFamily: INTER, fontSize: 8, color: "#7a6f6a", textTransform: "uppercase", letterSpacing: "2px", marginBottom: 12, fontWeight: 500 },
  pieceStats:    { fontFamily: SERIF, fontSize: 14, color: "#221516", lineHeight: 1.7 },

  muted:     { color: "#7a6f6a", fontSize: 13, fontFamily: SERIF },
  helpedFeel: { fontStyle: "italic", color: "#8b2035", fontFamily: SERIF },
  dnaStyle:   { fontSize: 14, color: "#8b2035", fontFamily: SERIF, fontStyle: "italic" },

  table: { width: "100%", borderCollapse: "collapse", fontSize: 13, fontFamily: SERIF, minWidth: 400 },
  th:    { textAlign: "left", padding: "8px 12px", fontFamily: INTER, fontSize: 8, textTransform: "uppercase", letterSpacing: "2px", color: "#7a6f6a", fontWeight: 600, borderBottom: BORDER, background: "rgba(34,21,22,0.02)" },
  td:    { padding: "9px 12px", borderBottom: "1px solid rgba(34,21,22,0.05)", color: "#221516", fontSize: 13 },

  linkBtn:   { background: "none", border: "none", cursor: "pointer", padding: "4px 0", fontSize: 9, color: "#8b2035", fontFamily: INTER, letterSpacing: "1.5px", textTransform: "uppercase", fontWeight: 600, marginTop: 10, display: "block" },
  periodBtn: { padding: "5px 10px", border: "1px solid rgba(34,21,22,0.16)", cursor: "pointer", fontFamily: INTER, fontSize: 8, textTransform: "uppercase", letterSpacing: "1.5px", fontWeight: 600 },
};
