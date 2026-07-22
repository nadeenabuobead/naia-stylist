import { useState } from "react";
import type { LinksFunction } from "react-router";
import MyNaiaLayout from "~/components/my-naia/MyNaiaLayout";
import naiaStyles from "~/styles/naia-design-system.css?url";

export const links: LinksFunction = () => [{ rel: "stylesheet", href: naiaStyles }];

type AnalysisState =
  | "not-started"
  | "processing"
  | "complete"
  | "selfie-deleted-analysis-kept"
  | "analysis-deleted-selfie-kept";

const STATE_LABELS: Record<AnalysisState, string> = {
  "not-started": "Not started",
  processing: "Analysis in progress",
  complete: "Analysis complete",
  "selfie-deleted-analysis-kept": "Selfie deleted · analysis retained",
  "analysis-deleted-selfie-kept": "Analysis deleted · selfie retained",
};

const ANALYSIS_ROWS = [
  { label: "Colour Direction", value: "Warm neutrals · Ivory · Chocolate · Soft rose" },
  { label: "Contrast Direction", value: "Medium contrast" },
  { label: "Necklines", value: "Soft V · Draped cowl · Slight scoop" },
  { label: "Hair Direction", value: "Softness at the shoulder · Framing pieces" },
  { label: "Earrings", value: "Elongated shapes · Warm metals" },
  { label: "Glasses", value: "Rounded rectangle · Tortoise" },
  { label: "Makeup Colour Direction", value: "Warm terracotta · Soft berry" },
];

function UploadTile({ label, disabled }: { label: string; disabled?: boolean }) {
  return (
    <div className={`mn-upload-tile${disabled ? " mn-disabled" : ""}`}>
      <div className="mn-upload-tile-label">{label}</div>
      <button type="button" disabled={disabled} className="mn-btn-outline" style={{ marginTop: "1rem" }}>
        Choose
      </button>
    </div>
  );
}

const divider: React.CSSProperties = { borderTop: "1px solid var(--fg-15)", paddingTop: "2rem" };
const eyebrow: React.CSSProperties = { fontSize: "0.62rem", textTransform: "uppercase", letterSpacing: "0.34em", color: "var(--fg-60)" };

export default function PersonalAnalysisPage() {
  const [state, setState] = useState<AnalysisState>("not-started");
  const [consented, setConsented] = useState(false);
  const [pending, setPending] = useState<null | "selfie" | "analysis" | "both">(null);
  const [note, setNote] = useState<string | null>(null);

  return (
    <MyNaiaLayout>
      <div className="mn-page-sections">
        <a href="/my-naia" className="mn-back-link">
          <span aria-hidden="true">←</span> Back to Overview
        </a>

        {/* Header */}
        <section>
          <div className="mn-eyebrow">Personalisation · Optional</div>
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
            Personal Styling Analysis
          </h1>
          <p style={{ marginTop: "1rem", maxWidth: "42rem", fontSize: "0.9rem", lineHeight: 1.75, color: "var(--fg-80)" }}>
            Optional selfie-based guidance for colours near your face, necklines, hair direction,
            earrings, glasses and optional makeup direction. This feature is optional — StyleMe
            works without it.
          </p>
          <p style={{ marginTop: "0.75rem", maxWidth: "42rem", fontSize: "0.82rem", lineHeight: 1.625, color: "var(--fg-65)" }}>
            This selfie is separate from My nAia Model and from your Closet photographs.
          </p>
        </section>

        {/* Status */}
        <div style={divider}>
          <div style={eyebrow}>Current Status</div>
          <div
            style={{
              fontFamily: "var(--ff-display)",
              fontWeight: 300,
              marginTop: "0.5rem",
              fontSize: "1.5rem",
              letterSpacing: "0.02em",
              textTransform: "uppercase",
              color: "var(--lipstick)",
            }}
          >
            {STATE_LABELS[state]}
          </div>
        </div>

        {/* Not started */}
        {state === "not-started" && (
          <>
            <section style={divider}>
              <div style={eyebrow}>Explicit Consent</div>
              <label style={{ marginTop: "1rem", display: "flex", alignItems: "flex-start", gap: "0.75rem", fontSize: "0.9rem", lineHeight: 1.75, color: "var(--fg-85)" }}>
                <input
                  type="checkbox"
                  checked={consented}
                  onChange={(e) => setConsented(e.target.checked)}
                  style={{ marginTop: "0.375rem", accentColor: "var(--fg)", width: "1rem", height: "1rem", flexShrink: 0 }}
                />
                <span>
                  I understand this feature is optional. I consent to nAia analysing a selfie I
                  upload to derive personal styling guidance. I may delete my selfie, my analysis,
                  or both at any time.
                </span>
              </label>
            </section>

            <section style={divider}>
              <div style={eyebrow}>Selfie Guidance</div>
              <ul style={{ listStyle: "none", padding: 0, marginTop: "1rem", display: "flex", flexDirection: "column", gap: "0.5rem", fontSize: "0.9rem", lineHeight: 1.75, color: "var(--fg-85)" }}>
                <li>· Front-facing, in natural daylight, without filters.</li>
                <li>· A neutral top and hair pulled back if possible.</li>
                <li>· Only the head and shoulders need to be visible.</li>
              </ul>
              <div style={{ marginTop: "1.5rem", display: "grid", gap: "0.75rem", gridTemplateColumns: "repeat(auto-fit, minmax(12rem, 1fr))" }}>
                <UploadTile label="Upload Selfie" disabled={!consented} />
                <UploadTile label="Take Selfie" disabled={!consented} />
              </div>
              <div style={{ marginTop: "1.5rem" }}>
                <button
                  type="button"
                  disabled={!consented}
                  className="mn-btn-primary"
                  onClick={() => { setState("processing"); setNote("Your selfie has been received. Analysis in progress."); }}
                >
                  Start My Analysis
                </button>
              </div>
            </section>
          </>
        )}

        {/* Processing */}
        {state === "processing" && (
          <section style={divider}>
            <p style={{ maxWidth: "42rem", fontSize: "0.9rem", lineHeight: 1.75, color: "var(--fg-85)" }}>
              nAia is analysing your selfie. This usually takes a few moments — you do not need to remain on this page.
            </p>
            <div style={{ marginTop: "1.5rem" }}>
              <div className="mn-progress-bar"><div className="mn-progress-fill" /></div>
            </div>
            <div style={{ marginTop: "1.5rem", display: "flex", flexWrap: "wrap", gap: "0.75rem" }}>
              <button type="button" className="mn-btn-outline" onClick={() => { setState("not-started"); setNote("Analysis cancelled. You can upload a new selfie any time."); }}>
                Cancel Analysis
              </button>
            </div>
          </section>
        )}

        {/* Complete / selfie deleted */}
        {(state === "complete" || state === "selfie-deleted-analysis-kept") && (
          <>
            <section style={divider}>
              <div style={eyebrow}>Your Analysis</div>
              <div style={{ marginTop: "1rem" }}>
                {ANALYSIS_ROWS.map((row) => (
                  <div
                    key={row.label}
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: "0.25rem",
                      borderBottom: "1px solid var(--fg-10)",
                      padding: "0.75rem 0",
                    }}
                  >
                    <span style={{ fontSize: "0.65rem", textTransform: "uppercase", letterSpacing: "0.28em", color: "var(--fg-55)" }}>{row.label}</span>
                    <span style={{ fontSize: "0.9rem", color: "var(--fg-85)" }}>{row.value}</span>
                  </div>
                ))}
              </div>
            </section>

            <section style={divider}>
              <div style={eyebrow}>Manage</div>
              <div style={{ marginTop: "1rem", display: "flex", flexWrap: "wrap", gap: "0.75rem" }}>
                {state === "complete" && (
                  <button type="button" className="mn-btn-outline" onClick={() => { setState("processing"); setNote("Selfie replaced. Reanalysing."); }}>
                    Replace Selfie
                  </button>
                )}
                <button type="button" className="mn-btn-outline" onClick={() => { setState("processing"); setNote("Reanalysing."); }}>
                  Reanalyse
                </button>
                {state === "complete" && (
                  <button type="button" className="mn-btn-outline" onClick={() => setState("selfie-deleted-analysis-kept")}>
                    Delete Selfie Only
                  </button>
                )}
                <button type="button" className="mn-btn-outline" onClick={() => setState("analysis-deleted-selfie-kept")}>
                  Delete Analysis Only
                </button>
                {state === "complete" && (
                  <button type="button" className="mn-btn-outline" onClick={() => setState("not-started")}>
                    Delete Both
                  </button>
                )}
              </div>
            </section>
          </>
        )}

        {/* Analysis deleted, selfie kept */}
        {state === "analysis-deleted-selfie-kept" && (
          <section style={divider}>
            <p style={{ maxWidth: "42rem", fontSize: "0.9rem", lineHeight: 1.75, color: "var(--fg-85)" }}>
              Your analysis has been removed. Your selfie remains private until you delete it or request a new analysis.
            </p>
            <div style={{ marginTop: "1rem", display: "flex", flexWrap: "wrap", gap: "0.75rem" }}>
              <button type="button" className="mn-btn-primary" onClick={() => setState("processing")}>Reanalyse</button>
              <button type="button" className="mn-btn-outline" onClick={() => setState("not-started")}>Delete Selfie</button>
            </div>
          </section>
        )}

        <p className="mn-state-note">
          Selfies and analyses are stored privately and can be removed at any time from this page or
          from Settings &amp; Privacy.
        </p>

        {note && <p className="mn-state-note">{note}</p>}

        {/* Prototype switcher */}
        <details style={{ borderTop: "1px solid var(--fg-12)", paddingTop: "1.5rem", fontSize: "0.72rem", textTransform: "uppercase", letterSpacing: "0.28em", color: "var(--fg-50)" }}>
          <summary style={{ cursor: "pointer" }}>Prototype · Preview Each State</summary>
          <div style={{ marginTop: "1rem", display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
            {(["not-started","processing","complete","selfie-deleted-analysis-kept","analysis-deleted-selfie-kept"] as AnalysisState[]).map((s) => (
              <button key={s} type="button" className="mn-btn-outline" style={{ fontSize: "0.7rem" }} onClick={() => setState(s)}>{s}</button>
            ))}
          </div>
        </details>

        {/* Delete confirmation modal */}
        {pending && (
          <div
            style={{ position: "fixed", inset: 0, zIndex: 70, display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem" }}
          >
            <button
              type="button"
              aria-label="Close"
              style={{ position: "absolute", inset: 0, background: "oklch(0.22 0.035 45 / 0.40)", backdropFilter: "blur(4px)", border: "none", cursor: "default" }}
              onClick={() => setPending(null)}
            />
            <div
              role="dialog"
              aria-modal="true"
              aria-label="Confirm deletion"
              style={{ position: "relative", zIndex: 1, width: "100%", maxWidth: "32rem", background: "var(--bg)", color: "var(--fg)", padding: "1.5rem" }}
            >
              <div style={{ fontSize: "0.62rem", textTransform: "uppercase", letterSpacing: "0.32em", color: "var(--fg-60)" }}>Confirm Deletion</div>
              <h3 style={{ fontFamily: "var(--ff-display)", fontWeight: 200, marginTop: "0.75rem", fontSize: "1.5rem", textTransform: "uppercase" }}>
                {pending === "selfie" ? "Delete Selfie Only" : pending === "analysis" ? "Delete Analysis Only" : "Delete Selfie and Analysis"}
              </h3>
              <p style={{ marginTop: "0.75rem", fontSize: "0.9rem", lineHeight: 1.75, color: "var(--fg-85)" }}>
                {pending === "selfie" && "Your uploaded selfie will be removed. The previously generated analysis is still stored — you may delete it separately."}
                {pending === "analysis" && "Your analysis will be removed. Your selfie remains private until you delete it or request a new analysis."}
                {pending === "both" && "Your selfie and your analysis will both be removed. You can create them again at any time."}
              </p>
              <div style={{ marginTop: "1.5rem", display: "flex", justifyContent: "flex-end", gap: "0.75rem" }}>
                <button type="button" className="mn-btn-outline" onClick={() => setPending(null)}>Cancel</button>
                <button
                  type="button"
                  className="mn-btn-primary"
                  onClick={() => {
                    if (pending === "selfie") setState("selfie-deleted-analysis-kept");
                    if (pending === "analysis") setState("analysis-deleted-selfie-kept");
                    if (pending === "both") setState("not-started");
                    setNote("Your deletion request has been recorded.");
                    setPending(null);
                  }}
                >
                  Confirm
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </MyNaiaLayout>
  );
}
