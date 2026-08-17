import type { LinksFunction, LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData } from "react-router";
import { requireCurrentNaiaCustomer } from "~/lib/naia-session.server";
import { trendReports } from "~/lib/trend-reports";
import {
  getShopperEvidence,
  buildShopperEdit,
} from "~/lib/trend-evidence.server";
import MyNaiaLayout from "~/components/my-naia/MyNaiaLayout";
import naiaStyles from "~/styles/naia-design-system.css?url";

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: naiaStyles },
  {
    rel: "stylesheet",
    href: "https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,200;0,400;1,200;1,400&family=Cormorant+Garamond:ital,wght@0,300;0,400;1,300;1,400&family=Space+Mono&display=swap",
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
};

export async function loader({ request }: LoaderFunctionArgs): Promise<LoaderData> {
  const customer = await requireCurrentNaiaCustomer(request);

  const reports = trendReports
    .filter((r) => r.published)
    .sort((a, b) => (a.publishedAt < b.publishedAt ? 1 : -1));

  // Single DB round-trip for all personalisation signals.
  const evidence = await getShopperEvidence(customer.id);

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

  return { cards, hasProfile: evidence.hasProfile };
}

const CARD_TINTS = ["#f0ebe0", "#e8dece", "#ddd0bc"];

const css = `
  .te-page { padding: 48px 0 96px; }

  .te-hero { margin-bottom: 52px; }
  .te-hero-eyebrow {
    font-family: 'Space Mono', 'Courier New', monospace;
    font-size: 0.6rem;
    letter-spacing: 0.34em;
    text-transform: uppercase;
    color: rgba(26,17,9,0.50);
    margin-bottom: 20px;
  }
  .te-hero-title {
    font-family: 'Playfair Display', Georgia, serif;
    font-size: clamp(2.6rem, 6vw, 4.2rem);
    font-weight: 200;
    line-height: 0.92;
    margin-bottom: 24px;
    color: #1a1109;
  }
  .te-hero-accent { font-style: italic; color: #7a1e28; }
  .te-hero-sub {
    font-family: 'Cormorant Garamond', Garamond, serif;
    font-size: 1.1rem;
    font-style: italic;
    color: rgba(26,17,9,0.68);
    max-width: 38rem;
    line-height: 1.7;
  }

  .te-divider { height: 1px; background: rgba(26,17,9,0.10); margin: 40px 0; }

  .te-section-eyebrow {
    font-family: 'Space Mono', monospace;
    font-size: 0.55rem;
    letter-spacing: 0.30em;
    text-transform: uppercase;
    color: rgba(26,17,9,0.50);
    margin-bottom: 20px;
  }

  .te-grid { display: grid; gap: 14px; }

  .te-card {
    position: relative;
    overflow: hidden;
    padding: 32px 32px 28px;
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    min-height: 200px;
    text-decoration: none;
    color: inherit;
    transition: transform 0.35s ease;
  }
  .te-card:hover { transform: translateY(-3px); }

  .te-card-num {
    position: absolute;
    right: -10px;
    top: -20px;
    font-family: 'Playfair Display', serif;
    font-size: clamp(6rem, 12vw, 10rem);
    font-weight: 200;
    line-height: 1;
    color: rgba(26,17,9,0.05);
    pointer-events: none;
    user-select: none;
    z-index: 0;
  }
  .te-card-inner { position: relative; z-index: 1; }

  .te-card-kicker {
    font-family: 'Space Mono', monospace;
    font-size: 0.55rem;
    letter-spacing: 0.28em;
    text-transform: uppercase;
    color: rgba(26,17,9,0.50);
    margin-bottom: 12px;
  }
  .te-card-title {
    font-family: 'Playfair Display', serif;
    font-size: clamp(1.4rem, 2.8vw, 1.9rem);
    font-weight: 400;
    line-height: 1.15;
    margin-bottom: 14px;
    color: #1a1109;
  }
  .te-card-title em { font-style: italic; color: #7a1e28; }

  /* Personalised subtitle — replaces the public summary */
  .te-card-subtitle {
    font-family: 'Cormorant Garamond', serif;
    font-size: 1rem;
    font-style: italic;
    color: rgba(26,17,9,0.75);
    line-height: 1.6;
    margin-bottom: 20px;
    max-width: 44rem;
  }

  /* Locked state — profile incomplete */
  .te-card-locked {
    font-family: 'Cormorant Garamond', serif;
    font-size: 0.9rem;
    font-style: italic;
    color: rgba(26,17,9,0.45);
    line-height: 1.55;
    margin-bottom: 16px;
    padding-left: 16px;
    border-left: 2px solid rgba(26,17,9,0.15);
  }
  .te-card-locked-hint {
    font-family: 'Space Mono', monospace;
    font-size: 0.55rem;
    letter-spacing: 0.22em;
    text-transform: uppercase;
    color: rgba(26,17,9,0.35);
    margin-bottom: 16px;
    display: block;
  }

  .te-card-cta {
    font-family: 'Space Mono', monospace;
    font-size: 0.58rem;
    letter-spacing: 0.28em;
    text-transform: uppercase;
    color: #7a1e28;
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }

  /* First-use banner when the entire list is locked */
  .te-passport-banner {
    padding: 32px;
    border: 1px solid rgba(26,17,9,0.10);
    background: rgba(255,255,255,0.45);
    margin-bottom: 28px;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .te-passport-banner-text {
    font-family: 'Cormorant Garamond', serif;
    font-size: 1.05rem;
    font-style: italic;
    color: rgba(26,17,9,0.70);
    line-height: 1.65;
  }
  .te-passport-banner-link {
    display: inline-block;
    padding: 12px 28px;
    border: 1px solid rgba(26,17,9,0.22);
    font-family: 'Space Mono', monospace;
    font-size: 0.6rem;
    letter-spacing: 0.26em;
    text-transform: uppercase;
    color: #1a1109;
    text-decoration: none;
    align-self: flex-start;
    transition: background 0.2s, color 0.2s;
  }
  .te-passport-banner-link:hover { background: #1a1109; color: #f5f0e8; }

  .te-empty {
    padding: 72px 40px;
    border: 1px solid rgba(26,17,9,0.10);
    background: rgba(255,255,255,0.45);
    text-align: center;
  }
  .te-empty-title {
    font-family: 'Cormorant Garamond', serif;
    font-size: 1.55rem;
    font-style: italic;
    color: #1a1109;
    margin-bottom: 16px;
    line-height: 1.5;
  }
  .te-empty-sub {
    font-family: 'Cormorant Garamond', serif;
    font-size: 1rem;
    font-style: italic;
    color: rgba(26,17,9,0.60);
    max-width: 34rem;
    margin: 0 auto 32px;
    line-height: 1.65;
  }
  .te-empty-link {
    display: inline-block;
    padding: 13px 30px;
    border: 1px solid rgba(26,17,9,0.25);
    font-family: 'Space Mono', monospace;
    font-size: 0.6rem;
    letter-spacing: 0.26em;
    text-transform: uppercase;
    color: #1a1109;
    text-decoration: none;
    transition: background 0.2s, color 0.2s;
  }
  .te-empty-link:hover { background: #1a1109; color: #f5f0e8; }
`;

export default function MyTrendEdits() {
  const { cards, hasProfile } = useLoaderData() as LoaderData;

  return (
    <MyNaiaLayout compact>
      <style>{css}</style>
      <div className="te-page">
        <div className="te-hero">
          <div className="te-hero-eyebrow">personal edit</div>
          <h1 className="te-hero-title">
            my trend<br />
            <em className="te-hero-accent">edits.</em>
          </h1>
          <p className="te-hero-sub">
            Each Trend Report, read against your Style Passport and Closet — showing what is relevant to you, what to skip, and how to wear it.
          </p>
        </div>

        <div className="te-divider" />

        {cards.length === 0 ? (
          <div className="te-empty">
            <p className="te-empty-title">Your trend edits are on their way.</p>
            <p className="te-empty-sub">
              nAia will publish Trend Edits as new reports arrive. Check back shortly — or build your Passport now so your edit is ready the moment it lands.
            </p>
            <Link to="/passport" className="te-empty-link">Build My Passport</Link>
          </div>
        ) : (
          <>
            {!hasProfile && (
              <div className="te-passport-banner">
                <p className="te-passport-banner-text">
                  Your Style Passport is incomplete. Complete it and nAia will read each of these directions through your actual style, lifestyle, and wardrobe — and show you exactly what applies to you.
                </p>
                <Link to="/passport" className="te-passport-banner-link">Complete My Passport</Link>
              </div>
            )}

            <div className="te-section-eyebrow">
              {hasProfile ? "Your edits" : "Available edits"}
            </div>

            <div className="te-grid">
              {cards.map((card, i) => {
                const tint = CARD_TINTS[i % CARD_TINTS.length];
                const words = card.title.split(" ");
                const bodyWords = words.slice(0, -1).join(" ");
                const lastWord = words[words.length - 1];

                return (
                  <Link
                    key={card.slug}
                    to={`/trends/my-edits/${card.slug}`}
                    className="te-card"
                    style={{ background: tint }}
                  >
                    <span className="te-card-num" aria-hidden="true">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <div className="te-card-inner">
                      <div className="te-card-kicker">{card.season}</div>
                      <div className="te-card-title">
                        {bodyWords}{bodyWords ? " " : ""}<em>{lastWord}</em>
                      </div>

                      {card.subTitle !== null ? (
                        <p className="te-card-subtitle">{card.subTitle}</p>
                      ) : (
                        <>
                          <p className="te-card-locked">
                            Complete your Style Passport to unlock your edit.
                          </p>
                          <span className="te-card-locked-hint">Passport required</span>
                        </>
                      )}

                      <span className="te-card-cta">
                        {card.subTitle !== null ? "Open My Edit →" : "Start Passport →"}
                      </span>
                    </div>
                  </Link>
                );
              })}
            </div>
          </>
        )}
      </div>
    </MyNaiaLayout>
  );
}
