import type { LinksFunction } from "react-router";
import MyNaiaLayout from "~/components/my-naia/MyNaiaLayout";
import naiaStyles from "~/styles/naia-design-system.css?url";

export const links: LinksFunction = () => [{ rel: "stylesheet", href: naiaStyles }];

const LATEST = {
  title: "Autumn Direction — Soft Tailoring & Chocolate Neutrals",
  date: "08 October 2026",
  takeaway:
    "Lean into elongated silhouettes in chocolate and mocha — they extend three coats you already own and align with your evening rotation.",
  evidence: ["Style Passport", "Digital Closet", "Saved Products", "Previous Buying Decisions"],
  wear: ["Fluid wool trousers in mocha", "Draped ivory blouses", "Elongated column dresses"],
  skip: ["Boxy short jackets", "High-shine synthetics", "Cropped cargo shapes"],
  owned: ["Chocolate cashmere knit", "Ivory silk trouser", "Wool trench"],
  saved: ["NADINE Draped Silk Blouse", "NADINE Wide-Leg Trouser"],
  previous: ["Wool trench (Sep 2026)", "Ivory silk slip (Jul 2026)"],
  nadine: ["Sculpted Column Dress", "Soft-Shoulder Blazer", "Fluid Trouser"],
};

const PREVIOUS = [
  { id: "e-1", title: "Late Summer — Ivory Layers", date: "20 August 2026" },
  { id: "e-2", title: "Spring Reset — Softness at the Shoulder", date: "04 April 2026" },
];

function TrendBlock({
  heading,
  items,
  eyebrow,
  strikethrough,
}: {
  heading: string;
  items: string[];
  eyebrow?: string;
  strikethrough?: boolean;
}) {
  return (
    <div
      style={{
        borderTop: "1px solid var(--fg-12)",
        paddingTop: "1.25rem",
      }}
    >
      {eyebrow && (
        <div
          style={{
            fontSize: "0.6rem",
            textTransform: "uppercase",
            letterSpacing: "0.3em",
            color: "var(--fg-45)",
          }}
        >
          {eyebrow}
        </div>
      )}
      <div
        style={{
          fontSize: "0.72rem",
          textTransform: "uppercase",
          letterSpacing: "0.28em",
          color: "var(--fg)",
          marginTop: eyebrow ? "0.25rem" : 0,
        }}
      >
        {heading}
      </div>
      <ul
        style={{
          listStyle: "none",
          padding: 0,
          marginTop: "0.75rem",
          display: "flex",
          flexDirection: "column",
          gap: "0.375rem",
          fontSize: "0.9rem",
          lineHeight: 1.75,
          color: strikethrough ? "var(--fg-60)" : "var(--fg-85)",
          textDecoration: strikethrough ? "line-through" : "none",
          textDecorationColor: "var(--fg-25)",
        }}
      >
        {items.map((i) => (
          <li key={i}>· {i}</li>
        ))}
      </ul>
    </div>
  );
}

export default function TrendEditsPage() {
  return (
    <MyNaiaLayout>
      <div className="mn-page-sections">
        <a href="/my-naia" className="mn-back-link">
          <span aria-hidden="true">←</span> Back to Overview
        </a>

        {/* Header */}
        <section>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              alignItems: "baseline",
              justifyContent: "space-between",
              gap: "1rem",
            }}
          >
            <div>
              <div className="mn-eyebrow">My Trend Edits</div>
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
                My Trend Edits
              </h1>
            </div>
            <span className="mn-sample-badge">
              <span className="mn-sample-dot" aria-hidden="true" />
              Sample data
            </span>
          </div>
          <p
            style={{
              marginTop: "1rem",
              maxWidth: "42rem",
              fontSize: "0.9rem",
              lineHeight: 1.75,
              color: "var(--fg-75)",
            }}
          >
            A personalised edit of the current direction, drawn from your Style Passport, Digital
            Closet, saved products and previous decisions. Separate from the free public Trend Reports.
          </p>
        </section>

        {/* Latest edit */}
        <section style={{ borderTop: "1px solid var(--fg-12)", paddingTop: "2rem" }}>
          <div
            style={{
              fontSize: "0.62rem",
              textTransform: "uppercase",
              letterSpacing: "0.34em",
              color: "var(--fg-55)",
            }}
          >
            Latest Personalised Edit · {LATEST.date}
          </div>
          <h2
            style={{
              fontFamily: "var(--ff-display)",
              fontWeight: 200,
              marginTop: "0.75rem",
              fontSize: "clamp(1.5rem, 4vw, 2.25rem)",
              lineHeight: 1.1,
              letterSpacing: "0.02em",
              textTransform: "uppercase",
            }}
          >
            {LATEST.title}
          </h2>
          <p
            style={{
              marginTop: "1rem",
              maxWidth: "42rem",
              fontSize: "0.95rem",
              lineHeight: 1.75,
              color: "var(--fg-80)",
            }}
          >
            {LATEST.takeaway}
          </p>
          <div
            style={{
              marginTop: "1rem",
              display: "flex",
              flexWrap: "wrap",
              gap: "0.5rem",
            }}
          >
            {LATEST.evidence.map((e) => (
              <span
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
              </span>
            ))}
          </div>

          <div
            style={{
              marginTop: "2.5rem",
              display: "grid",
              gap: "2rem",
              gridTemplateColumns: "repeat(auto-fit, minmax(14rem, 1fr))",
            }}
          >
            <TrendBlock heading="What to Wear" items={LATEST.wear} />
            <TrendBlock heading="What to Skip" items={LATEST.skip} strikethrough />
            <TrendBlock
              heading="You Already Own"
              items={LATEST.owned}
              eyebrow="Your Style DNA Says"
            />
            <TrendBlock heading="You've Saved" items={LATEST.saved} />
            <TrendBlock heading="You've Chosen Before" items={LATEST.previous} />
            <TrendBlock heading="Relevant NADINE Pieces" items={LATEST.nadine} />
          </div>
        </section>

        {/* Actions */}
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "0.75rem",
            borderTop: "1px solid var(--fg-12)",
            paddingTop: "2rem",
          }}
        >
          <button type="button" className="mn-btn-primary">Create a New Edit</button>
          <button type="button" className="mn-btn-outline">Refresh with Latest Data</button>
        </div>

        {/* Previous edits */}
        <section style={{ borderTop: "1px solid var(--fg-12)", paddingTop: "2rem" }}>
          <div className="mn-eyebrow">Previous Edits</div>
          <ul
            style={{
              listStyle: "none",
              padding: 0,
              marginTop: "1rem",
              borderTop: "1px solid var(--fg-12)",
            }}
          >
            {PREVIOUS.map((e) => (
              <li
                key={e.id}
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  justifyContent: "space-between",
                  padding: "1rem 0",
                  borderBottom: "1px solid var(--fg-12)",
                }}
              >
                <div>
                  <div
                    style={{
                      fontSize: "0.62rem",
                      textTransform: "uppercase",
                      letterSpacing: "0.28em",
                      color: "var(--fg-55)",
                    }}
                  >
                    {e.date}
                  </div>
                  <div
                    style={{
                      marginTop: "0.25rem",
                      fontSize: "0.95rem",
                      color: "var(--fg-85)",
                    }}
                  >
                    {e.title}
                  </div>
                </div>
                <button
                  type="button"
                  style={{
                    fontSize: "0.68rem",
                    textTransform: "uppercase",
                    letterSpacing: "0.28em",
                    textDecoration: "underline",
                    textUnderlineOffset: "4px",
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    color: "var(--fg-70)",
                    transition: "color 0.15s",
                    flexShrink: 0,
                  }}
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.color = "var(--lipstick)")
                  }
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.color = "var(--fg-70)")
                  }
                >
                  Open
                </button>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </MyNaiaLayout>
  );
}
