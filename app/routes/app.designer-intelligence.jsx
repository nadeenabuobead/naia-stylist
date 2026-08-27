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
import { getLiveCustomerSignals } from "../lib/ai/live-customer-signals.server";

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
    return Response.json(
      { ...sample, dateRangeDays, sampleMode: true, samplePreviewAvailable: true, liveSignals: null },
      { headers: { "Cache-Control": "no-store, no-cache, must-revalidate" } },
    );
  }

  const [dashboard, kpis, phase4b2, advanced, rel, liveSignals] = await Promise.all([
    getDesignerStats(dateRangeDays),
    getAdditionalKPIs(),
    getPhase4B2KPIs(dateRangeDays),
    getAdvancedKPIs(dateRangeDays),
    getRelationshipKPIs(dateRangeDays),
    getLiveCustomerSignals(dateRangeDays),
  ]);

  if (dashboard.error) throw new Response(dashboard.error, { status: 500 });
  return Response.json(
    { dashboard, kpis, phase4b2, advanced, rel, liveSignals, dateRangeDays, sampleMode: false, samplePreviewAvailable },
    { headers: { "Cache-Control": "no-store, no-cache, must-revalidate" } },
  );
}

// ── Error boundary ─────────────────────────────────────────────────────────────

export function ErrorBoundary() {
  return (
    <div style={s.wrap}>
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
  const isSample = useContext(SampleModeCtx);
  // In sample mode suppress the "LIVE" badge — the top-level banner already communicates sample state.
  if (isSample && status === "live") return null;
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG["not-implemented"];
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

// Map sample size for a specific claim to a canonical evidence maturity tier.
// n = evidence count supporting this specific claim, not total dashboard sessions.
// Labels match canonical-vocabulary.ts — never use the old "No Data" / "Early Signal" strings.
function sampleConfidence(n) {
  if (n === 0)  return { label: "Not measured",        status: "not-implemented",   color: "#9CA3AF" };
  if (n === 1)  return { label: "Single observation",  status: "insufficient-data", color: "#6b4800" };
  if (n <= 4)   return { label: "Directional signal",  status: "insufficient-data", color: "#6b4800" };
  if (n <= 9)   return { label: "Emerging pattern",    status: "experimental",      color: "#5c5350" };
  if (n <= 19)  return { label: "Established pattern", status: "live",              color: "#2a5e42" };
  return          { label: "Strong pattern",           status: "live",              color: "#2a5e42" };
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
        <div>{piece.ratingCount > 0 && piece.avgRating != null ? `★ ${piece.avgRating.toFixed(1)} · ${piece.ratingCount} review${piece.ratingCount !== 1 ? "s" : ""}` : `${piece.ratingCount} reviews — no rating yet`}</div>
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
  const getPriorityColor = (p) => (p === "Strong pattern" || p === "Established pattern" || p === "Strong Pattern" || p === "Established Pattern") ? "#2a5e42" : (p === "Emerging pattern" || p === "Emerging Pattern") ? "#5c5350" : (p === "Directional signal" || p === "Single observation" || p === "Early Signal" || p === "Single Observation") ? "#6b4800" : "#9CA3AF";
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
// 6 tabs: Overview · Customers · Products · Recommendations · Collection & Opportunities · Commercial

const TABS = [
  { id: "overview",                label: "Overview" },
  { id: "customer",                label: "Customers" },
  { id: "product",                 label: "Products" },
  { id: "recommendation",          label: "Features & Recommendations" },
  { id: "collection-opportunities", label: "Collection & Opportunities" },
  { id: "commercial",              label: "Commercial" },
];

// ── Root component ─────────────────────────────────────────────────────────────

export default function DesignerDashboard() {
  const { dashboard: data, kpis, phase4b2, advanced, rel, overview, commercial, liveSignals, dateRangeDays, sampleMode, samplePreviewAvailable } = useLoaderData();
  const [activeTab, setActiveTab] = useState("overview");
  // Role lens: fields preserved in data model for future B2B use; fixed to "combined" in the Founder–Designer dashboard.
  const roleLens = "combined";
  const [dataAiOpen, setDataAiOpen] = useState(false);
  const [dataAiPanel, setDataAiPanel] = useState("definitions"); // "definitions" | "confidence" | "integration" | "roadmap" | "experiments"
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
      <div style={s.inner}>

        {/* ── Sample Preview banner — only visible while sample mode is active ─ */}
        {sampleMode && (
          <div style={{ padding: "8px 20px", background: "#6b4800", color: "#fffbf0", fontFamily: "'Inter', sans-serif", fontSize: 11, letterSpacing: "0.5px", textAlign: "center" }}>
            Sample Preview — all figures, customers, orders and outcomes are illustrative synthetic data demonstrating the complete nAia intelligence experience.
          </div>
        )}

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div style={s.header}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 16 }}>
            <div>
              <div style={{ fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif", fontSize: 8, textTransform: "uppercase", letterSpacing: "3px", color: "#8b2035", marginBottom: 10, fontWeight: 600 }}>NADINE — Founder–Designer Intelligence</div>
              <h1 style={s.h1}>Intelligence Dashboard</h1>
              <p style={s.subtitle}>Customer, product and commercial intelligence for better design and collection decisions.</p>
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
              {/* Data & AI button */}
              <button
                type="button"
                onClick={() => setDataAiOpen(true)}
                style={{ padding: "3px 12px", fontFamily: "'Inter', sans-serif", fontSize: 9, letterSpacing: "1px", textTransform: "uppercase", background: "transparent", color: "#5c5350", border: "1px solid rgba(34,21,22,0.18)", cursor: "pointer" }}
              >
                Data &amp; AI ↗
              </button>
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
        <div style={{ position: "relative", marginBottom: 8 }}>
          <div style={{ ...s.tabBar, marginBottom: 0 }}>
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
          <div style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: 40, background: "linear-gradient(to right, transparent, #f4f4f1)", pointerEvents: "none" }} />
        </div>


        {/* ── Data & AI slide-over — always in DOM; CSS toggle prevents backdrop from intercepting
             clicks while closed, regardless of React hydration timing in Shopify Admin iframe */}
        <div
          aria-hidden={!dataAiOpen}
          style={{
            position: "fixed", inset: 0, zIndex: 200, display: "flex", justifyContent: "flex-end",
            visibility: dataAiOpen ? "visible" : "hidden",
            pointerEvents: dataAiOpen ? "auto" : "none",
          }}
        >
          <div style={{ position: "absolute", inset: 0, background: "rgba(34,21,22,0.45)" }} onClick={() => setDataAiOpen(false)} />
          <div style={{ position: "relative", width: "min(600px, 92vw)", background: "#faf9f7", height: "100dvh", display: "flex", flexDirection: "column", borderLeft: "1px solid rgba(34,21,22,0.12)" }}>
            {dataAiOpen && (
              <>
                {/* Pinned header — title + close button */}
                <div style={{ flexShrink: 0, padding: "32px 32px 0", display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div>
                    <div style={{ fontFamily: "'Inter', sans-serif", fontSize: 8, textTransform: "uppercase", letterSpacing: "3px", color: "#8b2035", marginBottom: 8, fontWeight: 600 }}>Data &amp; AI</div>
                    <h2 style={{ margin: 0, fontFamily: "'Playfair Display', serif", fontSize: 22, fontWeight: 700, color: "#221516" }}>Intelligence Reference</h2>
                  </div>
                  <button type="button" onClick={() => setDataAiOpen(false)} style={{ background: "none", border: "1px solid rgba(34,21,22,0.14)", padding: "4px 10px", cursor: "pointer", fontFamily: "'Inter', sans-serif", fontSize: 10, color: "#5c5350" }}>Close ✕</button>
                </div>
                {/* Pinned panel tabs */}
                <div style={{ flexShrink: 0, padding: "16px 32px 0", display: "flex", gap: 4, flexWrap: "wrap" }}>
                  {[
                    { id: "definitions",  label: "Metric Definitions" },
                    { id: "confidence",   label: "Confidence Ladder" },
                    { id: "integration",  label: "Integration Readiness" },
                    { id: "roadmap",      label: "AI Learning Roadmap" },
                    { id: "experiments",  label: "Experiment Builder" },
                  ].map(p => (
                    <button key={p.id} type="button" onClick={() => setDataAiPanel(p.id)} style={{ padding: "3px 10px", fontFamily: "'Inter', sans-serif", fontSize: 9, letterSpacing: "1px", textTransform: "uppercase", background: dataAiPanel === p.id ? "#221516" : "transparent", color: dataAiPanel === p.id ? "#f4f4f1" : "#7a6f6a", border: "1px solid rgba(34,21,22,0.14)", cursor: "pointer" }}>{p.label}</button>
                  ))}
                </div>
                {/* Scrollable content region */}
                <div style={{ flex: "1 1 auto", minHeight: 0, overflowY: "auto", overscrollBehavior: "contain", WebkitOverflowScrolling: "touch", padding: "24px 32px 80px", boxSizing: "border-box" }}>
                  {dataAiPanel === "definitions" && <DataAiDefinitions />}
                  {dataAiPanel === "confidence" && <DataAiConfidenceLadder />}
                  {dataAiPanel === "integration" && <DataAiIntegrationReadiness />}
                  {dataAiPanel === "roadmap" && <DataAiLearningRoadmap advanced={advanced} sampleMode={sampleMode} />}
                  {dataAiPanel === "experiments" && <DataAiExperimentBuilder advanced={advanced} sampleMode={sampleMode} />}
                </div>
              </>
            )}
          </div>
        </div>

        {/* ── Tab content ──────────────────────────────────────────────────── */}
          {activeTab === "overview"                && <TabOverview        data={data} kpis={kpis} phase4b2={phase4b2} advanced={advanced} rel={rel} overview={overview} sampleMode={sampleMode} dateRangeDays={dateRangeDays} roleLens={roleLens} liveSignals={liveSignals} />}
          {activeTab === "customer"                && <TabCustomer        data={data} kpis={kpis} advanced={advanced} rel={rel} sampleMode={sampleMode} dateRangeDays={dateRangeDays} roleLens={roleLens} liveSignals={liveSignals} />}
          {activeTab === "product"                 && <TabProduct         data={data} phase4b2={phase4b2} advanced={advanced} rel={rel} sampleMode={sampleMode} dateRangeDays={dateRangeDays} roleLens={roleLens} />}
          {activeTab === "recommendation"          && <TabRecommendation  data={data} kpis={kpis} phase4b2={phase4b2} advanced={advanced} rel={rel} sampleMode={sampleMode} dateRangeDays={dateRangeDays} roleLens={roleLens} liveSignals={liveSignals} />}
          {activeTab === "collection-opportunities" && <TabCollectionOpportunities data={data} kpis={kpis} phase4b2={phase4b2} advanced={advanced} rel={rel} sampleMode={sampleMode} dateRangeDays={dateRangeDays} roleLens={roleLens} liveSignals={liveSignals} />}
          {activeTab === "commercial"              && <TabCommercial      data={data} advanced={advanced} rel={rel} commercial={commercial} sampleMode={sampleMode} dateRangeDays={dateRangeDays} roleLens={roleLens} />}

      </div>
    </div>
    </SampleModeCtx.Provider>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// LIVE SIGNAL HELPER COMPONENTS (Batch 2)
// Render live customer data — only shown in Live mode (liveSignals != null)
// ══════════════════════════════════════════════════════════════════════════════

function LiveEvidencePill({ evidenceState }) {
  const colors = {
    measured:                { bg: "rgba(42,94,66,0.10)",   color: "#2a5e42" },
    insufficient_evidence:   { bg: "rgba(107,72,0,0.09)",   color: "#6b4800" },
    observed_zero:           { bg: "rgba(34,21,22,0.06)",   color: "#4a3535" },
    no_eligible_observations:{ bg: "rgba(122,111,106,0.10)",color: "#7a6f6a" },
    awaiting_integration:    { bg: "rgba(122,111,106,0.08)",color: "#9CA3AF" },
    not_applicable:          { bg: "rgba(122,111,106,0.08)",color: "#9CA3AF" },
  };
  const labels = {
    measured: "Measured", insufficient_evidence: "Early data", observed_zero: "Zero",
    no_eligible_observations: "No observations", awaiting_integration: "Awaiting",
    not_applicable: "N/A",
  };
  const cfg = colors[evidenceState] ?? colors.no_eligible_observations;
  return (
    <span style={{ display: "inline-block", padding: "2px 7px", fontSize: 9, fontFamily: "'Inter', sans-serif", fontWeight: 600, textTransform: "uppercase", letterSpacing: "1.5px", background: cfg.bg, color: cfg.color }}>
      {labels[evidenceState] ?? evidenceState}
    </span>
  );
}

function LiveFeatureAdoptionTable({ rows }) {
  if (!rows?.length) return null;
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={s.table}>
        <thead>
          <tr>
            <th style={s.th}>Feature</th>
            <th style={{ ...s.th, textAlign: "right" }}>Customers</th>
            <th style={{ ...s.th, textAlign: "right" }}>Events</th>
            <th style={{ ...s.th, textAlign: "right" }}>Latest activity</th>
            <th style={{ ...s.th, textAlign: "right" }}>Evidence</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} style={{ background: i % 2 === 0 ? "transparent" : "rgba(34,21,22,0.018)" }}>
              <td style={s.td}>{row.feature}</td>
              <td style={{ ...s.td, textAlign: "right", fontFamily: "'JetBrains Mono', 'Courier New', monospace" }}>{row.uniqueCustomers}</td>
              <td style={{ ...s.td, textAlign: "right", fontFamily: "'JetBrains Mono', 'Courier New', monospace" }}>{row.eventCount}</td>
              <td style={{ ...s.td, textAlign: "right", color: "#7a6f6a", fontSize: 10 }}>
                {row.mostRecentActivity ? new Date(row.mostRecentActivity).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "—"}
              </td>
              <td style={{ ...s.td, textAlign: "right" }}><LiveEvidencePill evidenceState={row.evidenceState} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LiveTopValues({ items, label }) {
  if (!items?.length) return <div style={{ color: "#9CA3AF", fontFamily: "'Inter', sans-serif", fontSize: 11 }}>No data yet.</div>;
  const max = items[0]?.count ?? 1;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {items.slice(0, 6).map((item, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ flex: 1, fontFamily: "'Inter', sans-serif", fontSize: 11, color: "#221516" }}>{item.value}</div>
          <div style={{ width: 80, height: 4, background: "rgba(34,21,22,0.07)", flexShrink: 0 }}>
            <div style={{ height: "100%", width: `${Math.round((item.count / max) * 100)}%`, background: "#8b2035" }} />
          </div>
          <div style={{ fontFamily: "'JetBrains Mono','Courier New',monospace", fontSize: 10, color: "#7a6f6a", minWidth: 24, textAlign: "right" }}>{item.count}</div>
        </div>
      ))}
    </div>
  );
}

function LiveJourneyFunnel({ journey }) {
  if (!journey?.stages?.length) return null;
  const stages = journey.stages;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
      {stages.map((stage, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 14, padding: "8px 0", borderBottom: i < stages.length - 1 ? "1px solid rgba(34,21,22,0.06)" : "none" }}>
          <div style={{ width: 26, height: 26, borderRadius: "50%", background: stage.uniqueCustomers > 0 ? "#8b2035" : "rgba(34,21,22,0.08)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <span style={{ fontFamily: "'JetBrains Mono','Courier New',monospace", fontSize: 9, color: stage.uniqueCustomers > 0 ? "#fff" : "#9CA3AF", fontWeight: 700 }}>{i + 1}</span>
          </div>
          <div style={{ flex: 1, fontFamily: "'Inter', sans-serif", fontSize: 11, color: "#221516" }}>{stage.stage}</div>
          <div style={{ fontFamily: "'JetBrains Mono','Courier New',monospace", fontSize: 11, color: stage.uniqueCustomers > 0 ? "#221516" : "#9CA3AF", fontWeight: stage.uniqueCustomers > 0 ? 600 : 400, minWidth: 60, textAlign: "right" }}>
            {stage.uniqueCustomers} {stage.uniqueCustomers === 1 ? "customer" : "customers"}
          </div>
          {stage.progressionFromPrevious != null && (
            <div style={{ fontFamily: "'JetBrains Mono','Courier New',monospace", fontSize: 10, color: "#7a6f6a", minWidth: 44, textAlign: "right" }}>
              {stage.progressionFromPrevious}%
            </div>
          )}
        </div>
      ))}
      <div style={{ marginTop: 8, fontFamily: "'Inter', sans-serif", fontSize: 9, color: "#9CA3AF", letterSpacing: "1px", textTransform: "uppercase" }}>
        % = share of previous stage reaching this stage · not a commercial funnel
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// TAB 1 — OVERVIEW
// ══════════════════════════════════════════════════════════════════════════════

function TabOverview({ data, kpis, phase4b2, advanced, rel, overview, sampleMode, dateRangeDays, liveSignals }) {
  const periodStr = dateRangeDays >= 365 ? "All Time" : `Last ${dateRangeDays} Days`;

  // Top 3 priority actions from opportunityFeed
  const topActions = (advanced?.opportunityFeed ?? []).slice(0, 3);

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
                      {opp.estimatedCommercialRelevance ?? "medium"} priority
                    </span>
                  </div>
                  <span style={{ fontFamily: INTER, fontSize: 8, fontWeight: 600, textTransform: "uppercase", letterSpacing: "1.5px", padding: "2px 8px", background: "rgba(34,21,22,0.06)", color: "#5c5350", flexShrink: 0 }}>
                    evidence: {opp.confidence}
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

      {/* Metric definitions — now in Data & AI panel */}
      <div style={{ padding: "12px 20px", background: "rgba(34,21,22,0.02)", border: "1px solid rgba(34,21,22,0.07)", fontSize: 12, color: "#7a6f6a", fontFamily: SERIF, fontStyle: "italic" }}>
        Metric Definitions, Confidence Ladder, and Platform Health are available in <strong style={{ fontStyle: "normal" }}>Data &amp; AI</strong> — click the button in the header.
      </div>
    </>
  );
}

function MethodologyPanel() {
  const [open, setOpen] = useState(false);
  const DEFS = [
    ["Rating", "Average score (1–5) from outfit reviews and post-wear reviews. Excludes sessions with no review."],
    ["Rewear rate", "% of post-wear reviews where the customer said they would wear the look again."],
    ["Emotional achievement", "Classified from desiredFeeling vs actualAfterFeeling. Achieved = exact match. Partly = same emotional family. Not achieved = different family or no response."],
    ["Recommendation response", "Immediate Love it / Okay / Not for me tap on a recommendation card — separate from post-outfit reviews."],
    ["Explanation agreement", "% of recommendation responses that were 'Love it'. Requires explanation logging."],
    ["Product coverage", "Whether at least one product exists that has been recommended to a personality group in the period."],
    ["Outcome quality", "Whether that group achieved their desired feeling: avgRating ≥ 4 AND rewearRate ≥ 60%."],
    ["Opportunity score", "Directional partial score: rating (30%) + rewear rate (25%) + confidence lift (25%) + data quality (20%). Excludes conversion and LTV until integrated."],
    ["Selected period vs All Time", "Period selector (7d / 30d / 90d / All) filters styling sessions and reviews. Passport profiles, registered users, and completed passports are always All Time."],
    ["Evidence maturity", "n=0: Not measured · n=1: Single observation · n=2–4: Directional signal · n=5–9: Emerging pattern · n=10–19: Established pattern · n≥20: Strong pattern."],
    ["Pending integrations", "Shopify commerce, wishlist/save, FASHN.ai VTO performance, and LTV are not integrated. Sections requiring these show Awaiting Integration."],
  ];
  return (
    <section style={s.section}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <h2 style={s.h2}>Metric Definitions</h2>
        <button type="button" onClick={() => setOpen(o => !o)} style={{ ...s.linkBtn, marginTop: 0 }}>{open ? "Hide ↑" : "Show ↓"}</button>
      </div>
      <p style={s.sectionDesc}>Transparent definitions for every metric in this dashboard.</p>
      {open && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {DEFS.map(([term, def], i) => (
            <div key={i} style={{ display: "grid", gridTemplateColumns: "clamp(140px, 20%, 200px) 1fr", gap: 16, paddingBottom: 8, borderBottom: i < DEFS.length - 1 ? "1px solid rgba(34,21,22,0.05)" : "none" }}>
              <div style={{ fontFamily: INTER, fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "1.5px", color: "#221516" }}>{term}</div>
              <div style={{ fontFamily: SERIF, fontSize: 13, color: "#7a6f6a", lineHeight: 1.6 }}>{def}</div>
            </div>
          ))}
        </div>
      )}
    </section>
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

  // Balance: one from each category first, then fill to 3 default (show up to 6 if expanded)
  const ORDER = ["identity", "context", "garment", "emotional", "friction", "naia"];
  const selected = [];
  const used = new Set();
  for (const cat of ORDER) {
    if (selected.length >= 3) break;
    const idx = candidates.findIndex((c, i) => c.cat === cat && !used.has(i));
    if (idx !== -1) { selected.push(candidates[idx]); used.add(idx); }
  }
  for (let i = 0; i < candidates.length && selected.length < 3; i++) {
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

function ChangeDeltaRow({ label, prior, current, decimals = 0, suffix = "" }) {
  if (prior == null || current == null) {
    return (
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8 }}>
        <span style={{ fontFamily: SERIF, fontSize: 13, color: "#7a6f6a" }}>{label}</span>
        <span style={{ fontFamily: MONO, fontSize: 11, color: "#9CA3AF" }}>Not enough comparable evidence</span>
      </div>
    );
  }
  const prec = Math.pow(10, decimals);
  const delta = Math.round((current - prior) * prec) / prec;
  const pctDelta = decimals === 0 && prior > 0
    ? Math.round(((current - prior) / prior) * 100)
    : null;
  const color = delta > 0 ? "#2a5e42" : delta < 0 ? "#8b2035" : "#7a6f6a";
  const dSign = delta >= 0 ? "+" : "";
  const dFmt = decimals > 0 ? delta.toFixed(decimals) : String(delta);
  const pFmt = pctDelta != null ? ` (${pctDelta >= 0 ? "+" : ""}${pctDelta}%)` : "";
  const fmtVal = (v) => decimals > 0 ? Number(v).toFixed(decimals) : v;
  return (
    <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, flexWrap: "wrap", gap: 4 }}>
      <span style={{ fontFamily: SERIF, fontSize: 13, color: "#7a6f6a" }}>{label}</span>
      <span style={{ fontFamily: MONO, fontSize: 11, color }}>
        {fmtVal(prior)}{suffix} → {fmtVal(current)}{suffix} · <strong>{dSign}{dFmt}{pFmt}</strong>
      </span>
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
  const [scoreOpen, setScoreOpen] = useState(false);
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
          {narrative.sampleSize <= 4 && (
            <span style={{ fontSize: 8, fontFamily: INTER, fontWeight: 600, textTransform: "uppercase", letterSpacing: "1.5px", padding: "3px 8px", background: "rgba(107,72,0,0.12)", color: "#6b4800" }}>Directional</span>
          )}
          <span style={{ fontSize: 8, fontFamily: INTER, fontWeight: 600, textTransform: "uppercase", letterSpacing: "1.5px", padding: "3px 8px", background: scoreColor, color: "#fff" }}>Score {narrative.opportunityScore}</span>
          <button type="button" onClick={() => setScoreOpen(o => !o)} style={{ ...s.linkBtn, marginTop: 0, fontSize: 9 }}>
            How scored {scoreOpen ? "↑" : "↓"}
          </button>
          <button type="button" onClick={() => setOpen(o => !o)} style={{ ...s.linkBtn, marginTop: 0 }}>
            {open ? "Hide ↑" : "View Detail ↓"}
          </button>
        </div>
      </div>

      {/* Score disclosure — How this is calculated */}
      {scoreOpen && (
        <div style={{ borderTop: "1px solid rgba(34,21,22,0.07)", padding: "14px 20px", background: "#fafaf9", fontSize: 11, fontFamily: MONO, lineHeight: 1.7 }}>
          <div style={{ color: "#221516", marginBottom: 8, fontWeight: 600 }}>
            Directional score: {narrative.opportunityScore} · {confData.label}
          </div>
          <div style={{ color: "#5c5350", marginBottom: 6, fontFamily: INTER, fontSize: 8, textTransform: "uppercase", letterSpacing: "2px", fontWeight: 600 }}>Available factors:</div>
          <div style={{ color: "#221516", marginBottom: 2 }}>· Avg rating: 30% weight</div>
          <div style={{ color: "#221516", marginBottom: 2 }}>· Rewear rate: 25% weight</div>
          <div style={{ color: "#221516", marginBottom: 2 }}>· Confidence lift: 25% weight</div>
          <div style={{ color: "#221516", marginBottom: 10 }}>· Data quality: 20% weight</div>
          <div style={{ color: "#7a6f6a", marginBottom: 2 }}>Evidence: n={narrative.sampleSize} · {periodLabel(dateRangeDays)}</div>
          <div style={{ color: "#7a6f6a", marginBottom: 8 }}>Pending (excluded): Shopify conversion · LTV · FASHN.ai fidelity</div>
          <div style={{ color: "#7a6f6a", fontFamily: SERIF, fontStyle: "italic", fontSize: 11, lineHeight: 1.5 }}>
            Scores reflect available evidence only. Treat as directional.
          </div>
        </div>
      )}

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

function TabCustomer({ data, kpis, advanced, rel, sampleMode, dateRangeDays, liveSignals }) {
  return (
    <>
      {/* Style DNA */}
      {data.onboarding?.totalProfiles > 0 && (
        <Section title="Style DNA Distribution" desc={`Based on ${data.onboarding.totalProfiles} completed profiles`} status="live" action={<ExportCSVButton data={data.onboarding.styleDNADistribution} filename="style-dna.csv" />}>
          <div style={{ fontFamily: MONO, fontSize: 10, color: "#9CA3AF", marginBottom: 12 }}>Multiple selections allowed — percentages do not sum to 100%.</div>
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
          <div style={{ fontFamily: MONO, fontSize: 10, color: "#9CA3AF", marginBottom: 12 }}>Multiple selections allowed — percentages do not sum to 100%.</div>
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
          <div style={{ fontFamily: MONO, fontSize: 10, color: "#9CA3AF", marginBottom: 12 }}>Multiple selections allowed — percentages do not sum to 100%.</div>
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
                  <KpiCard label="Unsure" value={`${advanced.emotionalJourney.wouldWearAgain.unsureCount ?? 0} · ${advanced.emotionalJourney.wouldWearAgain.unsureRate ?? 0}%`} />
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
                      {/* Req 7: Proxy removed — show measurement state when no WR data */}
                      {p.achievedEvidenceState && p.achievedEvidenceState !== "measured" ? (
                        <div style={{ marginBottom: 8 }}>
                          <MeasurementStatePill state={p.achievedEvidenceState} />
                          <span style={{ fontSize: 9, color: "#7a6f6a", fontFamily: INTER, marginLeft: 6 }}>
                            {p.eligibleWrCount === 0 ? "No post-wear reviews" : `${p.eligibleWrCount} WR event${p.eligibleWrCount !== 1 ? "s" : ""} — below minimum`}
                          </span>
                        </div>
                      ) : (
                        <>
                          <Metric label="Feeling achieved (strong)" value={p.achievedRate != null ? `${p.achievedRate}% (${p.achievedCount ?? p.wouldWearAgainCount} of ${p.eligibleWrCount ?? p.sampleSize})` : "—"} />
                          {p.partlyAchievedRate != null && p.partlyAchievedRate > 0 && <Metric label="Partly achieved" value={`${p.partlyAchievedRate}%`} />}
                          {p.notAchievedRate != null && p.notAchievedRate > 0 && <Metric label="Not achieved" value={`${p.notAchievedRate}%`} />}
                          {(p.unansweredCount ?? 0) > 0 && <Metric label="Unanswered" value={p.unansweredCount} />}
                        </>
                      )}
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
      {sampleMode && advanced?.journeyFunnel?.stages?.length > 0 ? (
        <Section title="Full Journey Mapping" desc={`SAMPLE PREVIEW — linked journey funnel · ${advanced.journeyFunnel.scopeLabel} · ${advanced.journeyFunnel.totalCustomers} customers`} status="sample">
          <div style={s.kpiGrid}>
            <KpiCard label="Total Customers" value={advanced.journeyFunnel.totalCustomers} />
            <KpiCard label="End-to-End Rate" value={`${advanced.journeyFunnel.endToEndRate ?? "—"}%`} tooltip="% of customers completing Passport through Repeat Purchase" />
            <KpiCard label="Main Drop-off" value={advanced.journeyFunnel.dropoffStage} />
            <KpiCard label="Top Segments" value={advanced.journeyFunnel.topSegments?.join(", ")} />
          </div>
          <div style={{ overflowX: "auto", marginTop: 20 }}>
            <table style={s.table}>
              <thead><tr>
                <th style={s.th}>Stage</th>
                <th style={s.th}>Customers</th>
                <th style={s.th}>Events / Count</th>
                <th style={s.th}>Conv. from Prev</th>
                <th style={s.th}>Median Days from Prev</th>
              </tr></thead>
              <tbody>
                {advanced.journeyFunnel.stages.map((stage, i) => (
                  <tr key={i} style={{ background: i % 2 === 0 ? "rgba(255,255,255,0.6)" : "transparent" }}>
                    <td style={{ ...s.td, fontFamily: SERIF, fontWeight: 600, fontSize: 13 }}>{stage.stage}</td>
                    <td style={{ ...s.td, fontFamily: MONO, fontWeight: 700 }}>{stage.customerCount}</td>
                    <td style={{ ...s.td, fontFamily: MONO, color: "#7a6f6a" }}>{stage.sessionsOrEvents ?? "—"}</td>
                    <td style={{ ...s.td, fontFamily: MONO, color: stage.convFromPrev != null && stage.convFromPrev < 50 ? "#8b2035" : "#2a5e42", fontWeight: 600 }}>
                      {stage.convFromPrev != null ? `${stage.convFromPrev}%` : "—"}
                    </td>
                    <td style={{ ...s.td, fontFamily: MONO, color: "#7a6f6a" }}>{stage.medianDaysFromPrev != null ? `${stage.medianDaysFromPrev}d` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {advanced.journeyFunnel.note && (
            <div style={{ marginTop: 12, padding: "8px 12px", background: "rgba(34,21,22,0.04)", borderLeft: "2px solid rgba(34,21,22,0.15)", fontSize: 11, color: "#7a6f6a", fontStyle: "italic" }}>
              {advanced.journeyFunnel.note}
            </div>
          )}
        </Section>
      ) : (
        <Section title="Customer Journey Analytics" desc="Multi-session journey mapping from first touch to repeat wear" status={advanced?.journeyAnalytics?.status || "awaiting-integration"}>
          {advanced?.journeyAnalytics?.status === "live" ? (
            <div style={s.kpiGrid}>
              <KpiCard label="Total Journey Events" value={advanced.journeyAnalytics.totalEvents} />
              {Object.entries(advanced.journeyAnalytics.eventTypeCounts).map(([type, count]) => (
                <KpiCard key={type} label={type.replace(/_/g, " ")} value={count} />
              ))}
            </div>
          ) : (
            <AwaitingCard
              label="Customer Journey Analytics"
              description="Highest-converting journeys, abandonment points, time-to-purchase, same-session / 24h / 7d / 30d attribution. Requires cart and checkout events from Shopify."
            />
          )}
        </Section>
      )}

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

      {/* Live Passport Preferences — Batch 2 */}
      {liveSignals && !sampleMode && liveSignals.passport?.evidenceState !== "no_eligible_observations" && (
        <Section title="Live Passport Preferences" desc={`Completed nAia Passports · all-time · ${liveSignals.passport?.uniqueCustomersWithPassport ?? 0} customers · ${liveSignals.passport?.totalUpdatedInPeriod ?? 0} updated ${liveSignals.period}`} status={liveSignals.passport?.evidenceState === "measured" ? "live" : "insufficient-data"}>
          <div style={{ fontFamily: MONO, fontSize: 10, color: "#9CA3AF", marginBottom: 14 }}>Multiple selections allowed — counts are per-customer responses, not percentages.</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 16 }}>
            {liveSignals.passport?.topStylePersonalities?.length > 0 && (
              <div style={s.card}>
                <div style={s.cardLabel}>Style Personalities</div>
                <div style={{ marginTop: 10 }}><LiveTopValues items={liveSignals.passport.topStylePersonalities} /></div>
              </div>
            )}
            {liveSignals.passport?.topDesiredFeelings?.length > 0 && (
              <div style={s.card}>
                <div style={s.cardLabel}>Desired Feelings</div>
                <div style={{ marginTop: 10 }}><LiveTopValues items={liveSignals.passport.topDesiredFeelings} /></div>
              </div>
            )}
            {liveSignals.passport?.topOccasions?.length > 0 && (
              <div style={s.card}>
                <div style={s.cardLabel}>Occasions</div>
                <div style={{ marginTop: 10 }}><LiveTopValues items={liveSignals.passport.topOccasions} /></div>
              </div>
            )}
            {liveSignals.passport?.topFitPreferences?.length > 0 && (
              <div style={s.card}>
                <div style={s.cardLabel}>Fit Preferences</div>
                <div style={{ marginTop: 10 }}><LiveTopValues items={liveSignals.passport.topFitPreferences} /></div>
              </div>
            )}
            {liveSignals.passport?.topStyleStruggles?.length > 0 && (
              <div style={s.card}>
                <div style={s.cardLabel}>Style Struggles</div>
                <div style={{ marginTop: 10 }}><LiveTopValues items={liveSignals.passport.topStyleStruggles} /></div>
              </div>
            )}
            {liveSignals.passport?.topFavoriteColors?.length > 0 && (
              <div style={s.card}>
                <div style={s.cardLabel}>Favourite Colours</div>
                <div style={{ marginTop: 10 }}><LiveTopValues items={liveSignals.passport.topFavoriteColors} /></div>
              </div>
            )}
          </div>
        </Section>
      )}

      {/* Live Customer Journey — Batch 2 */}
      {liveSignals && !sampleMode && liveSignals.journey?.stages?.length > 0 && (
        <Section title="Live Customer Journey" desc={`${liveSignals.period} · nAia-owned stages only · not a commercial conversion funnel`} status={liveSignals.journey.stages.some(s => s.uniqueCustomers > 0) ? "live" : "insufficient-data"}>
          <LiveJourneyFunnel journey={liveSignals.journey} />
        </Section>
      )}
    </>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// TAB 3 — PRODUCT INTELLIGENCE
// ══════════════════════════════════════════════════════════════════════════════

function TabProduct({ data, phase4b2, advanced, rel, sampleMode, dateRangeDays, roleLens }) {
  // Product summary from productNarratives — concise per-product snapshot
  const narratives = rel?.productNarratives ?? [];
  return (
    <>
      {/* Product Summary — concise table from productNarratives */}
      <Section
        title="Product Summary"
        desc="Every product in the current period — opportunity score, emotional outcome, best audience, top objection, and recommended next step."
        status={narratives.length > 0 ? (rel.status ?? "live") : "insufficient-data"}
      >
        {narratives.length > 0 ? (
          <div style={{ overflowX: "auto" }}>
            <table style={s.table}>
              <thead>
                <tr>
                  <th style={s.th}>Product</th>
                  <th style={s.th}>Directional Opportunity</th>
                  <th style={s.th}>Rating / Outcome</th>
                  <th style={s.th}>Rewear / Post-Wear</th>
                  <th style={s.th}>Best Audience</th>
                  <th style={s.th}>Top Objection</th>
                  <th style={s.th}>Evidence Maturity</th>
                  <th style={s.th}>Design Signal</th>
                  <th style={s.th}>Commercial / Positioning Signal</th>
                </tr>
              </thead>
              <tbody>
                {narratives.map((n, i) => {
                  const oppColor = (n.opportunityScore ?? 0) >= 60 ? "#2a5e42" : (n.opportunityScore ?? 0) >= 40 ? "#d97706" : "#8b2035";
                  const rewearDisplay = n.sampleSize > 0 && n.rewearRate != null
                    ? `${Math.round(n.rewearRate * 100)}% · n=${n.sampleSize}`
                    : "Not yet measured";
                  const ratingDisplay = n.avgRating != null
                    ? `★${n.avgRating.toFixed(1)}`
                    : "—";
                  const confData = sampleConfidence(n.sampleSize ?? 0);
                  return (
                    <tr key={i} style={{ background: i % 2 === 0 ? "rgba(255,255,255,0.6)" : "transparent" }}>
                      <td style={{ ...s.td, fontFamily: SERIF, fontWeight: 600, fontSize: 14 }}>{n.name ?? n.productTitle}</td>
                      <td style={{ ...s.td, color: oppColor, fontFamily: INTER, fontWeight: 700 }}>
                        {n.opportunityScore != null ? n.opportunityScore : "—"}
                        {n.sampleSize != null && n.sampleSize < 3 && (
                          <span style={{ display: "block", fontSize: 9, fontWeight: 400, color: "#9CA3AF", fontFamily: MONO }}>Directional</span>
                        )}
                      </td>
                      <td style={{ ...s.td, fontFamily: MONO, fontSize: 11 }}>{ratingDisplay}</td>
                      <td style={{ ...s.td, fontFamily: MONO, fontSize: 11, color: n.sampleSize > 0 && n.rewearRate != null ? "#221516" : "#9CA3AF" }}>
                        {rewearDisplay}
                      </td>
                      <td style={{ ...s.td, fontSize: 11 }}>{n.bestPersonality ?? "—"}</td>
                      <td style={{ ...s.td, color: n.mostCommonObjection ? "#8b2035" : "#7a6f6a", fontStyle: n.mostCommonObjection ? "italic" : "normal", fontSize: 11 }}>
                        {n.mostCommonObjection ?? "—"}
                      </td>
                      <td style={{ ...s.td, fontSize: 9 }}>
                        <span style={{ padding: "2px 6px", background: confData.color, color: "#fff", fontFamily: INTER, fontWeight: 700, textTransform: "uppercase", letterSpacing: "1px" }}>
                          {confData.label}
                        </span>
                      </td>
                      <td style={{ ...s.td, fontSize: 11, color: "#5c5350", maxWidth: 200 }}>{n.designImplication ?? "—"}</td>
                      <td style={{ ...s.td, fontSize: 11, color: "#5c5350", maxWidth: 200 }}>{n.recommendedAction ?? "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <InsufficientCard
            label="Product summary"
            description="Post-wear data accumulates from reviewed styling sessions. Product-level signals appear when enough session data is available."
            sampleSize={rel?.sampleSize ?? 0}
          />
        )}
      </Section>

      {/* Product detail — canonical profiles via ProductDetailPanel (progressive disclosure) */}
      {narratives.length > 0 && (
        <Section
          title="Product Intelligence"
          desc="Every NADINE product — opportunity score, emotional outcome, best audience, top objection, recommended action. Click View Detail for the full canonical profile."
          status={rel.status}
        >
          {rel.status === "insufficient-data" ? (
            <InsufficientCard label="Product intelligence" description="Not enough reviewed sessions to build product-level relationship intelligence." sampleSize={rel.sampleSize} />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {narratives.map((narrative, i) => (
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

      <Section title="Occasion Performance" desc="Where the collection shines — occasion demand, top pieces, and product fit" status="live" action={<ExportCSVButton data={data.topOccasions} filename="occasions.csv" />}>
        {data.topOccasions?.length > 0 ? (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 16 }}>
            {data.topOccasions.map((occ, i) => (
              <div key={i} style={s.card}>
                <div style={s.cardLabel}>{occ.name}</div>
                <div style={{ display: "flex", gap: 16, marginTop: 8, fontFamily: MONO, fontSize: 11, color: "#7a6f6a" }}>
                  {occ.avgRating != null && <span>★ {occ.avgRating.toFixed(1)}</span>}
                  <span>{occ.lookCount} looks</span>
                  <span>{occ.rewear != null && occ.lookCount > 0 ? `${Math.round(occ.rewear * 100)}% rewear` : "rewear: —"}</span>
                </div>
                {occ.topPieces?.length > 0 && <div style={{ fontSize: 12, color: "#666", marginTop: 8 }}>Best: {occ.topPieces.join(", ")}</div>}
              </div>
            ))}
          </div>
        ) : <EmptyState />}
      </Section>

      {sampleMode && advanced?.productPairing?.pairs?.length > 0 ? (
        <Section title="Product Pairing Intelligence" desc={`SAMPLE PREVIEW — co-session + sequential pairing signals · ${advanced.productPairing.scopeLabel} · ${advanced.productPairing.evidenceMaturity}`} status="sample">
          <div style={s.kpiGrid}>
            <KpiCard label="Top Pair" value={advanced.productPairing.topPair ? `${advanced.productPairing.topPair.product1.replace("Becoming ", "")} × ${advanced.productPairing.topPair.product2.replace("Becoming ", "")}` : "—"} />
            <KpiCard label="Total Pairing Signals" value={advanced.productPairing.totalSignals} />
            <KpiCard label="Evidence Maturity" value={advanced.productPairing.evidenceMaturity} />
          </div>
          <div style={{ overflowX: "auto", marginTop: 16 }}>
            <table style={s.table}>
              <thead><tr>
                <th style={s.th}>Product 1</th><th style={s.th}>Product 2</th>
                <th style={s.th}>Recommended Together</th><th style={s.th}>Saved Together</th>
                <th style={s.th}>Purchased Together</th><th style={s.th}>Positively Reviewed</th>
              </tr></thead>
              <tbody>
                {advanced.productPairing.pairs.map((p, i) => (
                  <tr key={i} style={{ background: i % 2 === 0 ? "rgba(255,255,255,0.6)" : "transparent" }}>
                    <td style={{ ...s.td, fontFamily: SERIF, fontSize: 12 }}>{p.product1}</td>
                    <td style={{ ...s.td, fontFamily: SERIF, fontSize: 12 }}>{p.product2}</td>
                    <td style={{ ...s.td, fontFamily: MONO, fontWeight: p.recommended > 0 ? 600 : 400, color: p.recommended > 0 ? "#2a5e42" : "#9CA3AF" }}>{p.recommended || "—"}</td>
                    <td style={{ ...s.td, fontFamily: MONO, color: p.saved > 0 ? "#221516" : "#9CA3AF" }}>{p.saved || "—"}</td>
                    <td style={{ ...s.td, fontFamily: MONO, color: p.purchased > 0 ? "#8b2035" : "#9CA3AF" }}>{p.purchased || "—"}</td>
                    <td style={{ ...s.td, fontFamily: MONO, color: p.reviewed > 0 ? "#6b4800" : "#9CA3AF" }}>{p.reviewed || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ marginTop: 10, fontSize: 11, color: "#7a6f6a", fontStyle: "italic" }}>{advanced.productPairing.note}</div>
        </Section>
      ) : (
        <Section title="Product Pairing Intelligence" desc="Best closet + nAia combinations" status={data.productPairings?.length > 0 ? "live" : "insufficient-data"}>
          {data.productPairings?.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {data.productPairings.map((p, i) => (
                <div key={i} style={{ padding: 16, background: "#fff", border: "1px solid rgba(34,21,22,0.08)" }}>
                  <div style={{ fontSize: 16, fontWeight: 500, marginBottom: 8 }}>{p.closetItem} + {p.naiaPiece}</div>
                  <div style={{ fontSize: 14, color: "#666" }}>{p.avgRating != null ? `${p.avgRating.toFixed(1)}/5` : "—"} · {p.reviewCount} review{p.reviewCount !== 1 ? "s" : ""}</div>
                </div>
              ))}
            </div>
          ) : <EmptyState message="No pairing data yet. Pairings appear when outfit reviews include both closet items and nAia pieces." />}
        </Section>
      )}

      {sampleMode && advanced?.saveVsPurchase?.status === "sample" ? (
        <Section title="Save vs Purchase Intelligence" desc={`SAMPLE PREVIEW — ${advanced.saveVsPurchase.scopeLabel} save/buy events · ${advanced.saveVsPurchase.evidenceMaturity}`} status="sample">
          <div style={s.kpiGrid}>
            <KpiCard label="Total Saves" value={advanced.saveVsPurchase.totalSaves} tooltip={`Saves within the selected period (${advanced.saveVsPurchase.scopeLabel}).`} />
            <KpiCard label="Unique Savers" value={advanced.saveVsPurchase.uniqueSavers} />
            <KpiCard label="Total Purchases" value={advanced.saveVsPurchase.totalPurchases} />
            <KpiCard label="Save-to-Purchase Rate" value={`${advanced.saveVsPurchase.overallSaveToP}%`} tooltip="% of saved items purchased in the same period." />
            <KpiCard label="Save-to-Convert Rate" value={advanced.saveVsPurchase.saveToConvertRate != null ? `${advanced.saveVsPurchase.saveToConvertRate}%` : "—"} tooltip="% of all-time saves that eventually led to a purchase of the same product." />
            <KpiCard label="Median Days Save→Purchase" value={advanced.saveVsPurchase.medianDaysToConvert != null ? `${advanced.saveVsPurchase.medianDaysToConvert}d` : "—"} />
            <KpiCard label="Highest SVP Product" value={advanced.saveVsPurchase.highestSvpProduct ?? "—"} tooltip="Product with the highest save-to-purchase conversion rate." />
            <KpiCard label="Most Saved" value={advanced.saveVsPurchase.mostSaved ?? "—"} />
            <KpiCard label="Purchases Without Prior Save" value={advanced.saveVsPurchase.purchasesWithoutSave} tooltip="Number of purchases where no prior save was recorded for the same product-customer pair." />
          </div>
          {advanced.saveVsPurchase.highSaveLowBuyProducts?.length > 0 && (
            <div style={{ marginTop: 16, padding: "10px 14px", background: "rgba(90,90,100,0.05)", borderLeft: "3px solid #8b2035" }}>
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

function TabRecommendation({ data, kpis, phase4b2, advanced, rel, sampleMode, dateRangeDays, liveSignals }) {
  return (
    <>
      <Section title="Recommendation Engagement & Response" desc="Immediate Love it / Okay / Not for me reactions to recommendation cards — separate from post-outfit reviews" status={phase4b2?.feedbackEngagement?.migrationPending ? "awaiting-integration" : "live"}>
        {phase4b2?.feedbackEngagement?.migrationPending ? (
          <MigrationPendingNotice label="Recommendation feedback (RecommendationFeedback table)" />
        ) : (
          <>
            <div style={{ padding: "8px 14px", background: "rgba(34,21,22,0.03)", border: "1px solid rgba(34,21,22,0.08)", fontFamily: "'Inter', -apple-system, sans-serif", fontSize: 11, color: "#5c5350", marginBottom: 16, lineHeight: 1.6 }}>
              Immediate card reactions — Love it / Okay / Not for me. Separate from post-outfit reviews, which are counted below.
            </div>
            <div style={s.kpiGrid}>
              <KpiCard label="StyleMe Sessions (period)" value={phase4b2.feedbackEngagement.totalSessions} tooltip={`Count of StyleMe sessions in the ${periodLabel(dateRangeDays)} — denominator for the response rate below.`} />
              <KpiCard label="Sessions With Response" value={phase4b2.feedbackEngagement.sessionsWithFeedback} />
              <KpiCard label="Response Rate" value={pctOf(phase4b2.feedbackEngagement.sessionsWithFeedback, phase4b2.feedbackEngagement.totalSessions, "sessions")} tooltip="% of styling sessions where at least one recommendation card received an immediate response." />
            </div>
            {(phase4b2?.feedbackDistribution?.total > 0) && (
              <>
                <div style={{ ...s.subHeader, marginTop: 20 }}>RESPONSE DISTRIBUTION</div>
                <div style={s.kpiGrid}>
                  <KpiCard label="Love it" value={phase4b2.feedbackDistribution.love} tooltip={pctOf(phase4b2.feedbackDistribution.love, phase4b2.feedbackDistribution.total, "responses")} />
                  <KpiCard label="It's okay" value={phase4b2.feedbackDistribution.okay} tooltip={pctOf(phase4b2.feedbackDistribution.okay, phase4b2.feedbackDistribution.total, "responses")} />
                  <KpiCard label="Not for me" value={phase4b2.feedbackDistribution.notForMe} tooltip={pctOf(phase4b2.feedbackDistribution.notForMe, phase4b2.feedbackDistribution.total, "responses")} />
                  <KpiCard label="Total Responses" value={phase4b2.feedbackDistribution.total} />
                </div>
              </>
            )}
          </>
        )}
      </Section>

      <Section title="Feedback & Friction" desc="Why recommendations are rejected — card-level objection signals, session-level tag patterns, and outfit hesitation" status={phase4b2?.objectionInsights?.migrationPending ? "awaiting-integration" : (phase4b2?.objectionInsights?.total >= 3 || data.positiveTags?.length > 0 || data.topObjections?.length > 0 ? "live" : "insufficient-data")}>
        {phase4b2?.objectionInsights?.migrationPending ? <MigrationPendingNotice label="Objection signals" /> : (
          <>
            {phase4b2?.objectionInsights?.total >= 3 ? (
              <>
                <div style={s.subHeader}>CARD-LEVEL OBJECTION SIGNALS</div>
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
              </>
            ) : (
              <div style={{ padding: "8px 14px", fontFamily: INTER, fontSize: 11, color: "#9CA3AF" }}>Need 3+ okay/not-for-me responses to surface card objection patterns.</div>
            )}

            <div style={{ ...s.subHeader, marginTop: 24 }}>OUTFIT-LEVEL TAG PATTERNS</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, marginTop: 12 }}>
              <div>
                <div style={{ fontFamily: INTER, fontSize: 9, textTransform: "uppercase", letterSpacing: "1.5px", color: "#2a5e42", marginBottom: 8 }}>What worked</div>
                {data.positiveTags?.length > 0 ? (
                  data.positiveTags.map((tag, i) => (
                    <div key={i} style={{ ...s.card, borderLeft: "3px solid #2a9d8f", marginBottom: 12 }}>
                      <div style={{ fontFamily: DISPLAY, fontSize: 16, fontWeight: 600, marginBottom: 6 }}>{tag.name}</div>
                      <div style={{ fontFamily: MONO, fontSize: 11, color: "#7a6f6a", marginBottom: 8 }}>{tag.count} mentions</div>
                      {tag.topPieces?.length > 0 && <div style={{ fontSize: 12, color: "#666" }}>Most linked: {tag.topPieces.join(", ")}</div>}
                    </div>
                  ))
                ) : <EmptyState />}
              </div>
              <div>
                <div style={{ fontFamily: INTER, fontSize: 9, textTransform: "uppercase", letterSpacing: "1.5px", color: "#8b2035", marginBottom: 8 }}>What didn't work</div>
                {data.negativeTags?.length > 0 ? (
                  data.negativeTags.map((tag, i) => (
                    <div key={i} style={{ ...s.card, borderLeft: "3px solid #c5553a", marginBottom: 12 }}>
                      <div style={{ fontFamily: DISPLAY, fontSize: 16, fontWeight: 600, marginBottom: 6 }}>{tag.name}</div>
                      <div style={{ fontFamily: MONO, fontSize: 11, color: "#7a6f6a", marginBottom: 8 }}>{tag.count} mentions</div>
                      {tag.topPieces?.length > 0 && <div style={{ fontSize: 12, color: "#666" }}>Most linked: {tag.topPieces.join(", ")}</div>}
                    </div>
                  ))
                ) : <EmptyState />}
              </div>
            </div>

            {data.topObjections?.length > 0 && (
              <>
                <div style={{ ...s.subHeader, marginTop: 24 }}>OUTFIT OBJECTION TRACKER</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 12 }}>
                  {data.topObjections.slice(0, 8).map((obj, i) => (
                    <div key={i} style={{ padding: 16, background: "#fff", border: "1px solid rgba(34,21,22,0.08)", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                      <div style={{ fontSize: 15, fontWeight: 500 }}>{obj.name}</div>
                      <div style={{ fontFamily: MONO, fontSize: 11, color: "#6b4800", whiteSpace: "nowrap" }}>{obj.count} mentions</div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </Section>

      <Section title="Buy or Skip Signals" desc="How customers assess new pieces against their wardrobe — all-time counts, does not follow the period filter" status={kpis?.buyOrSkip?.total > 0 ? "live" : "insufficient-data"}>
        {kpis?.buyOrSkip?.total > 0 ? (
          <>
            {/* 4-category canonical distribution (Req 6): Buy, Skip, Undecided, Incomplete — must sum to total */}
            <div style={s.kpiGrid}>
              <KpiCard label="Total Analyses" value={kpis.buyOrSkip.total} />
              <KpiCard
                label="Buy-Intent Rate"
                value={kpis.buyOrSkip.buyIntentRate != null ? `${kpis.buyOrSkip.buyIntentRate}%` : "—"}
                desc={`Buy ÷ decided (${kpis.buyOrSkip.buyIntentCount ?? kpis.buyOrSkip.buy} buy / ${kpis.buyOrSkip.decidedCount ?? (kpis.buyOrSkip.buy + kpis.buyOrSkip.skip)} decided) — intent, not confirmed purchase`}
              />
              <KpiCard label="Buy Intent" value={kpis.buyOrSkip.buyIntentCount ?? kpis.buyOrSkip.buy} />
              <KpiCard label="Skip" value={kpis.buyOrSkip.skipCount ?? kpis.buyOrSkip.skip} />
              <KpiCard label="Maybe / Undecided" value={kpis.buyOrSkip.undecidedCount ?? kpis.buyOrSkip.maybe} />
              <KpiCard label="Incomplete / No Response" value={kpis.buyOrSkip.incompleteCount ?? kpis.buyOrSkip.noDecision ?? 0} />
            </div>
            {/* Customer evidence disclosure (Req 3) */}
            {kpis.buyOrSkip.evidence && (
              <div style={{ marginTop: 8, marginBottom: 12 }}>
                <EvidenceDisclosure evidence={kpis.buyOrSkip.evidence} />
              </div>
            )}
            {/* Reconciliation — all 4 categories must sum to total */}
            {(() => {
              const buy  = kpis.buyOrSkip.buyIntentCount ?? kpis.buyOrSkip.buy ?? 0;
              const skip = kpis.buyOrSkip.skipCount ?? kpis.buyOrSkip.skip ?? 0;
              const unk  = kpis.buyOrSkip.undecidedCount ?? kpis.buyOrSkip.maybe ?? 0;
              const inc  = kpis.buyOrSkip.incompleteCount ?? kpis.buyOrSkip.noDecision ?? 0;
              const total = kpis.buyOrSkip.total;
              const sum   = buy + skip + unk + inc;
              return (
                <p style={{ fontSize: 10, color: sum === total ? "#2a5e42" : "#8b2035", fontFamily: INTER, marginTop: 4 }}>
                  Reconciliation: {buy} buy + {skip} skip + {unk} undecided + {inc} incomplete = {sum} of {total} total
                  {sum !== total ? ` — ⚠ ${Math.abs(total - sum)} unaccounted` : " ✓"}
                </p>
              );
            })()}
          </>
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


      {sampleMode && advanced?.explainability?.status === "sample" ? (
        <Section title="Explainability Analytics" desc={`SAMPLE PREVIEW — ${advanced.explainability.scopeLabel} · n=${advanced.explainability.evidenceDenominator} explanation-feedback events`} status="sample">
          {advanced.explainability.evidenceDenominator === 0 && (
            <div style={{ padding: "10px 14px", background: "rgba(90,90,100,0.05)", borderLeft: "3px solid #8b2035", marginBottom: 16, fontSize: 13, color: "#8b2035" }}>
              Not enough sample evidence for this period — no explanation-feedback events recorded.
            </div>
          )}
          <div style={s.kpiGrid}>
            <KpiCard label="Explanation Agreement Rate" value={advanced.explainability.explanationAgreementRate != null ? `${advanced.explainability.explanationAgreementRate}%` : "—"} tooltip="% of recommendation feedback responses that were 'Love it'. Not enough evidence when n=0." />
            <KpiCard label="→ Click Rate" value="—" status="not-implemented" tooltip="No click events captured in this period." />
            <KpiCard label="→ Save Rate" value={`${advanced.explainability.saveRate}%`} tooltip="% of sessions that resulted in a save." />
            <KpiCard label="→ Purchase Rate" value={`${advanced.explainability.purchaseRate}%`} tooltip="% of sessions that resulted in a purchase." />
          </div>
          {advanced.explainability.reasonsResonate?.length > 0 && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginTop: 16 }}>
              <div style={s.card}>
                <div style={{ ...s.cardLabel, color: "#2a5e42", marginBottom: 8 }}>Reasons That Resonate</div>
                {advanced.explainability.reasonsResonate.map((r, i) => {
                  const label = typeof r === "object" ? r.label : r;
                  const count = typeof r === "object" ? r.count : null;
                  return (
                    <div key={i} style={{ fontSize: 13, color: "#221516", paddingBottom: 4, borderBottom: i < advanced.explainability.reasonsResonate.length - 1 ? "1px solid rgba(34,21,22,0.06)" : "none", marginBottom: 4, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span>✓ {label}</span>
                      {count != null && <span style={{ fontFamily: "'Inter', sans-serif", fontSize: 10, color: "#7a6f6a", flexShrink: 0 }}>n={count}</span>}
                    </div>
                  );
                })}
              </div>
              {advanced.explainability.reasonsRejected?.length > 0 && (
                <div style={s.card}>
                  <div style={{ ...s.cardLabel, color: "#8b2035", marginBottom: 8 }}>Reasons Rejected</div>
                  {advanced.explainability.reasonsRejected.map((r, i) => {
                    const label = typeof r === "object" ? r.label : r;
                    const count = typeof r === "object" ? r.count : null;
                    return (
                      <div key={i} style={{ fontSize: 13, color: "#221516", paddingBottom: 4, borderBottom: i < advanced.explainability.reasonsRejected.length - 1 ? "1px solid rgba(34,21,22,0.06)" : "none", marginBottom: 4, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span>✗ {label}</span>
                        {count != null && <span style={{ fontFamily: "'Inter', sans-serif", fontSize: 10, color: "#7a6f6a", flexShrink: 0 }}>n={count}</span>}
                      </div>
                    );
                  })}
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
                    return `nAia succeeds when customers want to feel ${high[0].desiredFeeling}${high[0].topProducts[0] ? ` (${high[0].topProducts[0]})` : ""}. It struggles when they want to feel ${low[0].desiredFeeling}. Investigate product options for the under-served feeling states.`;
                  }
                  if (high.length > 0) return `nAia is consistently delivering on desired feelings. Continue observing to surface patterns across more mood-feeling combinations.`;
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

      {/* Starting Mood Distribution — moved from Collection */}
      {advanced?.emotionalJourney?.moodDistribution?.length > 0 && (
        <Section title="Mood Coverage" desc="Starting moods nAia encounters — what customers are feeling when they open Style Me" status="live">
          <div style={{ fontFamily: SERIF, fontSize: 13, color: "#7a6f6a", fontStyle: "italic", marginBottom: 16 }}>
            Starting moods differ from desired feelings: these are the emotional states customers bring in, before requesting what they want to feel. Understanding the mood range helps calibrate recommendation tone and product selection.
          </div>
          <div style={s.grid3}>
            {advanced.emotionalJourney.moodDistribution.slice(0, 9).map((m, i) => (
              <div key={i} style={s.card}><div style={s.cardLabel}>{m.mood}</div><div style={s.cardValue}>{m.count} sessions</div></div>
            ))}
          </div>
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

      {/* Virtual Try-On Intelligence — moved from Products */}
      {sampleMode && phase4b2?.vtoIntelligence ? (
        <Section title="Virtual Try-On Intelligence" desc="FASHN.ai VTO session outcomes — Sample Preview" status="sample">
          <div style={s.grid3}>
            <KpiCard label="VTO Sessions" value={phase4b2.vtoIntelligence.totalSessions} />
            <KpiCard label="Completion Rate" value={`${phase4b2.vtoIntelligence.completionRate}%`} />
            <KpiCard label="Fidelity Concern Rate" value={`${phase4b2.vtoIntelligence.fidelityConcernRate}%`} />
          </div>
          {phase4b2.vtoIntelligence.productBreakdown?.length > 0 && (
            <div style={{ overflowX: "auto", marginTop: 16 }}>
              <table style={s.table}>
                <thead><tr>
                  <th style={s.th}>Product</th><th style={s.th}>VTO Trials</th>
                  <th style={s.th}>Completion</th><th style={s.th}>Post-VTO Love</th>
                  <th style={s.th}>Fidelity Flags</th>
                </tr></thead>
                <tbody>
                  {phase4b2.vtoIntelligence.productBreakdown.map((p, i) => (
                    <tr key={i} style={{ background: i % 2 === 0 ? "rgba(255,255,255,0.6)" : "transparent" }}>
                      <td style={s.td}>{p.product}</td>
                      <td style={s.td}>{p.vtoTrials}</td>
                      <td style={s.td}>{p.completionRate}%</td>
                      <td style={{ ...s.td, color: "#2a5e42", fontWeight: 600 }}>{p.postVtoLoveRate}%</td>
                      <td style={s.td}>{p.fidelityConcerns}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {phase4b2.vtoIntelligence.topInsight && (
            <div style={{ marginTop: 14, padding: "10px 14px", background: "rgba(42,94,66,0.06)", borderLeft: "3px solid #2a5e42", fontSize: 13, color: "#221516" }}>
              {phase4b2.vtoIntelligence.topInsight}
            </div>
          )}
        </Section>
      ) : (
        <AwaitingCard
          label="Virtual Try-On Intelligence"
          description="VTO session counts, completion rates, and FASHN.ai fidelity metrics are pending FASHN.ai performance integration. Eligibility and readiness metrics are available in Feature Adoption above."
        />
      )}

      {/* Live Feature Adoption — moved from Overview */}
      {liveSignals && !sampleMode && liveSignals.featureAdoption?.length > 0 && (
        <Section title="Live Feature Adoption" desc={`Unique customers and events per nAia feature · ${liveSignals.period} · excludes test accounts`} status="live">
          <LiveFeatureAdoptionTable rows={liveSignals.featureAdoption} />
        </Section>
      )}

      {/* AI Learning Roadmap — now in Data & AI panel */}
      <div style={{ padding: "12px 20px", background: "rgba(34,21,22,0.02)", border: "1px solid rgba(34,21,22,0.07)", fontSize: 12, color: "#7a6f6a", fontFamily: SERIF, fontStyle: "italic" }}>
        AI Learning Roadmap has moved to <strong style={{ fontStyle: "normal" }}>Data &amp; AI</strong> — click the button in the header.
      </div>

      {/* Live Style Me Adoption — Batch 2 */}
      {liveSignals && !sampleMode && liveSignals.styleMe && (
        <Section title="Live Style Me Activity" desc={`${liveSignals.period} · nAia-owned activity only`} status={liveSignals.styleMe.evidenceState === "measured" ? "live" : "insufficient-data"}>
          <div style={s.kpiGrid}>
            <KpiCard label="Sessions Started" value={liveSignals.styleMe.sessionsStarted} />
            <KpiCard label="Unique Customers" value={liveSignals.styleMe.uniqueCustomers} />
            <KpiCard label="Recommendations Served" value={liveSignals.styleMe.recommendationsServed} />
            <KpiCard label="With Feedback" value={liveSignals.styleMe.sessionsWithFeedback} tooltip="Sessions where at least one recommendation received a Love/Okay/Not-for-me response." />
            <KpiCard label="With Saved Look" value={liveSignals.styleMe.sessionsWithSavedLook} tooltip="Sessions where at least one look was saved." />
            <KpiCard label="With In-Session Review" value={liveSignals.styleMe.sessionsWithInSessionReview} tooltip="Sessions with an immediate post-session rating." />
            <KpiCard label="With Post-Wear Review" value={liveSignals.styleMe.sessionsWithPostWearReview} tooltip="Sessions with a post-wear follow-up (did you wear it?)." />
          </div>
          {liveSignals.styleMe.topOccasions?.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <div style={s.subHeader}>TOP OCCASIONS REQUESTED</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
                {liveSignals.styleMe.topOccasions.slice(0, 6).map((o, i) => (
                  <span key={i} style={{ padding: "4px 12px", background: "rgba(34,21,22,0.05)", fontFamily: INTER, fontSize: 11, color: "#221516" }}>{o.value} <span style={{ color: "#9CA3AF" }}>({o.count})</span></span>
                ))}
              </div>
            </div>
          )}
        </Section>
      )}

      {/* Live Buy/Skip — Batch 2 */}
      {liveSignals && !sampleMode && liveSignals.buySkip && (
        <Section title="Live Buy/Skip Intent" desc={`${liveSignals.period} · Buy verdict = stated intent, not a purchase`} status={liveSignals.buySkip.evidenceState === "measured" ? "live" : "insufficient-data"}>
          <div style={{ fontFamily: MONO, fontSize: 10, color: "#9CA3AF", marginBottom: 12 }}>
            Buy/Skip verdict is stated intent only. Buy does not mean purchased. Data does not include Shopify orders.
          </div>
          <div style={s.kpiGrid}>
            <KpiCard label="Total Assessments" value={liveSignals.buySkip.total} />
            <KpiCard label="Unique Customers" value={liveSignals.buySkip.uniqueCustomers} />
            <KpiCard label="Buy Intent" value={liveSignals.buySkip.buyCount} desc="Stated buy intent — not a purchase" />
            <KpiCard label="Skip" value={liveSignals.buySkip.skipCount} />
            <KpiCard label="Maybe / Undecided" value={liveSignals.buySkip.maybeCount} />
            <KpiCard label="Incomplete" value={liveSignals.buySkip.incompleteCount} />
            <KpiCard
              label="Buy-Intent Rate"
              value={liveSignals.buySkip.buyIntentRate != null ? `${liveSignals.buySkip.buyIntentRate}%` : "—"}
              desc={`Buy ÷ decided (${liveSignals.buySkip.buyCount} buy / ${liveSignals.buySkip.decidedCount} decided)`}
              tooltip="Buy ÷ (Buy + Skip) — excludes Maybe and Incomplete. Stated intent, not confirmed purchase."
            />
          </div>
        </Section>
      )}

      {/* Live Feedback — Batch 2 */}
      {liveSignals && !sampleMode && liveSignals.feedback && (
        <Section title="Live Recommendation Feedback" desc={`${liveSignals.period} · Love it / Okay / Not for me responses`} status={liveSignals.feedback.evidenceState === "measured" ? "live" : "insufficient-data"}>
          <div style={s.kpiGrid}>
            <KpiCard label="Total Responses" value={liveSignals.feedback.totalFeedback} />
            <KpiCard label="Unique Customers" value={liveSignals.feedback.uniqueCustomers} />
            <KpiCard label="Love it" value={liveSignals.feedback.loveCount} />
            <KpiCard label="Okay" value={liveSignals.feedback.okayCount} />
            <KpiCard label="Not for me" value={liveSignals.feedback.notForMeCount} />
            <KpiCard
              label="Love Response Rate"
              value={liveSignals.feedback.loveRate != null ? `${liveSignals.feedback.loveRate}%` : "—"}
              desc="Love ÷ (Love + Not-for-me) · decided responses only"
            />
            <KpiCard label="With VTO Feedback" value={liveSignals.feedback.vtoFeedbackCount} tooltip="Responses that included virtual try-on aspect ratings." />
          </div>
          {liveSignals.feedback.topReasonCodes?.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <div style={s.subHeader}>TOP REASON CODES</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
                {liveSignals.feedback.topReasonCodes.slice(0, 8).map((r, i) => (
                  <span key={i} style={{ padding: "4px 12px", background: "rgba(34,21,22,0.05)", fontFamily: INTER, fontSize: 11, color: "#221516" }}>{r.value} <span style={{ color: "#9CA3AF" }}>({r.count})</span></span>
                ))}
              </div>
            </div>
          )}
        </Section>
      )}

      {/* Live In-Session Review — Batch 2 */}
      {liveSignals && !sampleMode && liveSignals.sessionReview && (
        <Section title="Live In-Session Review Outcomes" desc={`${liveSignals.period} · Immediate post-session response · ${liveSignals.sessionReview.totalReviews} reviews from ${liveSignals.sessionReview.uniqueCustomers} customers`} status={liveSignals.sessionReview.evidenceState === "measured" ? "live" : "insufficient-data"}>
          <div style={s.kpiGrid}>
            <KpiCard label="Total In-Session Reviews" value={liveSignals.sessionReview.totalReviews} />
            <KpiCard label="Avg Overall Feeling" value={liveSignals.sessionReview.avgOverallFeeling != null ? `${liveSignals.sessionReview.avgOverallFeeling}/5` : "—"} />
            <KpiCard label="Felt Like Her — Yes" value={liveSignals.sessionReview.feltLikeHerYes} />
            <KpiCard label="Desired Feeling Achieved" value={liveSignals.sessionReview.desiredFeelingAchievedYes} tooltip="Customers who said their desired feeling was achieved." />
            <KpiCard label="Would Wear Again — Definitely" value={liveSignals.sessionReview.wouldWearAgainDefinitely} tooltip="Stated intent — not verified repeat wear. 'Definitely' response to would-wear-again question." />
          </div>
        </Section>
      )}

      {/* Live Post-Wear Review — Batch 2 */}
      {liveSignals && !sampleMode && liveSignals.postWear && (
        <Section title="Live Post-Wear Follow-Up" desc={`${liveSignals.period} · Did you wear it? · Stated intent, not verified wear`} status={liveSignals.postWear.evidenceState === "measured" ? "live" : "insufficient-data"}>
          <div style={{ fontFamily: MONO, fontSize: 10, color: "#9CA3AF", marginBottom: 12 }}>
            "Would wear again" = stated intent only. This is not verified repeat wear. Post-wear data is self-reported.
          </div>
          <div style={s.kpiGrid}>
            <KpiCard label="Total Post-Wear Reviews" value={liveSignals.postWear.totalReviews} />
            <KpiCard label="Unique Customers" value={liveSignals.postWear.uniqueCustomers} />
            <KpiCard label="Did wear it — Yes" value={liveSignals.postWear.didWearItYes} />
            <KpiCard label="Not yet" value={liveSignals.postWear.didWearItNotYet} />
            <KpiCard label="Did not wear" value={liveSignals.postWear.didWearItNo} />
            <KpiCard label="Felt positive" value={liveSignals.postWear.feltPositive} desc="Great or Good feeling response" />
            <KpiCard label="Fit — Yes" value={liveSignals.postWear.fitFeedbackYes} />
            <KpiCard label="Coverage — Yes" value={liveSignals.postWear.coverageFeedbackYes} />
            <KpiCard label="Colour — Yes" value={liveSignals.postWear.colourFeedbackYes} />
            <KpiCard label="Stated Rewear Intent" value={liveSignals.postWear.statedRewearYes} tooltip="Customers who answered 'Definitely' to would-wear-again. Stated intent only — not verified repeat wear." />
          </div>
        </Section>
      )}

      {/* Live Saved Looks — Batch 2 */}
      {liveSignals && !sampleMode && liveSignals.savedLooks && (
        <Section title="Live Saved Looks" desc={`${liveSignals.period} · Looks saved from Style Me sessions`} status={liveSignals.savedLooks.evidenceState === "measured" ? "live" : "insufficient-data"}>
          <div style={s.kpiGrid}>
            <KpiCard label="Total Looks Saved" value={liveSignals.savedLooks.totalLooks} />
            <KpiCard label="Unique Customers" value={liveSignals.savedLooks.uniqueCustomers} />
            <KpiCard label="From a Recommendation" value={liveSignals.savedLooks.fromRecommendation} tooltip="Looks saved from a nAia styling recommendation, not custom." />
            <KpiCard label="With Post-Wear Link" value={liveSignals.savedLooks.withPostWearLink} tooltip="Saved looks whose source session has a post-wear review." />
          </div>
          {liveSignals.savedLooks.topItemTypes?.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <div style={s.subHeader}>ITEM TYPES IN SAVED LOOKS</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
                {liveSignals.savedLooks.topItemTypes.slice(0, 8).map((t, i) => (
                  <span key={i} style={{ padding: "4px 12px", background: "rgba(34,21,22,0.05)", fontFamily: INTER, fontSize: 11, color: "#221516" }}>{t.value} <span style={{ color: "#9CA3AF" }}>({t.count})</span></span>
                ))}
              </div>
            </div>
          )}
        </Section>
      )}
    </>
  );
}

function CollectionHealthScoreDisclosure({ health }) {
  const [open, setOpen] = useState(false);
  if (!health) return null;
  const factors = health.factors ?? {};
  const included = Object.entries(factors).filter(([, f]) => f.score !== null);
  const excluded = Object.entries(factors).filter(([, f]) => f.score === null);
  const humanise = k => k.replace(/([A-Z])/g, " $1").trim();
  return (
    <div style={{ marginTop: 10, textAlign: "left" }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        style={{ ...s.linkBtn, marginTop: 0, fontSize: 9, letterSpacing: "0.5px" }}
      >
        How this is calculated {open ? "↑" : "↓"}
      </button>
      {open && (
        <div style={{ marginTop: 10, padding: "12px 14px", background: "#fafaf9", border: "1px solid rgba(34,21,22,0.08)", fontSize: 11, fontFamily: MONO, lineHeight: 1.7 }}>
          {included.length > 0 && (
            <>
              <div style={{ color: "#5c5350", marginBottom: 6, fontFamily: INTER, fontSize: 8, textTransform: "uppercase", letterSpacing: "2px", fontWeight: 600 }}>
                Included factors ({included.length} of {Object.keys(factors).length}):
              </div>
              {included.map(([key, f]) => (
                <div key={key} style={{ color: "#221516", marginBottom: 3 }}>
                  · {humanise(key)}: {f.weight}% weight — {f.label}
                </div>
              ))}
            </>
          )}
          {excluded.length > 0 && (
            <>
              <div style={{ color: "#5c5350", marginTop: 10, marginBottom: 6, fontFamily: INTER, fontSize: 8, textTransform: "uppercase", letterSpacing: "2px", fontWeight: 600 }}>
                Excluded (pending integration — not zeroed):
              </div>
              {excluded.map(([key, f]) => (
                <div key={key} style={{ color: "#7a6f6a", marginBottom: 3 }}>
                  · {humanise(key)}: {f.weight}% weight — awaiting integration
                </div>
              ))}
            </>
          )}
          <div style={{ marginTop: 10, paddingTop: 8, borderTop: "1px solid rgba(34,21,22,0.07)", color: "#7a6f6a", fontFamily: SERIF, fontStyle: "italic", fontSize: 11 }}>
            Method: Directional partial score from available factors only. Unavailable factors are excluded, not treated as zero. Full score requires Shopify commercial integration.
          </div>
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// TAB 5 — COLLECTION INTELLIGENCE
// ══════════════════════════════════════════════════════════════════════════════

function TabCollection({ data, kpis, advanced, rel, sampleMode, dateRangeDays, liveSignals }) {
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
                  {wellServedCount != null ? `${wellServedCount} of ${totalPersonalities} observed personality segments currently have sufficient positive evidence` : "—"}
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
      <Section title="Collection Health Score" desc="Deprecated — not used for decisions. Retained for reference only." status={advanced?.collectionHealth?.score != null ? "live" : "insufficient-data"}>
        <div style={{ padding: "8px 14px", background: "rgba(90,90,100,0.05)", border: "1px solid rgba(90,90,100,0.2)", fontFamily: INTER, fontSize: 11, color: "#5c5350", marginBottom: 16, lineHeight: 1.6 }}>
          <strong>Deprecated — not used for decisions.</strong> This composite score is not used for sorting, ranking, or action generation. Factor breakdown is shown for reference only.
        </div>
        {advanced?.collectionHealth?.sampleSizeWarning && <SampleSizeWarning n={advanced.collectionHealth.reviewCount ?? 0} min={10} />}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 20 }}>
          <div style={{ ...s.card, textAlign: "center" }}>
            {(() => {
              const score = advanced?.collectionHealth?.score;
              const maturity = score == null ? null : score >= 67 ? "Strong" : score >= 34 ? "Moderate" : "Early";
              const maturityColor = maturity === "Strong" ? "#2a5e42" : maturity === "Moderate" ? "#d97706" : "#8b2035";
              return (
                <>
                  <div style={{ fontFamily: INTER, fontSize: 8, textTransform: "uppercase", letterSpacing: "2.5px", color: "#7a6f6a", marginBottom: 6 }}>Directional Collection Health</div>
                  <div style={{ fontFamily: "'Playfair Display', serif", fontSize: 40, fontWeight: 900, color: maturity ? maturityColor : "#9CA3AF", lineHeight: 1 }}>
                    {maturity ?? "—"}
                  </div>
                  <div style={{ fontFamily: MONO, fontSize: 11, color: "#7a6f6a", marginTop: 8 }}>
                    Indicative score: {score ?? "—"} &nbsp;·&nbsp; {advanced?.collectionHealth?.factorsAvailable ?? 0} of {advanced?.collectionHealth?.factorsTotal ?? 8} factors
                  </div>
                </>
              );
            })()}
            {advanced?.collectionHealth?.largestWeakness && (
              <div style={{ marginTop: 16, fontSize: 12, color: "#d97706" }}>Area with lowest score: {advanced.collectionHealth.largestWeakness.replace(/([A-Z])/g, " $1").trim()}</div>
            )}
            {advanced?.collectionHealth?.strongestArea && (
              <div style={{ marginTop: 8, fontSize: 12, color: "#2a5e42" }}>Area with highest score: {advanced.collectionHealth.strongestArea.replace(/([A-Z])/g, " $1").trim()}</div>
            )}
            <CollectionHealthScoreDisclosure health={advanced?.collectionHealth} />
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

      {/* Colour Coverage */}
      <Section title="Preferred Colour Demand" desc="Preferred colour families from completed customer profiles — all time" status={data.onboarding?.colorDistribution?.length > 0 ? "live" : "insufficient-data"}>
        <div style={s.grid3}>
          {data.onboarding?.colorDistribution?.slice(0, 9).map((item, i) => (
            <div key={i} style={s.card}><div style={s.cardLabel}>{normalizeLabel(item.color) ?? item.color}</div><div style={s.cardValue}>{item.count} customers prefer this</div></div>
          ))}
        </div>
      </Section>

      {/* Fit and Size Coverage */}
      {sampleMode && advanced?.sizeIntelligence?.sizeGroups?.length > 0 ? (
        <Section title="Fit and Size Intelligence" desc={`SAMPLE PREVIEW — ${advanced.sizeIntelligence.scopeLabel} · ${advanced.sizeIntelligence.totalFitObjections} fit objections · ${advanced.sizeIntelligence.totalReturns} returns · ${advanced.sizeIntelligence.evidenceMaturity}`} status="sample">
          <div style={s.kpiGrid}>
            <KpiCard label="Total Customers" value={advanced.sizeIntelligence.totalCustomers} />
            <KpiCard label="Fit Objections" value={advanced.sizeIntelligence.totalFitObjections} />
            <KpiCard label="Returns" value={advanced.sizeIntelligence.totalReturns} />
            <KpiCard label="Evidence Maturity" value={advanced.sizeIntelligence.evidenceMaturity} />
          </div>
          <div style={{ ...s.subHeader, marginTop: 20 }}>CUSTOMER DISTRIBUTION BY SIZE GROUP</div>
          <div style={{ overflowX: "auto" }}>
            <table style={s.table}>
              <thead><tr>
                <th style={s.th}>Size</th><th style={s.th}>Customers</th>
                <th style={s.th}>Main Personalities</th><th style={s.th}>Fit Objections</th>
                <th style={s.th}>Returns</th><th style={s.th}>Purchase Conv.</th>
              </tr></thead>
              <tbody>
                {advanced.sizeIntelligence.sizeGroups.map((g, i) => (
                  <tr key={i} style={{ background: i % 2 === 0 ? "rgba(255,255,255,0.6)" : "transparent" }}>
                    <td style={{ ...s.td, fontFamily: MONO, fontWeight: 700 }}>{g.size}</td>
                    <td style={{ ...s.td, fontFamily: MONO }}>{g.customerCount}</td>
                    <td style={{ ...s.td, fontSize: 11 }}>{g.preferencePersonalities?.join(", ")}</td>
                    <td style={{ ...s.td, fontFamily: MONO, color: g.fitObjCount > 2 ? "#8b2035" : "#221516" }}>{g.fitObjCount || "—"}</td>
                    <td style={{ ...s.td, fontFamily: MONO, color: g.returnCount > 1 ? "#8b2035" : "#221516" }}>{g.returnCount || "—"}</td>
                    <td style={{ ...s.td, fontFamily: MONO, color: g.purchaseConvRate < 72 ? "#d97706" : "#2a5e42", fontWeight: 600 }}>{g.purchaseConvRate}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {advanced.sizeIntelligence.fitObjByProduct?.length > 0 && (
            <>
              <div style={{ ...s.subHeader, marginTop: 20 }}>FIT OBJECTIONS BY PRODUCT</div>
              <div style={{ overflowX: "auto" }}>
                <table style={s.table}>
                  <thead><tr><th style={s.th}>Product</th><th style={s.th}>Fit Objections</th><th style={s.th}>Returns</th><th style={s.th}>Top Objection</th><th style={s.th}>Stock-Out Risk</th></tr></thead>
                  <tbody>
                    {advanced.sizeIntelligence.fitObjByProduct.map((r, i) => (
                      <tr key={i} style={{ background: i % 2 === 0 ? "rgba(255,255,255,0.6)" : "transparent" }}>
                        <td style={{ ...s.td, fontFamily: SERIF }}>{r.product}</td>
                        <td style={{ ...s.td, fontFamily: MONO, color: r.fitObjCount > 1 ? "#8b2035" : "#221516" }}>{r.fitObjCount}</td>
                        <td style={{ ...s.td, fontFamily: MONO }}>{r.returnCount || "—"}</td>
                        <td style={{ ...s.td, fontSize: 11, color: "#5c5350", fontStyle: "italic" }}>{r.topObjection ?? "—"}</td>
                        <td style={{ ...s.td, fontSize: 11, color: r.stockOutRisk === "Medium" ? "#d97706" : "#7a6f6a" }}>{r.stockOutRisk}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
          {advanced.sizeIntelligence.underservedSizes?.length > 0 && (
            <div style={{ marginTop: 14, padding: "10px 14px", background: "rgba(90,90,100,0.05)", borderLeft: "3px solid #8b2035" }}>
              <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "1.5px", color: "#8b2035", marginBottom: 6, fontFamily: "'Inter', sans-serif" }}>Underserved Size Groups</div>
              {advanced.sizeIntelligence.underservedSizes.map((u, i) => (
                <div key={i} style={{ fontSize: 13, color: "#221516", marginBottom: 3 }}>{u.size} — {u.issue}</div>
              ))}
            </div>
          )}
          {advanced.sizeIntelligence.recommendation && (
            <div style={{ marginTop: 14, padding: "10px 14px", background: "rgba(42,94,66,0.05)", borderLeft: "3px solid #2a5e42", fontSize: 13, color: "#221516" }}>
              {advanced.sizeIntelligence.recommendation}
            </div>
          )}
        </Section>
      ) : (
        <Section title="Fit and Size Coverage" desc="Fit preferences addressed by the collection" status={data.bodyPatterns?.length > 0 ? "live" : "awaiting-integration"}>
          {data.bodyPatterns?.length > 0 ? (
            <div style={s.grid3}>
              {data.bodyPatterns.map((p, i) => (
                <div key={i} style={s.card}><div style={s.cardLabel}>{p.preference}</div><div style={s.cardValue}>{p.userCount} {p.userCount === 1 ? "user" : "users"}</div><div style={{ fontSize: 12, color: "#7a6f6a", marginTop: 6, fontStyle: "italic" }}>{p.implication}</div></div>
              ))}
            </div>
          ) : (
            <AwaitingCard label="Size Coverage" description="Size coverage analysis requires size data to be collected in StyleMe sessions and linked to product variant availability." />
          )}
        </Section>
      )}

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
                  : `Current collection is performing consistently across all personality types with sufficient data. Increase session volume to surface signals for personality types with fewer than 3 sessions.`;
                const reason = underserved.length > 0
                  ? `Low rewear rate or rating from a consistent personality segment is the earliest signal of a collection gap — before any conversion data is available.`
                  : `Consistent performance across personality types within the current customer base — no clear gap signal in available observations.`;
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

      {/* Live Closet Demand — Batch 2 */}
      {liveSignals && !sampleMode && liveSignals.closet && (
        <Section title="Live Closet Demand" desc={`${liveSignals.period} · Category and colour demand from customer closets`} status={liveSignals.closet.evidenceState === "measured" ? "live" : "insufficient-data"}>
          <div style={s.kpiGrid}>
            <KpiCard label="Total Items Added" value={liveSignals.closet.totalItems} />
            <KpiCard label="Customers With Closet" value={liveSignals.closet.customersWithItems} />
            <KpiCard label="Avg Items / Customer" value={liveSignals.closet.avgItemsPerCustomer} />
            <KpiCard label="Try-On Eligible" value={liveSignals.closet.tryOnEligibleCount} tooltip="Items assessed as ready for virtual try-on." />
            <KpiCard
              label="Try-On Eligibility Rate"
              value={liveSignals.closet.tryOnEligibleRate != null ? `${liveSignals.closet.tryOnEligibleRate}%` : "—"}
              tooltip="% of closet items that pass try-on eligibility assessment."
            />
          </div>
          <div style={{ marginTop: 20, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 16 }}>
            {liveSignals.closet.categoryDistribution?.length > 0 && (
              <div style={s.card}>
                <div style={s.cardLabel}>Category demand</div>
                <div style={{ marginTop: 10 }}><LiveTopValues items={liveSignals.closet.categoryDistribution} /></div>
              </div>
            )}
            {liveSignals.closet.colorDistribution?.length > 0 && (
              <div style={s.card}>
                <div style={s.cardLabel}>Colour demand</div>
                <div style={{ marginTop: 10 }}><LiveTopValues items={liveSignals.closet.colorDistribution} /></div>
              </div>
            )}
          </div>
        </Section>
      )}
    </>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// TAB 6 — COMMERCIAL INTELLIGENCE
// ══════════════════════════════════════════════════════════════════════════════

function TabCommercial({ data, advanced, rel, commercial, sampleMode, dateRangeDays }) {
  const ltv = advanced?.ltv;

  // ── SAMPLE MODE: show computed commercial data ──────────────────────────────
  if (sampleMode && commercial) {
    const c = commercial;
    const fmtAed = (n) => `AED ${n?.toLocaleString() ?? "—"}`;
    const CLabel = ({ children }) => (
      <div style={{ fontFamily: INTER, fontSize: 8, textTransform: "uppercase", letterSpacing: "2px", color: "#7a6f6a", fontWeight: 600, marginBottom: 4 }}>{children}</div>
    );
    const CValue = ({ children, color }) => (
      <div style={{ fontFamily: DISPLAY, fontSize: 28, fontWeight: 700, color: color ?? "#8b2035", marginBottom: 4 }}>{children}</div>
    );
    const Row = ({ label, value, mono }) => (
      <div style={{ display: "flex", justifyContent: "space-between", padding: "7px 0", borderBottom: "1px solid rgba(34,21,22,0.05)" }}>
        <span style={{ fontFamily: SERIF, fontSize: 13, color: "#5c5350" }}>{label}</span>
        <span style={{ fontFamily: mono ? MONO : SERIF, fontSize: 13, color: "#221516", fontWeight: 600 }}>{value}</span>
      </div>
    );

    return (
      <>
        {/* Revenue Intelligence */}
        <Section title="nAia-Assisted Revenue" desc={`Orders linked to a nAia session within 7 days before checkout · observational · ${c.scopeLabel}`} status="sample">
          <div style={{ padding: "8px 12px", background: "rgba(107,72,0,0.05)", border: "1px solid rgba(107,72,0,0.12)", marginBottom: 14, fontSize: 11, color: "#6b4800", fontFamily: "serif" }}>
            Attribution rule: any qualifying touch (Style Me, Buy or Skip, Save, VTO) within <strong>7 days</strong> before checkout. This is observational correlation, not causal attribution. A purchase is counted once per attribution window regardless of touch count.
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px,1fr))", gap: 1, background: "rgba(34,21,22,0.07)", marginBottom: 24 }}>
            {[
              { label: "nAia-Assisted Revenue", value: fmtAed(c.revenue.naiaAssisted), color: "#8b2035" },
              { label: "All-Time Assisted Revenue", value: fmtAed(c.revenue.naiaAssistedAllTime), color: "#8b2035" },
              { label: "Avg Order Value", value: fmtAed(c.revenue.avgOrderValue), color: "#221516" },
              { label: "Revenue / Session", value: fmtAed(c.revenue.revenuePerSession), color: "#221516" },
              { label: "Session → Purchase Rate", value: `${c.revenue.sessionConversionRate}%`, color: "#2a5e42" },
              // naiaVsNonNaiaMultiplier removed from KPI tiles (Req 9) — illustrative assumption, shown in Data & AI only
            ].map(({ label, value, color }) => (
              <div key={label} style={{ padding: "18px 20px", background: "#fff" }}>
                <CLabel>{label}</CLabel>
                <CValue color={color}>{value}</CValue>
              </div>
            ))}
          </div>
          {c.revenue?.nonNaiaBaselineNote && (
            <div style={{ padding: "8px 12px", background: "rgba(107,72,0,0.05)", border: "1px solid rgba(107,72,0,0.12)", marginBottom: 14, fontSize: 11, color: "#6b4800", fontFamily: "serif" }}>
              <strong>Illustrative assumption — not observed performance.</strong> nAia vs. non-nAia comparison: {c.revenue.naiaVsNonNaiaMultiplier}× (baseline estimated — {c.revenue.nonNaiaBaselineNote})
            </div>
          )}
          {c.revenue.byProduct?.length > 0 && (
            <div style={{ overflowX: "auto" }}>
              <table style={s.table}>
                <thead><tr>
                  <th style={s.th}>Product</th>
                  <th style={s.th}>Units Sold</th>
                  <th style={s.th}>Revenue (AED)</th>
                </tr></thead>
                <tbody>
                  {c.revenue.byProduct.map((r, i) => (
                    <tr key={i} style={{ background: i % 2 === 0 ? "rgba(255,255,255,0.6)" : "transparent" }}>
                      <td style={{ ...s.td, fontFamily: DISPLAY, fontStyle: "italic", fontSize: 14 }}>{r.product}</td>
                      <td style={{ ...s.td, fontFamily: MONO }}>{r.units}</td>
                      <td style={{ ...s.td, fontFamily: MONO, color: "#8b2035", fontWeight: 700 }}>{r.revenue.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>

        {/* Margin */}
        <Section title="Gross Margin" desc="Derived from synthetic COGS — illustrative ratios only" status="sample">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px,1fr))", gap: 1, background: "rgba(34,21,22,0.07)", marginBottom: 24 }}>
            {[
              { label: "Gross Margin %", value: `${c.margin.grossMarginPct}%`, color: "#2a5e42" },
              { label: "Gross Margin AED", value: fmtAed(c.margin.grossMarginAed), color: "#2a5e42" },
              { label: "All-Time Gross", value: fmtAed(c.margin.allTimeGrossAed), color: "#221516" },
              { label: "Highest Margin", value: c.margin.highestMarginProduct ?? "—", color: "#221516" },
            ].map(({ label, value, color }) => (
              <div key={label} style={{ padding: "18px 20px", background: "#fff" }}>
                <CLabel>{label}</CLabel>
                <CValue color={color}>{value}</CValue>
              </div>
            ))}
          </div>
          {c.margin.byProduct?.length > 0 && (
            <div style={{ overflowX: "auto" }}>
              <table style={s.table}>
                <thead><tr>
                  <th style={s.th}>Product</th>
                  <th style={s.th}>Gross Margin %</th>
                  <th style={s.th}>Gross Margin AED</th>
                  <th style={s.th}>Revenue AED</th>
                </tr></thead>
                <tbody>
                  {c.margin.byProduct.map((r, i) => (
                    <tr key={i} style={{ background: i % 2 === 0 ? "rgba(255,255,255,0.6)" : "transparent" }}>
                      <td style={{ ...s.td, fontFamily: DISPLAY, fontStyle: "italic", fontSize: 14 }}>{r.product}</td>
                      <td style={{ ...s.td, fontFamily: MONO, color: "#2a5e42", fontWeight: 700 }}>{r.grossPct}%</td>
                      <td style={{ ...s.td, fontFamily: MONO }}>{r.grossAed.toLocaleString()}</td>
                      <td style={{ ...s.td, fontFamily: MONO }}>{r.revenue.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>

        {/* Returns */}
        <Section title="Returns" desc="All-time return rate from synthetic purchase history" status="sample">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px,1fr))", gap: 1, background: "rgba(34,21,22,0.07)", marginBottom: 24 }}>
            {[
              { label: "Total Returns", value: c.returns.total, color: c.returns.total > 3 ? "#8b2035" : "#2a5e42" },
              { label: "Return Rate", value: `${c.returns.returnRate}%`, color: c.returns.returnRate < 15 ? "#2a5e42" : "#8b2035" },
              { label: "Revenue Lost", value: fmtAed(c.returns.returnRevenueLost), color: "#d97706" },
            ].map(({ label, value, color }) => (
              <div key={label} style={{ padding: "18px 20px", background: "#fff" }}>
                <CLabel>{label}</CLabel>
                <CValue color={color}>{value}</CValue>
              </div>
            ))}
          </div>
          {c.returns.byProduct?.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              {c.returns.byProduct.map((r, i) => (
                <div key={i} style={{ padding: "10px 14px", background: "rgba(255,255,255,0.6)", borderLeft: "3px solid #d97706", marginBottom: 8 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                    <span style={{ fontFamily: DISPLAY, fontSize: 14, fontStyle: "italic", color: "#221516" }}>{r.product}</span>
                    <span style={{ fontFamily: MONO, fontSize: 11, color: "#d97706" }}>{r.returned} returned · {r.rate}% rate · {fmtAed(r.revenueLost)} lost</span>
                  </div>
                </div>
              ))}
            </div>
          )}
          {c.returns.byReason?.length > 0 && (
            <div>
              <div style={{ fontFamily: INTER, fontSize: 8, textTransform: "uppercase", letterSpacing: "2px", color: "#7a6f6a", marginBottom: 10, fontWeight: 600 }}>Return Reasons</div>
              {c.returns.byReason.map((r, i) => (
                <Row key={i} label={r.reason} value={`${r.count} return${r.count !== 1 ? "s" : ""}`} mono />
              ))}
            </div>
          )}
        </Section>

        {/* Inventory & Sell-Through */}
        <Section title="Inventory & Sell-Through" desc="Synthetic stock positions — derived from all-time purchases and current stock on hand" status="sample">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px,1fr))", gap: 1, background: "rgba(34,21,22,0.07)", marginBottom: 24 }}>
            {[
              // Weighted sell-through (canonical for founder-level decisions): total net sold ÷ total starting units
              { label: "Weighted Sell-Through (total net ÷ total starting)", value: `${c.inventory.weightedSellThrough ?? c.inventory.avgSellThrough}%`, color: "#221516" },
              // Unweighted: mean of individual product rates — biased by product mix
              { label: "Unweighted Avg Sell-Through (mean of product rates)", value: `${c.inventory.avgSellThrough}%`, color: "#5c5350" },
              { label: "Fastest Moving", value: c.inventory.fastestMoving ?? "—", color: "#2a5e42" },
              { label: "Slowest Moving", value: c.inventory.slowestMoving ?? "—", color: "#d97706" },
              { label: "At-Risk Lines", value: c.inventory.atRisk?.length ?? 0, color: c.inventory.atRisk?.length > 0 ? "#8b2035" : "#2a5e42" },
            ].map(({ label, value, color }) => (
              <div key={label} style={{ padding: "18px 20px", background: "#fff" }}>
                <CLabel>{label}</CLabel>
                <CValue color={color}>{value}</CValue>
              </div>
            ))}
          </div>
          {c.inventory.byProduct?.length > 0 && (
            <div style={{ overflowX: "auto" }}>
              <table style={s.table}>
                <thead><tr>
                  <th style={s.th}>Product</th>
                  <th style={s.th}>In Stock</th>
                  <th style={s.th}>Sold</th>
                  <th style={s.th}>Returned</th>
                  <th style={s.th}>Net Sold</th>
                  <th style={s.th}>Total Units</th>
                  <th style={s.th}>Sell-Through</th>
                </tr></thead>
                <tbody>
                  {c.inventory.byProduct.map((r, i) => {
                    const stColor = r.sellThrough >= 50 ? "#2a5e42" : r.sellThrough >= 25 ? "#d97706" : "#8b2035";
                    return (
                      <tr key={i} style={{ background: i % 2 === 0 ? "rgba(255,255,255,0.6)" : "transparent" }}>
                        <td style={{ ...s.td, fontFamily: DISPLAY, fontStyle: "italic", fontSize: 14 }}>{r.product}</td>
                        <td style={{ ...s.td, fontFamily: MONO }}>{r.inStock}</td>
                        <td style={{ ...s.td, fontFamily: MONO }}>{r.unitsSold}</td>
                        <td style={{ ...s.td, fontFamily: MONO, color: r.returned > 0 ? "#d97706" : "#9CA3AF" }}>{r.returned}</td>
                        <td style={{ ...s.td, fontFamily: MONO, fontWeight: 600 }}>{r.netSold}</td>
                        <td style={{ ...s.td, fontFamily: MONO }}>{r.totalUnits}</td>
                        <td style={{ ...s.td, fontFamily: MONO, color: stColor, fontWeight: 700 }}>{r.sellThrough}%</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Section>

        {/* LTV Intelligence — computed from sample data */}
        {ltv && ltv.sampleSize > 0 && (
          <Section title="Illustrative Buy-Intent Value" desc={`SAMPLE PREVIEW — ${ltv.scopeLabel} · ${ltv.totalCustomersWithPurchase} customers · ${ltv.evidenceMaturity ?? ""}`} status="sample">
            <div style={{ padding: "8px 14px", background: "rgba(107,72,0,0.05)", border: "1px solid rgba(107,72,0,0.15)", fontSize: 11, fontFamily: INTER, color: "#6b4800", marginBottom: 16, lineHeight: 1.6 }}>
              <strong>Synthetic demonstration derived from buy-intent events.</strong> This is not revenue and does not represent completed Shopify orders. Live revenue metrics remain Awaiting Integration until Shopify commerce is connected.
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px,1fr))", gap: 1, background: "rgba(34,21,22,0.07)", marginBottom: 24 }}>
              {[
                { label: "Avg Buy-Intent Value / Customer", value: fmtAed(ltv.avgLtv), color: "#8b2035" },
                { label: "Top Customer Buy-Intent Value", value: fmtAed(ltv.topCustomerLtv), color: "#221516" },
                { label: "Avg Buy-Intent Order Value", value: fmtAed(ltv.avgOrderValue), color: "#221516" },
                { label: "Avg Illustrative Gross Profit / Customer", value: fmtAed(ltv.avgGrossProfit), color: "#2a5e42" },
                { label: "Repeat Buy-Intent Rate", value: `${ltv.repeatPurchaseRate}%`, color: "#2a5e42" },
                { label: "Buy-Intent Frequency", value: `${ltv.purchaseFrequency}× avg`, color: "#221516" },
                { label: "Avg Days Between Buy-Intent Events", value: ltv.avgDaysBetweenPurchases != null ? `${ltv.avgDaysBetweenPurchases}d` : "—", color: "#221516" },
                { label: "Observed Customer Engagement Duration", value: ltv.observedCustomerLifetimeDays != null ? `${ltv.observedCustomerLifetimeDays}d median` : "—", color: "#221516" },
                { label: "Customers with Buy-Intent", value: ltv.totalCustomersWithPurchase, color: "#221516" },
              ].map(({ label, value, color }) => (
                <div key={label} style={{ padding: "18px 20px", background: "#fff" }}>
                  <CLabel>{label}</CLabel>
                  <CValue color={color}>{value}</CValue>
                </div>
              ))}
            </div>
            {ltv.ltvByPersonality?.length > 0 && (
              <>
                <div style={{ fontFamily: INTER, fontSize: 8, textTransform: "uppercase", letterSpacing: "2px", color: "#7a6f6a", marginBottom: 12, fontWeight: 600 }}>Illustrative Buy-Intent Value by Personality</div>
                <div style={{ overflowX: "auto" }}>
                  <table style={s.table}>
                    <thead><tr>
                      <th style={s.th}>Personality</th>
                      <th style={s.th}>Customers</th>
                      <th style={s.th}>Purchases</th>
                      <th style={s.th}>Avg Revenue (AED)</th>
                      <th style={s.th}>Total Revenue (AED)</th>
                    </tr></thead>
                    <tbody>
                      {ltv.ltvByPersonality.map((r, i) => (
                        <tr key={i} style={{ background: i % 2 === 0 ? "rgba(255,255,255,0.6)" : "transparent" }}>
                          <td style={{ ...s.td, color: "#8b2035", fontStyle: "italic", fontFamily: SERIF }}>{r.personality}</td>
                          <td style={{ ...s.td, fontFamily: MONO }}>{r.customerCount}</td>
                          <td style={{ ...s.td, fontFamily: MONO }}>{r.purchases}</td>
                          <td style={{ ...s.td, fontFamily: MONO, fontWeight: 700 }}>{r.avgLtv.toLocaleString()}</td>
                          <td style={{ ...s.td, fontFamily: MONO }}>{r.totalRevenue.toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
            {ltv.ltvBySegment?.length > 0 && (
              <>
                <div style={{ fontFamily: INTER, fontSize: 8, textTransform: "uppercase", letterSpacing: "2px", color: "#7a6f6a", marginBottom: 12, marginTop: 20, fontWeight: 600 }}>Revenue by Occasion Segment</div>
                <div style={{ overflowX: "auto" }}>
                  <table style={s.table}>
                    <thead><tr>
                      <th style={s.th}>Segment</th>
                      <th style={s.th}>Customers</th>
                      <th style={s.th}>Purchases</th>
                      <th style={s.th}>Avg Revenue (AED)</th>
                      <th style={s.th}>Total Revenue (AED)</th>
                    </tr></thead>
                    <tbody>
                      {ltv.ltvBySegment.map((r, i) => (
                        <tr key={i} style={{ background: i % 2 === 0 ? "rgba(255,255,255,0.6)" : "transparent" }}>
                          <td style={{ ...s.td, fontFamily: SERIF, fontStyle: "italic" }}>{r.segment}</td>
                          <td style={{ ...s.td, fontFamily: MONO }}>{r.customerCount}</td>
                          <td style={{ ...s.td, fontFamily: MONO }}>{r.purchases}</td>
                          <td style={{ ...s.td, fontFamily: MONO, fontWeight: 700, color: "#8b2035" }}>{(r.avgLtv ?? 0).toLocaleString()}</td>
                          <td style={{ ...s.td, fontFamily: MONO }}>{(r.totalRevenue ?? 0).toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
            {ltv.repeatProducts?.length > 0 && (
              <>
                <div style={{ fontFamily: INTER, fontSize: 8, textTransform: "uppercase", letterSpacing: "2px", color: "#7a6f6a", marginBottom: 10, marginTop: 20, fontWeight: 600 }}>Products Driving Repeat Customers</div>
                {ltv.repeatProducts.map((r, i) => (
                  <Row key={i} label={r.product} value={`${r.repeatCustomers} repeat customer${r.repeatCustomers !== 1 ? "s" : ""}`} mono />
                ))}
              </>
            )}
          </Section>
        )}

      </>
    );
  }

  // ── LIVE MODE (no commercial data yet) ────────────────────────────────────────
  return (
    <>
      <AwaitingCard
        label="Styling-to-Shopping Conversion"
        description="Click-through, try-on and wishlist events require product click tracking from Shopify storefront. Available after commerce integration."
      />

      <AwaitingCard
        label="Illustrative Buy-Intent Segments (Live Revenue Awaiting Integration)"
        description="Live revenue segmentation requires Shopify order history and customer purchase data. When integrated, will show: average revenue by personality type, repeat purchase patterns, and which products drive highest-value customers."
      />
    </>
  );
}



// ══════════════════════════════════════════════════════════════════════════════
// TAB 5 — COLLECTION & OPPORTUNITIES (merged)
// Combines Collection Intelligence + Design Opportunities into one tab
// ══════════════════════════════════════════════════════════════════════════════

// Canonical action taxonomy: Scale / Fix / Test / Build
// Scale = increase what works · Fix = resolve a problem · Test = validate a hypothesis · Build = create missing capability
const TAXONOMY_COLORS = { Scale: "#2a5e42", Fix: "#8b2035", Test: "#6b4800", Build: "#5c5350" };
// Legacy aliases — preserve backward compat with any live-data taxonomy values
const TAXONOMY_ALIAS = {
  Expand: "Scale", Resolve: "Fix", Target: "Test", Adapt: "Fix", Unlock: "Build",
};

function normalizeActionType(raw) {
  if (!raw) return "Test";
  if (TAXONOMY_COLORS[raw]) return raw;
  return TAXONOMY_ALIAS[raw] ?? "Test";
}

function oppTaxonomy(type) {
  if (!type) return "Build";
  const t = type.toLowerCase();
  if (t.includes("opportunity") || t.includes("retention") || t.includes("momentum")) return "Scale";
  if (t.includes("friction") || t.includes("objection") || t.includes("gap") || t.includes("fit-signal")) return "Fix";
  if (t.includes("audience") || t.includes("segment") || t.includes("product-opportunity")) return "Test";
  return "Build";
}

function ActionCard({ item }) {
  const taxKey = normalizeActionType(item.taxonomy);
  const taxColor = TAXONOMY_COLORS[taxKey] ?? "#9CA3AF";
  const confBg = item.confidence === "high" ? "#221516" : item.confidence === "medium" ? "#8B7355" : "#9CA3AF";
  return (
    <div style={{ ...s.card, marginBottom: 14, borderLeft: `4px solid ${taxColor}` }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: 8, fontFamily: INTER, fontWeight: 700, textTransform: "uppercase", letterSpacing: "1.5px", padding: "3px 10px", background: taxColor, color: "#fff" }}>{taxKey}</span>
          <span style={{ fontSize: 8, fontFamily: INTER, fontWeight: 600, textTransform: "uppercase", letterSpacing: "1.5px", padding: "3px 8px", background: confBg, color: "#fff" }}>{item.confidence}</span>
          {item.relevance && <span style={{ fontSize: 8, fontFamily: INTER, fontWeight: 600, textTransform: "uppercase", letterSpacing: "1.5px", padding: "3px 8px", background: "rgba(34,21,22,0.06)", color: "#5c5350" }}>{item.relevance} relevance</span>}
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

function TabCollectionOpportunities({ data, kpis, phase4b2, advanced, rel, sampleMode, dateRangeDays, roleLens, liveSignals }) {
  return (
    <>
      {/* ── COLLECTION DIRECTION ───────────────────────────────────── */}
      <TabCollection data={data} kpis={kpis} advanced={advanced} rel={rel} sampleMode={sampleMode} dateRangeDays={dateRangeDays} liveSignals={liveSignals} />
      {/* ── DESIGN & MERCHANDISING ACTION PLAN ─────────────────────── */}
      <TabOpportunitiesContent data={data} phase4b2={phase4b2} advanced={advanced} rel={rel} dateRangeDays={dateRangeDays} roleLens={roleLens} />
    </>
  );
}

function TabOpportunitiesContent({ data, phase4b2, advanced, rel, dateRangeDays, roleLens }) {
  const sortOrder = { high: 0, medium: 1, low: 2 };
  const actionItems = [];

  (advanced?.opportunityFeed ?? [])
    .filter(opp => !opp.id?.includes("ltv") && !opp.insight?.includes("LTV") && !opp.suggestedAction?.includes("LTV"))
    .forEach((opp, i) => {
      actionItems.push({
        id: `opp-${i}`,
        taxonomy: oppTaxonomy(opp.type),
        headline: opp.insight,
        detail: opp.customerNeed,
        designImplication: opp.designImplication ?? opp.customerNeed,
        merchandisingImplication: opp.suggestedAction,
        action: opp.suggestedAction,
        evidence: opp.evidence,
        period: opp.timePeriod,
        confidence: opp.confidence ?? "medium",
        relevance: opp.estimatedCommercialRelevance,
        dependency: opp.dependency ?? null,
        sampleSizeHint: opp.sampleSize ?? 1,
        source: "opportunity-feed",
      });
    });

  (data?.designActions ?? []).forEach((action, i) => {
    actionItems.push({
      id: `da-${i}`,
      taxonomy: normalizeActionType(action.actionType),
      decisionStatus: action.decisionStatus ?? "New",
      headline: action.product ?? action.productTitle ?? action.piece ?? "Design Action",
      detail: action.interpretation ?? action.recommendation ?? action.liked,
      designImplication: action.interpretation ?? action.recommendation,
      merchandisingImplication: action.recommendedTest ?? action.nextStep,
      action: action.recommendedTest ?? action.nextStep ?? action.recommendation,
      evidence: action.observedEvidence ?? action.performance ?? action.evidence,
      period: action.period ?? null,
      confidence: action.confidence ?? "medium",
      relevance: action.impact ?? "medium",
      expectedOutcome: action.successMetric,
      dependency: action.dependency ?? null,
      sampleSizeHint: action.sampleSize ?? 1,
      source: "design-actions",
    });
  });

  (rel?.productNarratives ?? []).filter(p => p.sampleSize >= 3).forEach((p, i) => {
    const taxonomy = p.opportunityScore >= 60 ? "Scale" : p.mostCommonObjection ? "Fix" : "Test";
    actionItems.push({
      id: `ri-${i}`,
      taxonomy,
      headline: p.name,
      detail: [p.bestPersonality && `Best: ${p.bestPersonality}`, p.bestOccasion && `for ${p.bestOccasion}`, p.mostCommonObjection && `Objection: ${p.mostCommonObjection}`].filter(Boolean).join(" · "),
      designImplication: p.designImplication,
      merchandisingImplication: p.recommendedAction,
      action: p.recommendation,
      evidence: [`n=${p.sampleSize}`, p.avgRating != null && `★${p.avgRating.toFixed(1)}`, p.rewearRate != null && `${Math.round(p.rewearRate * 100)}% rewear`].filter(Boolean).join(" · "),
      period: null,
      confidence: p.sampleSize >= 5 ? "high" : "medium",
      relevance: p.opportunityScore >= 60 ? "high" : p.opportunityScore >= 40 ? "medium" : "low",
      expectedOutcome: p.recommendationReason,
      dependency: null,
      sampleSizeHint: p.sampleSize,
      source: "product-intelligence",
    });
  });

  // Feedback-system insights (distinct from product-performance design actions above)
  (phase4b2?.designerInsights ?? []).forEach((insight, i) => {
    actionItems.push({
      id: `di-${i}`,
      taxonomy: insight.threshold === "strong" ? "Fix" : "Test",
      headline: insight.signal,
      detail: insight.category,
      designImplication: insight.suggestion,
      merchandisingImplication: insight.suggestion,
      action: insight.suggestion,
      evidence: `Feedback signal · ${insight.category}`,
      period: null,
      confidence: insight.threshold === "strong" ? "high" : insight.threshold === "moderate" ? "medium" : "low",
      relevance: insight.threshold === "strong" ? "high" : insight.threshold === "moderate" ? "medium" : "low",
      expectedOutcome: null,
      dependency: null,
      sampleSizeHint: 1,
      source: "feedback-insights",
    });
  });

  actionItems.sort((a, b) => (sortOrder[a.relevance] ?? 2) - (sortOrder[b.relevance] ?? 2) || (sortOrder[a.confidence] ?? 2) - (sortOrder[b.confidence] ?? 2));

  return (
    <>
      <CombinedPriorityBoard actionItems={actionItems} />
      <div style={{ padding: "12px 20px", background: "rgba(34,21,22,0.02)", border: "1px solid rgba(34,21,22,0.07)", fontSize: 12, color: "#7a6f6a", fontFamily: SERIF, fontStyle: "italic" }}>
        Experiment Builder and AI Learning Roadmap are in <strong style={{ fontStyle: "normal" }}>Data &amp; AI</strong> — click the button in the header.
      </div>
    </>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// FOUNDER–DESIGNER PRIORITY BOARD
// Every priority with design implication, commercial/positioning implication,
// what to test next, success metric, evidence maturity, and decision status.
// Role ownership fields are preserved in the data model for future B2B use.
// ══════════════════════════════════════════════════════════════════════════════

// Preserved for future B2B multi-role use; not displayed in the current interface.
function inferOwnership(item) {
  const t = normalizeActionType(item.taxonomy);
  if (t === "Fix")   return { primary: "Design Lead", supporting: "Merchandising" };
  if (t === "Test")  return { primary: "Merchandising", supporting: "Design Lead" };
  if (t === "Scale") return { primary: "Combined", supporting: null };
  return                    { primary: "Design Lead", supporting: "Merchandising" };
}

function CombinedPriorityCard({ item }) {
  const [open, setOpen] = useState(false);
  const owners = inferOwnership(item);
  const taxKey = normalizeActionType(item.taxonomy);
  const taxColor = TAXONOMY_COLORS[taxKey] ?? "#9CA3AF";
  const confBg = item.confidence === "high" ? "#221516" : item.confidence === "medium" ? "#8B7355" : "#9CA3AF";
  const confData = sampleConfidence(item.sampleSizeHint ?? 1);

  // Design implication: from productNarratives items or fallback to detail/action
  const designImpl = item.designImplication ?? item.detail;
  // Merch implication: from productNarratives items or fallback to action
  const merchImpl  = item.merchandisingImplication ?? item.action;

  return (
    <div style={{ border: "1px solid rgba(34,21,22,0.09)", background: "#fff", marginBottom: 12 }}>
      {/* Compact header */}
      <div style={{ padding: "14px 18px", borderLeft: `4px solid ${taxColor}` }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ fontSize: 7, fontFamily: INTER, fontWeight: 700, textTransform: "uppercase", letterSpacing: "1.5px", padding: "2px 8px", background: taxColor, color: "#fff" }}>{taxKey}</span>
            <span style={{ fontSize: 7, fontFamily: INTER, fontWeight: 600, textTransform: "uppercase", letterSpacing: "1px", padding: "2px 6px", background: confBg, color: "#fff" }}>{item.confidence}</span>
            <span style={{ fontSize: 7, fontFamily: INTER, fontWeight: 600, textTransform: "uppercase", letterSpacing: "1px", padding: "2px 6px", background: confData.color, color: "#fff" }}>{confData.label}</span>
          </div>
          <span style={{ fontSize: 8, fontFamily: MONO, color: "#9CA3AF" }}>Status: New</span>
        </div>
        <div style={{ fontFamily: SERIF, fontSize: 16, fontWeight: 600, color: "#221516", marginBottom: 4, lineHeight: 1.4 }}>{item.headline}</div>
        {item.evidence && (
          <div style={{ fontFamily: MONO, fontSize: 10, color: "#9CA3AF" }}>
            Evidence: {item.evidence}{item.period ? ` · ${item.period}` : ""}
          </div>
        )}
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          style={{ ...s.linkBtn, marginTop: 8, fontSize: 8 }}
        >
          {open ? "Hide evidence and recommended action ↑" : "View complete decision ↓"}
        </button>
      </div>

      {/* Expanded joined conclusions */}
      {open && (
        <div style={{ borderTop: "1px solid rgba(34,21,22,0.07)", padding: "16px 18px", background: "#fafaf8" }}>
          {/* Design + Commercial/Positioning implications */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
            <div style={{ padding: "12px 14px", background: "rgba(42,94,66,0.04)", borderLeft: "3px solid #2a5e42" }}>
              <div style={{ fontFamily: INTER, fontSize: 8, fontWeight: 600, textTransform: "uppercase", letterSpacing: "1.5px", color: "#2a5e42", marginBottom: 6 }}>Design Implication</div>
              <div style={{ fontFamily: SERIF, fontSize: 13, color: "#221516", lineHeight: 1.5 }}>{designImpl ?? "—"}</div>
            </div>
            <div style={{ padding: "12px 14px", background: "rgba(107,72,0,0.04)", borderLeft: "3px solid #6b4800" }}>
              <div style={{ fontFamily: INTER, fontSize: 8, fontWeight: 600, textTransform: "uppercase", letterSpacing: "1.5px", color: "#6b4800", marginBottom: 6 }}>Commercial / Positioning Implication</div>
              <div style={{ fontFamily: SERIF, fontSize: 13, color: "#221516", lineHeight: 1.5 }}>{merchImpl ?? "—"}</div>
            </div>
          </div>

          {/* Decision status + dependency + maturity */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10, marginBottom: 14 }}>
            <div>
              <div style={{ fontFamily: INTER, fontSize: 7, fontWeight: 600, textTransform: "uppercase", letterSpacing: "1.5px", color: "#7a6f6a", marginBottom: 3 }}>Decision Status</div>
              <div style={{ fontFamily: INTER, fontSize: 11, fontWeight: 600, color: "#221516" }}>{item.decisionStatus ?? "New"}</div>
            </div>
            <div>
              <div style={{ fontFamily: INTER, fontSize: 7, fontWeight: 600, textTransform: "uppercase", letterSpacing: "1.5px", color: "#7a6f6a", marginBottom: 3 }}>Dependency</div>
              <div style={{ fontFamily: SERIF, fontSize: 11, color: "#9CA3AF", fontStyle: "italic" }}>{item.dependency ?? "None"}</div>
            </div>
            <div>
              <div style={{ fontFamily: INTER, fontSize: 7, fontWeight: 600, textTransform: "uppercase", letterSpacing: "1.5px", color: "#7a6f6a", marginBottom: 3 }}>Evidence Maturity</div>
              <div style={{ fontFamily: MONO, fontSize: 10, color: confData.color }}>{confData.label}</div>
            </div>
          </div>

          {/* Test + metric row */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div style={{ padding: "10px 12px", background: "rgba(34,21,22,0.02)", border: "1px solid rgba(34,21,22,0.06)" }}>
              <div style={{ fontFamily: INTER, fontSize: 7, fontWeight: 600, textTransform: "uppercase", letterSpacing: "1.5px", color: "#7a6f6a", marginBottom: 4 }}>What to Test Next</div>
              <div style={{ fontFamily: SERIF, fontSize: 12, color: "#221516", lineHeight: 1.5 }}>{item.action ?? "—"}</div>
            </div>
            <div style={{ padding: "10px 12px", background: "rgba(34,21,22,0.02)", border: "1px solid rgba(34,21,22,0.06)" }}>
              <div style={{ fontFamily: INTER, fontSize: 7, fontWeight: 600, textTransform: "uppercase", letterSpacing: "1.5px", color: "#7a6f6a", marginBottom: 4 }}>Success Metric</div>
              <div style={{ fontFamily: SERIF, fontSize: 12, color: "#221516", lineHeight: 1.5 }}>{item.expectedOutcome ?? "—"}</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function CombinedPriorityBoard({ actionItems }) {
  const sorted = actionItems.slice().sort((a, b) => {
    const confRank = { high: 0, medium: 1, low: 2 };
    const relRank  = { high: 0, medium: 1, low: 2 };
    return (relRank[a.relevance] ?? 2) - (relRank[b.relevance] ?? 2)
        || (confRank[a.confidence] ?? 2) - (confRank[b.confidence] ?? 2);
  });

  return (
    <Section
      title="Founder–Designer Action Plan"
      desc="One card per actionable issue. Ranked by evidence strength. Click 'View complete decision' to see design implication, commercial implication, recommended test, and success metric."
      status={sorted.length > 0 ? "live" : "insufficient-data"}
    >
      {/* Legend */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 20 }}>
        {Object.entries(TAXONOMY_COLORS).map(([label, color]) => (
          <span key={label} style={{ fontSize: 7, fontFamily: INTER, fontWeight: 700, textTransform: "uppercase", letterSpacing: "1.5px", padding: "3px 8px", background: color, color: "#fff" }}>{label}</span>
        ))}
        <span style={{ fontFamily: SERIF, fontSize: 11, color: "#7a6f6a", fontStyle: "italic", alignSelf: "center" }}>
          Scale → increase what works · Fix → resolve a problem · Test → validate a hypothesis · Build → create missing capability
        </span>
      </div>

      {sorted.length > 0 ? (
        sorted.map(item => <CombinedPriorityCard key={item.id} item={item} />)
      ) : (
        <EmptyState message="No actionable priorities yet. Priorities appear when patterns cross minimum data thresholds." />
      )}
    </Section>
  );
}

// ── Data & AI slide-over panel components ────────────────────────────────────

function DataAiDefinitions() {
  const INTER_L = "'Inter', -apple-system, sans-serif";
  const SERIF_L = "'Cormorant Garamond', Garamond, serif";
  const MONO_L  = "'Courier New', Courier, monospace";
  const DEFS = [
    {
      term: "Rating",
      def: "Average score (1–5) from outfit reviews and post-wear reviews. Excludes sessions with no review.",
      reconciliation: "Numerator: sum of review scores. Denominator: count of sessions with at least one review. Display shows 0–1 decimal. Shown as — when denominator = 0.",
    },
    {
      term: "Rewear rate",
      def: "% of post-wear reviews where the customer said they would wear the look again.",
      reconciliation: "Numerator: sessions with didWearAgain = true. Denominator: sessions with a completed post-wear review. Shown as — when denominator = 0. Never shown as 0% when no post-wear data exists.",
    },
    {
      term: "Emotional achievement",
      def: "Classified from desiredFeeling vs actualAfterFeeling. Achieved = exact match. Partly = same emotional family. Not achieved = different family or no response.",
      reconciliation: "Three mutually exclusive buckets. Denominator: sessions with both desiredFeeling and actualAfterFeeling recorded. Shown as — when denominator = 0.",
    },
    {
      term: "Recommendation response",
      def: "Immediate Love it / Okay / Not for me tap on a recommendation card — separate from post-outfit reviews.",
      reconciliation: "Numerator: RecommendationFeedback events in period. Denominator: total StyleMe sessions in period. Response rate = sessions with ≥1 response ÷ total sessions.",
    },
    {
      term: "Explanation agreement",
      def: "% of recommendation responses that were 'Love it'. Requires explanation logging on the RecommendationFeedback record.",
      reconciliation: "Numerator: feedback records where sentiment = 'love'. Denominator: all feedback records with explanation logged. Shown as — when denominator = 0.",
    },
    {
      term: "Product coverage",
      def: "Whether at least one product exists that has been recommended to a personality group in the period.",
      reconciliation: "Denominator: distinct personality groups active in period. Coverage = groups with ≥1 product recommended ÷ total groups. Not a rate metric — binary per group.",
    },
    {
      term: "Outcome quality",
      def: "Whether that group achieved their desired feeling: avgRating ≥ 4 AND rewearRate ≥ 60%.",
      reconciliation: "Derived from per-group DNA matrix. Requires ≥2 post-wear sessions per group. Groups with n < 2 shown as Insufficient Data, not as 0% or false.",
    },
    {
      term: "Directional Opportunity Score",
      def: "Partial score built from available signals only: rating (30%) + rewear rate (25%) + confidence lift (25%) + data quality (20%). Excludes conversion and LTV until Shopify is integrated.",
      reconciliation: "Each factor normalised 0–100 before weighting. Data quality = min(sampleSize / 10, 1). Score is always labelled 'directional' — it is not a commercial confidence score.",
    },
    {
      term: "Selected period vs All Time",
      def: "Period selector (7d / 30d / 90d / All) filters styling sessions and reviews. Passport profiles, registered users, and completed passports are always All Time.",
      reconciliation: "Period applies to: sessions, reviews, feedback, post-wear, recommendation responses. Does NOT apply to: customer profiles, registered users, Passport completions.",
    },
    {
      term: "Pending integrations",
      def: "Shopify commerce, wishlist/save, FASHN.ai VTO performance, and LTV are not integrated. Sections requiring these show Awaiting Integration.",
      reconciliation: "Awaiting Integration means the metric formula is defined but the source data feed is not connected. It does NOT mean zero — absence of data is different from a measurement of zero.",
    },
  ];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <p style={{ fontFamily: SERIF_L, fontSize: 14, color: "#7a6f6a", fontStyle: "italic", margin: 0 }}>
        Transparent definitions for every metric in this dashboard.
      </p>
      {DEFS.map((item, i) => (
        <div key={i} style={{ paddingBottom: 14, borderBottom: i < DEFS.length - 1 ? "1px solid rgba(34,21,22,0.05)" : "none" }}>
          <div style={{ display: "grid", gridTemplateColumns: "clamp(160px, 32%, 200px) 1fr", gap: 16, marginBottom: item.reconciliation ? 6 : 0 }}>
            <div style={{ fontFamily: INTER_L, fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "1.5px", color: "#221516" }}>{item.term}</div>
            <div style={{ fontFamily: SERIF_L, fontSize: 13, color: "#7a6f6a", lineHeight: 1.6 }}>{item.def}</div>
          </div>
          {item.reconciliation && (
            <div style={{ display: "grid", gridTemplateColumns: "clamp(160px, 32%, 200px) 1fr", gap: 16 }}>
              <div style={{ fontFamily: INTER_L, fontSize: 8, fontWeight: 600, textTransform: "uppercase", letterSpacing: "1.5px", color: "#9CA3AF" }}>Reconciliation</div>
              <div style={{ fontFamily: MONO_L, fontSize: 10, color: "#9CA3AF", lineHeight: 1.6 }}>{item.reconciliation}</div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function DataAiConfidenceLadder() {
  const INTER_L = "'Inter', -apple-system, sans-serif";
  const SERIF_L = "'Cormorant Garamond', Garamond, serif";
  const LEVELS = [
    { n: "n = 0",     label: "Not measured",        desc: "No events recorded for this metric in the selected period. Do not show 0% — use '—' or 'Not measured'.",    color: "#9CA3AF" },
    { n: "n = 1",     label: "Single observation",  desc: "One data point. Directional only — do not act. Use to notice and monitor.",                                   color: "#6b4800" },
    { n: "n = 2–4",   label: "Directional signal",  desc: "A pattern is forming but not yet reliable. Use to inform content and exploration, not production decisions.", color: "#6b4800" },
    { n: "n = 5–9",   label: "Emerging pattern",    desc: "Enough data to generate a hypothesis worth testing. Suitable for low-risk experiments.",                      color: "#5c5350" },
    { n: "n = 10–19", label: "Established pattern", desc: "Reliable pattern for design and merchandising decisions. Suitable for direct testing with clear success metric.", color: "#2a5e42" },
    { n: "n ≥ 20",    label: "Strong pattern",      desc: "High confidence. Suitable for collection-level commitments.",                                                  color: "#2a5e42" },
  ];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <p style={{ fontFamily: SERIF_L, fontSize: 14, color: "#7a6f6a", fontStyle: "italic", margin: 0 }}>
        Six-tier evidence ladder used across all dashboard metrics. Every confidence badge maps to a tier below.
      </p>
      {LEVELS.map((l, i) => (
        <div key={i} style={{ display: "flex", gap: 14, alignItems: "flex-start", padding: "10px 12px", borderLeft: `3px solid ${l.color}`, background: "rgba(255,255,255,0.6)" }}>
          <div style={{ minWidth: 70, fontFamily: INTER_L, fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "1.5px", color: "#9CA3AF", paddingTop: 2 }}>{l.n}</div>
          <div>
            <div style={{ fontFamily: INTER_L, fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "1.5px", color: l.color, marginBottom: 4 }}>{l.label}</div>
            <div style={{ fontFamily: SERIF_L, fontSize: 13, color: "#5c5350", lineHeight: 1.5 }}>{l.desc}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function DataAiIntegrationReadiness() {
  const INTER_L = "'Inter', -apple-system, sans-serif";
  const SERIF_L = "'Cormorant Garamond', Garamond, serif";
  const MONO_L  = "'Courier New', Courier, monospace";
  const ITEMS = [
    {
      label: "Styling Sessions", status: "live",
      source: "PostOutfitReview, StyleSession tables",
      desc: "StyleMe sessions, recommendations, and post-outfit reviews are live.",
      metricsUnlocked: "Response rate, recommendation distribution, objection signals, session counts",
      blocker: null, nextAction: null,
    },
    {
      label: "Post-Wear Reviews", status: "live",
      source: "PostWearReview table",
      desc: "Post-wear feedback, desired feeling achievement, and rewear signal are live.",
      metricsUnlocked: "Rewear rate, emotional achievement, confidence lift, post-wear positive rate",
      blocker: null, nextAction: null,
    },
    {
      label: "Closet Uploads", status: "live",
      source: "ClosetItem table + Cloudinary",
      desc: "Closet item uploads and try-on readiness assessment are live.",
      metricsUnlocked: "Try-on readiness, closet composition, pending assessment counts",
      blocker: null, nextAction: null,
    },
    {
      label: "Selfie Analysis", status: "live",
      source: "NaiaModel table + Cloudinary",
      desc: "Selfie-based body and style signal extraction is live.",
      metricsUnlocked: "Selfie adoption rate, model coverage per customer",
      blocker: null, nextAction: null,
    },
    {
      label: "Shopify Order & Revenue", status: "awaiting-integration",
      source: "Shopify order_placed webhook (not connected)",
      desc: "Purchase attribution, revenue per session, and LTV require Shopify order webhook and line-item matching.",
      blocker: "Shopify webhook not yet registered. Requires order_placed + order_line_items scope.",
      nextAction: "Register order_placed webhook in Shopify Partners dashboard and map to session attribution window.",
      metricsUnlocked: "nAia-assisted revenue, % sales influenced, AOV comparison, revenue per session, conversion rate",
    },
    {
      label: "Save / Wishlist Events", status: "awaiting-integration",
      source: "SavedLook.shopifyProductId (schema exists, mapping incomplete)",
      desc: "Save-to-purchase attribution requires shopifyProductId populated on SavedLook records.",
      blocker: "SavedLook.shopifyProductId is null on most records — not populated at save time.",
      nextAction: "Populate shopifyProductId when customer saves a look from Storefront.",
      metricsUnlocked: "Most-saved products, save-to-purchase conversion rate, high-save / zero-purchase signals",
    },
    {
      label: "FASHN.ai VTO Metrics", status: "awaiting-integration",
      source: "FASHN.ai performance API (not yet polled)",
      desc: "Try-on session count, completion rate, and fidelity score require FASHN.ai performance data integration.",
      blocker: "FASHN.ai performance endpoint not yet wired into designer-dashboard loader.",
      nextAction: "Add FASHN.ai job result aggregation to api/designer-dashboard loader.",
      metricsUnlocked: "VTO session volume, completion rate, fidelity score by product, revenue per VTO session",
    },
    {
      label: "Cart & Checkout Events", status: "awaiting-integration",
      source: "Shopify cart_updated + checkout_completed webhooks (not connected)",
      desc: "Journey mapping (Passport → StyleMe → Cart → Purchase) requires cart and checkout Shopify webhooks.",
      blocker: "Cart and checkout webhooks not registered.",
      nextAction: "Register webhooks and store journey events with session_id attribution.",
      metricsUnlocked: "Cart abandonment rate, time-to-purchase, same-session vs 7-day attribution, full funnel mapping",
    },
    {
      label: "Explanation Logging", status: "awaiting-integration",
      source: "RecommendationFeedback.explanationAgreed (field missing)",
      desc: "Explanation agreement rate requires logging explanationAgreed and explanationVersion on each feedback record.",
      blocker: "Schema field not yet added to RecommendationFeedback.",
      nextAction: "Add explanationAgreed (boolean) and explanationVersion (string) to feedback records.",
      metricsUnlocked: "Explanation agreement rate, reasons that resonate, reasons rejected, agreement by personality",
    },
    {
      label: "Illustrative Buy-Intent Segments (Live Revenue Awaiting Integration)", status: "awaiting-integration",
      source: "Derived from Shopify order data (blocked on order webhook)",
      desc: "Live revenue segmentation by personality, repeat purchase rate, and avg days between purchases require Shopify order data.",
      blocker: "Depends on Shopify Order & Revenue integration above.",
      nextAction: "Complete Shopify order integration first.",
      metricsUnlocked: "Revenue by personality, revenue by desired feeling, repeat purchase patterns, products driving repeat",
    },
  ];
  const statusStyle = (st) => st === "live" ? { color: "#2a5e42", bg: "rgba(42,94,66,0.08)" } : { color: "#5c5350", bg: "rgba(122,111,106,0.08)" };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <p style={{ fontFamily: SERIF_L, fontSize: 14, color: "#7a6f6a", fontStyle: "italic", margin: "0 0 8px" }}>
        Current integration status for all data sources.
      </p>
      {ITEMS.map((item, i) => {
        const ss = statusStyle(item.status);
        return (
          <div key={i} style={{ padding: "12px 14px", background: "rgba(255,255,255,0.6)", border: "1px solid rgba(34,21,22,0.07)", marginBottom: 6 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 6 }}>
              <div style={{ fontFamily: INTER_L, fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "1.5px", color: "#221516" }}>{item.label}</div>
              <span style={{ fontSize: 7, fontFamily: INTER_L, fontWeight: 700, textTransform: "uppercase", letterSpacing: "2px", padding: "3px 8px", background: ss.bg, color: ss.color, whiteSpace: "nowrap", flexShrink: 0 }}>
                {item.status === "live" ? "Live" : "Awaiting Integration"}
              </span>
            </div>
            <div style={{ fontFamily: SERIF_L, fontSize: 12, color: "#5c5350", lineHeight: 1.5, marginBottom: 6 }}>{item.desc}</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 16px", fontSize: 10, fontFamily: MONO_L, color: "#9CA3AF" }}>
              {item.source && (
                <div><span style={{ fontFamily: INTER_L, fontWeight: 600, textTransform: "uppercase", letterSpacing: "1px", fontSize: 7, color: "#7a6f6a" }}>Source: </span>{item.source}</div>
              )}
              {item.metricsUnlocked && (
                <div><span style={{ fontFamily: INTER_L, fontWeight: 600, textTransform: "uppercase", letterSpacing: "1px", fontSize: 7, color: "#7a6f6a" }}>Unlocks: </span>{item.metricsUnlocked}</div>
              )}
              {item.blocker && (
                <div style={{ gridColumn: "1 / -1", color: "#d97706" }}><span style={{ fontFamily: INTER_L, fontWeight: 600, textTransform: "uppercase", letterSpacing: "1px", fontSize: 7, color: "#d97706" }}>Blocker: </span>{item.blocker}</div>
              )}
              {item.nextAction && (
                <div style={{ gridColumn: "1 / -1", color: "#2a5e42" }}><span style={{ fontFamily: INTER_L, fontWeight: 600, textTransform: "uppercase", letterSpacing: "1px", fontSize: 7, color: "#2a5e42" }}>Next action: </span>{item.nextAction}</div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function DataAiLearningRoadmap({ advanced, sampleMode }) {
  const SERIF_L = "'Cormorant Garamond', Garamond, serif";
  const INTER_L = "'Inter', -apple-system, sans-serif";
  const MONO_L  = "'Courier New', Courier, monospace";

  const al = advanced?.aiLearning;

  if (sampleMode && al) {
    const LLabel = ({ children }) => (
      <div style={{ fontFamily: INTER_L, fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "1.5px", color: "#5c5350", marginBottom: 6 }}>{children}</div>
    );
    const Row = ({ label, value }) => (
      <div style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", borderBottom: "1px solid rgba(34,21,22,0.05)" }}>
        <span style={{ fontFamily: SERIF_L, fontSize: 12, color: "#5c5350" }}>{label}</span>
        <span style={{ fontFamily: MONO_L, fontSize: 12, color: "#221516", fontWeight: 600 }}>{value}</span>
      </div>
    );
    const MetricCard = ({ label, value, subValue, accent, children }) => (
      <div style={{ padding: "16px 18px", background: "rgba(255,255,255,0.7)", borderLeft: `3px solid ${accent ?? "#8b2035"}`, marginBottom: 10 }}>
        <LLabel>{label}</LLabel>
        <div style={{ fontFamily: "'Playfair Display', serif", fontSize: 28, fontWeight: 700, color: accent ?? "#8b2035", marginBottom: 2 }}>{value}</div>
        {subValue && <div style={{ fontFamily: SERIF_L, fontSize: 12, color: "#7a6f6a", marginBottom: 10 }}>{subValue}</div>}
        {children}
      </div>
    );

    const trendLabel = (t) => t === "improving" ? "↑ improving" : t === "declining" ? "↓ declining" : "→ stable";

    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
        <p style={{ fontFamily: SERIF_L, fontSize: 13, color: "#7a6f6a", fontStyle: "italic", margin: "0 0 16px" }}>
          Model v{al.modelVersion} · {al.totalEvaluated} evaluated events · {al.evaluationPeriod}
        </p>

        {/* Love Response Rate (was: Recommendation Precision) */}
        <MetricCard label="Love Response Rate" value={al.precision.value != null ? `${al.precision.value}%` : "—"} subValue={al.precision.value != null ? `${al.precision.count} loves of ${al.precision.denominator} decided events` : `Insufficient evidence — ${al.precision.denominator} decided event${al.precision.denominator !== 1 ? "s" : ""} in period`} accent="#2a5e42">
          <Row label="Love decisions" value={al.precision.count} />
          <Row label="Skip decisions" value={al.falsePositiveRate.count} />
          <Row label="Total decided" value={al.precision.denominator} />
          {/* Canonical evidence disclosure (Req 3) */}
          {al.canonicalEvidence && (
            <div style={{ marginTop: 8 }}>
              <EvidenceDisclosure evidence={al.canonicalEvidence} />
            </div>
          )}
          {al.precision.measurementNote && (
            <div style={{ marginTop: 8, padding: "6px 8px", background: "rgba(107,72,0,0.05)", borderLeft: "2px solid rgba(107,72,0,0.3)", fontSize: 10, color: "#6b4800", fontFamily: SERIF_L }}>
              {al.precision.measurementNote}
            </div>
          )}
        </MetricCard>

        {/* Skip Rate (was: False Positive Rate — High Score, Rejected) */}
        <MetricCard label="Skip Rate (Decided Feedback Events)" value={al.falsePositiveRate.value != null ? `${al.falsePositiveRate.value}%` : "—"} subValue={al.falsePositiveRate.value != null ? `Target: ≤${al.falsePositiveRate.targetRate}% · Trend: ${trendLabel(al.falsePositiveRate.trend)}` : "Insufficient evidence in period"} accent="#d97706">
          {al.falsePositiveRate.measurementNote && (
            <div style={{ marginBottom: 8, padding: "6px 8px", background: "rgba(107,72,0,0.05)", borderLeft: "2px solid rgba(107,72,0,0.3)", fontSize: 10, color: "#6b4800", fontFamily: SERIF_L }}>
              {al.falsePositiveRate.measurementNote}
            </div>
          )}
          <LLabel>
            Top Skip Signals (must sum to {al.falsePositiveRate.count} skip events)
          </LLabel>
          {al.falsePositiveRate.topCauses.map((c, i) => (
            <Row key={i} label={c.cause} value={c.count > 0 ? `${c.count} event${c.count !== 1 ? "s" : ""}` : "—"} />
          ))}
          {(() => {
            const causeSum = al.falsePositiveRate.topCauses.reduce((s, c) => s + c.count, 0);
            const fp = al.falsePositiveRate.count;
            if (causeSum !== fp) {
              return <div style={{ fontSize: 10, color: "#d97706", marginTop: 4 }}>⚠ Cause sum ({causeSum}) ≠ skip count ({fp})</div>;
            }
            return null;
          })()}
        </MetricCard>

        {/* Undecided Event Rate (was: False Negative Rate — Moderate Score, Purchased) */}
        <MetricCard label="Undecided Event Rate" value={al.falseNegativeRate.value != null ? `${al.falseNegativeRate.value}%` : "—"} subValue={`${al.falseNegativeRate.count} of ${al.falseNegativeRate.denominator} evaluated events had no decision`} accent="#d97706">
          {al.falseNegativeRate.measurementNote && (
            <div style={{ marginBottom: 8, padding: "6px 8px", background: "rgba(107,72,0,0.05)", borderLeft: "2px solid rgba(107,72,0,0.3)", fontSize: 10, color: "#6b4800", fontFamily: SERIF_L }}>
              {al.falseNegativeRate.measurementNote}
            </div>
          )}
          <LLabel>Signals from Undecided Sessions</LLabel>
          {al.falseNegativeRate.topSignals.map((s, i) => (
            <div key={i} style={{ padding: "6px 0", borderBottom: "1px solid rgba(34,21,22,0.05)" }}>
              <div style={{ fontFamily: INTER_L, fontSize: 11, color: "#221516", fontWeight: 600 }}>{s.signal}</div>
              <div style={{ fontFamily: SERIF_L, fontSize: 11, color: "#7a6f6a" }}>{s.note}</div>
            </div>
          ))}
        </MetricCard>

        {/* Calibration — measurement states (Req 2): each tier shows its canonical state */}
        <MetricCard label="Match Score Calibration" value={`${al.calibration.score}/100`} subValue={`Trend: ${trendLabel(al.calibration.trend)}`} accent="#221516">
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11, fontFamily: MONO_L }}>
              <thead><tr>
                <th style={{ textAlign: "left", padding: "4px 6px", color: "#7a6f6a", fontFamily: INTER_L, fontSize: 8, textTransform: "uppercase", letterSpacing: "1.5px" }}>Tier</th>
                <th style={{ padding: "4px 6px", color: "#7a6f6a", fontFamily: INTER_L, fontSize: 8, textTransform: "uppercase", letterSpacing: "1.5px" }}>State</th>
                <th style={{ padding: "4px 6px", color: "#7a6f6a", fontFamily: INTER_L, fontSize: 8, textTransform: "uppercase", letterSpacing: "1.5px" }}>Predicted</th>
                <th style={{ padding: "4px 6px", color: "#7a6f6a", fontFamily: INTER_L, fontSize: 8, textTransform: "uppercase", letterSpacing: "1.5px" }}>Actual</th>
                <th style={{ padding: "4px 6px", color: "#7a6f6a", fontFamily: INTER_L, fontSize: 8, textTransform: "uppercase", letterSpacing: "1.5px" }}>Gap</th>
                <th style={{ padding: "4px 6px", color: "#7a6f6a", fontFamily: INTER_L, fontSize: 8, textTransform: "uppercase", letterSpacing: "1.5px" }}>n</th>
              </tr></thead>
              <tbody>
                {al.calibration.byTier.map((t, i) => {
                  // actualRate and gap are null when sampleSize === 0 — never show 0% as if measured.
                  const hasData = t.sampleSize > 0 && t.actualRate != null;
                  const gap = hasData ? (t.gap ?? (t.actualRate - t.predictedRate)) : null;
                  return (
                    <tr key={i} style={{ background: i % 2 === 0 ? "rgba(255,255,255,0.5)" : "transparent" }}>
                      <td style={{ padding: "5px 6px", fontFamily: SERIF_L, fontSize: 12 }}>{t.tier}</td>
                      <td style={{ padding: "5px 6px" }}>{t.measurementState ? <MeasurementStatePill state={t.measurementState} /> : null}</td>
                      <td style={{ padding: "5px 6px", textAlign: "center" }}>{t.predictedRate}%</td>
                      <td style={{ padding: "5px 6px", textAlign: "center", fontWeight: 700, color: hasData ? "#221516" : "#9CA3AF" }}>
                        {hasData ? `${t.actualRate}%` : "—"}
                      </td>
                      <td style={{ padding: "5px 6px", textAlign: "center", color: !hasData ? "#9CA3AF" : Math.abs(gap) <= 5 ? "#2a5e42" : "#d97706", fontWeight: hasData ? 700 : 400 }}>
                        {hasData ? (gap > 0 ? `+${gap}` : `${gap}`) + "pp" : "—"}
                      </td>
                      <td style={{ padding: "5px 6px", textAlign: "center", color: "#9CA3AF" }}>
                        {t.sampleSize === 0 ? "No evaluated events" : t.sampleSize}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </MetricCard>

        {/* Trajectory */}
        <MetricCard label="6-Week Model Improvement Trajectory" value={al.trajectory?.length >= 6 ? `${al.trajectory[5].precision}% → now` : "—"} subValue="Precision, FP rate, calibration — weekly trend" accent="#221516">
          {al.trajectory && al.trajectory.length > 0 ? (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11, fontFamily: MONO_L }}>
                <thead><tr>
                  {["Week", "Love Rate", "Skip Rate", "Calibration"].map(h => (
                    <th key={h} style={{ padding: "4px 8px", color: "#7a6f6a", fontFamily: INTER_L, fontSize: 8, textTransform: "uppercase", letterSpacing: "1.5px", textAlign: "center" }}>{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {al.trajectory.map((w, i) => (
                    <tr key={i} style={{ background: i === al.trajectory.length - 1 ? "rgba(139,32,53,0.05)" : i % 2 === 0 ? "rgba(255,255,255,0.5)" : "transparent" }}>
                      <td style={{ padding: "5px 8px", textAlign: "center", fontFamily: INTER_L, fontWeight: i === al.trajectory.length - 1 ? 700 : 400 }}>{w.week}{i === al.trajectory.length - 1 ? " ★" : ""}</td>
                      <td style={{ padding: "5px 8px", textAlign: "center", color: "#2a5e42", fontWeight: 600 }}>{w.precision != null ? `${w.precision}%` : "—"}</td>
                      <td style={{ padding: "5px 8px", textAlign: "center", color: "#d97706", fontWeight: 600 }}>{w.fpRate != null ? `${w.fpRate}%` : "—"}</td>
                      <td style={{ padding: "5px 8px", textAlign: "center", color: "#221516", fontWeight: 600 }}>{w.calibration}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div style={{ padding: "12px 14px", background: "rgba(34,21,22,0.03)", border: "1px solid rgba(34,21,22,0.08)", fontSize: 12, color: "#7a6f6a", fontFamily: SERIF_L, fontStyle: "italic" }}>
              {al.trajectoryNote ?? "Performance trajectory will populate as weekly snapshots accumulate. No back-projected data is generated."}
            </div>
          )}
        </MetricCard>

        {/* Signal Weights */}
        <MetricCard label="Scoring Weight Performance" value="" subValue="Directional signal — not measured model accuracy" accent="#221516">
          {al.signalWeights?.illustrativeNote && (
            <div style={{ marginBottom: 10, padding: "6px 8px", background: "rgba(107,72,0,0.05)", borderLeft: "2px solid rgba(107,72,0,0.3)", fontSize: 10, color: "#6b4800", fontFamily: SERIF_L }}>
              {al.signalWeights.illustrativeNote}
            </div>
          )}
          {Object.entries(al.signalWeights).filter(([k]) => !["isIllustrative","illustrativeNote"].includes(k)).map(([key, sw], i) => (
            <div key={key} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "7px 0", borderBottom: "1px solid rgba(34,21,22,0.05)" }}>
              <span style={{ fontFamily: SERIF_L, fontSize: 13, color: "#221516", textTransform: "capitalize" }}>{key}</span>
              <div style={{ display: "flex", gap: 16, fontFamily: MONO_L, fontSize: 11 }}>
                <span style={{ color: "#7a6f6a" }}>weight: {Math.round(sw.weight * 100)}%</span>
                <span style={{ color: "#5c5350", fontWeight: 700 }}>directional: {sw.accuracy}%</span>
                <span style={{ color: sw.trend === "improving" ? "#2a5e42" : sw.trend === "declining" ? "#8b2035" : "#7a6f6a" }}>{trendLabel(sw.trend)}</span>
              </div>
            </div>
          ))}
        </MetricCard>

        {/* Test / Train */}
        <div style={{ padding: "12px 16px", background: "rgba(34,21,22,0.03)", border: "1px solid rgba(34,21,22,0.08)", fontFamily: INTER_L, fontSize: 11, color: "#5c5350", lineHeight: 1.7 }}>
          <strong>Test/Train split:</strong> {al.testTrainInfo.trainPct}% training / {al.testTrainInfo.testPct}% test ·{" "}
          {al.testTrainInfo.totalEvents} total events ·{" "}
          Status: <strong style={{ color: al.testTrainInfo.currentStatus === "sufficient" ? "#2a5e42" : "#d97706" }}>{al.testTrainInfo.currentStatus}</strong>
          {al.testTrainInfo.currentStatus === "growing" && ` (minimum recommended: ${al.testTrainInfo.minimumRecommended})`}
        </div>
      </div>
    );
  }

  // ── static roadmap (live mode) ─────────────────────────────────────────────
  const ITEMS = [
    { label: "Recommendation Accuracy Over Time", description: "Requires logging accepted and rejected recommendations with a match score." },
    { label: "False Positives — high score, rejected", description: "Recommendations nAia was confident about that customers rejected — the most valuable calibration signal." },
    { label: "False Negatives — moderate score, purchased", description: "Recommendations with a modest score that led to purchase — evidence of underweighted signals." },
    { label: "Match Score Calibration", description: "How well nAia's confidence score predicts actual customer acceptance rate." },
    { label: "Scoring Weight Performance", description: "Which scoring dimensions (personality, occasion, feeling, fit) most reliably predict purchase." },
    { label: "Model Improvement by Period", description: "Whether nAia's recommendation quality is improving over successive periods." },
  ];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <p style={{ fontFamily: SERIF_L, fontSize: 14, color: "#7a6f6a", fontStyle: "italic", margin: "0 0 8px" }}>
        Metrics that become available as nAia accumulates more session data and integrations are completed.
      </p>
      {ITEMS.map((item, i) => (
        <div key={i} style={{ padding: "10px 14px", background: "rgba(255,255,255,0.6)", borderLeft: "2px solid rgba(34,21,22,0.10)" }}>
          <div style={{ fontFamily: INTER_L, fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "1.5px", color: "#5c5350", marginBottom: 4 }}>{item.label}</div>
          <div style={{ fontFamily: SERIF_L, fontSize: 12, color: "#7a6f6a", lineHeight: 1.5 }}>{item.description}</div>
        </div>
      ))}
    </div>
  );
}

function DataAiExperimentBuilder({ advanced, sampleMode }) {
  const INTER_L = "'Inter', -apple-system, sans-serif";
  const SERIF_L = "'Cormorant Garamond', Garamond, serif";
  const MONO_L = "'Courier New', Courier, monospace";

  const exps = advanced?.experiments;

  if (sampleMode && exps) {
    const Field = ({ label, value, mono }) => (
      <div style={{ padding: "8px 12px", background: "rgba(255,255,255,0.7)", border: "1px solid rgba(34,21,22,0.07)" }}>
        <div style={{ fontFamily: INTER_L, fontSize: 8, textTransform: "uppercase", letterSpacing: "1.5px", color: "#7a6f6a", marginBottom: 4 }}>{label}</div>
        <div style={{ fontFamily: mono ? MONO_L : SERIF_L, fontSize: 12, color: "#221516", lineHeight: 1.5 }}>{value}</div>
      </div>
    );
    const ExpCard = ({ exp, statusLabel, statusColor, headerNote, children }) => (
      <div style={{ border: "1px solid rgba(34,21,22,0.12)", background: "#faf9f7" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", padding: "12px 18px 0", gap: 12 }}>
          <div>
            <div style={{ fontFamily: INTER_L, fontSize: 7, fontWeight: 700, textTransform: "uppercase", letterSpacing: "2px", color: "#9CA3AF", marginBottom: 6 }}>
              {headerNote}
            </div>
            <div style={{ fontFamily: SERIF_L, fontSize: 16, fontWeight: 600, color: "#221516", marginBottom: 6, fontStyle: "italic" }}>
              {exp.title}
            </div>
          </div>
          <div style={{ padding: "4px 10px", background: statusColor + "22", border: `1px solid ${statusColor}44`, color: statusColor, fontFamily: INTER_L, fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "1.5px", whiteSpace: "nowrap", flexShrink: 0 }}>
            {statusLabel}
          </div>
        </div>
        <div style={{ fontFamily: SERIF_L, fontSize: 13, color: "#5c5350", fontStyle: "italic", margin: "0 18px 14px", lineHeight: 1.6 }}>
          "{exp.hypothesis}"
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 8, padding: "0 18px 14px" }}>
          <Field label="Product" value={exp.product} />
          <Field label="Target Segment" value={exp.targetSegment} />
          <Field label="Primary Metric" value={exp.primaryMetric} />
          <Field label="Secondary Metric" value={exp.secondaryMetric} />
          <Field label="Minimum Sample" value={exp.minimumSample} />
          <Field label="Period" value={exp.period} />
        </div>
        {children}
      </div>
    );

    const completedList = exps.completed ?? [];
    const activeList    = exps.active    ?? [];
    const plannedList   = exps.planned   ?? [];

    const renderCompleted = (completed) => (
      <ExpCard key={completed.id} exp={completed} statusLabel="Completed" statusColor="#2a5e42"
        headerNote={completed.minimumSampleMet === false
          ? "⚠ Completed — minimum sample not reached; do not conclude"
          : `Completed · ${completed.result?.outcome === "validated" ? "outcome validated" : (completed.result?.outcome ?? "complete")}`}>
        {completed.minimumSampleMet === false && (
          <div style={{ margin: "0 18px 8px", padding: "10px 14px", background: "#fff7ed", border: "1px solid #fed7aa", fontSize: 12, color: "#c2410c" }}>
            Minimum sample ({completed.minimumSample}) not reached. n={completed.sampleSize} events. Do not treat as confirmed.
          </div>
        )}
        <div style={{ margin: "0 18px 18px", padding: "12px 14px", background: "#f0faf4", border: "1px solid #c6e8d2" }}>
          <div style={{ fontFamily: INTER_L, fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "1.5px", color: "#2a5e42", marginBottom: 8 }}>
            Outcome — {completed.result.outcome}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {[
              { label: "Primary",    value: completed.result.primaryResult },
              { label: "Secondary",  value: completed.result.secondaryResult },
              { label: "Action taken", value: completed.result.action },
            ].map(({ label, value }) => (
              <div key={label} style={{ display: "flex", gap: 12, alignItems: "baseline" }}>
                <span style={{ fontFamily: INTER_L, fontSize: 9, textTransform: "uppercase", letterSpacing: "1px", color: "#2a5e42", minWidth: 72 }}>{label}</span>
                <span style={{ fontFamily: SERIF_L, fontSize: 13, color: "#221516" }}>{value}</span>
              </div>
            ))}
          </div>
          <div style={{ fontFamily: MONO_L, fontSize: 10, color: "#7a6f6a", marginTop: 8 }}>
            n={completed.sampleSize} events · minimum={completed.minimumSample}
          </div>
        </div>
      </ExpCard>
    );

    const renderActive = (active) => (
      <ExpCard key={active.id} exp={active} statusLabel="Active" statusColor="#d97706" headerNote={`Active experiment · ${active.daysRemaining} days remaining`}>
        <div style={{ margin: "0 18px 18px", padding: "12px 14px", background: "#fffbeb", border: "1px solid #fde68a" }}>
          <div style={{ fontFamily: INTER_L, fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "1.5px", color: "#d97706", marginBottom: 8 }}>
            Intermediate Results — {active.intermediate.status}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px,1fr))", gap: 8, marginBottom: 10 }}>
            {[
              { label: "Sessions to date", value: active.intermediate.sessionsToDate },
              { label: "Buys to date",     value: active.intermediate.buysToDate },
              { label: "Conversion",       value: `${active.intermediate.conversionToDate}%` },
              { label: "Sample (n)",       value: active.intermediate.sampleSize },
              { label: "Days remaining",   value: active.daysRemaining },
            ].map(({ label, value }) => (
              <div key={label} style={{ padding: "8px 10px", background: "rgba(255,255,255,0.7)", border: "1px solid rgba(253,230,138,0.8)" }}>
                <div style={{ fontFamily: INTER_L, fontSize: 8, textTransform: "uppercase", letterSpacing: "1px", color: "#92400e", marginBottom: 4 }}>{label}</div>
                <div style={{ fontFamily: MONO_L, fontSize: 16, fontWeight: 700, color: "#d97706" }}>{value}</div>
              </div>
            ))}
          </div>
          <div style={{ fontFamily: SERIF_L, fontSize: 12, color: "#78350f", fontStyle: "italic" }}>{active.intermediate.note}</div>
        </div>
      </ExpCard>
    );

    const renderPlanned = (planned) => (
      <ExpCard key={planned.id} exp={planned} statusLabel="Planned" statusColor="#7a6f6a" headerNote="Planned experiment · not yet started">
        <div style={{ margin: "0 18px 18px", padding: "12px 14px", background: "rgba(34,21,22,0.03)", border: "1px solid rgba(34,21,22,0.10)" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px,1fr))", gap: 8 }}>
            {[
              { label: "Prerequisite",      value: planned.prerequisite },
              { label: "Evidence from data", value: planned.evidence },
            ].filter(f => f.value).map(({ label, value }) => (
              <div key={label}>
                <div style={{ fontFamily: INTER_L, fontSize: 9, textTransform: "uppercase", letterSpacing: "1px", color: "#7a6f6a", fontWeight: 600, marginBottom: 4 }}>{label}</div>
                <div style={{ fontFamily: SERIF_L, fontSize: 13, color: "#221516" }}>{value}</div>
              </div>
            ))}
          </div>
        </div>
      </ExpCard>
    );

    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        {completedList.map(renderCompleted)}
        {activeList.map(renderActive)}
        {plannedList.map(renderPlanned)}
        {completedList.length === 0 && activeList.length === 0 && plannedList.length === 0 && (
          <div style={{ fontFamily: SERIF_L, fontSize: 14, color: "#7a6f6a", fontStyle: "italic" }}>No experiments configured yet.</div>
        )}
      </div>
    );
  }

  // ── live mode: illustrative example ──────────────────────────────────────────
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <p style={{ fontFamily: SERIF_L, fontSize: 14, color: "#7a6f6a", fontStyle: "italic", margin: 0 }}>
        Experiment Builder will allow you to structure and track design tests directly from the dashboard. Below is an illustrative example of how a hypothesis will look when this feature ships.
      </p>

      <div style={{ border: "2px dashed rgba(34,21,22,0.12)", padding: "20px 24px", background: "#faf9f7" }}>
        <div style={{ fontFamily: INTER_L, fontSize: 7, fontWeight: 700, textTransform: "uppercase", letterSpacing: "2px", color: "#9CA3AF", marginBottom: 14 }}>
          Illustrative example — not a live experiment
        </div>
        <div style={{ fontFamily: SERIF_L, fontSize: 16, fontWeight: 600, color: "#221516", marginBottom: 10 }}>
          If we introduce a relaxed linen option for <em>Becoming Whole</em>, customers seeking "calm and grounded" will show a higher rewear rate — because current objections cluster around formality mismatch.
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
          {[
            { field: "Design change",      value: "Add relaxed linen silhouette to Becoming Whole range" },
            { field: "Target segment",     value: "Becoming Whole · desired feeling: calm / grounded" },
            { field: "Primary metric",     value: "Rewear rate (target: ≥70%)" },
            { field: "Secondary metric",   value: "Objection: Too formal (target: <20%)" },
            { field: "Minimum sample",     value: "n = 10 post-wear reviews" },
            { field: "Reasoning from data",value: "n=8, 37% rewear, top objection: Too Formal (5/8)" },
          ].map(({ field, value }) => (
            <div key={field} style={{ padding: "10px 12px", background: "rgba(255,255,255,0.7)", border: "1px solid rgba(34,21,22,0.07)" }}>
              <div style={{ fontFamily: INTER_L, fontSize: 8, textTransform: "uppercase", letterSpacing: "1.5px", color: "#7a6f6a", marginBottom: 4 }}>{field}</div>
              <div style={{ fontFamily: SERIF_L, fontSize: 12, color: "#221516", lineHeight: 1.5 }}>{value}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ padding: "10px 14px", background: "rgba(122,111,106,0.06)", border: "1px solid rgba(34,21,22,0.07)", fontSize: 12, color: "#5c5350", fontFamily: SERIF_L }}>
        When Experiment Builder ships, hypotheses will be saved, linked to the opportunity they came from, and tracked against live post-wear data as results come in.
      </div>
    </div>
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

// ── Req 2: Canonical measurement state pill — renders all 6 states ─────────────
const MEASUREMENT_STATE_CONFIG = {
  measured:                 { label: "Measured",              bg: "#e8f5e9", color: "#2a5e42", border: "rgba(42,94,66,0.2)" },
  insufficient_evidence:    { label: "Insufficient Evidence", bg: "#fff8e1", color: "#6b4800", border: "rgba(107,72,0,0.2)" },
  no_eligible_observations: { label: "No Observations",       bg: "#f5f5f5", color: "#5c5350", border: "rgba(92,83,80,0.2)" },
  observed_zero:            { label: "Observed Zero",         bg: "#e8f5e9", color: "#2a5e42", border: "rgba(42,94,66,0.15)" },
  awaiting_integration:     { label: "Awaiting Integration",  bg: "#f5f5f5", color: "#5c5350", border: "rgba(92,83,80,0.2)" },
  not_applicable:           { label: "Not Applicable",        bg: "#f5f5f5", color: "#9ca3af", border: "rgba(156,163,175,0.2)" },
};
function MeasurementStatePill({ state }) {
  const cfg = MEASUREMENT_STATE_CONFIG[state] ?? MEASUREMENT_STATE_CONFIG.not_applicable;
  return (
    <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 3, background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.border}`, fontSize: 9, fontFamily: INTER, fontWeight: 600, letterSpacing: "0.5px", lineHeight: 1.6 }}>
      {cfg.label}
    </span>
  );
}

// ── Req 3: Customer-based evidence disclosure ──────────────────────────────────
function EvidenceDisclosure({ evidence, period }) {
  if (!evidence) return null;
  const { uniqueCustomerCount, eventCount, confidenceLevel } = evidence;
  const p = period ?? evidence.period ?? "";
  return (
    <span style={{ fontSize: 9, color: "#7a6f6a", fontFamily: INTER, letterSpacing: "0.3px" }}>
      {uniqueCustomerCount} customer{uniqueCustomerCount !== 1 ? "s" : ""} · {eventCount} events{p ? ` · ${p}` : ""}
      {confidenceLevel ? <> · <strong style={{ fontWeight: 600 }}>{confidenceLevel}</strong></> : null}
    </span>
  );
}
