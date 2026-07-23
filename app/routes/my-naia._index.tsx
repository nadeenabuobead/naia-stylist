import { useLoaderData, Link } from "react-router";
import type { LinksFunction, LoaderFunctionArgs } from "react-router";
import { requireCurrentNaiaCustomer } from "~/lib/naia-session.server";
import prisma from "~/db.server";
import MyNaiaLayout from "~/components/my-naia/MyNaiaLayout";
import naiaStyles from "~/styles/naia-design-system.css?url";

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: naiaStyles },
];

const QUOTES = [
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
  BUY: "Buy — strong addition",
  SKIP: "Skip it",
  MAYBE: "Buy, but only if…",
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
          id: true, createdAt: true, currentMood: true, desiredFeeling: true, occasion: true, styleFrom: true,
          suggestions: {
            take: 1, select: { id: true, heroImageUrl: true, outfitName: true, savedAsLook: true,
              items: { take: 1, select: { closetItemId: true, productTitle: true, closetItem: { select: { name: true } } } } }
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
    sessions, trendReport, buyOrSkipHistory, reviewCount, closetCount,
  };
}

export default function MyNaiaOverview() {
  const { firstName, profile, sessions, trendReport, buyOrSkipHistory, reviewCount, closetCount } =
    useLoaderData<typeof loader>();

  const quote = getDailyQuote();

  const attentionItems: Array<{ title: string; note: string; cta: string; to: string }> = [];
  if (!profile) {
    attentionItems.push({ title: "Your Style Passport is incomplete", note: "A few details are still missing to refine your styling direction.", cta: "Continue", to: "/my-naia/style-passport" });
  } else if (!profile.completed) {
    attentionItems.push({ title: "Your Style Passport is incomplete", note: "A few more answers help nAia refine its recommendations.", cta: "Continue", to: "/my-naia/style-passport" });
  }
  if (closetCount === 0) {
    attentionItems.push({ title: "Your closet is empty", note: "Upload pieces so nAia can style you from your own wardrobe.", cta: "Add a Piece", to: "/my-naia/closet" });
  }

  return (
    <MyNaiaLayout>
      <div className="mn-page-sections">

        {/* Welcome */}
        <section>
          <div className="mn-eyebrow">Welcome back</div>
          <h2 style={{ fontFamily: "var(--ff-display)", fontWeight: 200, marginTop: "0.75rem", fontSize: "clamp(2.25rem,6vw,3.75rem)", lineHeight: 0.95, letterSpacing: "0.02em", textTransform: "uppercase" }}>
            <span style={{ fontFamily: "var(--ff-editorial)", fontStyle: "italic", color: "var(--lipstick)", textTransform: "none", fontWeight: 400 }}>
              {firstName ? `${firstName}.` : "Welcome."}
            </span>
          </h2>
        </section>

        {/* Daily quote */}
        <section className="mn-daily-quote" aria-label="Today's Note">
          <div className="mn-daily-quote-label">Today&#8217;s Note</div>
          <blockquote className="mn-daily-quote-text">
            &#8220;{quote.text}&#8221;
          </blockquote>
          <div className="mn-daily-quote-attr">&#8212; {quote.attribution}</div>
        </section>

        {/* StyleMe dark hero */}
        <section className="mn-styleme-hero">
          <div className="mn-styleme-hero-bg" aria-hidden="true" />
          <div className="mn-styleme-hero-inner">
            <div className="mn-styleme-hero-eyebrow">Your Personal Stylist</div>
            <h3 className="mn-styleme-hero-title">
              Style me{" "}
              <span style={{ fontFamily: "var(--ff-editorial)", fontStyle: "italic", textTransform: "none", color: "oklch(0.955 0.012 70)" }}>
                today.
              </span>
            </h3>
            <p className="mn-styleme-hero-sub">
              Get a look based on your mood, plans, comfort needs and Style Passport.
            </p>
            <div className="mn-styleme-hero-actions">
              <Link to="/my-naia/style-me" className="mn-styleme-btn">
                Start StyleMe
              </Link>
              <Link to="/my-naia/style-me" className="mn-styleme-link">
                How StyleMe Works
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M7 17 17 7M17 7H7M17 7v10" />
                </svg>
              </Link>
            </div>
          </div>
        </section>

        {/* What needs attention */}
        {attentionItems.length > 0 && (
          <section className="mn-section">
            <div className="mn-section-head">
              <div className="mn-eyebrow">What Needs Your Attention</div>
            </div>
            <div className="mn-section-body">
              <ul className="mn-attention-list">
                {attentionItems.map((a) => (
                  <li key={a.to} className="mn-attention-item">
                    <div className="mn-content" style={{ minWidth: 0 }}>
                      <div className="mn-attention-title">{a.title}</div>
                      <p className="mn-attention-note">{a.note}</p>
                    </div>
                    <Link to={a.to} className="mn-see-link" style={{ flexShrink: 0 }}>
                      {a.cta}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          </section>
        )}

        {/* Quick Tools */}
        <section className="mn-section">
          <div className="mn-section-head">
            <div className="mn-eyebrow">Quick Tools</div>
          </div>
          <div className="mn-section-body" style={{ display: "grid", gap: "0.75rem" }}>
            <div style={{ display: "grid", gap: "0.75rem" }}>
              <style>{`@media (min-width:640px){.mn-quick-grid{grid-template-columns:repeat(3,1fr)!important}}`}</style>
              <div className="mn-quick-grid" style={{ display: "grid", gap: "0.75rem" }}>
                <Link to="/my-naia/style-me" className="mn-quick-tool">
                  <div className="mn-quick-tool-title">Start StyleMe</div>
                  <p className="mn-quick-tool-note">A look for your mood and your plans.</p>
                  <div className="mn-quick-tool-cta">Open <span aria-hidden>↗</span></div>
                </Link>
                <Link to="/my-naia/closet" className="mn-quick-tool">
                  <div className="mn-quick-tool-title">Open My Closet</div>
                  <p className="mn-quick-tool-note">Your saved wardrobe, ready to style.</p>
                  <div className="mn-quick-tool-cta">Open <span aria-hidden>↗</span></div>
                </Link>
                <Link to="/my-naia/buy-or-skip" className="mn-quick-tool">
                  <div className="mn-quick-tool-title">Buy or Skip</div>
                  <p className="mn-quick-tool-note">Can&#8217;t decide whether to buy it? nAia will help you choose.</p>
                  <div className="mn-quick-tool-cta">Get My Recommendation <span aria-hidden>↗</span></div>
                </Link>
              </div>
            </div>
          </div>
        </section>

        {/* Recent Looks */}
        <section className="mn-section">
          <div className="mn-section-head">
            <div className="mn-eyebrow">Recent Looks</div>
            <Link to="/my-naia/styleme/looks" className="mn-see-link">View All Looks</Link>
          </div>
          <div className="mn-section-body">
            {sessions.length === 0 ? (
              <p className="mn-state-note">Your first StyleMe look will appear here after your first session.</p>
            ) : (
              <>
              <style>{`@media (min-width:640px){.mn-looks-grid-inner{grid-template-columns:repeat(2,1fr)!important}}@media (min-width:1024px){.mn-looks-grid-inner{grid-template-columns:repeat(3,1fr)!important}}`}</style>
              <div className="mn-looks-grid-inner" style={{ display: "grid", gap: "1.5rem" }}>
                {sessions.map((session) => {
                  const suggestion = session.suggestions[0];
                  const items = suggestion?.items ?? [];
                  const hasNadine = items.some((i) => !i.closetItemId && i.productTitle);
                  const hasCloset = items.some((i) => !!i.closetItemId);
                  const sourcing = hasNadine && hasCloset ? "NADINE + My Closet" : hasNadine ? "NADINE" : hasCloset ? "My Closet" : session.styleFrom === "OWN_WARDROBE" ? "My Closet" : "NADINE";
                  return (
                    <article key={session.id} style={{ display: "flex", flexDirection: "column" }}>
                      <Link
                        to={`/my-naia/styleme/looks/${session.id}`}
                        style={{
                          display: "grid",
                          placeItems: "center",
                          aspectRatio: "4/5",
                          border: "1px solid var(--fg-10)",
                          background: "color-mix(in oklab, var(--bg) 92%, white)",
                          position: "relative",
                          overflow: "hidden",
                          textDecoration: "none",
                        }}
                        aria-label={`View look — ${suggestion?.outfitName ?? "nAia Look"}`}
                      >
                        {suggestion?.heroImageUrl ? (
                          <img src={suggestion.heroImageUrl} alt={suggestion.outfitName ?? ""} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                        ) : (
                          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.25, color: "var(--fg)" }} aria-hidden="true">
                            <path d="M12 3 4.5 7.5v9L12 21l7.5-4.5v-9L12 3z" /><path d="m4.5 7.5 7.5 4.5 7.5-4.5M12 12v9" />
                          </svg>
                        )}
                        {suggestion?.savedAsLook && (
                          <span style={{ position: "absolute", left: "0.75rem", top: "0.75rem", fontSize: "0.55rem", textTransform: "uppercase", letterSpacing: "0.3em", background: "var(--bg)", padding: "0.25rem 0.5rem", color: "var(--fg-80)" }}>Saved</span>
                        )}
                      </Link>
                      <div className="mn-look-date" style={{ marginTop: "0.75rem" }}>
                        {fmtDate(session.createdAt)}{session.occasion ? ` · ${session.occasion}` : ""}
                      </div>
                      <Link to={`/my-naia/styleme/looks/${session.id}`} className="mn-look-title" style={{ marginTop: "0.375rem" }}>
                        {suggestion?.outfitName ?? "nAia Look"}
                      </Link>
                      {(session.currentMood || session.desiredFeeling) && (
                        <p className="mn-look-meta" style={{ marginTop: "0.375rem", fontSize: "0.82rem", color: "var(--fg-70)" }}>
                          {session.currentMood && <><span style={{ color: "var(--fg-55)" }}>Mood ·</span> {session.currentMood}</>}
                          {session.currentMood && session.desiredFeeling && <span style={{ color: "var(--fg-40)" }}> → </span>}
                          {session.desiredFeeling && <><span style={{ color: "var(--fg-55)" }}>Feeling ·</span> {session.desiredFeeling}</>}
                        </p>
                      )}
                      <div style={{ marginTop: "0.375rem", fontSize: "0.66rem", textTransform: "uppercase", letterSpacing: "0.28em", color: "var(--fg-55)" }}>
                        {sourcing}
                      </div>
                      <div className="mn-look-actions" style={{ marginTop: "0.75rem" }}>
                        <Link to={`/my-naia/styleme/looks/${session.id}`} className="mn-look-action-link">View Look</Link>
                        <span className="mn-look-dot" aria-hidden="true">·</span>
                        <Link to={`/my-naia/styleme/looks/${session.id}/refine`} className="mn-look-action-link">Refine</Link>
                        {!session.review && (
                          <>
                            <span className="mn-look-dot" aria-hidden="true">·</span>
                            <Link to={`/my-naia/styleme/looks/${session.id}/feedback`} className="mn-look-action-link">Give Feedback</Link>
                          </>
                        )}
                        {session.review && (
                          <>
                            <span className="mn-look-dot" aria-hidden="true">·</span>
                            <Link to={`/my-naia/styleme/looks/${session.id}/feedback`} className="mn-look-action-link">View Feedback</Link>
                          </>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
              </>
            )}
          </div>
        </section>

        {/* What nAia Is Noticing */}
        <section className="mn-section">
          <div className="mn-section-head">
            <div className="mn-eyebrow">What nAia Is Beginning To Notice</div>
          </div>
          <div className="mn-section-body">
            {reviewCount >= 3 ? (
              <>
                <ul style={{ listStyle: "none", padding: 0, margin: 0, borderTop: "1px solid var(--fg-12)" }}>
                  <li style={{ padding: "1.25rem 0", borderBottom: "1px solid var(--fg-12)" }}>
                    <div style={{ fontSize: "0.62rem", textTransform: "uppercase", letterSpacing: "0.3em", color: "var(--lipstick)" }}>Style Intelligence</div>
                    <p style={{ marginTop: "0.5rem", fontSize: "0.95rem", lineHeight: 1.75, color: "var(--fg-85)" }}>
                      Based on {reviewCount} post-wear reviews, nAia is building a picture of what consistently works for you.
                    </p>
                  </li>
                </ul>
                <p style={{ marginTop: "1.25rem", display: "flex", alignItems: "flex-start", gap: "0.5rem", fontSize: "0.78rem", lineHeight: 1.625, color: "var(--fg-55)" }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginTop: "0.125rem", flexShrink: 0 }} aria-hidden="true">
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                  </svg>
                  nAia only shares what it is beginning to notice once there is enough gentle evidence.
                </p>
              </>
            ) : (
              <p className="mn-state-note">
                Review {Math.max(0, 3 - reviewCount)} more {3 - reviewCount === 1 ? "look" : "looks"} and nAia will begin sharing what it&#8217;s observing about your style.
              </p>
            )}
          </div>
        </section>

        {/* Latest Trend Edit */}
        <section className="mn-section">
          <div className="mn-section-head">
            <div className="mn-eyebrow">Your Latest Trend Edit</div>
            {trendReport && <Link to={`/trends/${trendReport.slug}`} className="mn-see-link">Open My Trend Edit</Link>}
          </div>
          <div className="mn-section-body">
            {trendReport ? (
              <div style={{ display: "grid", gap: "1.5rem" }}>
                <style>{`@media(min-width:1024px){.mn-trend-grid{grid-template-columns:1.3fr 1fr!important;gap:2.5rem!important}}`}</style>
                <div className="mn-trend-grid" style={{ display: "grid" }}>
                  <div>
                    <div style={{ fontSize: "0.62rem", textTransform: "uppercase", letterSpacing: "0.3em", color: "var(--fg-55)" }}>Ready · Latest</div>
                    <h3 style={{ fontFamily: "var(--ff-display)", fontWeight: 300, marginTop: "0.5rem", fontSize: "clamp(1.25rem,3vw,1.875rem)", lineHeight: 1.1, letterSpacing: "0.02em", textTransform: "uppercase" }}>{trendReport.title}</h3>
                    {trendReport.summary && (
                      <p style={{ marginTop: "0.75rem", maxWidth: "36rem", fontSize: "0.9rem", lineHeight: 1.75, color: "var(--fg-80)" }}>{trendReport.summary}</p>
                    )}
                  </div>
                  <div style={{ aspectRatio: "4/5", background: "color-mix(in oklab, var(--bg) 92%, white)", border: "1px solid var(--fg-10)", display: "grid", placeItems: "center" }}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.25 }} aria-hidden="true">
                      <path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3z" />
                    </svg>
                  </div>
                </div>
              </div>
            ) : (
              <p className="mn-state-note">Your personalised trend edit will appear here once published.</p>
            )}
          </div>
        </section>

        {/* Recent Buy or Skip */}
        <section className="mn-section">
          <div className="mn-section-head">
            <div className="mn-eyebrow">Recent Buy Or Skip</div>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: "0.5rem 1.25rem" }}>
              <Link to="/my-naia/buy-or-skip" className="mn-see-link">Start A New Decision</Link>
            </div>
          </div>
          <div className="mn-section-body">
            {buyOrSkipHistory.length > 0 ? (
              <ul style={{ listStyle: "none", padding: 0, margin: 0, borderTop: "1px solid var(--fg-12)" }}>
                {buyOrSkipHistory.map((d) => (
                  <li key={d.id} style={{ display: "grid", gap: "0.5rem", padding: "1.25rem 0", borderBottom: "1px solid var(--fg-12)" }}>
                    <style>{`@media(min-width:640px){.mn-decision-row-inner{grid-template-columns:1.4fr 1fr!important;alignItems:baseline!important;gap:1.5rem!important}}`}</style>
                    <div className="mn-decision-row-inner" style={{ display: "grid" }}>
                      <div>
                        <div style={{ fontSize: "0.62rem", textTransform: "uppercase", letterSpacing: "0.28em", color: "var(--fg-55)" }}>{fmtDate(d.createdAt)}</div>
                        <div style={{ marginTop: "0.25rem", fontSize: "0.95rem", lineHeight: 1.625, color: "var(--fg-90, var(--fg))" }}>{d.productName ?? "Unnamed item"}</div>
                      </div>
                      <div style={{ fontSize: "0.72rem", textTransform: "uppercase", letterSpacing: "0.28em", color: "var(--lipstick)" }}>
                        {VERDICT_LABELS[d.verdict] ?? d.verdict}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mn-state-note">
                No decisions yet.{" "}
                <Link to="/my-naia/buy-or-skip" style={{ color: "var(--lipstick)", textDecoration: "underline", textUnderlineOffset: "4px" }}>Start your first</Link>
              </p>
            )}
          </div>
        </section>

        {/* Latest Order */}
        <section className="mn-section">
          <div className="mn-section-head">
            <div className="mn-eyebrow">Latest Order</div>
            <Link to="/my-naia/orders" className="mn-see-link">View All Orders</Link>
          </div>
          <div className="mn-section-body">
            <dl style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(7rem, 1fr))", gap: "1.5rem 2rem" }}>
              {[
                { label: "Order", value: "NAD-XXXXXX" },
                { label: "Date", value: "—" },
                { label: "Status", value: "—" },
                { label: "Total", value: "AED —" },
              ].map((c) => (
                <div key={c.label}>
                  <dt style={{ fontSize: "0.62rem", textTransform: "uppercase", letterSpacing: "0.3em", color: "var(--fg-55)" }}>{c.label}</dt>
                  <dd style={{ marginTop: "0.375rem", fontSize: "0.92rem", color: "var(--fg-85)" }}>{c.value}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        {/* Plan & Usage */}
        <section className="mn-section">
          <div className="mn-section-head">
            <div className="mn-eyebrow">Plan &amp; Usage</div>
            <Link to="/my-naia/plan-usage" className="mn-see-link">Manage Plan</Link>
          </div>
          <div className="mn-section-body">
            <div style={{ display: "grid", gap: "1.5rem", gridTemplateColumns: "repeat(auto-fill, minmax(10rem, 1fr))" }}>
              {[
                { label: "Current Plan", value: "The Atelier Plan" },
                { label: "StyleMe", value: "5 sessions remaining" },
                { label: "Buy or Skip", value: "3 checks remaining" },
                { label: "Virtual Try-On", value: "3 try-ons remaining" },
                { label: "My Closet", value: "45 of 100 spaces used" },
                { label: "Personalised Trend Edit", value: "Available this month" },
              ].map((c) => (
                <div key={c.label}>
                  <div style={{ fontSize: "0.62rem", textTransform: "uppercase", letterSpacing: "0.3em", color: "var(--fg-55)" }}>{c.label}</div>
                  <div style={{ marginTop: "0.5rem", fontFamily: "var(--ff-display)", fontWeight: 300, fontSize: "1.5rem", letterSpacing: "0.02em", textTransform: "uppercase", color: "var(--fg)" }}>{c.value}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

      </div>
    </MyNaiaLayout>
  );
}
