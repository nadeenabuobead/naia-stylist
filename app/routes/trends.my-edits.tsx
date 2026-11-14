import type { LinksFunction, LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData } from "react-router";
import { requireCurrentNaiaCustomer } from "~/lib/naia-session.server";
import { getPublishedEditorialReports } from "~/lib/editorial-reports.server";
import { getUsageWindow } from "~/lib/plan/usage-window.server";
import {
  getShopperEvidence,
  buildShopperEdit,
} from "~/lib/trend-evidence.server";
import MyNaiaLayout from "~/components/my-naia/MyNaiaLayout";
import naiaStyles from "~/styles/naia-design-system.css?url";

// "2026-06-30" -> "June 2026". Same parsing pattern as
// personalised-trend-edit-usage.server.ts's formatPeriodKeyLabel —
// duplicated rather than imported, per that file's own established
// convention (this module never depends on the plan layer for display
// formatting). Falls back to the raw string rather than throwing, since a
// malformed or missing publishedAt must never break this page.
function formatReportMonthLabel(publishedAt: string): string {
  const match = /^(\d{4})-(\d{2})-\d{2}$/.exec(publishedAt);
  if (!match) return publishedAt || "Undated";
  const [, yearStr, monthStr] = match;
  const asDate = new Date(Date.UTC(Number(yearStr), Number(monthStr) - 1, 1));
  return asDate.toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
}

// A report only counts as "this month's edit" when its own publication
// month matches the server's actual current month — never assumed. A
// report published in an earlier month (e.g. the editorial cadence hasn't
// caught up yet) must never be labelled "this month's edit"; see the
// featured-eyebrow logic below for the honest fallback.
function reportPeriodKey(publishedAt: string): string | null {
  const match = /^(\d{4}-\d{2})-\d{2}$/.exec(publishedAt);
  return match ? match[1] : null;
}

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
  monthLabel: string; // derived from the report's own publishedAt — never relabelled
  isCurrentPeriod: boolean; // true only when publishedAt falls in the server's actual current month
};

// One real calendar month's worth of editorial content. Multiple reports can
// legitimately share a periodKey (e.g. several reports all dated in the same
// month, before a genuine monthly cadence existed) — grouping by periodKey,
// not one-card-per-report, is what stops that from being displayed as if
// each report were its own separate monthly edition.
type MonthGroup = {
  periodKey: string | null; // null when the report's publishedAt didn't parse
  monthLabel: string;
  isCurrentPeriod: boolean;
  cards: CardItem[];
};

type LoaderData = {
  groups: MonthGroup[];
  hasProfile: boolean;
};

export async function loader({ request }: LoaderFunctionArgs): Promise<LoaderData> {
  const customer = await requireCurrentNaiaCustomer(request);

  const reports = (await getPublishedEditorialReports())
    .slice()
    .sort((a, b) => (a.publishedAt < b.publishedAt ? 1 : -1));

  // Single DB round-trip for all personalisation signals.
  const evidence = await getShopperEvidence(customer.id);
  const { periodKey: currentPeriodKey } = getUsageWindow();

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
    return {
      slug: report.slug,
      title: report.title,
      season: report.season,
      subTitle,
      monthLabel: formatReportMonthLabel(report.publishedAt),
      isCurrentPeriod: reportPeriodKey(report.publishedAt) === currentPeriodKey,
    };
  });

  // Group consecutive cards sharing the same real periodKey. Cards already
  // arrive newest-first, so each group's own order (and the overall group
  // order) is preserved — this only merges adjacent same-month cards, it
  // never reorders or re-labels anything.
  const groups: MonthGroup[] = [];
  for (const report of reports) {
    const periodKey = reportPeriodKey(report.publishedAt);
    const card = cards.find((c) => c.slug === report.slug)!;
    const lastGroup = groups[groups.length - 1];
    if (lastGroup && lastGroup.periodKey === periodKey) {
      lastGroup.cards.push(card);
    } else {
      groups.push({ periodKey, monthLabel: card.monthLabel, isCurrentPeriod: card.isCurrentPeriod, cards: [card] });
    }
  }

  return { groups, hasProfile: evidence.hasProfile };
}

const TINTS = ["#efeae0", "#e6dccb", "#d9c9b5", "#efe6d7", "#e2d3bf", "#ede2cf"];

const css = `
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

  /* ── Featured (current month) ────────────────────────────────────
     QA fix (2026-11-13): shows the current month's edit prominently,
     with previous months below as an archive.
     QA fix (2026-11-14): the first compact pass (min-height 220-260px)
     still read as oversized — large empty vertical space and an
     oversized background numeral pushed the CTA below the fold
     on mobile. This version sizes to content instead of a forced
     min-height, and shrinks the decorative numeral so it reads as a
     texture, not a headline. Reuses every existing .tme-card-* part
     (num/top/dot/title/subtitle/locked/cta); only the outer sizing
     differs. */
  .tme-featured {
    aspect-ratio: auto;
    padding: 22px 24px;
    margin-bottom: 28px;
  }
  .tme-featured .tme-card-num { font-size: clamp(3.5rem, 5vw, 5rem); top: -6px; right: -4px; }
  .tme-featured .tme-card-title { font-size: clamp(1.3rem, 2vw, 1.6rem); margin-bottom: 8px; }
  .tme-featured .tme-card-subtitle,
  .tme-featured .tme-card-locked { font-size: 0.92rem; max-width: 40rem; margin-bottom: 12px; }
  .tme-featured .tme-card-top { margin-bottom: 4px; }

  /* ── Siblings — other reports sharing the featured card's own month ──
     Smaller than the featured card but distinguished from the archive
     grid below (different section, different heading) — these are NOT
     "previous editions"; they are more content from the SAME month. */
  .tme-siblings-label {
    font-family: 'Cormorant Garamond', serif;
    font-size: 0.85rem;
    font-style: italic;
    color: rgba(26,17,9,0.55);
    margin: 0 0 12px;
  }
  .tme-siblings-grid {
    display: grid;
    gap: 14px;
    margin-bottom: 28px;
  }
  @media (min-width: 640px) { .tme-siblings-grid { grid-template-columns: repeat(2, 1fr); } }
  @media (min-width: 1024px) { .tme-siblings-grid { grid-template-columns: repeat(3, 1fr); } }

  /* ── Archive month grouping ───────────────────────────────────────
     Each past month gets its own small label before its own row of
     cards, so multiple reports from one past month read as "more from
     that month," not as separate months. */
  .tme-archive-month {
    font-family: 'Space Mono', monospace;
    font-size: 0.6rem;
    letter-spacing: 0.22em;
    text-transform: uppercase;
    color: rgba(26,17,9,0.5);
    margin: 24px 0 12px;
  }
  .tme-archive-month:first-of-type { margin-top: 0; }

  /* ── Card grid (archive) ──────────────────────────────────────── */
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

function TrendEditCard({ card, index, featured }: { card: CardItem; index: number; featured: boolean }) {
  const tint = TINTS[index % TINTS.length];
  const num = String(index + 1).padStart(2, "0");

  return (
    <Link
      to={`/trends/my-edits/${card.slug}`}
      className={featured ? "tme-card tme-featured" : "tme-card"}
      style={{ background: tint }}
    >
      <span className="tme-card-num" aria-hidden="true">{num}</span>
      <div className="tme-card-top">
        <span className="tme-card-dot" />
        {card.monthLabel}
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
}

export default function MyTrendEdits() {
  const { groups, hasProfile } = useLoaderData() as LoaderData;
  // Groups arrive newest-month-first (loader groups cards by periodKey,
  // preserving the loader's own newest-first card order) — the first
  // group is the latest month's content. Within that group, the first
  // card is featured; any OTHER cards in the same group are siblings from
  // the same month, not separate "previous editions." Only groups strictly
  // after the first are a real archive of earlier months.
  const [currentGroup, ...archiveGroups] = groups;
  const [currentCard, ...siblingCards] = currentGroup?.cards ?? [];
  const totalCards = groups.reduce((n, g) => n + g.cards.length, 0);

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

        {totalCards === 0 ? (
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
              {currentGroup.isCurrentPeriod
                ? (hasProfile ? `This month's edit — ${currentGroup.monthLabel}` : `Available now — ${currentGroup.monthLabel}`)
                : `Latest edit — ${currentGroup.monthLabel}`}
            </div>

            <TrendEditCard card={currentCard} index={0} featured />

            {siblingCards.length > 0 && (
              <>
                <p className="tme-siblings-label">Also published in {currentGroup.monthLabel}:</p>
                <div className="tme-siblings-grid">
                  {siblingCards.map((card, i) => (
                    <TrendEditCard key={card.slug} card={card} index={i + 1} featured={false} />
                  ))}
                </div>
              </>
            )}

            {archiveGroups.length > 0 && (
              <>
                <div className="tme-section-eyebrow">Previous editions</div>
                {archiveGroups.map((group) => (
                  <div key={group.periodKey ?? group.monthLabel}>
                    <div className="tme-archive-month">{group.monthLabel}</div>
                    <div className="tme-grid">
                      {group.cards.map((card, i) => (
                        <TrendEditCard key={card.slug} card={card} index={i} featured={false} />
                      ))}
                    </div>
                  </div>
                ))}
              </>
            )}
          </>
        )}
      </div>
    </MyNaiaLayout>
  );
}
