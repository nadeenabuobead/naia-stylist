import { useLoaderData, Link } from "react-router";
import type { LinksFunction, LoaderFunctionArgs } from "react-router";
import { getCurrentNaiaCustomer } from "~/lib/naia-session.server";
import { prisma } from "~/lib/prisma.server";
import MyNaiaLayout from "~/components/my-naia/MyNaiaLayout";
import naiaStyles from "~/styles/naia-design-system.css?url";

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: naiaStyles },
];

function fmtDate(d: string | Date): string {
  const date = new Date(d);
  const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

export async function loader({ request }: LoaderFunctionArgs) {
  const customer = await getCurrentNaiaCustomer(request);

  if (!customer) {
    return { authed: false as const, sessions: [], reviewCount: 0 };
  }

  const customerId = customer.id;

  const [sessions, reviewCount] = await Promise.all([
    prisma.stylingSession.findMany({
      where: { customerId },
      take: 5,
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
    prisma.postOutfitReview.count({ where: { customerId } }),
  ]);

  return { authed: true as const, sessions, reviewCount };
}

export default function StyleMeIndex() {
  const data = useLoaderData<typeof loader>();
  const { sessions, reviewCount } = data;
  const authed = data.authed;

  return (
    <MyNaiaLayout>
      <div className="mn-page-sections">

        {/* ── Dark StyleMe hero ── */}
        <div className="mn-styleme-hero">
          <div className="mn-styleme-hero-bg" aria-hidden="true" />
          <div className="mn-styleme-hero-inner">
            <div className="mn-styleme-hero-eyebrow">nAia StyleMe</div>
            <h1 className="mn-styleme-hero-title">The Creative Brief.</h1>
            <p className="mn-styleme-hero-sub">
              Tell nAia your mood, the occasion, and how you want to feel — it builds the complete look.
            </p>
            <div className="mn-styleme-hero-actions">
              {authed ? (
                <Link to="/style-me/mood" className="mn-styleme-btn">
                  Start a New Session
                </Link>
              ) : (
                <>
                  <Link to="/auth/shopify/login?return_to=/style-me" className="mn-styleme-btn">
                    Sign In to Continue
                  </Link>
                  <span className="mn-styleme-link">
                    Sign in to unlock personalised looks
                  </span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* ── Feedback count ── */}
        {reviewCount > 0 && (
          <section className="mn-section">
            <div className="mn-section-head">
              <div className="mn-eyebrow">Your Feedback</div>
            </div>
            <div className="mn-section-body">
              <p style={{ fontSize: "0.9rem", lineHeight: 1.75, color: "var(--fg-75)", maxWidth: "36rem", margin: 0 }}>
                You&#8217;ve reviewed {reviewCount} {reviewCount === 1 ? "look" : "looks"}.
                nAia uses your feedback to refine future sessions.
              </p>
            </div>
          </section>
        )}

        {/* ── Previous looks ── */}
        {sessions.length > 0 ? (
          <section className="mn-section">
            <div className="mn-section-head">
              <div className="mn-eyebrow">Previous Looks</div>
            </div>
            <div className="mn-section-body">
              <style>{`
                .mn-styleme-looks {
                  display: grid;
                  grid-template-columns: 1fr 1fr;
                  gap: 1.5rem;
                }
                @media (min-width: 640px) {
                  .mn-styleme-looks {
                    grid-template-columns: repeat(3, 1fr);
                    gap: 2rem;
                  }
                }
              `}</style>
              <div className="mn-styleme-looks">
                {sessions.map((session) => {
                  const suggestion = session.suggestions[0];
                  return (
                    <div key={session.id} className="mn-look-card">
                      <Link
                        to={`/style-me/result?sessionId=${session.id}`}
                        className="mn-look-preview"
                      >
                        {suggestion?.heroImageUrl ? (
                          <img
                            src={suggestion.heroImageUrl}
                            alt={suggestion.outfitName ?? "StyleMe look"}
                            style={{ width: "100%", height: "100%", objectFit: "cover" }}
                          />
                        ) : (
                          <span style={{
                            fontSize: "0.6rem",
                            textTransform: "uppercase",
                            letterSpacing: "0.24em",
                            color: "var(--fg-40)",
                          }}>
                            No Preview
                          </span>
                        )}
                        <span className="mn-look-badge">Look</span>
                      </Link>
                      <time
                        className="mn-look-date"
                        dateTime={new Date(session.createdAt).toISOString()}
                      >
                        {fmtDate(session.createdAt)}
                      </time>
                      <Link
                        to={`/style-me/result?sessionId=${session.id}`}
                        className="mn-look-title"
                      >
                        {suggestion?.outfitName ?? "nAia Look"}
                      </Link>
                      {session.occasion && (
                        <p className="mn-look-meta">{session.occasion}</p>
                      )}
                      {session.currentMood && (
                        <div className="mn-look-tags">
                          <span className="mn-look-tag">{session.currentMood}</span>
                        </div>
                      )}
                      <div className="mn-look-actions">
                        <Link
                          to={`/style-me/result?sessionId=${session.id}`}
                          className="mn-look-action-link"
                        >
                          View look
                        </Link>
                        {!session.review ? (
                          <>
                            <span className="mn-look-dot">·</span>
                            <Link
                              to={`/post-wear-review?sessionId=${session.id}`}
                              className="mn-look-action-link"
                            >
                              Leave feedback
                            </Link>
                          </>
                        ) : (
                          <>
                            <span className="mn-look-dot">·</span>
                            <span style={{
                              fontSize: "0.62rem",
                              textTransform: "uppercase",
                              letterSpacing: "0.24em",
                              color: "oklch(0.4 0.12 155)",
                            }}>
                              Reviewed
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </section>
        ) : authed ? (
          <section className="mn-section">
            <div className="mn-section-head">
              <div className="mn-eyebrow">Previous Looks</div>
            </div>
            <div className="mn-section-body">
              <p className="mn-state-note">
                Your StyleMe looks will appear here after your first session.
              </p>
            </div>
          </section>
        ) : null}

      </div>
    </MyNaiaLayout>
  );
}
