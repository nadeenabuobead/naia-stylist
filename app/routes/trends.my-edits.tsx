import type { LinksFunction, LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData } from "react-router";
import { requireCurrentNaiaCustomer } from "~/lib/naia-session.server";
import { getPublishedEditorialReports } from "~/lib/editorial-reports.server";
import {
  getShopperEvidence,
  buildShopperEdit,
} from "~/lib/trend-evidence.server";
import MyNaiaLayout from "~/components/my-naia/MyNaiaLayout";
import { loadHistoryCards } from "~/lib/personalised-trend-history.server";
import type { HistoryCard } from "~/lib/personalised-trend-history";
import naiaStyles from "~/styles/naia-design-system.css?url";

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: naiaStyles },
  {
    rel: "stylesheet",
    href: "https://fonts.googleapis.com/css2?family=Oswald:wght@200;300;400&family=Cormorant+Garamond:ital,wght@0,300;0,400;1,300;1,400&family=Space+Mono&display=swap",
  },
];

export function meta() {
  return [{ title: "My Trend Edits | My nAia" }];
}

type CardItem = {
  slug: string;
  title: string;
  season: string;
  subTitle: string | null; // null = Passport incomplete
};

type LoaderData = {
  cards: CardItem[];
  hasProfile: boolean;
  /** Report History — one entry per canonical report, never per version. */
  history: HistoryCard[];
};

export async function loader({ request }: LoaderFunctionArgs): Promise<LoaderData> {
  const customer = await requireCurrentNaiaCustomer(request);

  const reports = (await getPublishedEditorialReports())
    .slice()
    .sort((a, b) => (a.publishedAt < b.publishedAt ? 1 : -1));

  // Single DB round-trip for all personalisation signals.
  const evidence = await getShopperEvidence(customer.id);

  // Report History. Distinct from My Saved: these are edits she RECEIVED, not
  // things she bookmarked, and they never appear in /my-naia/saved.
  const history = await loadHistoryCards(customer.id);

  const cards: CardItem[] = reports.map((report) => {
    let subTitle: string | null = null;
    if (evidence.hasProfile) {
      try {
        const edit = buildShopperEdit(report, evidence);
        subTitle = edit.subTitle ?? null;
      } catch {
        // buildShopperEdit failed for this report; leave locked
      }
    }
    return { slug: report.slug, title: report.title, season: report.season, subTitle };
  });

  return { cards, hasProfile: evidence.hasProfile, history };
}

const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
function fmtReceived(iso: string): string {
  const d = new Date(iso);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

const TINTS = ["#efeae0", "#e6dccb", "#d9c9b5", "#efe6d7", "#e2d3bf", "#ede2cf"];

const css = `
  /* ── Previously — secondary to the current edits ── */
  .tme-history { margin-top: 56px; }
  .tme-history-intro {
    font-family: 'Cormorant Garamond', serif;
    font-style: italic;
    font-size: 0.98rem;
    color: rgba(26,17,9,0.6);
    margin: 0 0 20px;
  }
  .tme-history-list { list-style: none; padding: 0; margin: 0; }
  .tme-history-item { border-top: 1px solid rgba(26,17,9,0.10); }
  .tme-history-item:last-child { border-bottom: 1px solid rgba(26,17,9,0.10); }
  .tme-history-link {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px 20px;
    padding: 16px 0;
    text-decoration: none;
    transition: opacity 0.15s;
  }
  .tme-history-link:hover { opacity: 0.62; }
  .tme-history-title {
    font-family: 'Oswald', sans-serif;
    font-weight: 300;
    font-size: 1.02rem;
    letter-spacing: 0.02em;
    text-transform: uppercase;
    color: #1a1109;
  }
  .tme-history-meta {
    font-family: 'Space Mono', monospace;
    font-size: 9.5px;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: rgba(26,17,9,0.5);
  }

  .tme-page { padding: 48px 0 96px; }

  /* ── Hero ─────────────────────────────────────────────────────── */
  .tme-hero { margin-bottom: 52px; }
  .tme-hero-eyebrow {
    font-family: 'Space Mono', monospace;
    font-size: 0.6rem;
    letter-spacing: 0.34em;
    text-transform: uppercase;
    color: rgba(26,17,9,0.50);
    margin-bottom: 24px;
  }
  .tme-hero-title {
    font-family: 'Oswald', sans-serif;
    font-size: 2rem;
    font-weight: 200;
    line-height: 0.92;
    letter-spacing: 0.02em;
    text-transform: uppercase;
    margin: 0 0 24px;
    color: #1a1109;
  }
  @media (min-width: 640px) { .tme-hero-title { font-size: 3rem; } }
  @media (min-width: 1024px) { .tme-hero-title { font-size: 4.25rem; } }
  .tme-hero-title em {
    font-family: 'Cormorant Garamond', serif;
    font-style: italic;
    font-weight: 300;
    text-transform: none;
    color: #7a1e28;
  }
  .tme-hero-sub {
    font-family: 'Cormorant Garamond', serif;
    font-size: 1.05rem;
    font-style: italic;
    color: rgba(26,17,9,0.65);
    max-width: 38rem;
    line-height: 1.75;
  }

  .tme-divider { height: 1px; background: rgba(26,17,9,0.10); margin: 40px 0; }

  /* ── Passport banner ──────────────────────────────────────────── */
  .tme-banner {
    background: #2a1e17;
    color: #f0ebe2;
    padding: 32px;
    margin-bottom: 32px;
    display: flex;
    flex-direction: column;
    gap: 20px;
  }
  .tme-banner-eyebrow {
    font-family: 'Space Mono', monospace;
    font-size: 0.55rem;
    letter-spacing: 0.3em;
    text-transform: uppercase;
    color: rgba(240,235,226,0.55);
  }
  .tme-banner-text {
    font-family: 'Cormorant Garamond', serif;
    font-size: 1.05rem;
    font-style: italic;
    color: rgba(240,235,226,0.80);
    line-height: 1.70;
    max-width: 44rem;
  }
  .tme-banner-btn {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    border: 1px solid rgba(240,235,226,0.6);
    border-radius: 9999px;
    padding: 11px 22px;
    font-family: 'Space Mono', monospace;
    font-size: 0.6rem;
    letter-spacing: 0.26em;
    text-transform: uppercase;
    color: #f0ebe2;
    text-decoration: none;
    align-self: flex-start;
    transition: background 0.2s, color 0.2s;
  }
  .tme-banner-btn:hover { background: #f0ebe2; color: #1a1109; }

  .tme-section-eyebrow {
    font-family: 'Space Mono', monospace;
    font-size: 0.55rem;
    letter-spacing: 0.30em;
    text-transform: uppercase;
    color: rgba(26,17,9,0.45);
    margin-bottom: 20px;
  }

  /* ── Card grid ────────────────────────────────────────────────── */
  .tme-grid {
    display: grid;
    gap: 16px;
  }
  @media (min-width: 640px) { .tme-grid { grid-template-columns: repeat(2, 1fr); } }
  @media (min-width: 1024px) { .tme-grid { grid-template-columns: repeat(3, 1fr); } }

  .tme-card {
    position: relative;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    overflow: hidden;
    padding: 24px;
    text-decoration: none;
    color: inherit;
    transition: transform 0.5s ease;
    aspect-ratio: 4 / 5;
  }
  .tme-card:hover { transform: translateY(-4px); }
  .tme-card-num {
    position: absolute;
    right: -16px;
    top: -32px;
    font-family: 'Oswald', sans-serif;
    font-size: clamp(10rem, 12vw, 12rem);
    font-weight: 200;
    line-height: 1;
    color: rgba(26,17,9,0.06);
    pointer-events: none;
    user-select: none;
    z-index: 0;
    letter-spacing: 0.02em;
    text-transform: uppercase;
  }
  .tme-card-top {
    position: relative;
    z-index: 1;
    display: flex;
    align-items: center;
    gap: 8px;
    font-family: 'Space Mono', monospace;
    font-size: 0.55rem;
    letter-spacing: 0.28em;
    text-transform: uppercase;
    color: rgba(26,17,9,0.6);
  }
  .tme-card-dot {
    display: inline-block;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #7a1e28;
    flex-shrink: 0;
  }
  .tme-card-bottom { position: relative; z-index: 1; }
  .tme-card-title {
    font-family: 'Oswald', sans-serif;
    font-size: clamp(1.5rem, 2.5vw, 2rem);
    font-weight: 200;
    letter-spacing: 0.02em;
    text-transform: uppercase;
    line-height: 1.1;
    color: #1a1109;
    margin-bottom: 16px;
    transition: color 0.3s;
  }
  .tme-card:hover .tme-card-title { color: #7a1e28; }

  /* Personalised subtitle */
  .tme-card-subtitle {
    font-family: 'Cormorant Garamond', serif;
    font-size: 0.95rem;
    font-style: italic;
    color: rgba(26,17,9,0.72);
    line-height: 1.65;
    margin-bottom: 20px;
  }

  /* Locked state */
  .tme-card-locked {
    font-family: 'Cormorant Garamond', serif;
    font-size: 0.88rem;
    font-style: italic;
    color: rgba(26,17,9,0.42);
    line-height: 1.55;
    margin-bottom: 16px;
    padding-left: 14px;
    border-left: 2px solid rgba(26,17,9,0.14);
  }

  .tme-card-cta {
    font-family: 'Space Mono', monospace;
    font-size: 0.58rem;
    letter-spacing: 0.28em;
    text-transform: uppercase;
    color: #7a1e28;
  }

  /* ── Empty state ──────────────────────────────────────────────── */
  .tme-empty {
    padding: 72px 40px;
    border: 1px solid rgba(26,17,9,0.10);
    background: rgba(255,255,255,0.45);
    text-align: center;
  }
  .tme-empty-title {
    font-family: 'Oswald', sans-serif;
    font-size: 2rem;
    font-weight: 200;
    letter-spacing: 0.02em;
    text-transform: uppercase;
    color: #1a1109;
    margin-bottom: 16px;
  }
  .tme-empty-title em {
    font-family: 'Cormorant Garamond', serif;
    font-style: italic;
    text-transform: none;
    color: #7a1e28;
  }
  .tme-empty-sub {
    font-family: 'Cormorant Garamond', serif;
    font-size: 1rem;
    font-style: italic;
    color: rgba(26,17,9,0.60);
    max-width: 34rem;
    margin: 0 auto 32px;
    line-height: 1.65;
  }
  .tme-empty-link {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    border: 1px solid rgba(26,17,9,0.80);
    border-radius: 9999px;
    padding: 11px 22px;
    font-family: 'Space Mono', monospace;
    font-size: 0.6rem;
    letter-spacing: 0.26em;
    text-transform: uppercase;
    color: #1a1109;
    text-decoration: none;
    transition: background 0.2s, color 0.2s;
  }
  .tme-empty-link:hover { background: #1a1109; color: #f5f0e8; }
`;

export default function MyTrendEdits() {
  const loaderData = useLoaderData() as LoaderData;
  const { cards, hasProfile } = loaderData;
  // Previously is secondary to the current edits; if history is unavailable the
  // page still reads, it just does not offer the archive.
  const history = loaderData.history ?? [];

  return (
    <MyNaiaLayout compact>
      <style>{css}</style>
      <div className="tme-page">
        {/* Hero */}
        <div className="tme-hero">
          <h1 className="sp-shell-title">MY TREND <span className="sp-shell-accent">edits.</span></h1>
          <p className="sp-shell-desc">
            Each Trend Report, read against your Style Passport and Closet — showing what is relevant to you, what to skip, and how to wear it.
          </p>
        </div>

        <div className="tme-divider" />

        {cards.length === 0 ? (
          <div className="tme-empty">
            <p className="tme-empty-title">your trend edits<br /><em>are on their way.</em></p>
            <p className="tme-empty-sub">
              nAia will publish Trend Edits as new reports arrive. Build your Passport now so your edit is ready the moment it lands.
            </p>
            <Link to="/passport" className="tme-empty-link">Build My Passport →</Link>
          </div>
        ) : (
          <>
            {!hasProfile && (
              <div className="tme-banner">
                <div className="tme-banner-eyebrow">style passport incomplete</div>
                <p className="tme-banner-text">
                  Complete your Style Passport and nAia will read each of these directions through your actual style, lifestyle, and wardrobe — showing you exactly what applies to you.
                </p>
                <Link to="/passport" className="tme-banner-btn">Complete My Passport →</Link>
              </div>
            )}

            <div className="tme-section-eyebrow">
              {hasProfile ? "Your edits" : "Available edits"}
            </div>

            <div className="tme-grid">
              {cards.map((card, i) => {
                const tint = TINTS[i % TINTS.length];
                const num = String(i + 1).padStart(2, "0");

                return (
                  <Link
                    key={card.slug}
                    to={`/trends/my-edits/${card.slug}`}
                    className="tme-card"
                    style={{ background: tint }}
                  >
                    <span className="tme-card-num" aria-hidden="true">{num}</span>
                    <div className="tme-card-top">
                      <span className="tme-card-dot" />
                      {card.season}
                    </div>
                    <div className="tme-card-bottom">
                      <div className="tme-card-title">{card.title}</div>

                      {card.subTitle !== null ? (
                        <p className="tme-card-subtitle">{card.subTitle}</p>
                      ) : (
                        <p className="tme-card-locked">
                          Complete your Style Passport to unlock your edit.
                        </p>
                      )}

                      <span className="tme-card-cta">
                        {card.subTitle !== null ? "Open My Edit →" : "Start Passport →"}
                      </span>
                    </div>
                  </Link>
                );
              })}
            </div>
          </>
        )}

        {history.length > 0 && (
          <section className="tme-history" aria-labelledby="tme-history-heading">
            <div className="tme-divider" />
            <div className="tme-section-eyebrow" id="tme-history-heading">Previously</div>
            <p className="tme-history-intro">
              Edits you&rsquo;ve already received, kept exactly as nAia wrote them.
            </p>
            <ul className="tme-history-list">
              {history.map((entry) => (
                <li key={entry.reportId} className="tme-history-item">
                  <Link
                    to={`/trends/my-edits/${entry.reportSlug}?edit=${entry.snapshotId}`}
                    className="tme-history-link"
                  >
                    <span className="tme-history-title">{entry.reportTitle}</span>
                    <span className="tme-history-meta">
                      {entry.reportSeason} · received {fmtReceived(entry.receivedAt)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </MyNaiaLayout>
  );
}
