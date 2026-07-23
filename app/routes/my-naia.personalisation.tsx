import { Link } from "react-router";
import type { LinksFunction } from "react-router";
import MyNaiaLayout from "~/components/my-naia/MyNaiaLayout";
import naiaStyles from "~/styles/naia-design-system.css?url";

export const links: LinksFunction = () => [{ rel: "stylesheet", href: naiaStyles }];

const CARDS = [
  {
    to: "/my-naia/model",
    eyebrow: "Virtual Try-On",
    title: "My nAia Model",
    desc: "Save a private full-body photograph to preview eligible pieces on your silhouette.",
  },
  {
    to: "/my-naia/personal-analysis",
    eyebrow: "Optional · Selfie",
    title: "Personal Styling Analysis",
    desc: "Optional selfie-based guidance for colours near your face, necklines, hair direction, earrings and glasses.",
  },
  {
    to: "/my-naia/what-naia-notices",
    eyebrow: "Observations",
    title: "What nAia Is Noticing",
    desc: "Patterns nAia is beginning to observe in your styling behaviour and saved looks.",
  },
];

export default function PersonalisationPage() {
  return (
    <MyNaiaLayout>
      <div className="mn-page-sections">
        <Link to="/my-naia" className="mn-back-link">
          <span aria-hidden="true">←</span> Back to Overview
        </Link>

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
            Personalisation
          </h1>
          <p
            style={{
              marginTop: "1rem",
              maxWidth: "42rem",
              fontSize: "0.9rem",
              lineHeight: 1.75,
              color: "var(--fg-75)",
            }}
          >
            Manage the private data and tools nAia uses to personalise your styling experience.
          </p>
        </section>

        {/* Cards */}
        <div className="mn-pers-grid">
          {CARDS.map((c) => (
            <Link key={c.to} to={c.to} className="mn-pers-card">
              <div>
                <div className="mn-eyebrow">{c.eyebrow}</div>
                <div
                  className="mn-pers-card-title"
                  style={{
                    marginTop: "0.75rem",
                    fontFamily: "var(--ff-display)",
                    fontWeight: 300,
                    fontSize: "1.5rem",
                    letterSpacing: "0.02em",
                    textTransform: "uppercase",
                  }}
                >
                  {c.title}
                </div>
                <p
                  style={{
                    marginTop: "0.75rem",
                    fontSize: "0.9rem",
                    lineHeight: 1.75,
                    color: "var(--fg-75)",
                  }}
                >
                  {c.desc}
                </p>
              </div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.375rem",
                  fontSize: "0.66rem",
                  textTransform: "uppercase",
                  letterSpacing: "0.28em",
                  color: "var(--fg-60)",
                }}
              >
                Open{" "}
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M7 17 17 7M7 7h10v10" />
                </svg>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </MyNaiaLayout>
  );
}
