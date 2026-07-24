// app/routes/app.designer-intelligence.jsx
// nAia Designer Dashboard — full certification build.
// 8-section tabbed portal: Overview · Customer · Product · Recommendation ·
// Collection · Commercial · AI Performance · Design Opportunities

import { useState, useCallback } from "react";
import { useLoaderData, useSearchParams, Form } from "react-router";
import { requireStaffAccess } from "../lib/staff-auth.server";
import { getDesignerStats, getAdditionalKPIs } from "../lib/designer-stats.server";
import { getPhase4B2KPIs } from "../lib/ai/designer-intelligence.server";
import { getAdvancedKPIs } from "../lib/designer-advanced.server";

// ── Loader ────────────────────────────────────────────────────────────────────

export async function loader({ request }) {
  await requireStaffAccess(request);
  const url = new URL(request.url);
  const rawDays = parseInt(url.searchParams.get("days") || "30", 10);
  const dateRangeDays = [7, 30, 90, 365].includes(rawDays) ? rawDays : 30;

  const [dashboard, kpis, phase4b2, advanced] = await Promise.all([
    getDesignerStats(dateRangeDays),
    getAdditionalKPIs(),
    getPhase4B2KPIs(dateRangeDays),
    getAdvancedKPIs(dateRangeDays),
  ]);

  if (dashboard.error) throw new Response(dashboard.error, { status: 500 });
  return { dashboard, kpis, phase4b2, advanced, dateRangeDays };
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

// ── Status helpers ─────────────────────────────────────────────────────────────

const STATUS_CONFIG = {
  live:                  { label: "LIVE",                 bg: "#14532d", color: "#dcfce7" },
  "awaiting-integration":{ label: "AWAITING INTEGRATION", bg: "#3b0764", color: "#e9d5ff" },
  "insufficient-data":   { label: "INSUFFICIENT DATA",    bg: "#78350f", color: "#fef3c7" },
  experimental:          { label: "EXPERIMENTAL INSIGHT",  bg: "#1e3a5f", color: "#bae6fd" },
  "not-implemented":     { label: "NOT IMPLEMENTED",       bg: "#374151", color: "#d1d5db" },
};

function StatusBadge({ status, style = {} }) {
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG["not-implemented"];
  return (
    <span style={{
      display: "inline-block", padding: "3px 10px", borderRadius: "3px",
      fontSize: "9px", fontFamily: "'Space Mono', monospace", fontWeight: 700,
      textTransform: "uppercase", letterSpacing: "1.5px",
      background: cfg.bg, color: cfg.color, ...style,
    }}>
      {cfg.label}
    </span>
  );
}

function AwaitingCard({ label, description, dataContract }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ ...s.card, borderLeft: "3px solid #6b21a8", opacity: 0.9 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", gap: 12 }}>
        <div>
          <div style={{ ...s.cardLabel, color: "#6b21a8" }}>{label}</div>
          <p style={{ ...s.muted, marginTop: 6 }}>{description}</p>
        </div>
        <StatusBadge status="awaiting-integration" />
      </div>
      {dataContract && (
        <>
          <button onClick={() => setOpen(!open)} style={s.linkBtn}>
            {open ? "Hide" : "Show"} data contract ↓
          </button>
          {open && (
            <div style={{ marginTop: 12, padding: "12px 14px", background: "#0f0a1e", borderRadius: 4, fontSize: 12, color: "#c4b5fd", fontFamily: "'Space Mono', monospace", lineHeight: 1.8, overflow: "auto" }}>
              <pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>{typeof dataContract === "string" ? dataContract : JSON.stringify(dataContract, null, 2)}</pre>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function InsufficientCard({ label, description, sampleSize }) {
  return (
    <div style={{ ...s.card, borderLeft: "3px solid #b45309" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", gap: 12 }}>
        <div>
          <div style={{ ...s.cardLabel, color: "#b45309" }}>{label}</div>
          <p style={{ ...s.muted, marginTop: 6 }}>{description}</p>
          {sampleSize !== undefined && (
            <p style={{ ...s.muted, marginTop: 4, fontSize: 11 }}>Current sample: {sampleSize} records — minimum 5 required.</p>
          )}
        </div>
        <StatusBadge status="insufficient-data" />
      </div>
    </div>
  );
}

// ── Shared components ─────────────────────────────────────────────────────────

function GFonts() {
  return (
    <link
      href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,700;0,900;1,400&family=Cormorant+Garamond:ital,wght@0,300;0,400;0,600;1,300&family=Space+Mono:wght@400;700&display=swap"
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
            <span style={{ position: "absolute", zIndex: 10, background: "#1a1816", color: "#f4f4f1", padding: "6px 10px", borderRadius: 4, fontSize: 11, width: 200, marginTop: 4, lineHeight: 1.5, display: "block" }}>
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
    <div style={{ padding: "12px 16px", background: "rgba(59,5,16,0.03)", border: "1px dashed rgba(59,5,16,0.12)", fontSize: 13, color: "#9CA3AF", fontStyle: "italic" }}>
      {label} — migration pending. Data will appear after the Phase 4B1 database migration is applied.
    </div>
  );
}

function EmptyState({ message = "No data yet for this period." }) {
  return (
    <div style={{ padding: "40px 20px", textAlign: "center", color: "#9CA3AF", fontStyle: "italic", fontSize: 14 }}>
      {message}
    </div>
  );
}

function SampleSizeWarning({ n, min = 5 }) {
  if (n >= min) return null;
  return (
    <div style={{ padding: "8px 14px", background: "#fef3c7", border: "1px solid #d97706", borderRadius: 4, fontSize: 12, color: "#92400e", marginBottom: 16 }}>
      ⚠ Sample size is {n} — minimum {min} required for reliable signals. Treat this data as directional only.
    </div>
  );
}

function ExportCSVButton({ data, filename }) {
  const handleExport = useCallback(() => {
    if (!data || data.length === 0) return;
    const keys = Object.keys(data[0]);
    const rows = [keys.join(","), ...data.map((row) => keys.map((k) => JSON.stringify(row[k] ?? "")).join(","))];
    const blob = new Blob([rows.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }, [data, filename]);
  return (
    <button onClick={handleExport} style={s.linkBtn}>
      ↓ CSV
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
        {piece.positiveComments?.length > 0 && <div style={{ marginTop: 8 }}><span style={s.muted}>Top feedback: </span><span style={{ color: "#2a9d8f" }}>{piece.positiveComments.join(", ")}</span></div>}
        <div style={{ marginTop: 8 }}><span style={s.muted}>Watch-outs: </span><span style={{ color: "#d97706" }}>{piece.negativeComments?.length > 0 ? piece.negativeComments.join(", ") : "None yet"}</span></div>
        <div style={{ marginTop: 8 }}><span style={s.muted}>Resonates with: </span><span style={s.dnaStyle}>{piece.topDNA?.length > 0 ? piece.topDNA.join(", ") : "More data needed"}</span></div>
      </div>
    </div>
  );
}

function FeedbackInsightCard({ insight }) {
  const thresholdColor = insight.threshold === "strong" ? "#1a1816" : insight.threshold === "moderate" ? "#8B7355" : "#9CA3AF";
  return (
    <div style={{ padding: "16px 20px", border: `2px solid ${thresholdColor}`, borderRadius: 4, marginBottom: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", marginBottom: 8 }}>
        <div style={{ fontFamily: "'Space Mono', monospace", fontSize: 9, textTransform: "uppercase", letterSpacing: "2px", color: "#7a6f6a" }}>{insight.category}</div>
        <span style={{ fontSize: 9, textTransform: "uppercase", letterSpacing: "1.3px", padding: "4px 10px", background: thresholdColor, color: "#faf9f7", borderRadius: 3, fontFamily: "'Space Mono', monospace" }}>{insight.threshold}</span>
      </div>
      <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 15, color: "#221516", marginBottom: 8 }}>{insight.signal}</div>
      <div style={{ fontSize: 13, color: "#8B7355" }}><strong>Suggestion:</strong> {insight.suggestion}</div>
    </div>
  );
}

function DesignActionCard({ action }) {
  const getPriorityColor = (p) => p === "High Confidence" ? "#1a1816" : p === "Medium Confidence" ? "#8B7355" : p === "Early Signal" ? "#9CA3AF" : "#D4C4B0";
  const color = getPriorityColor(action.priority || action.confidenceBadge);
  return (
    <div style={{ padding: 22, border: `2px solid ${color}`, borderRadius: 4, marginBottom: 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", marginBottom: 14 }}>
        <h4 style={{ margin: 0, fontFamily: "Cormorant Garamond", fontSize: 21, fontWeight: 600 }}>{action.piece}</h4>
        <span style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "1.3px", padding: "6px 14px", background: color, color: "#faf9f7", borderRadius: 3, whiteSpace: "nowrap", fontWeight: 600 }}>{action.confidenceBadge || action.priority}</span>
      </div>
      <div style={{ fontSize: 14, color: "#8B7355", marginBottom: 14, fontWeight: 600 }}>{action.actionType}: {action.action}</div>
      <div style={{ marginBottom: 10 }}><span style={{ fontSize: 12, fontWeight: 600, color: "#666", marginRight: 8 }}>Performance:</span><span style={{ fontSize: 13 }}>{action.performance}</span></div>
      <div style={{ marginBottom: 10 }}><span style={{ fontSize: 12, fontWeight: 600, color: "#2a9d8f", marginRight: 8 }}>Liked:</span><span style={{ fontSize: 13 }}>{action.liked}</span></div>
      <div style={{ marginBottom: 10 }}><span style={{ fontSize: 12, fontWeight: 600, color: "#d97706", marginRight: 8 }}>Watch:</span><span style={{ fontSize: 13, color: "#92400e" }}>{action.watch}</span></div>
      <div style={{ marginBottom: 14 }}><span style={{ fontSize: 12, fontWeight: 600, marginRight: 8 }}>Next step:</span><span style={{ fontSize: 13 }}>{action.nextStep}</span></div>
      <div style={{ fontSize: 12, color: "#999", paddingTop: 10, borderTop: "1px solid #f0f0f0" }}>{action.data}</div>
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
  { id: "ai-performance",  label: "AI Performance" },
  { id: "opportunities",   label: "Design Opportunities" },
];

// ── Root component ─────────────────────────────────────────────────────────────

export default function DesignerDashboard() {
  const { dashboard: data, kpis, phase4b2, advanced, dateRangeDays } = useLoaderData();
  const [activeTab, setActiveTab] = useState("overview");
  const [searchParams] = useSearchParams();

  return (
    <div style={s.wrap}>
      <GFonts />
      <div style={s.inner}>

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div style={s.header}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 16 }}>
            <div>
              <div style={{ fontFamily: "'Space Mono', monospace", fontSize: 9, textTransform: "uppercase", letterSpacing: "3px", color: "#9CA3AF", marginBottom: 12 }}>Private — Internal Only</div>
              <h1 style={s.h1}>nAia Designer Dashboard</h1>
              <p style={s.subtitle}>Collection intelligence · Customer insights · Design direction</p>
            </div>
            {/* Date range selector */}
            <Form method="get" style={{ display: "flex", gap: 8, alignItems: "center" }}>
              {searchParams.get("tab") && <input type="hidden" name="tab" value={searchParams.get("tab")} />}
              <span style={{ fontFamily: "'Space Mono', monospace", fontSize: 10, color: "#7a6f6a", textTransform: "uppercase", letterSpacing: "1px" }}>Period</span>
              {[7, 30, 90, 365].map((d) => (
                <button
                  key={d}
                  type="submit"
                  name="days"
                  value={d}
                  style={{
                    ...s.periodBtn,
                    background: dateRangeDays === d ? "#221516" : "transparent",
                    color: dateRangeDays === d ? "#f4f4f1" : "#7a6f6a",
                  }}
                >
                  {d === 365 ? "All" : `${d}d`}
                </button>
              ))}
            </Form>
          </div>
        </div>

        {/* ── Tab bar ──────────────────────────────────────────────────────── */}
        <div style={s.tabBar}>
          {TABS.map((tab) => (
            <button
              key={tab.id}
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
          {activeTab === "overview"       && <TabOverview        data={data} kpis={kpis} phase4b2={phase4b2} advanced={advanced} dateRangeDays={dateRangeDays} />}
          {activeTab === "customer"       && <TabCustomer        data={data} kpis={kpis} advanced={advanced} />}
          {activeTab === "product"        && <TabProduct         data={data} phase4b2={phase4b2} />}
          {activeTab === "recommendation" && <TabRecommendation  data={data} kpis={kpis} phase4b2={phase4b2} advanced={advanced} />}
          {activeTab === "collection"     && <TabCollection      data={data} kpis={kpis} advanced={advanced} dateRangeDays={dateRangeDays} />}
          {activeTab === "commercial"     && <TabCommercial      data={data} advanced={advanced} />}
          {activeTab === "ai-performance" && <TabAIPerformance   data={data} kpis={kpis} phase4b2={phase4b2} advanced={advanced} />}
          {activeTab === "opportunities"  && <TabOpportunities   data={data} phase4b2={phase4b2} advanced={advanced} />}
        </div>

      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// TAB 1 — OVERVIEW
// ══════════════════════════════════════════════════════════════════════════════

function TabOverview({ data, kpis, phase4b2, advanced, dateRangeDays }) {
  return (
    <>
      {/* Priority KPI grid */}
      <Section title="Collection at a Glance" desc="Key signals across all intelligence areas">
        <div style={s.kpiGrid}>
          <KpiCard label="nAia-Assisted Revenue" value="—" status="awaiting-integration" tooltip="Requires Shopify Orders webhook integration. Will show total order value attributed to nAia styling sessions." />
          <KpiCard label="nAia Influence Rate" value="—" status="awaiting-integration" tooltip="% of sales that touched at least one nAia feature before purchase." />
          <KpiCard label="Highest-Converting Feature" value="—" status="awaiting-integration" tooltip="Which nAia feature (StyleMe, VTO, Buy or Skip) produces the highest purchase intent." />
          <KpiCard label="Total nAia Users" value={data.totalUsers || 0} status="live" />
          <KpiCard label="Total Looks Rated" value={data.totalLooks || 0} status="live" />
          <KpiCard label="Avg Rating" value={(data.avgRating || 0).toFixed(1)} suffix="/5" status="live" tooltip="Average overall feeling rating across all reviewed styling sessions." />
          <KpiCard label="Would Wear Again" value={`${Math.round((data.avgRewear || 0) * 100)}%`} status="live" tooltip="% of reviewed looks where customer answered 'Definitely' to would wear again." />
          <KpiCard label="Style Alignment" value={`${Math.round((data.avgAlignment || 0) * 100)}%`} status="live" tooltip="% of reviews where customer felt the look was like her." />
          {kpis && !kpis.error && kpis.confidence && (
            <KpiCard label="Confidence Lift" value={`${kpis.confidence.avgDelta >= 0 ? "+" : ""}${kpis.confidence.avgDelta}`} suffix="/10" status="live" tooltip={`Avg confidence before styling: ${kpis.confidence.avgBefore}/10. After: ${kpis.confidence.avgAfter}/10.`} />
          )}
          <KpiCard label="nAia Users vs Non-nAia Users" value="—" status="awaiting-integration" tooltip="Comparison of purchase behaviour between customers who used nAia vs those who didn't. Requires Shopify customer segmentation." />
        </div>
      </Section>

      {/* Platform Health */}
      {kpis && !kpis.error && (
        <Section title="Platform Health" desc="Feature adoption and engagement" status="live">
          <div style={s.kpiGrid}>
            <KpiCard label="Passport Started" value={kpis.passport.total} />
            <KpiCard label="Passport Completed" value={kpis.passport.completed} />
            <KpiCard label="Completion Rate" value={`${kpis.passport.completionRate}%`} tooltip="% of started passports that were completed." />
            <KpiCard label="Closet Adoption" value={`${kpis.closet.adoptionRate}%`} tooltip="% of customers who added at least 1 item to their Digital Closet." />
            <KpiCard label="Avg Closet Items" value={kpis.closet.avgItems} />
            <KpiCard label="StyleMe Sessions (30d)" value={kpis.recentActivity.sessions} />
            <KpiCard label="Outfit Reviews (30d)" value={kpis.recentActivity.reviews} />
          </div>
        </Section>
      )}

      {/* Top signals */}
      {data.onboarding && data.onboarding.totalProfiles > 0 && (
        <Section title="Top Signals" desc="Leading answers across customer profiles and styling sessions" status="live">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 16 }}>
            <SignalGroup title="Top Style Personalities" items={data.onboarding.styleDNADistribution.slice(0, 4)} keyField="style" valueField="count" />
            <SignalGroup title="Top Desired Feelings" items={data.onboarding.desiredFeelings.slice(0, 4)} keyField="feeling" valueField="count" />
            <SignalGroup title="Top Occasions" items={data.topOccasions?.slice(0, 4)} keyField="name" valueField="lookCount" />
            <SignalGroup title="Top Preferred Colors" items={data.onboarding.colorDistribution.slice(0, 4)} keyField="color" valueField="count" />
          </div>
        </Section>
      )}

      {/* Collection Evolution summary */}
      {advanced?.collectionEvolution && (
        <Section title="Period Comparison" desc={`${advanced.collectionEvolution.current.label} vs ${advanced.collectionEvolution.previous.label}`} status={advanced.collectionEvolution.status}>
          {advanced.collectionEvolution.status === "insufficient-data" ? (
            <InsufficientCard label="Period comparison" description="Not enough data in this period to compare meaningfully." />
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 20 }}>
              <PeriodCard period={advanced.collectionEvolution.current} label="Current Period" />
              <PeriodCard period={advanced.collectionEvolution.previous} label="Previous Period" />
              <div style={s.card}>
                <div style={s.cardLabel}>Trends</div>
                <TrendPill label="Ratings" trend={advanced.collectionEvolution.ratingTrend} />
                <TrendPill label="Sessions" trend={advanced.collectionEvolution.sessionsTrend} />
              </div>
            </div>
          )}
        </Section>
      )}
    </>
  );
}

function SignalGroup({ title, items, keyField, valueField }) {
  if (!items || items.length === 0) return null;
  return (
    <div style={{ ...s.card }}>
      <div style={s.cardLabel}>{title}</div>
      <div style={{ marginTop: 10 }}>
        {items.map((item, i) => (
          <div key={i} style={{ display: "flex", justifyContent: "space-between", paddingBottom: 6, marginBottom: 6, borderBottom: i < items.length - 1 ? "1px solid rgba(59,5,16,0.06)" : "none" }}>
            <span style={{ fontSize: 13, color: "#221516" }}>{item[keyField]}</span>
            <span style={{ fontFamily: "'Space Mono', monospace", fontSize: 11, color: "#7a6f6a" }}>{item[valueField]}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function PeriodCard({ period, label }) {
  return (
    <div style={s.card}>
      <div style={s.cardLabel}>{label}</div>
      <div style={{ fontFamily: "'Space Mono', monospace", fontSize: 10, color: "#9CA3AF", marginBottom: 12 }}>{period.label}</div>
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
  const config = { improving: { icon: "↑", color: "#16a34a" }, growing: { icon: "↑", color: "#16a34a" }, stable: { icon: "→", color: "#6b7280" }, declining: { icon: "↓", color: "#dc2626" }, null: { icon: "—", color: "#9CA3AF" } };
  const cfg = config[trend] || config.null;
  return (
    <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8 }}>
      <span style={{ fontSize: 13, color: "#7a6f6a" }}>{label}</span>
      <span style={{ fontFamily: "'Space Mono', monospace", fontSize: 12, color: cfg.color, fontWeight: 700 }}>{cfg.icon} {trend || "—"}</span>
    </div>
  );
}

function Metric({ label, value }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between" }}>
      <span style={{ fontSize: 12, color: "#7a6f6a" }}>{label}</span>
      <span style={{ fontFamily: "'Space Mono', monospace", fontSize: 12, color: "#221516" }}>{value}</span>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// TAB 2 — CUSTOMER INTELLIGENCE
// ══════════════════════════════════════════════════════════════════════════════

function TabCustomer({ data, kpis, advanced }) {
  return (
    <>
      {/* Style DNA */}
      {data.onboarding?.totalProfiles > 0 && (
        <Section title="Style DNA Distribution" desc={`Based on ${data.onboarding.totalProfiles} completed profiles`} status="live" action={<ExportCSVButton data={data.onboarding.styleDNADistribution} filename="style-dna.csv" />}>
          <div style={s.grid3}>
            {data.onboarding.styleDNADistribution.map((item, i) => (
              <div key={i} style={s.card}>
                <div style={s.cardLabel}>{item.style}</div>
                <div style={{ ...s.cardValue, marginTop: 8 }}>{item.count} users · {item.percentage}%</div>
                <div style={{ marginTop: 8, height: 6, background: "rgba(59,5,16,0.08)", borderRadius: 3 }}>
                  <div style={{ height: "100%", width: `${item.percentage}%`, background: "#8b2035", borderRadius: 3 }} />
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
                <div style={s.cardLabel}>{item.feeling}</div>
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
                <div style={s.cardLabel}>{item.lifestyle}</div>
                <div style={s.cardValue}>{item.count} users · {item.percentage}%</div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Colour Intelligence */}
      {data.onboarding?.colorDistribution?.length > 0 && (
        <Section title="Colour Intelligence" desc="Preferred and avoided colours across all profiles" status="live">
          <div style={s.grid3}>
            {data.onboarding.colorDistribution.slice(0, 9).map((item, i) => (
              <div key={i} style={s.card}>
                <div style={s.cardLabel}>{item.color}</div>
                <div style={s.cardValue}>{item.count} users · {item.percentage}%</div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Fit & Silhouette */}
      {data.bodyPatterns?.length > 0 && (
        <Section title="Fit and Silhouette Intelligence" desc="What works for different body and fit preferences" status="live">
          <div style={s.grid3}>
            {data.bodyPatterns.map((pattern, i) => (
              <div key={i} style={s.card}>
                <div style={s.cardLabel}>{pattern.preference}</div>
                <div style={{ fontFamily: "'Space Mono', monospace", fontSize: 10, color: "#9CA3AF", marginBottom: 10 }}>{pattern.userCount} {pattern.userCount === 1 ? "user" : "users"}</div>
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
        desc="From starting mood → desired feeling → recommendation → outcome → post-wear"
        status={advanced?.emotionalJourney?.status || "insufficient-data"}
      >
        {!advanced?.emotionalJourney || advanced.emotionalJourney.status === "insufficient-data" ? (
          <InsufficientCard label="Emotional Journey" description="Not enough reviewed sessions to map emotional transformations. Need at least 3 sessions with mood + outcome data." sampleSize={advanced?.emotionalJourney?.sampleSize ?? 0} />
        ) : (
          <>
            <SampleSizeWarning n={advanced.emotionalJourney.sampleSize} min={10} />
            <div style={s.kpiGrid}>
              <KpiCard label="Intended Feeling Achieved" value={advanced.emotionalJourney.intendedFeelingAchievedRate != null ? `${advanced.emotionalJourney.intendedFeelingAchievedRate}%` : "—"} tooltip="% of sessions where desired feeling was fully achieved (Yes answer on desiredFeelingAchieved)." />
              <KpiCard label="Partly Achieved" value={advanced.emotionalJourney.partlyAchievedRate != null ? `${advanced.emotionalJourney.partlyAchievedRate}%` : "—"} />
              <KpiCard label="Avg Confidence Before" value={advanced.emotionalJourney.avgConfidenceBefore != null ? `${advanced.emotionalJourney.avgConfidenceBefore}/10` : "—"} />
              <KpiCard label="Avg Confidence After" value={advanced.emotionalJourney.avgConfidenceAfter != null ? `${advanced.emotionalJourney.avgConfidenceAfter}/10` : "—"} />
              <KpiCard label="Avg Confidence Lift" value={advanced.emotionalJourney.avgConfidenceLift != null ? `${advanced.emotionalJourney.avgConfidenceLift >= 0 ? "+" : ""}${advanced.emotionalJourney.avgConfidenceLift}` : "—"} />
              <KpiCard label="Post-Wear Positive Rate" value={advanced.emotionalJourney.postWearPositiveRate != null ? `${advanced.emotionalJourney.postWearPositiveRate}%` : "—"} suffix="" tooltip="% of post-wear reviews where customer reported feeling great or good." />
            </div>

            {advanced.emotionalJourney.emotionalTransformations.length > 0 && (
              <div style={{ marginTop: 24 }}>
                <div style={s.subHeader}>Mood → Feeling Transformations (min 2 sessions)</div>
                <div style={{ overflowX: "auto" }}>
                  <table style={s.table}>
                    <thead><tr><th style={s.th}>Starting Mood</th><th style={s.th}>Desired Feeling</th><th style={s.th}>Achieved Rate</th><th style={s.th}>Sessions</th></tr></thead>
                    <tbody>
                      {advanced.emotionalJourney.emotionalTransformations.map((t, i) => (
                        <tr key={i} style={{ background: i % 2 === 0 ? "rgba(255,255,255,0.6)" : "transparent" }}>
                          <td style={s.td}>{t.startingMood}</td>
                          <td style={s.td}>{t.desiredFeeling}</td>
                          <td style={s.td}><span style={{ color: t.achievedRate >= 70 ? "#16a34a" : t.achievedRate >= 40 ? "#d97706" : "#dc2626" }}>{t.achievedRate}%</span></td>
                          <td style={s.td}>{t.count}</td>
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
                <div style={s.grid3}>
                  {advanced.emotionalJourney.productsByEmotionalImpact.slice(0, 6).map((p, i) => (
                    <div key={i} style={s.card}>
                      <div style={s.cardLabel}>{p.productTitle}</div>
                      <Metric label="Intended feeling achieved" value={`${p.achievedRate}%`} />
                      <Metric label="Avg confidence lift" value={p.avgConfidenceLift >= 0 ? `+${p.avgConfidenceLift}` : `${p.avgConfidenceLift}`} />
                      <Metric label="Would wear again" value={`${p.rewearRate}%`} />
                      <Metric label="Sample size" value={p.sampleSize} />
                      {p.desiredFeelings.length > 0 && <div style={{ marginTop: 8, fontSize: 12, color: "#8b2035", fontStyle: "italic" }}>{p.desiredFeelings.join(", ")}</div>}
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
              dataContract={advanced.journeyAnalytics.dataContract}
            />
          </>
        ) : (
          <AwaitingCard
            label="Customer Journey Analytics"
            description="Highest-converting journeys, abandonment points, time-to-purchase, same-session / 24h / 7d / 30d attribution. Requires cart and checkout events from Shopify."
            dataContract={advanced?.journeyAnalytics?.dataContract}
          />
        )}
      </Section>

      {/* LTV Intelligence */}
      <Section title="Lifetime Value Intelligence" desc="LTV by style personality, desired feeling, occasion, and first nAia feature" status="awaiting-integration">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 16 }}>
          <AwaitingCard label="Customer Lifetime Value" description="Total order value per customer, segmented by style personality, desired feeling, and acquisition feature." dataContract={advanced?.ltv?.dataContract} />
          <AwaitingCard label="Products Creating Repeat Customers" description="Which products are associated with highest repeat purchase rates." dataContract={null} />
          <AwaitingCard label="Time Between Purchases" description="Average days between first and second purchase for nAia users." dataContract={null} />
        </div>
      </Section>

      {/* Trust Metrics */}
      <Section title="Trust Metrics" desc="How much customers follow and trust nAia recommendations" status={advanced?.trustMetrics?.status || "insufficient-data"}>
        {!advanced?.trustMetrics || advanced.trustMetrics.status === "insufficient-data" ? (
          <InsufficientCard label="Trust Metrics" description="Not enough sessions to calculate reliable trust patterns." sampleSize={advanced?.trustMetrics?.sampleSize ?? 0} />
        ) : (
          <>
            <SampleSizeWarning n={advanced.trustMetrics.sampleSize} min={10} />
            <div style={s.kpiGrid}>
              <KpiCard label="Outfit Selection Rate" value={`${advanced.trustMetrics.selectionRate}%`} tooltip="% of styling sessions where customer selected a suggested outfit." />
              <KpiCard label="Feedback Response Rate" value={`${advanced.trustMetrics.feedbackResponseRate}%`} tooltip="% of sessions where customer provided recommendation feedback." />
              <KpiCard label="Love Rate" value={`${advanced.trustMetrics.loveRate}%`} tooltip="% of feedback responses that are 'Love it'." />
              <KpiCard label="Disagreement Rate" value={`${advanced.trustMetrics.disagreementRate}%`} tooltip="% of feedback responses that are 'Not for me'." />
              <KpiCard label="Repeat Usage Rate" value={`${advanced.trustMetrics.repeatUsageRate}%`} tooltip="% of customers with more than 1 styling session." />
              <KpiCard label="Repeat Customers" value={advanced.trustMetrics.repeatCustomers} />
            </div>
            <AwaitingCard label="Trust Over Time / After Prior Success" description="Trust progression after successful vs. unsuccessful recommendations requires per-customer longitudinal event tracking." dataContract={null} />
          </>
        )}
      </Section>
    </>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// TAB 3 — PRODUCT INTELLIGENCE
// ══════════════════════════════════════════════════════════════════════════════

function TabProduct({ data, phase4b2 }) {
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
                <div>★ {p.avgRating?.toFixed(1)} | Rewear: {Math.round(p.rewear * 100)}%</div>
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
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>{p.topDNA?.map((dna, j) => <span key={j} style={{ padding: "5px 10px", background: "#8b2035", color: "#f4f4f1", borderRadius: 20, fontSize: 11, fontFamily: "'Space Mono', monospace" }}>{dna}</span>)}</div>
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
                <div style={{ display: "flex", gap: 16, marginTop: 8, fontFamily: "'Space Mono', monospace", fontSize: 11, color: "#7a6f6a" }}>
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
              <div key={i} style={{ padding: 16, background: "#fff", border: "1px solid #e5e5e5", borderRadius: 4 }}>
                <div style={{ fontSize: 16, fontWeight: 500, marginBottom: 8 }}>{p.closetItem} + {p.naiaPiece}</div>
                <div style={{ fontSize: 14, color: "#666" }}>{p.avgRating.toFixed(1)}/5 · {p.reviewCount} review{p.reviewCount !== 1 ? "s" : ""} · {Math.round(p.rewearRate * 100)}% would wear again</div>
              </div>
            ))}
          </div>
        ) : <EmptyState message="No pairing data yet. Pairings appear when outfit reviews include both closet items and nAia pieces." />}
      </Section>

      <Section title="Most-Saved vs Most-Purchased" status="awaiting-integration">
        <AwaitingCard label="Save vs Purchase Comparison" description="Which pieces customers save vs. actually purchase. Requires wishlist and Shopify order webhook integration." dataContract={{ required: ["SavedLook table with shopifyProductId", "Shopify order_placed webhook", "Product lookup by shopifyProductId"] }} />
      </Section>

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
    </>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// TAB 4 — RECOMMENDATION INTELLIGENCE
// ══════════════════════════════════════════════════════════════════════════════

function TabRecommendation({ data, kpis, phase4b2, advanced }) {
  return (
    <>
      <Section title="Feedback Engagement" desc="How many styling sessions receive recommendation feedback" status={phase4b2?.feedbackEngagement?.migrationPending ? "awaiting-integration" : "live"}>
        {phase4b2?.feedbackEngagement?.migrationPending ? (
          <MigrationPendingNotice label="Recommendation feedback" />
        ) : (
          <div style={s.kpiGrid}>
            <KpiCard label="Sessions (period)" value={phase4b2.feedbackEngagement.totalSessions} />
            <KpiCard label="With Feedback" value={phase4b2.feedbackEngagement.sessionsWithFeedback} />
            <KpiCard label="Response Rate" value={`${phase4b2.feedbackEngagement.feedbackResponseRate}%`} tooltip="% of styling sessions where at least one feedback response was given." />
          </div>
        )}
      </Section>

      <Section title="Rating Distribution" desc="Love it / It's okay / Not for me breakdown" status={phase4b2?.feedbackDistribution?.migrationPending ? "awaiting-integration" : "live"}>
        {phase4b2?.feedbackDistribution?.migrationPending ? <MigrationPendingNotice label="Feedback distribution" /> : phase4b2?.feedbackDistribution?.total > 0 ? (
          <div style={s.kpiGrid}>
            <KpiCard label="Love it" value={phase4b2.feedbackDistribution.love} suffix={` (${phase4b2.feedbackDistribution.loveRate}%)`} />
            <KpiCard label="It's okay" value={phase4b2.feedbackDistribution.okay} suffix={` (${phase4b2.feedbackDistribution.okayRate}%)`} />
            <KpiCard label="Not for me" value={phase4b2.feedbackDistribution.notForMe} suffix={` (${phase4b2.feedbackDistribution.notForMeRate}%)`} />
          </div>
        ) : <EmptyState message="No feedback recorded yet for this period." />}
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

      <Section title="Buy or Skip Signals" desc="How customers assess new pieces against their wardrobe" status={kpis?.buyOrSkip?.total > 0 ? "live" : "insufficient-data"}>
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
                  <div style={{ fontFamily: "'Space Mono', monospace", fontSize: 11, color: "#7a6f6a", marginBottom: 8 }}>{tag.count} mentions</div>
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
                  <div style={{ fontFamily: "'Space Mono', monospace", fontSize: 11, color: "#7a6f6a", marginBottom: 8 }}>{tag.count} mentions</div>
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
              <div key={i} style={{ padding: 16, background: "#fff", border: "1px solid #e5e5e5", borderRadius: 4, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                <div style={{ fontSize: 15, fontWeight: 500 }}>{obj.name}</div>
                <div style={{ fontSize: 13, color: "#fff", background: "#d97706", padding: "4px 12px", borderRadius: 12, whiteSpace: "nowrap" }}>{obj.count} mentions</div>
              </div>
            ))}
          </div>
        ) : <EmptyState message="No outfit objections recorded yet." />}
      </Section>

      <Section title="Recommendation Explainability Analytics" desc="Do customers agree with nAia's explanations for recommendations?" status="awaiting-integration">
        <AwaitingCard
          label="Explanation Agreement / Disagreement Rate"
          description="Tracks whether customers find AI explanations compelling. Requires logging explanationAgreed and explanationVersion on each feedback record."
          dataContract={advanced?.explainability?.dataContract}
        />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16, marginTop: 16 }}>
          {["Explanation → Click Rate", "Explanation → Save Rate", "Explanation → Purchase Rate", "Reasons That Resonate Most", "Reasons Frequently Rejected", "Explanation Performance by Segment"].map((label) => (
            <div key={label} style={{ ...s.card, borderLeft: "3px solid #6b21a8" }}>
              <div style={{ ...s.cardLabel, color: "#6b21a8" }}>{label}</div>
              <StatusBadge status="awaiting-integration" style={{ marginTop: 8 }} />
            </div>
          ))}
        </div>
      </Section>
    </>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// TAB 5 — COLLECTION INTELLIGENCE
// ══════════════════════════════════════════════════════════════════════════════

function TabCollection({ data, kpis, advanced, dateRangeDays }) {
  return (
    <>
      {/* Collection Health Score */}
      <Section title="Collection Health Score" desc="Transparent partial score from available data factors (full score requires commercial integration)" status={advanced?.collectionHealth?.score != null ? "live" : "insufficient-data"}>
        {advanced?.collectionHealth?.sampleSizeWarning && <SampleSizeWarning n={data.totalLooks} min={10} />}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 20 }}>
          <div style={{ ...s.card, textAlign: "center" }}>
            <div style={{ fontFamily: "'Playfair Display', serif", fontSize: 72, fontWeight: 900, color: "#8b2035", lineHeight: 1 }}>
              {advanced?.collectionHealth?.score != null ? advanced.collectionHealth.score : "—"}
            </div>
            <div style={{ fontFamily: "'Space Mono', monospace", fontSize: 10, color: "#7a6f6a", textTransform: "uppercase", letterSpacing: "2px", marginTop: 8 }}>
              {advanced?.collectionHealth?.factorsAvailable ?? 0} of {advanced?.collectionHealth?.factorsTotal ?? 8} factors available
            </div>
            {advanced?.collectionHealth?.largestWeakness && (
              <div style={{ marginTop: 16, fontSize: 12, color: "#d97706" }}>Largest weakness: {advanced.collectionHealth.largestWeakness.replace(/([A-Z])/g, " $1").trim()}</div>
            )}
            {advanced?.collectionHealth?.strongestArea && (
              <div style={{ marginTop: 8, fontSize: 12, color: "#16a34a" }}>Strongest area: {advanced.collectionHealth.strongestArea.replace(/([A-Z])/g, " $1").trim()}</div>
            )}
          </div>
          {advanced?.collectionHealth?.factors && (
            <div style={s.card}>
              <div style={s.cardLabel}>Factor Breakdown</div>
              {Object.entries(advanced.collectionHealth.factors).map(([key, factor]) => (
                <div key={key} style={{ marginBottom: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                    <span style={{ fontSize: 12, color: "#221516" }}>{key.replace(/([A-Z])/g, " $1").trim()}</span>
                    <span style={{ fontFamily: "'Space Mono', monospace", fontSize: 11, color: factor.score != null ? "#221516" : "#9CA3AF" }}>
                      {factor.score != null ? `${factor.score}/100` : factor.label}
                    </span>
                  </div>
                  {factor.score != null && (
                    <div style={{ height: 4, background: "rgba(59,5,16,0.08)", borderRadius: 2 }}>
                      <div style={{ height: "100%", width: `${Math.min(factor.score, 100)}%`, background: factor.score >= 60 ? "#16a34a" : factor.score >= 30 ? "#d97706" : "#dc2626", borderRadius: 2 }} />
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
              <div style={{ marginTop: 16, padding: "10px 12px", background: "#faf9f7", borderRadius: 4, fontSize: 12, color: "#7a6f6a" }}>
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
              <div style={{ fontFamily: "'Space Mono', monospace", fontSize: 10, color: "#7a6f6a", marginTop: 6 }}>{occ.lookCount} looks · ★{occ.avgRating?.toFixed(1)}</div>
            </div>
          ))}
        </div>
        {data.stylingNeeds?.length > 0 && (
          <div style={{ marginTop: 24 }}>
            <div style={s.subHeader}>All Requested Occasions</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 12 }}>
              {data.stylingNeeds.map((need, i) => (
                <div key={i} style={s.card}>
                  <div style={{ fontSize: 14, color: "#221516" }}>{need.occasion || need.need}</div>
                  <div style={{ fontFamily: "'Space Mono', monospace", fontSize: 10, color: "#7a6f6a", marginTop: 4 }}>{need.count} requests</div>
                </div>
              ))}
            </div>
          </div>
        )}
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
            <div key={i} style={s.card}><div style={s.cardLabel}>{item.color}</div><div style={s.cardValue}>{item.count} customers prefer this</div></div>
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
        <AwaitingCard label="Size Coverage" description="Size coverage analysis requires size data to be collected in StyleMe sessions and linked to product variant availability." dataContract={null} />
      </Section>

      {/* Unmet Needs */}
      <Section title="Unmet Customer Needs" desc="Occasions and needs requested most with insufficient product coverage" status="live">
        {data.stylingNeeds?.length > 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {data.stylingNeeds.slice(0, 8).map((need, i) => (
              <div key={i} style={{ padding: 16, background: "#fff", border: "1px solid #e5e5e5", borderRadius: 4, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 15, color: "#221516" }}>{need.occasion || need.need}</span>
                <span style={{ fontFamily: "'Space Mono', monospace", fontSize: 11, color: "#7a6f6a" }}>{need.count} requests</span>
              </div>
            ))}
          </div>
        ) : <EmptyState />}
      </Section>
    </>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// TAB 6 — COMMERCIAL INTELLIGENCE
// ══════════════════════════════════════════════════════════════════════════════

function TabCommercial({ data, advanced }) {
  return (
    <>
      <Section title="nAia-Assisted Revenue" status="awaiting-integration">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16 }}>
          {["nAia-Assisted Revenue", "% Sales Influenced by nAia", "Highest-Converting Feature", "Revenue per Styling Session", "Revenue per VTO Session", "AOV — nAia vs Non-nAia"].map((label) => (
            <div key={label} style={{ ...s.card, borderLeft: "3px solid #6b21a8" }}>
              <div style={{ ...s.cardLabel, color: "#6b21a8" }}>{label}</div>
              <StatusBadge status="awaiting-integration" style={{ marginTop: 8 }} />
              <p style={{ ...s.muted, marginTop: 8, fontSize: 11 }}>Requires Shopify order_placed webhook + session attribution window.</p>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Styling-to-Shopping Conversion" desc="Does styling lead to clicks, try-ons, and saves?" status={data.conversionStats?.length > 0 ? "live" : "insufficient-data"}>
        {data.conversionStats?.length > 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {data.conversionStats.map((product, i) => (
              <div key={i} style={{ padding: 16, background: "#fff", border: "1px solid #e5e5e5", borderRadius: 4 }}>
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
            <div style={{ padding: "8px 14px", background: "#eff6ff", border: "1px solid #3b82f6", borderRadius: 4, fontSize: 12, color: "#1d4ed8", marginBottom: 16 }}>
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

      {/* LTV */}
      <Section title="Lifetime Value Intelligence" status="awaiting-integration">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16 }}>
          {["LTV by Style Personality", "LTV by Desired Feeling", "LTV by Occasion / Lifestyle", "LTV by First nAia Feature", "Products Driving Repeat Purchase", "Purchase Frequency by Segment"].map((label) => (
            <div key={label} style={{ ...s.card, borderLeft: "3px solid #6b21a8" }}>
              <div style={{ ...s.cardLabel, color: "#6b21a8" }}>{label}</div>
              <StatusBadge status="awaiting-integration" style={{ marginTop: 8 }} />
            </div>
          ))}
        </div>
        <AwaitingCard label="LTV Data Contract" description="All LTV metrics require order data from Shopify." dataContract={advanced?.ltv?.dataContract} />
      </Section>

      {/* Predictive Intelligence */}
      <Section title="Predictive Intelligence" desc="Evidence-based signals with explicit confidence levels — never speculation" status={advanced?.predictive?.status || "insufficient-data"}>
        {advanced?.predictive?.signals?.length > 0 ? (
          <>
            <div style={{ padding: "8px 14px", background: "#eff6ff", border: "1px solid #3b82f6", borderRadius: 4, fontSize: 12, color: "#1d4ed8", marginBottom: 16 }}>
              {advanced.predictive.disclaimer}
            </div>
            {advanced.predictive.signals.map((signal, i) => (
              <div key={i} style={{ ...s.card, marginBottom: 12, borderLeft: "3px solid #1e3a5f" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", marginBottom: 8 }}>
                  <div style={{ fontFamily: "'Space Mono', monospace", fontSize: 9, textTransform: "uppercase", letterSpacing: "2px", color: "#7a6f6a" }}>{signal.type}</div>
                  <StatusBadge status="experimental" />
                </div>
                <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 17, color: "#221516", fontWeight: 600, marginBottom: 8 }}>{signal.label}</div>
                <div style={{ fontSize: 13, color: "#7a6f6a", marginBottom: 8 }}>{signal.evidence}</div>
                <div style={{ display: "flex", gap: 16, fontSize: 11, color: "#9CA3AF", fontFamily: "'Space Mono', monospace" }}>
                  <span>Confidence: {signal.confidence}</span>
                  <span>n={signal.sampleSize}</span>
                  <span>{signal.period}</span>
                </div>
              </div>
            ))}
          </>
        ) : (
          <>
            <div style={{ padding: "8px 14px", background: "#fef3c7", border: "1px solid #d97706", borderRadius: 4, fontSize: 12, color: "#92400e", marginBottom: 16 }}>
              {advanced?.predictive?.disclaimer || "Insufficient data for predictive signals in this period. Need more sessions to detect trends."}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 16 }}>
              {["Likely Product Momentum", "Emerging Colour Demand", "Emerging Mood Demand", "Future Assortment Gaps", "Save-to-Purchase Potential", "Stock / Size Pressure"].map((label) => (
                <div key={label} style={{ ...s.card, borderLeft: "3px solid #1e3a5f" }}>
                  <div style={{ ...s.cardLabel, color: "#1e3a5f" }}>{label}</div>
                  <StatusBadge status="experimental" style={{ marginTop: 8 }} />
                  <p style={{ ...s.muted, marginTop: 8, fontSize: 11 }}>Requires 20+ data points for reliable signals.</p>
                </div>
              ))}
            </div>
          </>
        )}
      </Section>
    </>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// TAB 7 — AI PERFORMANCE
// ══════════════════════════════════════════════════════════════════════════════

function TabAIPerformance({ data, kpis, phase4b2, advanced }) {
  return (
    <>
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

      <Section title="AI Learning Dashboard" desc="Recommendation accuracy, calibration, and model improvement over time" status="awaiting-integration">
        <AwaitingCard label="Recommendation Accuracy Over Time" description="Tracks whether scored recommendations are accepted, purchased, or returned. Requires a RecommendationAccuracyLog table." dataContract={advanced?.aiLearning?.dataContract} />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 16, marginTop: 16 }}>
          {[
            "False Positives (high score, rejected)",
            "False Negatives (moderate score, purchased)",
            "Match Score Calibration",
            "Confidence Calibration",
            "Scoring Weight Performance",
            "Model Improvement by Period",
          ].map((label) => (
            <div key={label} style={{ ...s.card, borderLeft: "3px solid #6b21a8" }}>
              <div style={{ ...s.cardLabel, color: "#6b21a8" }}>{label}</div>
              <StatusBadge status="awaiting-integration" style={{ marginTop: 8 }} />
            </div>
          ))}
        </div>
      </Section>

      <Section title="Feedback-Informed Design Insights" desc="Signals from customer feedback — restrained internal suggestions only" status={phase4b2?.designerInsights?.length > 0 ? "live" : "insufficient-data"}>
        <div style={{ padding: "10px 14px", background: "#faf9f7", borderLeft: "3px solid #8B7355", marginBottom: 20, fontSize: 13, color: "#8B7355", lineHeight: 1.6 }}>
          <strong>Note:</strong> These are internal signals only. No automatic changes are made to products, StyleMe logic, or customer profiles.
        </div>
        {phase4b2?.designerInsights?.length > 0 ? (
          phase4b2.designerInsights.map((insight, i) => <FeedbackInsightCard key={i} insight={insight} />)
        ) : (
          <EmptyState message="No feedback patterns strong enough to surface yet. Signals appear when objections reach threshold levels." />
        )}
      </Section>

      <Section title="StyleMe Session Analytics" desc="Session volume and question patterns" status="live">
        <div style={s.kpiGrid}>
          <KpiCard label="Sessions (30d)" value={kpis?.recentActivity?.sessions ?? "—"} />
          <KpiCard label="Outfit Reviews (30d)" value={kpis?.recentActivity?.reviews ?? "—"} />
          <KpiCard label="Total Sessions" value={data.totalLooks ?? "—"} />
          <KpiCard label="Avg Rating All-Time" value={(data.avgRating || 0).toFixed(1)} suffix="/5" />
        </div>
      </Section>
    </>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// TAB 8 — DESIGN OPPORTUNITIES
// ══════════════════════════════════════════════════════════════════════════════

function TabOpportunities({ data, phase4b2, advanced }) {
  return (
    <>
      {/* Designer Opportunity Feed */}
      <Section title="Designer Opportunity Feed" desc="Prioritised actionable insights from customer data" status={advanced?.opportunityFeed?.length > 0 ? "live" : "insufficient-data"}>
        <div style={{ padding: "10px 14px", background: "#faf9f7", borderLeft: "3px solid #8B7355", marginBottom: 20, fontSize: 13, color: "#8B7355", lineHeight: 1.6 }}>
          <strong>Note:</strong> All opportunities are derived from real customer data. No insights are invented when data is insufficient. Status tracking (Reviewing / Actioned / Dismissed) requires a DesignerOpportunity DB table.
        </div>
        {advanced?.opportunityFeed?.length > 0 ? (
          advanced.opportunityFeed.map((opp, i) => (
            <div key={i} style={{ ...s.card, marginBottom: 16, borderLeft: `4px solid ${opp.confidence === "high" ? "#221516" : opp.confidence === "medium" ? "#8B7355" : "#9CA3AF"}` }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
                <div style={{ fontFamily: "'Space Mono', monospace", fontSize: 9, textTransform: "uppercase", letterSpacing: "2px", color: "#7a6f6a" }}>{opp.type ?? opp.id.split("-")[0]}</div>
                <div style={{ display: "flex", gap: 8 }}>
                  <span style={{ fontSize: 9, fontFamily: "'Space Mono', monospace", padding: "3px 8px", background: opp.estimatedCommercialRelevance === "high" ? "#14532d" : opp.estimatedCommercialRelevance === "medium" ? "#78350f" : "#374151", color: "#fff", borderRadius: 3 }}>{opp.estimatedCommercialRelevance} relevance</span>
                  <span style={{ fontSize: 9, fontFamily: "'Space Mono', monospace", padding: "3px 8px", background: "#1e3a5f", color: "#bae6fd", borderRadius: 3 }}>confidence: {opp.confidence}</span>
                </div>
              </div>
              <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 17, fontWeight: 600, color: "#221516", marginBottom: 6 }}>{opp.insight}</div>
              <div style={{ fontSize: 13, color: "#7a6f6a", marginBottom: 8 }}>Customer need: {opp.customerNeed}</div>
              <div style={{ fontSize: 12, color: "#9CA3AF", marginBottom: 10 }}>Evidence: {opp.evidence} · {opp.timePeriod}</div>
              <div style={{ padding: "10px 12px", background: "rgba(59,5,16,0.04)", borderRadius: 4, fontSize: 13, color: "#221516" }}>
                <strong>Suggested action:</strong> {opp.suggestedAction}
              </div>
            </div>
          ))
        ) : (
          <EmptyState message="No actionable opportunities yet. Opportunities appear when patterns cross minimum data thresholds." />
        )}
      </Section>

      {/* Design Actions */}
      <Section title="Design Actions" desc="Piece-specific recommended next steps from customer feedback" status={data.designActions?.length > 0 ? "live" : "insufficient-data"}>
        <div style={{ padding: "10px 14px", background: "#faf9f7", borderLeft: "3px solid #8B7355", marginBottom: 20, fontSize: 13, color: "#8B7355", lineHeight: 1.6 }}>
          <strong>Note:</strong> Recommendations become more confident after 5+ reviews per piece. Early signals should guide testing and styling content, not final production decisions.
        </div>
        {data.designActions?.length > 0 ? (
          data.designActions.map((action, i) => <DesignActionCard key={i} action={action} />)
        ) : (
          <EmptyState message="No design actions yet. Actions appear once pieces have at least 1 review." />
        )}
      </Section>

      {/* User Quotes */}
      <Section title="Customer Quotes" desc="Qualitative insights from outfit reviews" status={data.quotes?.length > 0 ? "live" : "insufficient-data"}>
        {data.quotes?.length > 0 ? (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(350px, 1fr))", gap: 16 }}>
            {data.quotes.map((quote, i) => (
              <div key={i} style={{ padding: 24, background: "rgba(255,255,255,0.8)", border: "1px solid rgba(59,5,16,0.06)", borderLeft: "3px solid #8b2035" }}>
                <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 16, fontStyle: "italic", color: "#221516", marginBottom: 12, lineHeight: 1.7 }}>"{quote.text}"</div>
                {quote.piece && <div style={{ fontFamily: "'Space Mono', monospace", fontSize: 10, color: "#7a6f6a", letterSpacing: "1px" }}>— about {quote.piece}</div>}
              </div>
            ))}
          </div>
        ) : <EmptyState />}
      </Section>

      {/* Designer Experimentation */}
      <Section title="Designer Experimentation" desc="Structured experiments tracking design hypotheses against customer outcomes" status="awaiting-integration">
        <AwaitingCard
          label="Experiment Builder"
          description="A/B tests and design experiments comparing design variants, colourways, or styling anchors against customer emotional response, recommendation score, saves, and conversion."
          dataContract={advanced?.experimentation?.dataContract}
        />
        <div style={{ marginTop: 16 }}>
          <div style={s.subHeader}>Experiment Fields (data contract)</div>
          <div style={{ overflowX: "auto" }}>
            <table style={s.table}>
              <thead><tr><th style={s.th}>Field</th><th style={s.th}>Type</th><th style={s.th}>Description</th></tr></thead>
              <tbody>
                {[
                  ["name", "String", "Experiment name"],
                  ["hypothesis", "String", "What outcome is expected and why"],
                  ["productId", "String?", "Shopify product ID if applicable"],
                  ["variantDescription", "String", "What is being varied (colour, silhouette, fabric)"],
                  ["audienceSegment", "String", "Target customer segment"],
                  ["startDate / endDate", "DateTime", "Test period"],
                  ["exposureCount", "Int", "Number of customers exposed"],
                  ["purchaseIntentRate", "Float?", "% who expressed purchase intent"],
                  ["emotionalResponseSummary", "String?", "Aggregate emotional outcome"],
                  ["recommendationScore", "Float?", "Avg nAia score during test"],
                  ["conversionRate", "Float?", "Conversion % (requires order integration)"],
                  ["confidence", "String", "Statistical confidence level"],
                  ["result", "String?", "Outcome summary"],
                  ["recommendedAction", "String?", "Suggested next step"],
                  ["status", "Enum", "active | complete | inconclusive | cancelled"],
                ].map(([field, type, desc], i) => (
                  <tr key={i} style={{ background: i % 2 === 0 ? "rgba(255,255,255,0.6)" : "transparent" }}>
                    <td style={{ ...s.td, fontFamily: "'Space Mono', monospace", fontSize: 11 }}>{field}</td>
                    <td style={{ ...s.td, color: "#7a6f6a", fontSize: 11 }}>{type}</td>
                    <td style={s.td}>{desc}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </Section>
    </>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s = {
  wrap: { background: "#f4f4f1", minHeight: "100vh", paddingBottom: 80 },
  inner: { maxWidth: 1500, margin: "0 auto", padding: "0 40px" },
  header: { paddingTop: 48, paddingBottom: 32, borderBottom: "1px solid rgba(59,5,16,0.1)", marginBottom: 0 },
  h1: { fontFamily: "'Playfair Display', serif", fontSize: "clamp(36px, 5vw, 60px)", fontWeight: 900, lineHeight: 1, margin: "0 0 12px", color: "#221516" },
  subtitle: { fontFamily: "'Cormorant Garamond', serif", fontSize: 18, fontStyle: "italic", color: "#7a6f6a", margin: 0 },
  tabBar: { display: "flex", gap: 0, overflowX: "auto", borderBottom: "1px solid rgba(59,5,16,0.1)", marginBottom: 32, paddingTop: 16 },
  tabBtn: { background: "none", border: "none", cursor: "pointer", padding: "10px 18px", fontFamily: "'Space Mono', monospace", fontSize: 10, textTransform: "uppercase", letterSpacing: "1.5px", whiteSpace: "nowrap", transition: "color 0.15s" },
  section: { marginBottom: 40, background: "rgba(255,255,255,0.6)", padding: "36px 40px", border: "1px solid rgba(59,5,16,0.06)", backdropFilter: "blur(10px)" },
  h2: { fontFamily: "'Playfair Display', serif", fontSize: 26, fontWeight: 700, margin: "0 0 8px", color: "#221516" },
  sectionDesc: { fontFamily: "'Cormorant Garamond', serif", fontSize: 15, color: "#7a6f6a", margin: "0 0 28px", fontStyle: "italic" },
  subHeader: { fontFamily: "'Space Mono', monospace", fontSize: 9, textTransform: "uppercase", letterSpacing: "2.5px", color: "#7a6f6a", marginBottom: 14, marginTop: 8 },
  kpiGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 16 },
  kpiCard: { padding: "20px 24px", background: "rgba(255,255,255,0.9)", border: "1px solid rgba(59,5,16,0.08)", position: "relative" },
  kpiValue: { fontFamily: "'Playfair Display', serif", fontSize: 32, fontWeight: 700, color: "#8b2035", marginBottom: 8, marginTop: 6 },
  kpiLabel: { fontFamily: "'Space Mono', monospace", fontSize: 9, color: "#7a6f6a", textTransform: "uppercase", letterSpacing: "2px", lineHeight: 1.5 },
  card: { padding: "20px 24px", background: "rgba(255,255,255,0.8)", border: "1px solid rgba(59,5,16,0.06)" },
  cardLabel: { fontFamily: "'Cormorant Garamond', serif", fontSize: 17, fontWeight: 600, color: "#221516", marginBottom: 6 },
  cardValue: { fontFamily: "'Space Mono', monospace", fontSize: 11, letterSpacing: "1px", color: "#7a6f6a" },
  grid3: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 16 },
  pieceGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 16 },
  pieceCard: { padding: 24, background: "rgba(255,255,255,0.8)", border: "1px solid rgba(59,5,16,0.06)" },
  pieceName: { fontFamily: "'Playfair Display', serif", fontSize: 19, fontWeight: 600, marginBottom: 6, color: "#221516" },
  pieceCategory: { fontFamily: "'Space Mono', monospace", fontSize: 9, color: "#7a6f6a", textTransform: "uppercase", letterSpacing: "2px", marginBottom: 14 },
  pieceStats: { fontFamily: "'Cormorant Garamond', serif", fontSize: 14, color: "#221516", lineHeight: 1.7 },
  muted: { color: "#7a6f6a", fontSize: 13, fontFamily: "'Cormorant Garamond', serif" },
  helpedFeel: { fontStyle: "italic", color: "#8b2035", fontFamily: "'Cormorant Garamond', serif" },
  dnaStyle: { fontSize: 14, color: "#8b2035", fontFamily: "'Cormorant Garamond', serif", fontStyle: "italic" },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 13, fontFamily: "'Cormorant Garamond', serif", minWidth: 400 },
  th: { textAlign: "left", padding: "8px 12px", fontFamily: "'Space Mono', monospace", fontSize: 9, textTransform: "uppercase", letterSpacing: "1.5px", color: "#7a6f6a", borderBottom: "1px solid rgba(59,5,16,0.1)", background: "rgba(59,5,16,0.02)" },
  td: { padding: "10px 12px", borderBottom: "1px solid rgba(59,5,16,0.05)", color: "#221516", fontSize: 13 },
  linkBtn: { background: "none", border: "none", cursor: "pointer", padding: "4px 0", fontSize: 11, color: "#8b2035", fontFamily: "'Space Mono', monospace", textDecoration: "underline", marginTop: 10, display: "block" },
  periodBtn: { padding: "6px 12px", border: "1px solid rgba(59,5,16,0.2)", cursor: "pointer", fontFamily: "'Space Mono', monospace", fontSize: 9, textTransform: "uppercase", letterSpacing: "1px", borderRadius: 3 },
};
