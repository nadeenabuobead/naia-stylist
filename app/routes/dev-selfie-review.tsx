// app/routes/dev-selfie-review.tsx
// Phase 4A8 — Dev review screen for selfie analysis UI states.
// Returns 404 unless DEV_TRYON_UI_ENABLED=true.
//
// Shows all five result sections across all analysis outcome states.
// No provider calls — fixture data only.

import { useState } from "react";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { data } from "react-router";
import type { SelfieAnalysisOutcome, SelfieStyleSignals } from "~/lib/ai/selfie-analysis";
import {
  buildColourDirectionSummary,
  buildNecklineSummary,
  buildHairDirectionSummary,
  buildAccessoriesSummary,
  buildNaiaUsageExplanation,
} from "~/lib/ai/selfie-styling-signals";

// ── Loader ────────────────────────────────────────────────────────────────────

export async function loader({ request: _ }: LoaderFunctionArgs) {
  const devEnabled = process.env.DEV_TRYON_UI_ENABLED === "true";
  if (!devEnabled) throw new Response("Not Found", { status: 404 });
  return data({});
}

// ── Fixture signals ───────────────────────────────────────────────────────────

const FIXTURE_SIGNALS: SelfieStyleSignals = {
  faceShapeDirection: "softly oval tendency — most necklines may suit",
  suggestedNecklines: ["V-neck", "scoop neck", "square neck"],
  necklineExplanation: "an open neckline may elongate and draw the eye upward",
  colourFamilies: ["warm earth tones", "muted dusty rose", "soft ivory"],
  colourExplanation: "warm tones may complement golden undertones",
  contrastLevel: "medium",
  hairLengthDirection: "shoulder-length or longer may balance proportions",
  hairVolumeDirection: "volume at the crown tends to add lift",
  hairPartingDirection: "a side parting may soften the forehead",
  earringsDirection: "longer drop earrings may elongate",
  glassesFrameDirection: "oval or round frames may complement angular features",
  makeupColourDirection: "warm terracotta tones may suit",
  overallNote: "tonal layering with warm neutrals may create a cohesive look",
};

// ── All fixture states ────────────────────────────────────────────────────────

const FIXTURE_STATES: Array<{ label: string; id: string; outcome: SelfieAnalysisOutcome }> = [
  {
    id: "completed",
    label: "Completed — full signals",
    outcome: { status: "completed", signals: FIXTURE_SIGNALS, analysedAt: "2026-07-17T10:05:00.000Z" },
  },
  {
    id: "quality-blurry",
    label: "Quality failed — blurry",
    outcome: { status: "quality-failed", issues: ["blurry"], guidance: "The image is too blurry. Retake in good, even lighting." },
  },
  {
    id: "quality-obstructed",
    label: "Quality failed — obstructed",
    outcome: { status: "quality-failed", issues: ["obstructed"], guidance: "Your face is partially covered. Retake without obstructions." },
  },
  {
    id: "quality-multiple-faces",
    label: "Quality failed — multiple faces",
    outcome: { status: "quality-failed", issues: ["multiple-faces"], guidance: "More than one face is visible. Retake with only you in the frame." },
  },
  {
    id: "quality-strong-filter",
    label: "Quality failed — strong filter",
    outcome: { status: "quality-failed", issues: ["strong-filter"], guidance: "A heavy colour filter is masking your natural colouring. Retake without filters." },
  },
  {
    id: "quality-not-selfie",
    label: "Quality failed — not a selfie",
    outcome: { status: "quality-failed", issues: ["not-a-selfie"], guidance: "No face is visible in this photo. Take a photo facing the camera." },
  },
  {
    id: "timeout",
    label: "Timeout",
    outcome: { status: "timeout" },
  },
  {
    id: "system-failure",
    label: "System failure",
    outcome: { status: "system-failure", internalNote: "Style response could not be parsed as JSON. Raw: [fixture]" },
  },
  {
    id: "consent-missing",
    label: "Consent missing",
    outcome: { status: "consent-missing" },
  },
];

// ── Page ──────────────────────────────────────────────────────────────────────

export default function DevSelfieReview() {
  useLoaderData<typeof loader>();
  const [selected, setSelected] = useState<string>("completed");

  const current = FIXTURE_STATES.find(s => s.id === selected) ?? FIXTURE_STATES[0];

  return (
    <div style={{ minHeight: "100vh", background: "#f4f4f1" }}>
      <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,700;0,900&family=Cormorant+Garamond:ital,wght@0,300;0,400;0,600&family=Space+Mono:wght@400;700&display=swap" rel="stylesheet" />

      {/* Nav */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "20px 40px", borderBottom: "1px solid rgba(59,5,16,0.06)" }}>
        <a href="/" style={{ fontFamily: "'Space Mono',monospace", fontSize: "9px", letterSpacing: "2px", textTransform: "uppercase", color: "#7a6f6a", textDecoration: "none" }}>← Back</a>
        <div style={{ fontFamily: "'Playfair Display',Georgia,serif", fontSize: "22px", fontStyle: "italic", letterSpacing: "3px", color: "#221516" }}>nAia</div>
        <div style={{ display: "flex", gap: "8px" }}>
          <span style={{ padding: "4px 10px", background: "#8b2035", color: "#f4f4f1", fontFamily: "'Space Mono',monospace", fontSize: "7px", letterSpacing: "2px" }}>DEV</span>
          <span style={{ padding: "4px 10px", background: "rgba(59,5,16,0.06)", color: "#7a6f6a", fontFamily: "'Space Mono',monospace", fontSize: "7px", letterSpacing: "1px" }}>4A8</span>
        </div>
      </div>

      <div style={{ maxWidth: "1100px", margin: "0 auto", padding: "48px 40px 80px", display: "grid", gridTemplateColumns: "280px 1fr", gap: "48px" }}>

        {/* State selector */}
        <div>
          <div style={{ fontFamily: "'Space Mono',monospace", fontSize: "8px", letterSpacing: "3px", textTransform: "uppercase", color: "#7a6f6a", marginBottom: "16px" }}>Analysis state</div>
          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            {FIXTURE_STATES.map(s => (
              <button
                key={s.id}
                onClick={() => setSelected(s.id)}
                style={{
                  padding: "10px 14px", textAlign: "left", fontFamily: "'Space Mono',monospace",
                  fontSize: "8px", letterSpacing: "1px", border: "1px solid",
                  borderColor: selected === s.id ? "#221516" : "rgba(59,5,16,0.1)",
                  background: selected === s.id ? "#221516" : "transparent",
                  color: selected === s.id ? "#f4f4f1" : "#4a3f3a",
                  cursor: "pointer",
                }}
              >
                {s.label}
              </button>
            ))}
          </div>

          <div style={{ marginTop: "32px", padding: "16px", background: "rgba(59,5,16,0.03)", border: "1px solid rgba(59,5,16,0.08)" }}>
            <div style={{ fontFamily: "'Space Mono',monospace", fontSize: "7px", letterSpacing: "2px", textTransform: "uppercase", color: "#7a6f6a", marginBottom: "8px" }}>Route</div>
            <a href="/passport/selfie" style={{ fontFamily: "'Space Mono',monospace", fontSize: "8px", color: "#8b2035", textDecoration: "none" }}>/passport/selfie</a>
          </div>
        </div>

        {/* Result preview */}
        <div>
          <div style={{ marginBottom: "32px" }}>
            <div style={{ fontFamily: "'Space Mono',monospace", fontSize: "9px", letterSpacing: "4px", textTransform: "uppercase", color: "#8b2035", marginBottom: "10px" }}>Dev Fixture</div>
            <h1 style={{ fontFamily: "'Playfair Display',Georgia,serif", fontSize: "clamp(24px,3vw,36px)", fontWeight: 900, color: "#221516", letterSpacing: "-0.5px", marginBottom: "8px" }}>
              Selfie Analysis Review
            </h1>
            <p style={{ fontFamily: "'Cormorant Garamond',Garamond,serif", fontSize: "15px", fontStyle: "italic", color: "#7a6f6a" }}>
              All outcome states. Five result sections. No live provider calls.
            </p>
          </div>

          <div style={{ background: "white", border: "1px solid rgba(59,5,16,0.08)", padding: "40px" }}>
            <SelfieResultPreview outcome={current.outcome} />
          </div>
        </div>

      </div>
    </div>
  );
}

// ── Result preview ────────────────────────────────────────────────────────────

function SelfieResultPreview({ outcome }: { outcome: SelfieAnalysisOutcome }) {
  if (outcome.status === "consent-missing") {
    return (
      <StateShell label="consent-missing" color="#7a6f6a">
        <p style={{ color: "#4a3f3a", fontSize: "15px", lineHeight: 1.7 }}>Please tick the consent box to proceed.</p>
      </StateShell>
    );
  }

  if (outcome.status === "invalid-input") {
    return (
      <StateShell label="invalid-input" color="#7a6f6a">
        <p style={{ color: "#4a3f3a", fontSize: "15px", lineHeight: 1.7 }}>{outcome.reason}</p>
      </StateShell>
    );
  }

  if (outcome.status === "quality-failed") {
    return (
      <StateShell label="quality-failed" color="#8b2035">
        <div style={{ marginBottom: "12px" }}>
          {outcome.issues.map(issue => (
            <span key={issue} style={{ display: "inline-block", marginRight: "6px", marginBottom: "6px", padding: "3px 8px", background: "rgba(139,32,53,0.08)", color: "#8b2035", fontFamily: "'Space Mono',monospace", fontSize: "7px", letterSpacing: "1px" }}>
              {issue}
            </span>
          ))}
        </div>
        {outcome.guidance && (
          <p style={{ color: "#4a3f3a", fontSize: "15px", lineHeight: 1.7 }}>{outcome.guidance}</p>
        )}
      </StateShell>
    );
  }

  if (outcome.status === "timeout") {
    return (
      <StateShell label="timeout" color="#7a6f6a">
        <p style={{ color: "#4a3f3a", fontSize: "15px", lineHeight: 1.7 }}>
          nAia couldn&apos;t complete the analysis at this moment. Please try again shortly.
        </p>
      </StateShell>
    );
  }

  if (outcome.status === "system-failure") {
    return (
      <StateShell label="system-failure" color="#7a6f6a">
        <p style={{ color: "#4a3f3a", fontSize: "15px", lineHeight: 1.7 }}>
          nAia couldn&apos;t complete the analysis at this moment. Please try again shortly.
        </p>
        <div style={{ marginTop: "12px", padding: "10px 14px", background: "rgba(59,5,16,0.04)", fontFamily: "'Space Mono',monospace", fontSize: "7px", color: "#7a6f6a" }}>
          [dev] {outcome.internalNote}
        </div>
      </StateShell>
    );
  }

  if (outcome.status === "completed") {
    const { signals } = outcome;
    return (
      <div>
        <div style={{ fontFamily: "'Space Mono',monospace", fontSize: "9px", letterSpacing: "4px", textTransform: "uppercase", color: "#8b2035", marginBottom: "8px" }}>
          completed
        </div>
        <div style={{ fontFamily: "'Playfair Display',Georgia,serif", fontSize: "22px", fontStyle: "italic", color: "#221516", marginBottom: "32px" }}>
          Your styling observations
        </div>

        <ResultSection label="Your Colour Direction">
          <p>{buildColourDirectionSummary(signals)}</p>
        </ResultSection>

        <ResultSection label="Necklines That May Suit You">
          <p>{buildNecklineSummary(signals)}</p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginTop: "10px" }}>
            {signals.suggestedNecklines.map(n => (
              <span key={n} style={{ padding: "4px 10px", background: "rgba(59,5,16,0.05)", color: "#4a3f3a", fontFamily: "'Space Mono',monospace", fontSize: "8px", letterSpacing: "1px" }}>{n}</span>
            ))}
          </div>
        </ResultSection>

        <ResultSection label="Hair Direction">
          <p>{buildHairDirectionSummary(signals)}</p>
        </ResultSection>

        <ResultSection label="Earrings and Glasses">
          <p>{buildAccessoriesSummary(signals)}</p>
          {signals.makeupColourDirection && (
            <p style={{ marginTop: "8px", fontStyle: "italic", color: "#7a6f6a" }}>Makeup direction: {signals.makeupColourDirection}</p>
          )}
        </ResultSection>

        <ResultSection label="How nAia Will Use This" subtle>
          <p style={{ fontSize: "13px", fontStyle: "italic", lineHeight: 1.7, color: "#7a6f6a" }}>
            {buildNaiaUsageExplanation()}
          </p>
        </ResultSection>

        {/* Raw signals (dev only) */}
        <details style={{ marginTop: "24px" }}>
          <summary style={{ fontFamily: "'Space Mono',monospace", fontSize: "7px", letterSpacing: "2px", textTransform: "uppercase", color: "#7a6f6a", cursor: "pointer" }}>
            Raw signals (dev)
          </summary>
          <pre style={{ marginTop: "12px", padding: "12px", background: "rgba(59,5,16,0.03)", fontSize: "11px", color: "#4a3f3a", overflow: "auto", whiteSpace: "pre-wrap" }}>
            {JSON.stringify(signals, null, 2)}
          </pre>
        </details>
      </div>
    );
  }

  return null;
}

function StateShell({ label, color, children }: { label: string; color: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontFamily: "'Space Mono',monospace", fontSize: "9px", letterSpacing: "4px", textTransform: "uppercase", color, marginBottom: "16px" }}>
        {label}
      </div>
      {children}
    </div>
  );
}

function ResultSection({ label, children, subtle }: { label: string; children: React.ReactNode; subtle?: boolean }) {
  return (
    <div style={{ marginBottom: "28px", paddingBottom: "28px", borderBottom: "1px solid rgba(59,5,16,0.07)" }}>
      <div style={{ fontFamily: "'Space Mono',monospace", fontSize: "8px", letterSpacing: "2px", textTransform: "uppercase", color: subtle ? "#7a6f6a" : "#8b2035", marginBottom: "8px" }}>
        {label}
      </div>
      <div style={{ color: "#4a3f3a", fontSize: "15px", lineHeight: 1.7 }}>{children}</div>
    </div>
  );
}
