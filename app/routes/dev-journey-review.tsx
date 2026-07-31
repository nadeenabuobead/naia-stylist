// app/routes/dev-journey-review.tsx
// Phase 4B3 — Dev review journey demonstrating the full feature integration.
// Returns 404 unless DEV_TRYON_UI_ENABLED=true.
//
// Shows 9 customer scenarios:
//   1. Full-data customer
//   2. No-selfie customer
//   3. Empty Closet customer
//   4. No My nAia Model
//   5. Pending Closet assessment
//   6. Ineligible try-on product
//   7. Feedback history present
//   8. Migration-pending features
//   9. System/provider failure with graceful fallback
//
// All data is fixture-only — no real DB calls, no provider calls, no PII.

import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { data } from "react-router";
import {
  aggregateClosetSummary,
  buildSelfieSignalSummary,
  buildFeedbackSignalContext,
  computeFeatureAvailability,
  computeVtoGate,
  emptyClosetSummary,
  emptyFeedbackContext,
  emptyMigrationStatus,
  type CustomerJourneyContext,
  type MigrationStatus,
} from "~/lib/ai/journey-contract";

// ── Fixture helpers ───────────────────────────────────────────────────────────

function fixtureContext(overrides: Partial<CustomerJourneyContext> = {}): CustomerJourneyContext {
  const selfieSignals = buildSelfieSignalSummary({
    colourFamilies: ["warm neutrals", "earth tones"],
    suggestedNecklines: ["V-neck", "wrap"],
    contrastLevel: "medium",
    overallNote: "Warm skin undertones complement earth-toned palettes.",
  });

  const closetItems = [
    { category: "TOPS",   tryOnEligibility: "ready-for-try-on" },
    { category: "SHOES",  tryOnEligibility: "ready-for-try-on" },
    { category: "BAGS",   tryOnEligibility: "pending-assessment" },
    { category: "BOTTOMS",tryOnEligibility: "needs-clearer-photo" },
  ];
  const closetSummary = aggregateClosetSummary(closetItems);

  const feedbackContext = buildFeedbackSignalContext({
    records: [
      { rating: "not-for-me", reasonCodes: ["too-formal", "colour-not-for-me"] },
      { rating: "not-for-me", reasonCodes: ["too-formal"] },
      { rating: "love",       reasonCodes: [] },
      { rating: "okay",       reasonCodes: ["too-formal"] },
    ],
    positivePostWearRate: 0.75,
    migrationPending: false,
    postWearMigrationPending: false,
  });

  const features = computeFeatureAvailability({
    closetSummary,
    selfieSignals,
    naiaModelReady: true,
    virtualTryOnEnabled: false, // VIRTUAL_TRY_ON_ENABLED stays false
    feedbackContext,
  });

  return {
    selfieSignals,
    closetSummary,
    feedbackContext,
    features,
    migrationStatus: emptyMigrationStatus(),
    ...overrides,
  };
}

// ── Scenario definitions ──────────────────────────────────────────────────────

type Scenario = {
  id: string;
  label: string;
  description: string;
  context: CustomerJourneyContext;
  vtoGate: ReturnType<typeof computeVtoGate>;
  eligibleProduct: boolean;
  systemFailure?: string;
};

function buildScenarios(): Scenario[] {
  // 1. Full-data customer
  const full = fixtureContext();

  // 2. No-selfie customer
  const noSelfieCloset = aggregateClosetSummary([
    { category: "TOPS",  tryOnEligibility: "ready-for-try-on" },
    { category: "SHOES", tryOnEligibility: "ready-for-try-on" },
  ]);
  const noSelfieFeedback = buildFeedbackSignalContext({
    records: [
      { rating: "love", reasonCodes: [] },
      { rating: "love", reasonCodes: [] },
    ],
    positivePostWearRate: null,
    migrationPending: false,
    postWearMigrationPending: false,
  });
  const noSelfie: CustomerJourneyContext = {
    selfieSignals: null,
    closetSummary: noSelfieCloset,
    feedbackContext: noSelfieFeedback,
    features: computeFeatureAvailability({
      closetSummary: noSelfieCloset,
      selfieSignals: null,
      naiaModelReady: true,
      virtualTryOnEnabled: false,
      feedbackContext: noSelfieFeedback,
    }),
    migrationStatus: emptyMigrationStatus(),
  };

  // 3. Empty Closet customer
  const emptyClosetCtx: CustomerJourneyContext = {
    selfieSignals: buildSelfieSignalSummary({
      colourFamilies: ["cool tones"],
      suggestedNecklines: ["boat neck"],
      contrastLevel: "low",
      overallNote: "Cool undertones suit muted palettes.",
    }),
    closetSummary: emptyClosetSummary(),
    feedbackContext: emptyFeedbackContext(),
    features: computeFeatureAvailability({
      closetSummary: emptyClosetSummary(),
      selfieSignals: buildSelfieSignalSummary({
        colourFamilies: ["cool tones"],
        suggestedNecklines: ["boat neck"],
        contrastLevel: "low",
        overallNote: "Cool undertones suit muted palettes.",
      }),
      naiaModelReady: false,
      virtualTryOnEnabled: false,
      feedbackContext: emptyFeedbackContext(),
    }),
    migrationStatus: emptyMigrationStatus(),
  };

  // 4. No My nAia Model
  const noModelCloset = aggregateClosetSummary([
    { category: "TOPS", tryOnEligibility: "ready-for-try-on" },
  ]);
  const noModelCtx: CustomerJourneyContext = {
    selfieSignals: full.selfieSignals,
    closetSummary: noModelCloset,
    feedbackContext: full.feedbackContext,
    features: computeFeatureAvailability({
      closetSummary: noModelCloset,
      selfieSignals: full.selfieSignals,
      naiaModelReady: false,
      virtualTryOnEnabled: false,
      feedbackContext: full.feedbackContext,
    }),
    migrationStatus: emptyMigrationStatus(),
  };

  // 5. Pending Closet assessment
  const pendingCloset = aggregateClosetSummary([
    { category: "TOPS",   tryOnEligibility: "pending-assessment" },
    { category: "SHOES",  tryOnEligibility: "pending-assessment" },
    { category: "BAGS",   tryOnEligibility: "pending-assessment" },
  ]);
  const pendingCtx: CustomerJourneyContext = {
    selfieSignals: null,
    closetSummary: pendingCloset,
    feedbackContext: emptyFeedbackContext(),
    features: computeFeatureAvailability({
      closetSummary: pendingCloset,
      selfieSignals: null,
      naiaModelReady: true,
      virtualTryOnEnabled: false,
      feedbackContext: emptyFeedbackContext(),
    }),
    migrationStatus: emptyMigrationStatus(),
  };

  // 6. Ineligible try-on product (all other context present and healthy)
  const ineligibleCtx = fixtureContext();

  // 7. Feedback history present
  const richFeedback = buildFeedbackSignalContext({
    records: [
      { rating: "not-for-me", reasonCodes: ["too-formal", "colour-not-for-me"] },
      { rating: "not-for-me", reasonCodes: ["too-formal", "fit-shape-not-for-me"] },
      { rating: "not-for-me", reasonCodes: ["too-formal"] },
      { rating: "not-for-me", reasonCodes: ["colour-not-for-me"] },
      { rating: "love",       reasonCodes: [] },
    ],
    positivePostWearRate: 0.6,
    migrationPending: false,
    postWearMigrationPending: false,
  });
  const feedbackCtx: CustomerJourneyContext = {
    selfieSignals: full.selfieSignals,
    closetSummary: full.closetSummary,
    feedbackContext: richFeedback,
    features: computeFeatureAvailability({
      closetSummary: full.closetSummary,
      selfieSignals: full.selfieSignals,
      naiaModelReady: true,
      virtualTryOnEnabled: false,
      feedbackContext: richFeedback,
    }),
    migrationStatus: emptyMigrationStatus(),
  };

  // 8. Migration-pending features
  const migrationFeedback = emptyFeedbackContext({
    migrationPending: true,
    postWearMigrationPending: true,
  });
  const migrationStatus: MigrationStatus = {
    recommendationFeedbackPending: true,
    selfieAnalysisPending: true,
    postWearColumnsPending: true,
  };
  const migrationCtx: CustomerJourneyContext = {
    selfieSignals: null, // selfie table not migrated
    closetSummary: aggregateClosetSummary([
      { category: "TOPS", tryOnEligibility: "ready-for-try-on" },
    ]),
    feedbackContext: migrationFeedback,
    features: computeFeatureAvailability({
      closetSummary: aggregateClosetSummary([
        { category: "TOPS", tryOnEligibility: "ready-for-try-on" },
      ]),
      selfieSignals: null,
      naiaModelReady: true,
      virtualTryOnEnabled: false,
      feedbackContext: migrationFeedback,
    }),
    migrationStatus,
  };

  // 9. System/provider failure (graceful fallback)
  const failureCtx: CustomerJourneyContext = {
    selfieSignals: null,
    closetSummary: emptyClosetSummary(),
    feedbackContext: emptyFeedbackContext(),
    features: computeFeatureAvailability({
      closetSummary: emptyClosetSummary(),
      selfieSignals: null,
      naiaModelReady: false,
      virtualTryOnEnabled: false,
      feedbackContext: emptyFeedbackContext(),
    }),
    migrationStatus: emptyMigrationStatus(),
  };

  return [
    {
      id: "full-data",
      label: "Full-data customer",
      description: "Selfie analysis completed · Closet with eligible items · Model ready · Feedback history",
      context: full,
      vtoGate: computeVtoGate({ globalEnabled: false, naiaModelReady: true, productEligible: true }),
      eligibleProduct: true,
    },
    {
      id: "no-selfie",
      label: "No selfie",
      description: "Closet present · Model ready · No selfie analysis — StyleMe proceeds without selfie guidance",
      context: noSelfie,
      vtoGate: computeVtoGate({ globalEnabled: false, naiaModelReady: true, productEligible: true }),
      eligibleProduct: true,
    },
    {
      id: "empty-closet",
      label: "Empty Closet",
      description: "Selfie available · No closet items — NADINE-only recommendations",
      context: emptyClosetCtx,
      vtoGate: computeVtoGate({ globalEnabled: false, naiaModelReady: false, productEligible: true }),
      eligibleProduct: true,
    },
    {
      id: "no-model",
      label: "No My nAia Model",
      description: "Closet + selfie available · No model photos or consent — VTO CTAs hidden",
      context: noModelCtx,
      vtoGate: computeVtoGate({ globalEnabled: false, naiaModelReady: false, productEligible: true }),
      eligibleProduct: true,
    },
    {
      id: "pending-closet",
      label: "Pending Closet assessment",
      description: "All closet items awaiting visual assessment — try-on CTAs show pending state",
      context: pendingCtx,
      vtoGate: computeVtoGate({ globalEnabled: false, naiaModelReady: true, productEligible: true }),
      eligibleProduct: true,
    },
    {
      id: "ineligible-product",
      label: "Ineligible try-on product",
      description: "All other context healthy — product not in eligible set, CTA suppressed only for this product",
      context: ineligibleCtx,
      vtoGate: computeVtoGate({ globalEnabled: false, naiaModelReady: true, productEligible: false }),
      eligibleProduct: false,
    },
    {
      id: "feedback-history",
      label: "Feedback history present",
      description: "Rich feedback signal context — patterns visible to designer intelligence (SOFT_RANK only)",
      context: feedbackCtx,
      vtoGate: computeVtoGate({ globalEnabled: false, naiaModelReady: true, productEligible: true }),
      eligibleProduct: true,
    },
    {
      id: "migration-pending",
      label: "Migration-pending features",
      description: "Phase 4B1 + 4A8 tables not yet applied — selfie, feedback, post-wear all show pending state",
      context: migrationCtx,
      vtoGate: computeVtoGate({ globalEnabled: false, naiaModelReady: true, productEligible: true }),
      eligibleProduct: true,
    },
    {
      id: "system-failure",
      label: "System / provider failure",
      description: "Closet DB error + selfie provider unavailable — graceful fallback, StyleMe still available",
      context: failureCtx,
      vtoGate: computeVtoGate({ globalEnabled: false, naiaModelReady: false, productEligible: true }),
      eligibleProduct: true,
      systemFailure: "Closet items unavailable · Selfie analysis provider error · Model not set up",
    },
  ];
}

// ── Loader ────────────────────────────────────────────────────────────────────

export async function loader({ request: _ }: LoaderFunctionArgs) {
  if (process.env.DEV_TRYON_UI_ENABLED !== "true") {
    throw new Response("Not Found", { status: 404 });
  }
  return data({ scenarios: buildScenarios() });
}

// ── Styles ────────────────────────────────────────────────────────────────────

const MONO: React.CSSProperties  = { fontFamily: "'Space Mono', monospace" };
const SERIF: React.CSSProperties = { fontFamily: "'Cormorant Garamond', Garamond, serif" };
const DEEP = "#1a1816";
const MUTED = "#8B7355";
const ACCENT = "#8b2035";
const SUBTLE = "rgba(59,5,16,0.05)";

// ── Sub-components ────────────────────────────────────────────────────────────

function Badge({ label, ok }: { label: string; ok: boolean }) {
  return (
    <span style={{
      ...MONO, display: "inline-block", fontSize: "7px", letterSpacing: "1.5px",
      textTransform: "uppercase", padding: "2px 6px", marginRight: "4px", marginBottom: "4px",
      background: ok ? "rgba(30,90,30,0.08)" : "rgba(59,5,16,0.06)",
      border: `1px solid ${ok ? "rgba(30,90,30,0.3)" : "rgba(59,5,16,0.12)"}`,
      color: ok ? "#2a6b2a" : MUTED,
    }}>
      {ok ? "✓ " : "– "}{label}
    </span>
  );
}

function MigrationFlag({ label }: { label: string }) {
  return (
    <span style={{
      ...MONO, display: "inline-block", fontSize: "7px", letterSpacing: "1.5px",
      textTransform: "uppercase", padding: "2px 6px", marginRight: "4px", marginBottom: "4px",
      background: "rgba(180,120,0,0.07)", border: "1px dashed rgba(180,120,0,0.4)",
      color: "#8a6200",
    }}>
      ⋯ {label} — migration pending
    </span>
  );
}

function ScenarioCard({ scenario }: { scenario: Scenario }) {
  const { context: ctx, vtoGate, eligibleProduct } = scenario;
  const f = ctx.features;
  const ms = ctx.migrationStatus;

  return (
    <div style={{
      background: "#fff", border: "1px solid rgba(59,5,16,0.09)",
      marginBottom: "32px", overflow: "hidden",
    }}>
      {/* Header */}
      <div style={{ padding: "20px 24px 16px", borderBottom: "1px solid rgba(59,5,16,0.06)", background: SUBTLE }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "12px" }}>
          <div>
            <div style={{ ...MONO, fontSize: "8px", letterSpacing: "3px", textTransform: "uppercase", color: ACCENT, marginBottom: "6px" }}>
              {scenario.id}
            </div>
            <h3 style={{ ...SERIF, fontSize: "20px", fontWeight: 700, color: DEEP, margin: 0 }}>
              {scenario.label}
            </h3>
          </div>
          {scenario.systemFailure && (
            <span style={{
              ...MONO, fontSize: "7px", letterSpacing: "1.5px", textTransform: "uppercase",
              padding: "3px 8px", background: "rgba(180,30,30,0.07)",
              border: "1px dashed rgba(180,30,30,0.3)", color: "#7a1a1a",
            }}>
              failure scenario
            </span>
          )}
        </div>
        <p style={{ ...SERIF, fontSize: "13px", fontStyle: "italic", color: MUTED, margin: "8px 0 0" }}>
          {scenario.description}
        </p>
      </div>

      <div style={{ padding: "20px 24px" }}>

        {/* System failure notice */}
        {scenario.systemFailure && (
          <div style={{ marginBottom: "20px", padding: "12px 16px", background: "rgba(180,30,30,0.04)", border: "1px dashed rgba(180,30,30,0.2)", fontSize: "12px", color: "#7a1a1a", ...MONO }}>
            {scenario.systemFailure}
          </div>
        )}

        {/* Migration flags */}
        {(ms.selfieAnalysisPending || ms.recommendationFeedbackPending || ms.postWearColumnsPending) && (
          <div style={{ marginBottom: "16px" }}>
            {ms.selfieAnalysisPending && <MigrationFlag label="Selfie Analysis (Phase 4A8)" />}
            {ms.recommendationFeedbackPending && <MigrationFlag label="Recommendation Feedback (Phase 4B1)" />}
            {ms.postWearColumnsPending && <MigrationFlag label="Post-Wear Columns (Phase 4B1)" />}
          </div>
        )}

        {/* Feature availability */}
        <div style={{ marginBottom: "20px" }}>
          <div style={{ ...MONO, fontSize: "8px", letterSpacing: "2px", textTransform: "uppercase", color: MUTED, marginBottom: "10px" }}>
            Feature availability
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "2px" }}>
            <Badge label="StyleMe" ok={f.canStyleMe} />
            <Badge label="Closet items" ok={f.hasClosetItems} />
            <Badge label="Eligible closet VTO" ok={f.hasEligibleClosetItems} />
            <Badge label="Selfie signals" ok={f.hasSelfieSignals} />
            <Badge label="My nAia Model" ok={f.naiaModelIsReady} />
            <Badge label="Virtual try-on" ok={f.virtualTryOnAvailable} />
            <Badge label="Feedback history" ok={f.feedbackHistoryAvailable} />
            <Badge label="Post-wear history" ok={f.postWearHistoryAvailable} />
          </div>
        </div>

        {/* Two-column detail */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>

          {/* Closet summary */}
          <div>
            <div style={{ ...MONO, fontSize: "8px", letterSpacing: "2px", textTransform: "uppercase", color: MUTED, marginBottom: "8px" }}>
              Closet
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px" }}>
              {[
                ["Total items", ctx.closetSummary.totalItems],
                ["Ready for try-on", ctx.closetSummary.eligibleForTryOn],
                ["Pending assessment", ctx.closetSummary.pendingAssessment],
                ["Not eligible", ctx.closetSummary.notEligible],
                ["Clothing", ctx.closetSummary.byCategory.clothing],
                ["Shoes", ctx.closetSummary.byCategory.shoes],
                ["Bags", ctx.closetSummary.byCategory.bags],
              ].map(([k, v]) => (
                <tr key={String(k)} style={{ borderBottom: "1px solid rgba(59,5,16,0.04)" }}>
                  <td style={{ padding: "4px 0", color: MUTED }}>{k}</td>
                  <td style={{ padding: "4px 0", color: DEEP, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{v}</td>
                </tr>
              ))}
            </table>
          </div>

          {/* VTO gate + selfie */}
          <div>
            <div style={{ ...MONO, fontSize: "8px", letterSpacing: "2px", textTransform: "uppercase", color: MUTED, marginBottom: "8px" }}>
              VTO gate — this product
            </div>
            <div style={{ marginBottom: "12px" }}>
              <div style={{ fontSize: "12px", color: vtoGate.allowed ? "#2a6b2a" : ACCENT, fontWeight: 600 }}>
                {vtoGate.allowed ? "Allowed" : `Blocked — ${vtoGate.blockedReason}`}
              </div>
              <div style={{ fontSize: "11px", color: MUTED, marginTop: "4px" }}>
                Product eligible: {eligibleProduct ? "yes" : "no (ineligible handle)"}
              </div>
            </div>

            <div style={{ ...MONO, fontSize: "8px", letterSpacing: "2px", textTransform: "uppercase", color: MUTED, marginBottom: "8px", marginTop: "16px" }}>
              Selfie signals
            </div>
            {ctx.selfieSignals ? (
              <div style={{ fontSize: "12px", color: DEEP }}>
                <div>Colours: {ctx.selfieSignals.colourFamilies.join(", ")}</div>
                <div style={{ color: MUTED, marginTop: "2px" }}>Necklines: {ctx.selfieSignals.suggestedNecklines.join(", ")}</div>
                <div style={{ marginTop: "4px", padding: "4px 8px", background: SUBTLE, ...MONO, fontSize: "7px", color: MUTED, letterSpacing: "1px" }}>
                  behaviour: {ctx.selfieSignals.behaviour}
                </div>
              </div>
            ) : (
              <div style={{ fontSize: "12px", color: MUTED, fontStyle: "italic" }}>
                {ms.selfieAnalysisPending ? "Migration pending" : "Not available"}
              </div>
            )}
          </div>

        </div>

        {/* Feedback context */}
        {ctx.feedbackContext.available && ctx.feedbackContext.totalFeedback > 0 && (
          <div style={{ marginTop: "20px" }}>
            <div style={{ ...MONO, fontSize: "8px", letterSpacing: "2px", textTransform: "uppercase", color: MUTED, marginBottom: "8px" }}>
              Feedback signals (SOFT_RANK only)
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginBottom: "8px" }}>
              {ctx.feedbackContext.activePatterns.map((p) => (
                <div key={p.reason} style={{
                  padding: "6px 12px", background: SUBTLE,
                  border: "1px solid rgba(59,5,16,0.08)", fontSize: "12px",
                }}>
                  <span style={{ color: DEEP }}>{p.reason}</span>
                  <span style={{ color: MUTED, marginLeft: "8px" }}>×{p.count}</span>
                  <span style={{ ...MONO, fontSize: "7px", color: MUTED, marginLeft: "8px" }}>{p.behaviour}</span>
                </div>
              ))}
            </div>
            {ctx.feedbackContext.positivePostWearRate !== null && (
              <div style={{ fontSize: "12px", color: MUTED }}>
                Post-wear positive rate: {Math.round(ctx.feedbackContext.positivePostWearRate * 100)}%
              </div>
            )}
          </div>
        )}
        {ctx.feedbackContext.migrationPending && (
          <div style={{ marginTop: "16px", ...MONO, fontSize: "11px", color: "#8a6200", fontStyle: "italic" }}>
            Feedback context unavailable — Phase 4B1 migration not yet applied.
          </div>
        )}

      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function DevJourneyReview() {
  const { scenarios } = useLoaderData<typeof loader>();

  return (
    <div style={{ minHeight: "100vh", background: "#f4f4f1", color: DEEP }}>

      {/* Nav */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "20px 40px", borderBottom: "1px solid rgba(59,5,16,0.07)" }}>
        <a href="/" style={{ ...MONO, fontSize: "9px", letterSpacing: "2px", textTransform: "uppercase", color: MUTED, textDecoration: "none" }}>← Back</a>
        <div style={{ fontFamily: "'Playfair Display', Georgia, serif", fontSize: "22px", fontStyle: "italic", letterSpacing: "3px", color: DEEP }}>nAia</div>
        <span style={{ ...MONO, padding: "4px 10px", background: ACCENT, color: "#f4f4f1", fontSize: "7px", letterSpacing: "2px" }}>DEV</span>
      </div>

      <main style={{ maxWidth: "960px", margin: "0 auto", padding: "48px 40px 80px" }}>

        {/* Header */}
        <div style={{ marginBottom: "48px" }}>
          <div style={{ ...MONO, fontSize: "9px", letterSpacing: "4px", textTransform: "uppercase", color: ACCENT, marginBottom: "12px" }}>
            Phase 4B3 · Dev Review
          </div>
          <h1 style={{ fontFamily: "'Playfair Display', Georgia, serif", fontSize: "clamp(28px,4vw,42px)", fontWeight: 900, color: DEEP, letterSpacing: "-1px", margin: "0 0 12px" }}>
            Unified Feature Integration
          </h1>
          <p style={{ ...SERIF, fontSize: "16px", fontStyle: "italic", color: MUTED, maxWidth: "600px" }}>
            9 customer journey scenarios demonstrating signal precedence, optional-data fallback,
            VTO gating, migration-pending states, and graceful failure. All fixture-only — no network calls.
          </p>
        </div>

        {/* Precedence reference */}
        <div style={{ marginBottom: "40px", padding: "20px 24px", background: "#fff", border: "1px solid rgba(59,5,16,0.09)" }}>
          <div style={{ ...MONO, fontSize: "8px", letterSpacing: "3px", textTransform: "uppercase", color: ACCENT, marginBottom: "14px" }}>
            Signal precedence rules
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: "8px" }}>
            {[
              { level: "EXPLICIT_PREFERENCE", score: 100, note: "OnboardingProfile, Style Passport" },
              { level: "SESSION_ANSWER",      score: 80,  note: "Current StyleMe step answers" },
              { level: "SOFT_RANK_FEEDBACK",  score: 40,  note: "Repeated consistent feedback" },
              { level: "SOFT_RANK_SELFIE",    score: 30,  note: "Selfie styling guidance (never elevated)" },
              { level: "NO_SIGNAL",           score: 0,   note: "Optional data absent — graceful skip" },
            ].map(({ level, score, note }) => (
              <div key={level} style={{ padding: "10px 12px", background: SUBTLE, border: "1px solid rgba(59,5,16,0.06)" }}>
                <div style={{ ...MONO, fontSize: "7px", letterSpacing: "1.5px", textTransform: "uppercase", color: score >= 80 ? DEEP : MUTED }}>
                  {level}
                </div>
                <div style={{ ...MONO, fontSize: "14px", color: DEEP, marginTop: "2px" }}>{score}</div>
                <div style={{ fontSize: "11px", color: MUTED, marginTop: "4px" }}>{note}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Scenarios */}
        {scenarios.map((scenario) => (
          <ScenarioCard key={scenario.id} scenario={scenario} />
        ))}

        {/* Footer */}
        <div style={{ paddingTop: "32px", borderTop: "1px solid rgba(59,5,16,0.07)", ...MONO, fontSize: "7px", letterSpacing: "2px", textTransform: "uppercase", color: MUTED }}>
          Phase 4B3 — dev only · All data is fixture-only · No provider calls · VIRTUAL_TRY_ON_ENABLED = false
        </div>

      </main>
    </div>
  );
}
