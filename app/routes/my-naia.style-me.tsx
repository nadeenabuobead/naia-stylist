import { useLoaderData, Link } from "react-router";
import type { LinksFunction, LoaderFunctionArgs } from "react-router";
import { getCurrentNaiaCustomer } from "~/lib/naia-session.server";
import { prisma } from "~/lib/prisma.server";
import MyNaiaLayout from "~/components/my-naia/MyNaiaLayout";
import naiaStyles from "~/styles/naia-design-system.css?url";

export const links: LinksFunction = () => [{ rel: "stylesheet", href: naiaStyles }];

function fmtDate(d: string | Date): string {
  const date = new Date(d);
  const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

export async function loader({ request }: LoaderFunctionArgs) {
  const customer = await getCurrentNaiaCustomer(request);
  if (!customer) return { authed: false as const, sessions: [], reviewCount: 0 };

  const [sessions, reviewCount] = await Promise.all([
    prisma.stylingSession.findMany({
      where: { customerId: customer.id },
      take: 9,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        createdAt: true,
        currentMood: true,
        occasion: true,
        suggestions: {
          take: 1,
          select: { id: true, outfitName: true },
        },
        review: { select: { id: true } },
      },
    }),
    prisma.postOutfitReview.count({ where: { customerId: customer.id } }),
  ]);

  return { authed: true as const, sessions, reviewCount };
}

export default function MyNaiaStyleMe() {
  const data = useLoaderData<typeof loader>();
  const { sessions, reviewCount } = data;
  const authed = data.authed;

  return (
    <MyNaiaLayout>
      <div className="mn-page-sections">
        <Link to="/my-naia" className="mn-back-link">
          <span aria-hidden="true">←</span> Back to Overview
        </Link>

        {/* Header */}
        <section>
          <div className="mn-eyebrow">StyleMe</div>
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
            Style Me
          </h1>
          <p style={{ marginTop: "1rem", maxWidth: "42rem", fontSize: "0.9rem", lineHeight: 1.75, color: "var(--fg-75)" }}>
            Tell nAia about the occasion and receive a considered look built from NADINE pieces and/or your own Closet.
          </p>
        </section>

        {/* Start a new session panel */}
        <section
          style={{
            border: "1px solid var(--fg-10)",
            background: "var(--bg-50)",
            padding: "2rem",
          }}
        >
          <div className="mn-eyebrow">Start a New Session</div>
          <p
            style={{
              marginTop: "1.25rem",
              maxWidth: "36rem",
              fontSize: "0.9rem",
              lineHeight: 1.75,
              color: "var(--fg-75)",
            }}
          >
            Answer a few questions about how you feel, what you need and where you&apos;re going.
          </p>
          <div style={{ marginTop: "1.5rem" }}>
            {authed ? (
              <Link to="/style-me/mood" className="mn-btn-primary">
                Start a New Session
              </Link>
            ) : (
              <Link to="/auth/shopify/login?return_to=/my-naia/style-me" className="mn-btn-primary">
                Sign In to Continue
              </Link>
            )}
          </div>
        </section>

        {/* Recent feedback note */}
        {reviewCount > 0 && (
          <section style={{ borderTop: "1px solid var(--fg-12)", paddingTop: "2rem" }}>
            <div className="mn-eyebrow">Recent Feedback</div>
            <p
              style={{
                marginTop: "0.75rem",
                maxWidth: "36rem",
                fontSize: "0.9rem",
                lineHeight: 1.75,
                color: "var(--fg-75)",
              }}
            >
              You&#8217;ve reviewed {reviewCount}{" "}
              {reviewCount === 1 ? "look" : "looks"}. nAia uses your feedback to refine future
              sessions.
            </p>
          </section>
        )}

        {/* Previous looks */}
        {sessions.length > 0 ? (
          <section style={{ borderTop: "1px solid var(--fg-12)", paddingTop: "2rem" }}>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                alignItems: "baseline",
                justifyContent: "space-between",
                gap: "1rem",
              }}
            >
              <div className="mn-eyebrow">Previous Looks</div>
              <Link to="/my-naia/styleme/looks" className="mn-see-link">
                See All
              </Link>
            </div>

            <ul
              style={{
                listStyle: "none",
                padding: 0,
                marginTop: "1.5rem",
                display: "grid",
                gap: "1.5rem",
                gridTemplateColumns: "repeat(auto-fill, minmax(11rem, 1fr))",
              }}
            >
              {sessions.map((session) => {
                const suggestion = session.suggestions[0];
                return (
                  <li key={session.id}>
                    <article style={{ display: "flex", flexDirection: "column" }}>
                      <Link
                        to={`/my-naia/styleme/looks/${session.id}`}
                        style={{
                          display: "block",
                          aspectRatio: "4/5",
                          border: "1px solid var(--fg-10)",
                          background: "color-mix(in oklab, var(--bg) 92%, white)",
                          position: "relative",
                          overflow: "hidden",
                          textDecoration: "none",
                        }}
                      >
                        <span
                          style={{
                            position: "absolute",
                            inset: 0,
                            display: "grid",
                            placeItems: "center",
                            fontSize: "0.58rem",
                            textTransform: "uppercase",
                            letterSpacing: "0.28em",
                            color: "var(--fg-40)",
                          }}
                        >
                          Look
                        </span>
                      </Link>

                      <time
                        style={{
                          display: "block",
                          marginTop: "0.75rem",
                          fontSize: "0.6rem",
                          textTransform: "uppercase",
                          letterSpacing: "0.3em",
                          color: "var(--fg-55)",
                        }}
                        dateTime={new Date(session.createdAt).toISOString()}
                      >
                        {fmtDate(session.createdAt)}
                        {session.occasion ? ` · ${session.occasion}` : ""}
                      </time>

                      <Link
                        to={`/my-naia/styleme/looks/${session.id}`}
                        style={{
                          display: "block",
                          marginTop: "0.375rem",
                          fontFamily: "var(--ff-display)",
                          fontWeight: 300,
                          fontSize: "1.125rem",
                          letterSpacing: "0.02em",
                          textTransform: "uppercase",
                          color: "var(--fg)",
                          textDecoration: "none",
                        }}
                      >
                        {suggestion?.outfitName ?? "nAia Look"}
                      </Link>

                      {session.currentMood && (
                        <p style={{ marginTop: "0.25rem", fontSize: "0.78rem", color: "var(--fg-65)" }}>
                          {session.currentMood}
                        </p>
                      )}

                      <div
                        style={{
                          marginTop: "0.75rem",
                          display: "flex",
                          flexWrap: "wrap",
                          gap: "0.75rem",
                          alignItems: "center",
                          fontSize: "0.62rem",
                          textTransform: "uppercase",
                          letterSpacing: "0.26em",
                        }}
                      >
                        <Link
                          to={`/my-naia/styleme/looks/${session.id}`}
                          style={{
                            textDecoration: "underline",
                            textUnderlineOffset: "3px",
                            color: "var(--fg-80)",
                          }}
                        >
                          View Look
                        </Link>
                        {!session.review && (
                          <>
                            <span style={{ color: "var(--fg-25)" }}>·</span>
                            <Link
                              to={`/my-naia/styleme/looks/${session.id}/feedback`}
                              style={{ textDecoration: "underline", textUnderlineOffset: "3px", color: "var(--fg-80)" }}
                            >
                              Give Feedback
                            </Link>
                          </>
                        )}
                        {session.review && (
                          <>
                            <span style={{ color: "var(--fg-25)" }}>·</span>
                            <span style={{ color: "oklch(0.4 0.12 155)", fontSize: "0.62rem", textTransform: "uppercase", letterSpacing: "0.26em" }}>
                              Reviewed
                            </span>
                          </>
                        )}
                      </div>
                    </article>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : authed ? (
          <section style={{ borderTop: "1px solid var(--fg-12)", paddingTop: "2rem" }}>
            <div className="mn-eyebrow">Previous Looks</div>
            <p className="mn-state-note" style={{ marginTop: "1rem" }}>
              Your StyleMe looks will appear here after your first session.
            </p>
          </section>
        ) : null}

        {/* All looks link */}
        {sessions.length > 0 && (
          <div style={{ display: "flex", gap: "1rem" }}>
            <Link to="/my-naia/styleme/looks" className="mn-btn-outline">View All Looks</Link>
            <Link to="/my-naia/saved" className="mn-btn-ghost">Saved</Link>
          </div>
        )}
      </div>
    </MyNaiaLayout>
  );
}
