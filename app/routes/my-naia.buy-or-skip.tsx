import { useState } from "react";
import { Link } from "react-router";
import type { LinksFunction } from "react-router";
import MyNaiaLayout from "~/components/my-naia/MyNaiaLayout";
import naiaStyles from "~/styles/naia-design-system.css?url";

export const links: LinksFunction = () => [{ rel: "stylesheet", href: naiaStyles }];

type Source = "upload" | "photograph";

const SOURCE_OPTIONS: { id: Source; label: string; hint: string }[] = [
  { id: "upload", label: "Upload a Screenshot or Product Image", hint: "From a website, lookbook or saved image." },
  { id: "photograph", label: "Take a Photograph in a Store", hint: "Capture the piece on the rack or on you." },
];

const EVIDENCE = [
  "Style Passport",
  "My Closet",
  "Lifestyle",
  "Fit & Coverage Preferences",
  "Saved Products",
  "Previous Purchases",
  "Previous Buy or Skip Decisions",
  "Styling Feedback",
];

const SAMPLE_VERDICT = {
  verdict: "Buy, but only if…",
  summary:
    "This piece complements your soft-tailoring direction, but only if you plan to have the hem tailored to your height.",
  reasons: [
    "Silhouette aligns with your stated preferences (relaxed, elongated).",
    "Fabric is heavier than your usual climate — consider seasonal wear only.",
    "One partial overlap with a Closet trouser, though the cut differs.",
  ],
  wardrobeOverlap: "Partial overlap — one comparable trouser in a different silhouette.",
  stylingValue: "Pairs cleanly with three existing NADINE tops and two Closet knits.",
  fitLifestyle: "Coverage suits your preferences; length will need tailoring.",
  betterAlternative: "A lighter wool blend in the same silhouette may serve year-round wear.",
};

function UploadRow({ label, required }: { label: string; required?: boolean }) {
  return (
    <div
      style={{
        display: "grid",
        gap: "0.75rem",
        border: "1px dashed var(--fg-20)",
        padding: "1rem",
        gridTemplateColumns: "minmax(0,1fr) auto",
        alignItems: "center",
      }}
    >
      <div>
        <div style={{ fontSize: "0.72rem", textTransform: "uppercase", letterSpacing: "0.28em", color: "var(--fg)" }}>
          {label}{" "}
          {required && <span style={{ color: "var(--lipstick)" }}>·</span>}
        </div>
        <p style={{ marginTop: "0.25rem", fontSize: "0.8rem", lineHeight: 1.5, color: "var(--fg-60)" }}>JPG or PNG · high resolution preferred</p>
      </div>
      <button type="button" className="mn-btn-outline">Choose File</button>
    </div>
  );
}

function Field({ label, placeholder }: { label: string; placeholder?: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
      <label style={{ fontSize: "0.62rem", textTransform: "uppercase", letterSpacing: "0.28em", color: "var(--fg-55)" }}>{label}</label>
      <input
        type="text"
        placeholder={placeholder}
        style={{
          width: "100%",
          border: "1px solid var(--fg-15)",
          background: "transparent",
          padding: "0.625rem 0.75rem",
          fontSize: "0.9rem",
          color: "var(--fg)",
          outline: "none",
          fontFamily: "var(--ff-ui)",
        }}
      />
    </div>
  );
}

function ResultBlock({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ borderTop: "1px solid var(--fg-12)", paddingTop: "1.25rem" }}>
      <div style={{ fontSize: "0.62rem", textTransform: "uppercase", letterSpacing: "0.28em", color: "var(--fg-55)" }}>{label}</div>
      <div style={{ marginTop: "0.75rem" }}>{children}</div>
    </div>
  );
}

export default function BuyOrSkipPage() {
  const [source, setSource] = useState<Source>("upload");
  const [showResult, setShowResult] = useState(false);

  return (
    <MyNaiaLayout>
      <div className="mn-page-sections">
        <Link to="/my-naia" className="mn-back-link">
          <span aria-hidden="true">←</span> Back to Overview
        </Link>

        {/* Header */}
        <section>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-start", justifyContent: "space-between", gap: "1rem" }}>
            <div>
              <div className="mn-eyebrow">Should I Buy This?</div>
              <h1
                style={{
                  fontFamily: "var(--ff-display)",
                  fontWeight: 200,
                  marginTop: "0.75rem",
                  fontSize: "clamp(1.875rem, 5vw, 2.5rem)",
                  lineHeight: 1,
                  letterSpacing: "0.02em",
                  textTransform: "uppercase",
                }}
              >
                Should I Buy This?
              </h1>
            </div>
            <span className="mn-sample-badge">Sample</span>
          </div>
          <p style={{ marginTop: "1rem", maxWidth: "42rem", fontSize: "0.9rem", lineHeight: 1.75, color: "var(--fg-75)" }}>
            Considering a piece from another brand? Share it with nAia and receive an honest read based
            on your style, wardrobe, lifestyle and whether you already own something similar.
          </p>
        </section>

        {/* Step 1: Source */}
        <section style={{ borderTop: "1px solid var(--fg-12)", paddingTop: "2rem" }}>
          <div className="mn-eyebrow">Step 1 · Add the Piece</div>
          <div className="mn-grid-2col" style={{ marginTop: "1.25rem", gap: "0.75rem" }}>
            {SOURCE_OPTIONS.map((o) => {
              const active = source === o.id;
              return (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => setSource(o.id)}
                  style={{
                    textAlign: "left",
                    border: `1px solid ${active ? "var(--fg)" : "var(--fg-15)"}`,
                    background: active ? "oklch(0.22 0.035 45 / 0.04)" : "transparent",
                    padding: "1.25rem",
                    cursor: "pointer",
                  }}
                >
                  <div style={{ fontSize: "0.72rem", textTransform: "uppercase", letterSpacing: "0.28em", color: "var(--fg)" }}>{o.label}</div>
                  <p style={{ marginTop: "0.5rem", fontSize: "0.82rem", lineHeight: 1.5, color: "var(--fg-65)" }}>{o.hint}</p>
                </button>
              );
            })}
          </div>

          <div style={{ marginTop: "1.5rem", border: "1px solid var(--fg-12)", padding: "1.25rem 1.5rem", display: "flex", flexDirection: "column", gap: "1rem" }}>
            <UploadRow label={source === "upload" ? "Screenshot or Product Image" : "Photograph — Front View"} required />
            <UploadRow label="A Second Angle (optional)" />
            <UploadRow label="Fabric or Detail (optional)" />
          </div>
        </section>

        {/* Step 2: Questions */}
        <section style={{ borderTop: "1px solid var(--fg-12)", paddingTop: "2rem" }}>
          <div className="mn-eyebrow">Step 2 · A Few Questions</div>
          <div className="mn-grid-2col" style={{ marginTop: "1.25rem", gap: "1rem" }}>
            <Field label="What are you considering it for?" placeholder="e.g. Evening dinners in Beirut" />
            <Field label="What do you like about it?" placeholder="e.g. The neckline and the drape" />
            <Field label="What are you unsure about?" placeholder="e.g. Whether it duplicates something I own" />
            <Field label="Which colour are you considering?" placeholder="e.g. Ivory" />
            <Field label="Which size are you considering?" placeholder="e.g. M" />
          </div>
        </section>

        {/* What nAia may consider */}
        <section style={{ borderTop: "1px solid var(--fg-12)", paddingTop: "2rem" }}>
          <div className="mn-eyebrow">What nAia May Consider</div>
          <ul style={{ marginTop: "1rem", listStyle: "none", padding: 0, display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
            {EVIDENCE.map((e) => (
              <li
                key={e}
                style={{
                  border: "1px solid var(--fg-15)",
                  padding: "0.375rem 0.75rem",
                  fontSize: "0.66rem",
                  textTransform: "uppercase",
                  letterSpacing: "0.24em",
                  color: "var(--fg-70)",
                }}
              >
                {e}
              </li>
            ))}
          </ul>
        </section>

        {/* CTA */}
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "1.5rem", borderTop: "1px solid var(--fg-12)", paddingTop: "2rem" }}>
          <button type="button" onClick={() => setShowResult(true)} className="mn-btn-primary">
            Get My Recommendation
          </button>
          <Link
            to="/my-naia/buying-decisions"
            style={{ fontSize: "0.66rem", textTransform: "uppercase", letterSpacing: "0.32em", textDecoration: "underline", textUnderlineOffset: "3px", color: "var(--fg-80)" }}
          >
            View All Decisions
          </Link>
        </div>

        {/* Sample result */}
        {showResult && (
          <section style={{ borderTop: "1px solid var(--fg-12)", paddingTop: "2.5rem" }}>
            <div className="mn-eyebrow">nAia&#8217;s Recommendation</div>
            <div style={{ marginTop: "0.75rem", fontSize: "0.85rem", textTransform: "uppercase", letterSpacing: "0.32em", color: "var(--lipstick)" }}>
              {SAMPLE_VERDICT.verdict}
            </div>
            <p style={{ marginTop: "1rem", maxWidth: "42rem", fontSize: "1rem", lineHeight: 1.75, color: "var(--fg-85)" }}>
              {SAMPLE_VERDICT.summary}
            </p>

            <div className="mn-grid-2col-lg" style={{ marginTop: "2rem", gap: "1.5rem" }}>
              <ResultBlock label="Why It Does Or Does Not Work">
                <ul style={{ listStyle: "none", padding: 0, display: "flex", flexDirection: "column", gap: "0.5rem", fontSize: "0.9rem", lineHeight: 1.5, color: "var(--fg-80)" }}>
                  {SAMPLE_VERDICT.reasons.map((r) => (
                    <li key={r} style={{ display: "flex", gap: "0.75rem", alignItems: "flex-start" }}>
                      <span style={{ marginTop: "0.5rem", width: "1rem", height: "1px", background: "var(--fg-40)", flexShrink: 0, display: "block" }} />
                      <span>{r}</span>
                    </li>
                  ))}
                </ul>
              </ResultBlock>
              <ResultBlock label="Wardrobe Overlap">
                <p style={{ fontSize: "0.9rem", lineHeight: 1.5, color: "var(--fg-80)" }}>{SAMPLE_VERDICT.wardrobeOverlap}</p>
              </ResultBlock>
              <ResultBlock label="Likely Styling Value">
                <p style={{ fontSize: "0.9rem", lineHeight: 1.5, color: "var(--fg-80)" }}>{SAMPLE_VERDICT.stylingValue}</p>
              </ResultBlock>
              <ResultBlock label="Fit · Coverage · Lifestyle">
                <p style={{ fontSize: "0.9rem", lineHeight: 1.5, color: "var(--fg-80)" }}>{SAMPLE_VERDICT.fitLifestyle}</p>
              </ResultBlock>
              <ResultBlock label="What May Work Better">
                <p style={{ fontSize: "0.9rem", lineHeight: 1.5, color: "var(--fg-80)" }}>{SAMPLE_VERDICT.betterAlternative}</p>
              </ResultBlock>
            </div>

            <div style={{ marginTop: "2rem", display: "flex", flexWrap: "wrap", alignItems: "center", gap: "1rem" }}>
              <button type="button" className="mn-btn-primary">Save Decision</button>
              <button type="button" className="mn-btn-outline">Style Around It</button>
              <button
                type="button"
                onClick={() => setShowResult(false)}
                style={{ fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "0.24em", textDecoration: "underline", textUnderlineOffset: "3px", background: "none", border: "none", color: "var(--fg-80)", cursor: "pointer" }}
              >
                Assess Another Piece
              </button>
            </div>
          </section>
        )}
      </div>
    </MyNaiaLayout>
  );
}
