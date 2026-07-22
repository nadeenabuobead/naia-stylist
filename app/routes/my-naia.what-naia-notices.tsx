import { useState } from "react";
import type { LinksFunction } from "react-router";
import MyNaiaLayout from "~/components/my-naia/MyNaiaLayout";
import naiaStyles from "~/styles/naia-design-system.css?url";

export const links: LinksFunction = () => [{ rel: "stylesheet", href: naiaStyles }];

type Confidence = "Your stated preference" | "Early pattern" | "Emerging preference" | "Strong preference";

type Notice = { id: string; confidence: Confidence; text: string };

const TOLD: Notice[] = [
  { id: "told-1", confidence: "Your stated preference", text: "You prefer elongated silhouettes over cropped shapes." },
  { id: "told-2", confidence: "Your stated preference", text: "You favour chocolate, ivory and mocha as your core palette." },
];

const NOTICING: Notice[] = [
  { id: "notice-silk-warm", confidence: "Emerging preference", text: "You reach for silk when the day feels formal but the room is warm." },
  { id: "notice-elongated-ease", confidence: "Early pattern", text: "On days you want more ease around the waist, elongated silhouettes have felt right." },
  { id: "notice-closet-mix", confidence: "Early pattern", text: "You save looks more often when they include one Closet piece alongside a NADINE piece." },
];

const WORKED: Notice[] = [
  { id: "worked-ivory-blouse", confidence: "Strong preference", text: "The Draped Silk Blouse in Ivory received your highest post-wear feedback across three looks." },
  { id: "worked-wideleg", confidence: "Emerging preference", text: "Wide-leg trousers with a soft crease read well for your evening rotation." },
];

type FeedbackState = "unanswered" | "confirmed" | "correcting" | "corrected";

const REASONS = [
  "This is not true for me",
  "It only applies sometimes",
  "The occasion or context is wrong",
  "The colour or fabric is wrong",
  "The fit or silhouette is wrong",
  "I have changed my preference",
  "Something else",
];

function InsightFeedback({ id }: { id: string }) {
  const [status, setStatus] = useState<FeedbackState>("unanswered");
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [showUndo, setShowUndo] = useState(false);

  if (status === "confirmed") {
    return (
      <div style={{ display: "flex", flexWrap: "wrap", gap: "1rem", fontSize: "0.62rem", textTransform: "uppercase", letterSpacing: "0.3em", alignItems: "baseline" }}>
        <span style={{ color: "var(--lipstick)", borderBottom: "1px solid oklch(0.36 0.11 18 / 0.50)", paddingBottom: "2px" }}>Confirmed</span>
        {showUndo && (
          <button type="button" className="mn-insight-btn mn-insight-btn-muted" onClick={() => { setStatus("unanswered"); setShowUndo(false); }}>Undo</button>
        )}
      </div>
    );
  }

  if (status === "corrected") {
    return (
      <div style={{ fontSize: "0.62rem", textTransform: "uppercase", letterSpacing: "0.3em", color: "var(--fg-70)", borderBottom: "1px solid var(--fg-25)", paddingBottom: "2px" }}>
        Thanks — nAia will adjust this pattern.
      </div>
    );
  }

  if (status === "correcting") {
    return (
      <div style={{ width: "100%", marginTop: "1rem", border: "1px solid var(--fg-15)", background: "var(--bg-60)", padding: "1rem" }}>
        <div style={{ fontSize: "0.65rem", textTransform: "uppercase", letterSpacing: "0.3em", color: "var(--fg-70)" }}>What is not quite right?</div>
        <ul style={{ listStyle: "none", padding: 0, marginTop: "0.75rem", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          {REASONS.map((r) => (
            <li key={r}>
              <label style={{ display: "flex", alignItems: "flex-start", gap: "0.75rem", fontSize: "0.85rem", lineHeight: 1.625, color: "var(--fg-80)", cursor: "pointer" }}>
                <input type="radio" name={`reason-${id}`} checked={reason === r} onChange={() => setReason(r)} style={{ marginTop: "0.25rem", accentColor: "var(--lipstick)" }} />
                <span>{r}</span>
              </label>
            </li>
          ))}
        </ul>
        <label style={{ display: "block", marginTop: "1rem" }}>
          <span style={{ fontSize: "0.6rem", textTransform: "uppercase", letterSpacing: "0.28em", color: "var(--fg-55)" }}>Tell nAia what would be more accurate.</span>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            style={{ display: "block", width: "100%", marginTop: "0.5rem", background: "transparent", border: "none", borderBottom: "1px solid var(--fg-20)", padding: "0.5rem 0", fontSize: "0.9rem", color: "var(--fg)", outline: "none", resize: "none", fontFamily: "var(--ff-ui)" }}
            placeholder="Optional"
          />
        </label>
        <div style={{ marginTop: "1rem", display: "flex", flexWrap: "wrap", gap: "1rem", fontSize: "0.62rem", textTransform: "uppercase", letterSpacing: "0.3em" }}>
          <button type="button" disabled={!reason} className="mn-insight-btn" style={{ opacity: reason ? 1 : 0.4 }} onClick={() => setStatus("corrected")}>
            Save Correction
          </button>
          <button type="button" className="mn-insight-btn mn-insight-btn-muted" onClick={() => setStatus("unanswered")}>
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "1rem", fontSize: "0.62rem", textTransform: "uppercase", letterSpacing: "0.3em", alignItems: "baseline" }}>
      <button
        type="button"
        className="mn-insight-btn"
        onClick={() => { setStatus("confirmed"); setShowUndo(true); setTimeout(() => setShowUndo(false), 8000); }}
      >
        That Feels Right
      </button>
      <button type="button" className="mn-insight-btn mn-insight-btn-muted" onClick={() => setStatus("correcting")}>
        Not Quite
      </button>
    </div>
  );
}

function NoticeGroup({
  eyebrow,
  note,
  items,
  showFeedback,
}: {
  eyebrow: string;
  note: string;
  items: Notice[];
  showFeedback: boolean;
}) {
  return (
    <section style={{ borderTop: "1px solid var(--fg-12)", paddingTop: "2rem" }}>
      <div className="mn-eyebrow">{eyebrow}</div>
      <p style={{ marginTop: "0.75rem", maxWidth: "42rem", fontSize: "0.85rem", lineHeight: 1.625, color: "var(--fg-65)" }}>{note}</p>
      <ul
        style={{
          listStyle: "none",
          padding: 0,
          marginTop: "1.5rem",
          borderTop: "1px solid var(--fg-12)",
          borderBottom: "1px solid var(--fg-12)",
        }}
      >
        {items.map((n) => (
          <li
            key={n.id}
            style={{
              display: "grid",
              gap: "0.75rem",
              padding: "1.25rem 0",
              borderBottom: "1px solid var(--fg-12)",
            }}
          >
            <div style={{ display: "grid", gap: "2rem", gridTemplateColumns: "minmax(0,1fr) auto", alignItems: "flex-start" }}>
              <div>
                <div
                  style={{
                    fontSize: "0.6rem",
                    textTransform: "uppercase",
                    letterSpacing: "0.3em",
                    color: "var(--lipstick)",
                  }}
                >
                  {n.confidence}
                </div>
                <p style={{ marginTop: "0.5rem", fontSize: "0.95rem", lineHeight: 1.75, color: "var(--fg-85)" }}>
                  {n.text}
                </p>
              </div>
              {showFeedback ? (
                <InsightFeedback id={n.id} />
              ) : (
                <a
                  href="/my-naia/style-passport"
                  style={{
                    flexShrink: 0,
                    fontSize: "0.6rem",
                    textTransform: "uppercase",
                    letterSpacing: "0.3em",
                    color: "var(--fg-70)",
                    borderBottom: "1px solid var(--fg-25)",
                    paddingBottom: "2px",
                    textDecoration: "none",
                    transition: "color 0.15s, border-color 0.15s",
                    alignSelf: "flex-start",
                  }}
                >
                  Edit In Style Passport
                </a>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function WhatNaiaNoticesPage() {
  return (
    <MyNaiaLayout>
      <div className="mn-page-sections">
        <a href="/my-naia" className="mn-back-link">
          <span aria-hidden="true">←</span> Back to Overview
        </a>

        {/* Header */}
        <section>
          <div className="mn-eyebrow">Personalisation</div>
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
            What nAia Is Noticing
          </h1>
          <p style={{ marginTop: "1rem", maxWidth: "42rem", fontSize: "0.9rem", lineHeight: 1.75, color: "var(--fg-75)" }}>
            nAia listens gently and only shares what it is beginning to notice once there is enough
            evidence. You can confirm or correct anything below — nAia adjusts from there.
          </p>
        </section>

        <NoticeGroup
          eyebrow="What You Told nAia"
          note="Preferences you shared in your Style Passport and settings."
          items={TOLD}
          showFeedback={false}
        />

        <NoticeGroup
          eyebrow="What nAia Is Beginning To Notice"
          note="Patterns nAia is watching in your behaviour and saved looks."
          items={NOTICING}
          showFeedback
        />

        <NoticeGroup
          eyebrow="What Actually Worked"
          note="Based on your post-wear feedback and reactions."
          items={WORKED}
          showFeedback
        />

        <p
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: "0.5rem",
            fontSize: "0.8rem",
            lineHeight: 1.625,
            color: "var(--fg-70)",
            borderTop: "1px solid var(--fg-15)",
            paddingTop: "1.5rem",
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginTop: "0.2rem", flexShrink: 0, color: "var(--fg-50)" }} aria-hidden>
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          </svg>
          Temporary feelings are translated into practical styling needs and are not added to your
          long-term Passport unless you choose to save them.
        </p>
      </div>
    </MyNaiaLayout>
  );
}
