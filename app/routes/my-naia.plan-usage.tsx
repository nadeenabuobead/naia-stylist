import type { LinksFunction } from "react-router";
import MyNaiaLayout from "~/components/my-naia/MyNaiaLayout";
import naiaStyles from "~/styles/naia-design-system.css?url";

export const links: LinksFunction = () => [{ rel: "stylesheet", href: naiaStyles }];

const PLAN = {
  name: "The Atelier Plan",
  renewal: "18 February 2027",
  price: "AED 39 / month · AED 390 / year",
  note: "Founding-member pricing · provisional",
};

const USAGE = [
  { label: "StyleMe Sessions", remaining: "5 sessions remaining", used: "3 used this cycle", cap: "of 8 per month" },
  { label: "Buy or Skip Checks", remaining: "3 checks remaining", used: "2 used this cycle", cap: "of 5 per month" },
  { label: "Virtual Try-Ons", remaining: "3 try-ons remaining", used: "2 used this cycle", cap: "of 5 per month" },
  { label: "My Closet Spaces", remaining: "45 of 100 spaces used", used: "", cap: "100 active spaces" },
  { label: "Personalised Trend Edit", remaining: "Available this month", used: "", cap: "1 per month" },
];

const divider: React.CSSProperties = {
  borderTop: "1px solid var(--fg-12)",
  paddingTop: "2rem",
};

export default function PlanUsagePage() {
  return (
    <MyNaiaLayout>
      <div className="mn-page-sections">
        <a href="/my-naia" className="mn-back-link">
          <span aria-hidden="true">←</span> Back to Overview
        </a>

        {/* Section shell header */}
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
              <div className="mn-eyebrow">Account</div>
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
                Plan &amp; Usage
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
            Your current membership, what is included and how much of it you have used this cycle.
          </p>
          <p
            style={{
              marginTop: "0.75rem",
              fontSize: "0.78rem",
              lineHeight: 1.625,
              color: "var(--fg-60)",
            }}
          >
            Sample / provisional package shown for prototype purposes. Final pricing and allowances may differ.
          </p>
        </section>

        {/* Current plan */}
        <section style={divider}>
          <div className="mn-eyebrow">Current Plan</div>
          <div
            style={{
              marginTop: "1rem",
              display: "grid",
              gap: "1.5rem",
              gridTemplateColumns: "repeat(auto-fit, minmax(10rem, 1fr))",
            }}
          >
            {[
              { label: "Plan", value: PLAN.name },
              { label: "Renews", value: PLAN.renewal },
              { label: "Billing", value: PLAN.price },
            ].map((c) => (
              <div key={c.label}>
                <div
                  style={{
                    fontSize: "0.62rem",
                    textTransform: "uppercase",
                    letterSpacing: "0.3em",
                    color: "var(--fg-60)",
                  }}
                >
                  {c.label}
                </div>
                <div
                  style={{
                    marginTop: "0.5rem",
                    fontFamily: "var(--ff-display)",
                    fontWeight: 300,
                    fontSize: "1.5rem",
                    letterSpacing: "0.02em",
                    textTransform: "uppercase",
                    color: "var(--fg)",
                  }}
                >
                  {c.value}
                </div>
              </div>
            ))}
          </div>
          <p
            style={{
              marginTop: "0.75rem",
              fontSize: "0.72rem",
              textTransform: "uppercase",
              letterSpacing: "0.24em",
              color: "var(--fg-55)",
            }}
          >
            {PLAN.note}
          </p>
        </section>

        {/* Usage this cycle */}
        <section style={divider}>
          <div className="mn-eyebrow">This Cycle</div>
          <ul
            style={{
              listStyle: "none",
              padding: 0,
              marginTop: "1rem",
              borderTop: "1px solid var(--fg-15)",
            }}
          >
            {USAGE.map((u) => (
              <li
                key={u.label}
                style={{
                  display: "grid",
                  gap: "0.5rem",
                  padding: "1rem 0",
                  borderBottom: "1px solid var(--fg-15)",
                  gridTemplateColumns: "minmax(0,1fr) auto",
                  alignItems: "baseline",
                }}
              >
                <div>
                  <div style={{ fontSize: "0.85rem", color: "var(--fg-90, var(--fg))" }}>
                    {u.label}
                  </div>
                  <div
                    style={{
                      marginTop: "0.25rem",
                      fontSize: "0.72rem",
                      textTransform: "uppercase",
                      letterSpacing: "0.24em",
                      color: "var(--fg-60)",
                    }}
                  >
                    {u.used ? `${u.used} · ${u.cap}` : u.cap}
                  </div>
                </div>
                <div
                  style={{
                    fontSize: "0.72rem",
                    textTransform: "uppercase",
                    letterSpacing: "0.28em",
                    color: "var(--lipstick)",
                    whiteSpace: "nowrap",
                  }}
                >
                  {u.remaining}
                </div>
              </li>
            ))}
          </ul>
        </section>

        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "1rem",
            borderTop: "1px solid var(--fg-15)",
            paddingTop: "2rem",
          }}
        >
          <button type="button" className="mn-btn-primary">Manage Membership</button>
          <button type="button" className="mn-btn-outline">Purchase Additional Usage</button>
        </div>
      </div>
    </MyNaiaLayout>
  );
}
