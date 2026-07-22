import { useLoaderData, Link } from "react-router";
import type { LinksFunction, LoaderFunctionArgs } from "react-router";
import { requireCurrentNaiaCustomer } from "~/lib/naia-session.server";
import { prisma } from "~/lib/prisma.server";
import MyNaiaLayout from "~/components/my-naia/MyNaiaLayout";
import naiaStyles from "~/styles/naia-design-system.css?url";

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: naiaStyles },
];

const QUOTES = [
  {
    text: "On a day when nothing feels right, a great fabric next to the skin changes something.",
    attribution: "nAia Editorial Note",
  },
  {
    text: "Dressing is a small, daily rehearsal for the person you are becoming.",
    attribution: "nAia Editorial Note",
  },
  {
    text: "Ease is not the absence of effort. It is effort placed where no one can see it.",
    attribution: "nAia Editorial Note",
  },
  {
    text: "A wardrobe is a quiet argument you have with yourself about who you are today.",
    attribution: "nAia Editorial Note",
  },
  {
    text: "The right piece rarely announces itself. It simply stops feeling like a decision.",
    attribution: "nAia Editorial Note",
  },
  {
    text: "Confidence often begins at the shoulder, the wrist, the hem — small places, worn well.",
    attribution: "nAia Editorial Note",
  },
  {
    text: "Clothes remember the days you wore them. Choose the ones you want to remember back.",
    attribution: "nAia Editorial Note",
  },
  {
    text: "Style is a way of being on good terms with the mirror.",
    attribution: "nAia Editorial Note",
  },
  {
    text: "A silhouette is a sentence. Keep yours short and true.",
    attribution: "nAia Editorial Note",
  },
  {
    text: "The most personal thing you can wear is what you already understand.",
    attribution: "nAia Editorial Note",
  },
  {
    text: "Some mornings, elegance is simply the courage to keep it plain.",
    attribution: "nAia Editorial Note",
  },
  {
    text: "A colour worn often becomes a kind of signature you did not know you were writing.",
    attribution: "nAia Editorial Note",
  },
];

function getDailyQuote() {
  const start = new Date(2026, 0, 1).getTime();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dayIndex = Math.floor((today.getTime() - start) / (1000 * 60 * 60 * 24));
  return QUOTES[Math.abs(dayIndex) % QUOTES.length];
}

function fmtDate(d: string | Date): string {
  const date = new Date(d);
  const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

const VERDICT_LABELS: Record<string, string> = {
  BUY: "Buy it",
  SKIP: "Skip it",
  MAYBE: "Maybe",
};

export async function loader({ request }: LoaderFunctionArgs) {
  const customer = await requireCurrentNaiaCustomer(request);
  const customerId = customer.id;

  const [sessions, trendReport, buyOrSkipHistory, reviewCount, closetCount] =
    await Promise.all([
      prisma.stylingSession.findMany({
        where: { customerId },
        take: 3,
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          createdAt: true,
          currentMood: true,
          occasion: true,
          suggestions: {
            take: 1,
            select: { id: true, heroImageUrl: true, outfitName: true },
          },
          review: { select: { id: true } },
        },
      }),
      prisma.trendReport.findFirst({
        where: { publishedAt: { lte: new Date() } },
        orderBy: { publishedAt: "desc" },
        select: { title: true, slug: true, summary: true },
      }),
      prisma.buyOrSkipAnalysis.findMany({
        where: { customerId },
        take: 3,
        orderBy: { createdAt: "desc" },
        select: { id: true, productName: true, verdict: true, createdAt: true },
      }),
      prisma.postOutfitReview.count({ where: { customerId } }),
      prisma.closetItem.count({ where: { customerId } }),
    ]);

  return {
    firstName: customer.firstName ?? null,
    profile: customer.onboardingProfile,
    sessions,
    trendReport,
    buyOrSkipHistory,
    reviewCount,
    closetCount,
  };
}

export default function MyNaiaOverview() {
  const { firstName, profile, sessions, trendReport, buyOrSkipHistory, reviewCount, closetCount } =
    useLoaderData<typeof loader>();

  const quote = getDailyQuote();

  const attentionItems: Array<{ title: string; note: string; cta: string; href: string }> = [];
  if (!profile) {
    attentionItems.push({
      title: "Start your Style Passport",
      note: "Your answers help nAia personalise every look it creates for you.",
      cta: "Start",
      href: "/full-style-profile",
    });
  } else if (!profile.completed) {
    attentionItems.push({
      title: "Continue your Style Passport",
      note: "A few more answers help nAia refine its recommendations.",
      cta: "Continue",
      href: "/full-style-profile",
    });
  }
  if (closetCount === 0) {
    attentionItems.push({
      title: "Add your first closet piece",
      note: "Upload items so nAia can style you from your own wardrobe.",
      cta: "Upload",
      href: "/my-naia/closet",
    });
  }

  return (
    <MyNaiaLayout currentPath="/my-naia">

      {/* 1 — Daily editorial quote */}
      <section className="mn-section-rule">
        <div className="mn-section-rule-header">
          <span className="mn-section-rule-eyebrow">Today&#8217;s Note</span>
        </div>
        <blockquote className="mn-daily-quote">
          <p className="mn-daily-quote-label">Editorial</p>
          <p className="mn-daily-quote-text">&#8220;{quote.text}&#8221;</p>
          <footer className="mn-daily-quote-attribution">&#8212; {quote.attribution}</footer>
        </blockquote>
      </section>

      {/* 2 — StyleMe hero card */}
      <div className="mn-hero-card">
        <div className="mn-hero-card-bg" aria-hidden="true" />
        <div className="mn-hero-card-inner">
          <p className="mn-hero-card-eyebrow">nAia&#8217;s Eye</p>
          <h2 className="mn-hero-card-title">
            {firstName ? `Ready when you are, ${firstName}.` : "Ready when you are."}
          </h2>
          <p className="mn-hero-card-body">
            Tell nAia your mood, occasion, and how you want to feel — and it will build the complete look.
          </p>
          <div className="mn-hero-card-actions">
            <Link to="/style-me/mood" className="mn-hero-card-cta">
              Start a New Session
            </Link>
            <Link to="/style-me" className="mn-hero-card-link">
              Style Me overview &#8594;
            </Link>
          </div>
        </div>
      </div>

      {/* 3 — Previous looks */}
      {sessions.length > 0 && (
        <section className="mn-section-rule" style={{ marginTop: "var(--naia-sp-10)" }}>
          <div className="mn-section-rule-header">
            <span className="mn-section-rule-eyebrow">My Looks</span>
            <Link to="/style-me" className="mn-inline-link mn-section-rule-aside">
              View all
            </Link>
          </div>
          <div className="mn-looks-grid">
            {sessions.map((session) => {
              const suggestion = session.suggestions[0];
              return (
                <div key={session.id} className="mn-look-card">
                  <Link
                    to={`/style-me/result?sessionId=${session.id}`}
                    className="mn-look-card-img"
                    aria-label={`View look: ${suggestion?.outfitName ?? "nAia Look"}`}
                  >
                    {suggestion?.heroImageUrl ? (
                      <img
                        src={suggestion.heroImageUrl}
                        alt={suggestion.outfitName ?? "nAia look"}
                      />
                    ) : (
                      <span style={{ fontSize: "2rem", opacity: 0.3 }}>&#128247;</span>
                    )}
                    {session.review && (
                      <span className="mn-look-card-badge">Reviewed</span>
                    )}
                  </Link>
                  <time className="mn-look-card-date" dateTime={new Date(session.createdAt).toISOString()}>
                    {fmtDate(session.createdAt)}
                  </time>
                  <Link
                    to={`/style-me/result?sessionId=${session.id}`}
                    className="mn-look-card-title"
                  >
                    {suggestion?.outfitName ?? "nAia Look"}
                  </Link>
                  {(session.currentMood || session.occasion) && (
                    <p className="mn-look-card-meta">
                      {[session.currentMood, session.occasion].filter(Boolean).join(" · ")}
                    </p>
                  )}
                  <div className="mn-look-card-actions">
                    <Link
                      to={`/style-me/result?sessionId=${session.id}`}
                      className="mn-look-card-action"
                    >
                      View look
                    </Link>
                    {!session.review && (
                      <>
                        <span className="mn-look-card-sep" aria-hidden="true">/</span>
                        <Link
                          to={`/post-wear-review?sessionId=${session.id}`}
                          className="mn-look-card-action"
                        >
                          Leave feedback
                        </Link>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* 4 — Attention required */}
      {attentionItems.length > 0 && (
        <section className="mn-section-rule">
          <div className="mn-section-rule-header">
            <span className="mn-section-rule-eyebrow">Needs Attention</span>
          </div>
          <div className="mn-attention-list">
            {attentionItems.map((item) => (
              <div key={item.title} className="mn-attention-item">
                <div>
                  <p className="mn-attention-title">{item.title}</p>
                  <p className="mn-attention-note">{item.note}</p>
                </div>
                <Link to={item.href} className="mn-attention-cta">
                  {item.cta}
                </Link>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 5 — Quick tools */}
      <section className="mn-section-rule">
        <div className="mn-section-rule-header">
          <span className="mn-section-rule-eyebrow">Quick Tools</span>
        </div>
        <div className="mn-quick-tools-grid">
          <Link to="/my-naia/closet" className="mn-quick-tool">
            <p className="mn-quick-tool-title">My Closet</p>
            <p className="mn-quick-tool-note">
              {closetCount > 0
                ? `${closetCount} ${closetCount === 1 ? "piece" : "pieces"} in your digital wardrobe.`
                : "Upload your pieces so nAia can style from your own wardrobe."}
            </p>
            <span className="mn-quick-tool-cta">Open closet &#8594;</span>
          </Link>
          <Link to="/my-naia/buy-or-skip" className="mn-quick-tool">
            <p className="mn-quick-tool-title">Buy or Skip</p>
            <p className="mn-quick-tool-note">
              Unsure about a purchase? nAia checks it against your style and wardrobe.
            </p>
            <span className="mn-quick-tool-cta">Start a decision &#8594;</span>
          </Link>
          <div className="mn-quick-tool" style={{ opacity: 0.5, cursor: "not-allowed" }}>
            <p className="mn-quick-tool-title">Trend Edits</p>
            <p className="mn-quick-tool-note">
              Curated seasonal edits filtered through your style profile.
            </p>
            <span className="mn-quick-tool-cta" style={{ fontStyle: "italic" }}>Coming soon</span>
          </div>
        </div>
      </section>

      {/* 6 — Trend Reports */}
      <section className="mn-section-rule">
        <div className="mn-section-rule-header">
          <span className="mn-section-rule-eyebrow">Trend Reports</span>
        </div>
        {trendReport ? (
          <div>
            <p className="mn-detail-row-label" style={{ marginBottom: "var(--naia-sp-2)" }}>
              Latest Report
            </p>
            <p className="mn-look-card-title" style={{ marginBottom: "var(--naia-sp-3)" }}>
              {trendReport.title}
            </p>
            <p
              className="mn-section-shell-desc"
              style={{ marginTop: 0, marginBottom: "var(--naia-sp-5)" }}
            >
              {trendReport.summary}
            </p>
            <Link to={`/trends/${trendReport.slug}`} className="mn-inline-link">
              Read report &#8594;
            </Link>
          </div>
        ) : (
          <p className="mn-state-note">
            Trend reports will appear here once published. Check back soon.
          </p>
        )}
      </section>

      {/* 7 — Notices (only if >= 3 reviews) */}
      {reviewCount >= 3 && (
        <section className="mn-section-rule">
          <div className="mn-section-rule-header">
            <span className="mn-section-rule-eyebrow">nAia is Noticing</span>
          </div>
          <div className="mn-notice-list">
            <div className="mn-notice-item">
              <p className="mn-notice-label">Style Intelligence</p>
              <p className="mn-notice-text">
                Based on {reviewCount} reviews, nAia is building a clearer picture of what works for you.
                Your feedback is being used to refine future looks.
              </p>
            </div>
          </div>
          <p className="mn-notice-threshold-note">
            Personalised pattern insights will appear once nAia has enough data to speak with confidence.
          </p>
        </section>
      )}
      {reviewCount < 3 && sessions.length > 0 && (
        <section className="mn-section-rule">
          <div className="mn-section-rule-header">
            <span className="mn-section-rule-eyebrow">nAia is Noticing</span>
          </div>
          <p className="mn-state-note">
            Review {3 - reviewCount} more {3 - reviewCount === 1 ? "look" : "looks"} and nAia will begin
            sharing what it&#8217;s observing about your style.
          </p>
        </section>
      )}

      {/* 8 — Buy or Skip history */}
      <section className="mn-section-rule">
        <div className="mn-section-rule-header">
          <span className="mn-section-rule-eyebrow">Buy or Skip</span>
          <Link to="/my-naia/buy-or-skip" className="mn-inline-link mn-section-rule-aside">
            All decisions
          </Link>
        </div>
        {buyOrSkipHistory.length > 0 ? (
          <div className="mn-decision-list">
            {buyOrSkipHistory.map((item) => (
              <div key={item.id} className="mn-decision-row">
                <p className="mn-decision-date">{fmtDate(item.createdAt)}</p>
                <p className="mn-decision-product">{item.productName ?? "Unnamed item"}</p>
                <p className="mn-decision-verdict">
                  {VERDICT_LABELS[item.verdict] ?? item.verdict}
                </p>
              </div>
            ))}
          </div>
        ) : (
          <p className="mn-state-note">
            No decisions yet.{" "}
            <Link to="/buyskip" className="mn-inline-link mn-inline-link--muted">
              Start your first Buy or Skip
            </Link>
          </p>
        )}
      </section>

      {/* 9 — Orders (unavailable) */}
      <section className="mn-section-rule">
        <div className="mn-section-rule-header">
          <span className="mn-section-rule-eyebrow">Orders</span>
        </div>
        <p className="mn-state-note">
          Your NADINE order history will appear here once order integration is complete.
        </p>
      </section>

      {/* 10 — Plan & Usage (unavailable) */}
      <section className="mn-section-rule">
        <div className="mn-section-rule-header">
          <span className="mn-section-rule-eyebrow">Plan &amp; Usage</span>
        </div>
        <p className="mn-state-note">Your plan and usage details will appear here.</p>
      </section>

      {/* 11 — Style Passport quick summary */}
      <section className="mn-section-rule">
        <div className="mn-section-rule-header">
          <span className="mn-section-rule-eyebrow">Style Passport</span>
          <Link to="/my-naia/style-passport" className="mn-inline-link mn-section-rule-aside">
            View passport
          </Link>
        </div>
        {profile ? (
          <div>
            {profile.stylePersonalities?.length > 0 && (
              <p
                className="mn-section-shell-desc"
                style={{ marginTop: 0, marginBottom: "var(--naia-sp-4)" }}
              >
                {profile.stylePersonalities.join(", ")}
              </p>
            )}
            <p className="mn-detail-row-label">
              {profile.completed ? "Passport complete" : "Passport in progress"}
            </p>
            <Link to="/my-naia/style-passport" className="mn-inline-link" style={{ marginTop: "var(--naia-sp-5)", display: "inline-block" }}>
              {profile.completed ? "Review passport" : "Continue passport"}
            </Link>
          </div>
        ) : (
          <p className="mn-state-note">
            Your Style Passport hasn&#8217;t been started yet.{" "}
            <Link to="/full-style-profile" className="mn-inline-link mn-inline-link--muted">
              Start now
            </Link>
          </p>
        )}
      </section>

    </MyNaiaLayout>
  );
}
