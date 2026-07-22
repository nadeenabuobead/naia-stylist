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
    <MyNaiaLayout currentPath="/style-me">

      {/* Start a new session */}
      <section className="mn-section-shell" style={{ borderTop: 0, paddingTop: 0 }}>
        <div className="mn-section-shell-header">
          <div>
            <p className="mn-section-shell-eyebrow">nAia StyleMe</p>
            <h1 className="mn-section-shell-title">The creative brief.</h1>
          </div>
        </div>
        <p className="mn-section-shell-desc">
          Tell nAia your mood, the occasion, and how you want to feel — it will build the
          complete look.
        </p>

        {authed ? (
          <div className="mn-styleme-start-box" style={{ marginTop: "var(--naia-sp-8)" }}>
            <p className="mn-detail-row-label" style={{ marginBottom: "var(--naia-sp-4)" }}>
              New Session
            </p>
            <Link to="/style-me/mood" className="mn-btn-primary">
              Start a New Session
            </Link>
          </div>
        ) : (
          <div className="mn-styleme-start-box" style={{ marginTop: "var(--naia-sp-8)" }}>
            <p className="mn-state-note" style={{ marginBottom: "var(--naia-sp-4)" }}>
              Sign in to start a StyleMe session and access your full style history.
            </p>
            <Link to="/auth/shopify/login?return_to=/style-me" className="mn-btn-primary">
              Sign In to Continue
            </Link>
          </div>
        )}
      </section>

      {/* Recent feedback count */}
      {reviewCount > 0 && (
        <section className="mn-section-rule">
          <div className="mn-section-rule-header">
            <span className="mn-section-rule-eyebrow">Your Feedback</span>
          </div>
          <p className="mn-section-shell-desc" style={{ marginTop: 0 }}>
            You&#8217;ve reviewed {reviewCount} {reviewCount === 1 ? "look" : "looks"}.
            nAia uses your feedback to refine future sessions.
          </p>
        </section>
      )}

      {/* Previous looks */}
      {sessions.length > 0 ? (
        <section className="mn-section-rule">
          <div className="mn-section-rule-header">
            <span className="mn-section-rule-eyebrow">Previous Looks</span>
          </div>
          <div className="mn-styleme-look-grid">
            {sessions.map((session) => {
              const suggestion = session.suggestions[0];
              return (
                <div key={session.id} className="mn-styleme-look-item">
                  <time
                    className="mn-styleme-look-date"
                    dateTime={new Date(session.createdAt).toISOString()}
                  >
                    {fmtDate(session.createdAt)}
                  </time>
                  <Link
                    to={`/style-me/result?sessionId=${session.id}`}
                    className="mn-styleme-look-title"
                  >
                    {suggestion?.outfitName ?? "nAia Look"}
                  </Link>
                  {session.occasion && (
                    <p className="mn-styleme-look-occasion">{session.occasion}</p>
                  )}
                  {session.currentMood && (
                    <div className="mn-styleme-look-tags">
                      <span className="mn-styleme-look-tag">{session.currentMood}</span>
                    </div>
                  )}
                  <div className="mn-styleme-look-actions">
                    <Link
                      to={`/style-me/result?sessionId=${session.id}`}
                      className="mn-styleme-look-action"
                    >
                      View look
                    </Link>
                    {!session.review && (
                      <Link
                        to={`/post-wear-review?sessionId=${session.id}`}
                        className="mn-styleme-look-action"
                      >
                        Leave feedback
                      </Link>
                    )}
                    {session.review && (
                      <span
                        style={{
                          fontFamily: "var(--naia-ff-ui)",
                          fontSize: "0.68rem",
                          textTransform: "uppercase",
                          letterSpacing: "0.28em",
                          color: "var(--naia-ok)",
                        }}
                      >
                        Reviewed
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ) : authed ? (
        <section className="mn-section-rule">
          <div className="mn-section-rule-header">
            <span className="mn-section-rule-eyebrow">Previous Looks</span>
          </div>
          <p className="mn-state-note">
            Your StyleMe looks will appear here after your first session.
          </p>
        </section>
      ) : null}

    </MyNaiaLayout>
  );
}
