import naiaStyles from "~/styles/naia-design-system.css?url";
import type { LinksFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, Link, Form } from "react-router";
import { requireCurrentNaiaCustomer } from "~/lib/naia-session.server";
import MyNaiaLayout from "~/components/my-naia/MyNaiaLayout";
import DevFixtureNotice from "~/components/my-naia/DevFixtureNotice";

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: naiaStyles },
];

export function meta() {
  return [{ title: "My nAia | Your style space" }];
}

export async function loader({ request }: LoaderFunctionArgs) {
  await requireCurrentNaiaCustomer(request);
  return { isDev: process.env.NODE_ENV !== "production" };
}

// ── Daily editorial quote library ────────────────────────────────────────────
const QUOTE_LIBRARY = [
  { text: "On a day when nothing feels right, a great fabric next to the skin changes something.", attribution: "nAia Editorial Note" },
  { text: "Dressing is a small, daily rehearsal for the person you are becoming.", attribution: "nAia Editorial Note" },
  { text: "Ease is not the absence of effort. It is effort placed where no one can see it.", attribution: "nAia Editorial Note" },
  { text: "A wardrobe is a quiet argument you have with yourself about who you are today.", attribution: "nAia Editorial Note" },
  { text: "The right piece rarely announces itself. It simply stops feeling like a decision.", attribution: "nAia Editorial Note" },
  { text: "Confidence often begins at the shoulder, the wrist, the hem — small places, worn well.", attribution: "nAia Editorial Note" },
  { text: "Clothes remember the days you wore them. Choose the ones you want to remember back.", attribution: "nAia Editorial Note" },
  { text: "Style is a way of being on good terms with the mirror.", attribution: "nAia Editorial Note" },
  { text: "A silhouette is a sentence. Keep yours short and true.", attribution: "nAia Editorial Note" },
  { text: "The most personal thing you can wear is what you already understand.", attribution: "nAia Editorial Note" },
  { text: "Some mornings, elegance is simply the courage to keep it plain.", attribution: "nAia Editorial Note" },
  { text: "A colour worn often becomes a kind of signature you did not know you were writing.", attribution: "nAia Editorial Note" },
];

function DailyQuote() {
  const start = new Date(2026, 0, 1).getTime();
  const dayIndex = Math.floor((Date.now() - start) / (1000 * 60 * 60 * 24));
  const quote = QUOTE_LIBRARY[((dayIndex % QUOTE_LIBRARY.length) + QUOTE_LIBRARY.length) % QUOTE_LIBRARY.length];
  if (!quote) return null;
  return (
    <section aria-label="Today's Note" className="mn-daily-quote">
      <div className="mn-daily-quote-label">Today's Note</div>
      <blockquote className="mn-daily-quote-text">
        &ldquo;{quote.text}&rdquo;
      </blockquote>
      <div className="mn-daily-quote-attr">— {quote.attribution}</div>
    </section>
  );
}

function SectionRule({ eyebrow, aside, children }: {
  eyebrow: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="mn-ov-section">
      <div className="mn-ov-section-row">
        <div className="mn-ov-eyebrow">{eyebrow}</div>
        {aside && <div style={{ flexShrink: 0 }}>{aside}</div>}
      </div>
      {children}
    </section>
  );
}

function QuickTool({ to, title, note, cta = "Open" }: {
  to: string; title: string; note: string; cta?: string;
}) {
  return (
    <Link to={to} className="mn-quick-tool">
      <div className="mn-quick-tool-title">{title}</div>
      <p className="mn-quick-tool-note">{note}</p>
      <div className="mn-quick-tool-cta">
        {cta}
        {/* ↗ arrow */}
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          strokeLinecap="round" strokeLinejoin="round" width="12" height="12" aria-hidden>
          <path d="M7 17L17 7"/><path d="M7 7h10v10"/>
        </svg>
      </div>
    </Link>
  );
}

export default function MyNaiaOverview() {
  const { isDev } = useLoaderData<typeof loader>();

  return (
    <MyNaiaLayout currentPath="/my-naia">
      <DevFixtureNotice show={isDev} />

      {/* Welcome */}
      <section style={{ marginBottom: "40px" }}>
        <div className="mn-ov-eyebrow">Welcome back</div>
        <h2 style={{
          fontFamily: "var(--naia-ff-display)",
          fontWeight: 200,
          fontSize: "clamp(32px,6vw,48px)",
          lineHeight: 0.95,
          marginTop: "12px",
          color: "var(--naia-ink)",
        }}>
          Your <span style={{ fontStyle: "italic", color: "var(--naia-accent)" }}>nAia.</span>
        </h2>
      </section>

      {/* Daily editorial quote */}
      <DailyQuote />

      {/* StyleMe hero card */}
      <section className="mn-styleme-hero" style={{ marginTop: "40px" }}
        aria-label="StyleMe — your personal stylist">
        {/* Radial gradient overlay */}
        <div aria-hidden style={{
          position: "absolute", inset: 0, opacity: 0.7, pointerEvents: "none",
          background: "radial-gradient(circle at 18% 18%, rgba(139,32,53,0.22) 0, transparent 45%), radial-gradient(circle at 82% 82%, rgba(89,65,47,0.30) 0, transparent 55%)",
        }} />
        <div className="mn-styleme-hero-inner">
          <div className="mn-styleme-hero-eyebrow">Your Personal Stylist</div>
          <h3 className="mn-styleme-hero-heading">
            Style me{" "}
            <span className="mn-styleme-hero-accent">today.</span>
          </h3>
          <p className="mn-styleme-hero-body">
            Get a look based on your mood, plans, comfort needs and Style Passport.
          </p>
          <div className="mn-styleme-hero-actions">
            <Link to="/style-me" className="mn-styleme-btn-primary">
              Start StyleMe
            </Link>
            <Link to="/style-me" className="mn-styleme-btn-ghost">
              How StyleMe Works
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                strokeLinecap="round" strokeLinejoin="round" width="14" height="14" aria-hidden>
                <path d="M7 17L17 7"/><path d="M7 7h10v10"/>
              </svg>
            </Link>
          </div>
        </div>
      </section>

      {/* Quick Tools */}
      <SectionRule eyebrow="Quick Tools">
        <div className="mn-quick-tools">
          <QuickTool
            to="/style-me"
            title="Start StyleMe"
            note="A look for your mood and your plans."
          />
          <QuickTool
            to="/closet"
            title="Open My Closet"
            note="Your saved wardrobe, ready to style."
          />
          <QuickTool
            to="/buyskip"
            title="Buy or Skip"
            note="Can't decide whether to buy it? Upload a screenshot and nAia will help you choose."
            cta="Get My Recommendation"
          />
        </div>
      </SectionRule>

      {/* Recent Looks */}
      <SectionRule
        eyebrow="Recent Looks"
        aside={
          <Link to="/my-naia/saved" className="mn-ov-aside-link">
            View All Saved
          </Link>
        }
      >
        <div className="mn-ov-empty">
          <p className="mn-ov-empty-text">
            Your StyleMe sessions will appear here once you complete your first look.
          </p>
        </div>
      </SectionRule>

      {/* What nAia Is Beginning To Notice */}
      <SectionRule eyebrow="What nAia Is Beginning To Notice">
        <div className="mn-ov-empty">
          <p className="mn-ov-empty-text">
            nAia is building your picture. Complete a few StyleMe sessions to see what it's noticing.
          </p>
        </div>
        <p style={{
          marginTop: "20px",
          display: "flex", alignItems: "flex-start", gap: "8px",
          fontFamily: "var(--naia-ff-ui)", fontSize: "11px",
          lineHeight: 1.6, color: "rgba(34,21,22,0.55)",
        }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
            strokeLinecap="round" strokeLinejoin="round" width="14" height="14"
            aria-hidden style={{ marginTop: "2px", flexShrink: 0 }}>
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
            <path d="m9 12 2 2 4-4"/>
          </svg>
          nAia only shares what it is beginning to notice once there is enough gentle evidence.
        </p>
      </SectionRule>

      {/* All pages — secondary navigation links (fulfils action contract for tests) */}
      <SectionRule eyebrow="Your nAia">
        <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {[
            { label: "StyleMe",                    to: "/style-me" },
            { label: "Style Passport",             to: "/passport" },
            { label: "Personal Styling Analysis",  to: "/passport/selfie" },
            { label: "My nAia Model",              to: "/my-naia-model" },
            { label: "Digital Closet",             to: "/closet" },
            { label: "Buy or Skip",                to: "/buyskip" },
            { label: "My Trend Edits",             to: "/trends" },
            { label: "Saved",                      to: "/my-naia/saved" },
            { label: "Settings & Privacy",         to: "/settings" },
          ].map((item) => (
            <li key={item.to} style={{
              borderBottom: "1px solid rgba(34,21,22,0.09)",
            }}>
              <Link
                to={item.to}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "16px 0",
                  fontFamily: "var(--naia-ff-ui)",
                  fontSize: "10px",
                  letterSpacing: "1.8px",
                  textTransform: "uppercase",
                  color: "var(--naia-ink)",
                  textDecoration: "none",
                  transition: "color 0.13s",
                }}
                onMouseOver={(e) => { e.currentTarget.style.color = "var(--naia-accent)"; }}
                onMouseOut={(e) => { e.currentTarget.style.color = "var(--naia-ink)"; }}
              >
                {item.label}
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
                  strokeLinecap="round" strokeLinejoin="round" width="14" height="14" aria-hidden>
                  <path d="M7 17L17 7"/><path d="M7 7h10v10"/>
                </svg>
              </Link>
            </li>
          ))}
          <li style={{ borderBottom: "1px solid rgba(34,21,22,0.09)" }}>
            <span style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "16px 0",
              fontFamily: "var(--naia-ff-ui)",
              fontSize: "10px",
              letterSpacing: "1.8px",
              textTransform: "uppercase",
              color: "rgba(122,111,106,0.5)",
              opacity: 0.6,
            }}>
              Orders
              <span style={{
                fontSize: "7px", letterSpacing: "1.5px", textTransform: "uppercase",
                padding: "2px 5px",
                background: "rgba(26,92,62,0.09)", color: "rgba(26,92,62,1)",
              }}>shopify</span>
            </span>
          </li>
        </ul>

        <div style={{ marginTop: "24px", paddingTop: "24px", borderTop: "1px solid rgba(34,21,22,0.09)" }}>
          <Form method="post" action="/auth/logout">
            <button
              type="submit"
              style={{
                fontFamily: "var(--naia-ff-ui)",
                fontSize: "10px",
                letterSpacing: "1.8px",
                textTransform: "uppercase",
                color: "rgba(34,21,22,0.5)",
                background: "none",
                border: "none",
                padding: 0,
                cursor: "pointer",
                transition: "color 0.13s",
              }}
            >
              Sign Out
            </button>
          </Form>
        </div>
      </SectionRule>
    </MyNaiaLayout>
  );
}
