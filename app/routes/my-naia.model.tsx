import { useState } from "react";
import type { LinksFunction } from "react-router";
import MyNaiaLayout from "~/components/my-naia/MyNaiaLayout";
import naiaStyles from "~/styles/naia-design-system.css?url";

export const links: LinksFunction = () => [{ rel: "stylesheet", href: naiaStyles }];

type ModelState = "no-model" | "processing" | "ready" | "error";

function UploadTile({ label, disabled }: { label: string; disabled?: boolean }) {
  return (
    <div className={`mn-upload-tile${disabled ? " mn-disabled" : ""}`}>
      <div className="mn-upload-tile-label">{label}</div>
      <div className="mn-upload-tile-sub">JPG or PNG · full body preferred</div>
      <button
        type="button"
        disabled={disabled}
        className="mn-btn-outline"
        style={{ marginTop: "1rem" }}
      >
        Choose
      </button>
    </div>
  );
}

function Modal({
  children,
  onClose,
}: {
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 70,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "1rem",
      }}
    >
      <button
        type="button"
        aria-label="Close"
        style={{
          position: "absolute",
          inset: 0,
          background: "oklch(0.22 0.035 45 / 0.40)",
          backdropFilter: "blur(4px)",
          border: "none",
          cursor: "default",
        }}
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Confirm action"
        style={{
          position: "relative",
          zIndex: 1,
          width: "100%",
          maxWidth: "32rem",
          background: "var(--bg)",
          color: "var(--fg)",
          padding: "1.5rem",
        }}
      >
        {children}
      </div>
    </div>
  );
}

export default function NaiaModelPage() {
  const [state, setState] = useState<ModelState>("ready");
  const [consented, setConsented] = useState(false);
  const [pendingDelete, setPendingDelete] = useState(false);
  const [confirmation, setConfirmation] = useState<string | null>(null);

  const s: React.CSSProperties = {
    borderTop: "1px solid var(--fg-15)",
    paddingTop: "1.5rem",
  };
  const eyebrow: React.CSSProperties = {
    fontSize: "0.62rem",
    textTransform: "uppercase",
    letterSpacing: "0.3em",
    color: "var(--fg-60)",
  };
  const statusTitle: React.CSSProperties = {
    fontFamily: "var(--ff-display)",
    fontWeight: 300,
    marginTop: "0.5rem",
    fontSize: "1.5rem",
    letterSpacing: "0.02em",
    textTransform: "uppercase",
    color: "var(--lipstick)",
  };

  return (
    <MyNaiaLayout>
      <div className="mn-page-sections">
        <a href="/my-naia" className="mn-back-link">
          <span aria-hidden="true">←</span> Back to Overview
        </a>

        {/* Section header */}
        <section>
          <div className="mn-eyebrow">Personalisation · Virtual Try-On</div>
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
            My nAia Model
          </h1>
          <p style={{ marginTop: "1rem", maxWidth: "42rem", fontSize: "0.9rem", lineHeight: 1.75, color: "var(--fg-80)" }}>
            Your saved full-body photograph for Virtual Try-On. Used privately to preview eligible
            pieces on your own silhouette. This is separate from your Personal Styling Analysis selfie.
          </p>
          <p style={{ marginTop: "0.75rem", maxWidth: "42rem", fontSize: "0.82rem", lineHeight: 1.625, color: "var(--fg-65)" }}>
            Virtual previews show styling direction and silhouette rather than exact physical fit.
          </p>
        </section>

        {/* No model state */}
        {state === "no-model" && (
          <>
            <section style={s}>
              <div style={eyebrow}>Current Status</div>
              <div style={statusTitle}>No Model Saved Yet</div>
              <p style={{ marginTop: "0.5rem", maxWidth: "42rem", fontSize: "0.9rem", lineHeight: 1.75, color: "var(--fg-80)" }}>
                Set up your private model to unlock Virtual Try-On.
              </p>
            </section>

            <section style={s}>
              <div className="mn-eyebrow">Setup Guidance</div>
              <ul style={{ listStyle: "none", padding: 0, marginTop: "1rem", display: "flex", flexDirection: "column", gap: "0.5rem", fontSize: "0.9rem", lineHeight: 1.75, color: "var(--fg-85)" }}>
                <li>· A single full-body photograph in daylight, from head to feet.</li>
                <li>· Close-fitting neutral clothing so nAia can read your silhouette.</li>
                <li>· Plain background where possible; face may be blurred before upload.</li>
              </ul>
              <div style={{ marginTop: "1.5rem", display: "grid", gap: "0.75rem", gridTemplateColumns: "repeat(auto-fit, minmax(14rem, 1fr))" }}>
                <UploadTile label="Upload a Full-Body Photograph" disabled={!consented} />
                <UploadTile label="Take a Full-Body Photograph" disabled={!consented} />
              </div>
              <label style={{ marginTop: "1.5rem", display: "flex", alignItems: "flex-start", gap: "0.75rem", fontSize: "0.9rem", lineHeight: 1.75, color: "var(--fg-85)" }}>
                <input
                  type="checkbox"
                  checked={consented}
                  onChange={(e) => setConsented(e.target.checked)}
                  style={{ marginTop: "0.375rem", accentColor: "var(--fg)", width: "1rem", height: "1rem", flexShrink: 0 }}
                />
                <span>
                  I consent to nAia saving my full-body photograph privately to render my own Virtual
                  Try-On previews. I may delete it at any time.
                </span>
              </label>
              <div style={{ marginTop: "1.5rem" }}>
                <button
                  type="button"
                  className="mn-btn-primary"
                  disabled={!consented}
                  onClick={() => {
                    setState("processing");
                    setConfirmation("Your photograph has been received. Preparing your model.");
                  }}
                >
                  Save Model
                </button>
              </div>
            </section>
          </>
        )}

        {/* Processing state */}
        {state === "processing" && (
          <section style={s}>
            <div style={eyebrow}>Current Status</div>
            <div style={statusTitle}>Preparing Your Model For Virtual Try-On</div>
            <p style={{ marginTop: "0.5rem", maxWidth: "42rem", fontSize: "0.9rem", lineHeight: 1.75, color: "var(--fg-80)" }}>
              This usually takes a few moments. You do not need to remain on this page.
            </p>
            <div style={{ marginTop: "1.5rem" }}>
              <div className="mn-progress-bar">
                <div className="mn-progress-fill" />
              </div>
            </div>
            <div style={{ marginTop: "1.5rem", display: "flex", flexWrap: "wrap", gap: "0.75rem" }}>
              <button
                type="button"
                className="mn-btn-outline"
                onClick={() => { setState("no-model"); setConfirmation("Processing cancelled. You can upload a new photograph."); }}
              >
                Cancel &amp; Upload Another Photograph
              </button>
            </div>
            <p style={{ marginTop: "1rem", fontSize: "0.78rem", lineHeight: 1.625, color: "var(--fg-60)" }}>
              A new upload is unavailable while processing unless you cancel.
            </p>
          </section>
        )}

        {/* Ready state */}
        {state === "ready" && (
          <>
            <section style={s}>
              <div style={eyebrow}>Current Status</div>
              <div style={statusTitle}>Ready For Virtual Try-On</div>
            </section>

            <section
              style={{
                ...s,
                display: "grid",
                gap: "2rem",
                gridTemplateColumns: "minmax(0,1fr)",
              }}
            >
              <div
                style={{
                  maxWidth: "18rem",
                }}
              >
                <div
                  style={{
                    aspectRatio: "3/4",
                    border: "1px solid var(--fg-15)",
                    background: "color-mix(in oklab, var(--bg) 92%, white)",
                    display: "grid",
                    placeItems: "center",
                  }}
                >
                  <span
                    style={{
                      fontSize: "0.62rem",
                      textTransform: "uppercase",
                      letterSpacing: "0.3em",
                      color: "var(--fg-40)",
                      textAlign: "center",
                      padding: "1rem",
                    }}
                  >
                    Private Photograph<br />(preview hidden)
                  </span>
                </div>
                <p
                  style={{
                    marginTop: "0.5rem",
                    fontSize: "0.72rem",
                    textTransform: "uppercase",
                    letterSpacing: "0.28em",
                    color: "var(--fg-60)",
                  }}
                >
                  Created · 04 October 2026
                </p>
              </div>

              <div>
                <p style={{ fontSize: "0.9rem", lineHeight: 1.75, color: "var(--fg-85)" }}>
                  Eligible pieces can now be previewed on your saved model. Virtual previews are
                  stored only for you.
                </p>
                <div style={{ marginTop: "1.5rem", display: "flex", flexWrap: "wrap", gap: "0.75rem" }}>
                  <button type="button" className="mn-btn-primary">Try An Eligible Piece</button>
                  <button
                    type="button"
                    className="mn-btn-outline"
                    onClick={() => { setState("processing"); setConfirmation("Replacement photograph received. Preparing your model."); }}
                  >
                    Replace Photograph
                  </button>
                  <button
                    type="button"
                    className="mn-btn-outline"
                    onClick={() => setPendingDelete(true)}
                  >
                    Delete Saved Model
                  </button>
                </div>
              </div>
            </section>
          </>
        )}

        {/* Error state */}
        {state === "error" && (
          <section style={s}>
            <div style={eyebrow}>Current Status</div>
            <div style={statusTitle}>We Couldn&apos;t Use That Photograph</div>
            <p style={{ marginTop: "0.75rem", maxWidth: "42rem", fontSize: "0.9rem", lineHeight: 1.75, color: "var(--fg-85)" }}>
              One or more of the following may apply:
            </p>
            <ul style={{ listStyle: "none", padding: 0, marginTop: "0.75rem", display: "flex", flexDirection: "column", gap: "0.5rem", fontSize: "0.9rem", lineHeight: 1.75, color: "var(--fg-80)" }}>
              <li>· Full body is not visible from head to feet.</li>
              <li>· Photograph is too dark or blurred.</li>
              <li>· Background or clothing prevented a usable silhouette.</li>
            </ul>
            <div style={{ marginTop: "1.5rem" }}>
              <button type="button" className="mn-btn-primary" onClick={() => setState("no-model")}>
                Retake or Upload Another Photograph
              </button>
            </div>
          </section>
        )}

        {/* Info note */}
        <p className="mn-state-note">
          Your saved model is stored privately and used only to render your own previews. Consent is
          required before any full-body photograph is saved.
        </p>

        {confirmation && <p className="mn-state-note">{confirmation}</p>}

        {/* Prototype state switcher */}
        <details style={{ borderTop: "1px solid var(--fg-12)", paddingTop: "1.5rem", fontSize: "0.72rem", textTransform: "uppercase", letterSpacing: "0.28em", color: "var(--fg-50)" }}>
          <summary style={{ cursor: "pointer" }}>Prototype · Preview Each State</summary>
          <div style={{ marginTop: "1rem", display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
            {(["no-model", "processing", "ready", "error"] as ModelState[]).map((s) => (
              <button key={s} type="button" className="mn-btn-outline" style={{ fontSize: "0.7rem" }} onClick={() => setState(s)}>{s}</button>
            ))}
          </div>
        </details>
      </div>

      {/* Delete confirmation modal */}
      {pendingDelete && (
        <Modal onClose={() => setPendingDelete(false)}>
          <div style={{ fontSize: "0.62rem", textTransform: "uppercase", letterSpacing: "0.32em", color: "var(--fg-60)" }}>Confirm</div>
          <h3 style={{ fontFamily: "var(--ff-display)", fontWeight: 200, marginTop: "0.75rem", fontSize: "1.5rem", textTransform: "uppercase" }}>Delete Saved Model</h3>
          <p style={{ marginTop: "0.75rem", fontSize: "0.9rem", lineHeight: 1.75, color: "var(--fg-85)" }}>
            Your full-body photograph and derived model will be removed. Saved looks are kept but
            Virtual Try-On will pause until you create a new model.
          </p>
          <div style={{ marginTop: "1.5rem", display: "flex", justifyContent: "flex-end", gap: "0.75rem" }}>
            <button type="button" className="mn-btn-outline" onClick={() => setPendingDelete(false)}>Cancel</button>
            <button
              type="button"
              className="mn-btn-primary"
              onClick={() => {
                setState("no-model");
                setPendingDelete(false);
                setConsented(false);
                setConfirmation("Your saved model has been deleted.");
              }}
            >
              Confirm Delete
            </button>
          </div>
        </Modal>
      )}
    </MyNaiaLayout>
  );
}
