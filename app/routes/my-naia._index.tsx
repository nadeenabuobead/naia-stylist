import { useLoaderData, Link } from "react-router";
import type { LinksFunction, LoaderFunctionArgs } from "react-router";
import { requireCurrentNaiaCustomer } from "~/lib/naia-session.server";
import prisma from "~/db.server";
import { getPublishedEditorialReports } from "~/lib/editorial-reports.server";
import MyNaiaLayout from "~/components/my-naia/MyNaiaLayout";
import naiaStyles from "~/styles/naia-design-system.css?url";

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: naiaStyles },
];

export function meta() {
  return [{ title: "My nAia | Your style space" }];
}

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
  const dayMs = 1000 * 60 * 60 * 24;
  const startDay = Math.floor(Date.UTC(2026, 0, 1) / dayMs);
  const todayDay = Math.floor(Date.now() / dayMs);
  return QUOTES[Math.abs(todayDay - startDay) % QUOTES.length];
}

function fmtDate(d: string | Date): string {
  const date = new Date(d);
  const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

const VERDICT_LABELS: Record<string, string> = {
  BUY: "BUY",
  SKIP: "SKIP",
  MAYBE: "MAYBE",
};

const STYLE_PERSONALITY_LABELS: Record<string, string> = {
  "classic-polished":    "Classic & Polished",
  "feminine-romantic":   "Feminine & Romantic",
  "minimal-relaxed":     "Minimal & Relaxed",
  "bold-edgy":           "Bold & Edgy",
  "creative-expressive": "Creative & Expressive",
};

const CURRENT_GOAL_LABELS: Record<string, string> = {
  "understand-my-style":       "Understand my personal style",
  "feel-more-like-myself":     "Feel more like myself in what I wear",
  "use-what-i-own":            "Get more from what I already own",
  "easier-getting-dressed":    "Make getting dressed easier",
  "stop-regret-purchases":     "Stop buying things I never wear",
  "more-cohesive-wardrobe":    "Build a more cohesive wardrobe",
  "dress-for-my-life":         "Dress better for my actual life",
  "refresh-my-style":          "Refresh my style",
  "specific-event-trip-change":"Dress for a specific event or change",
};

const SILHOUETTE_LABELS: Record<string, string> = {
  "fitted":               "Fitted",
  "waist-defined":        "Waist-defined",
  "straight-simple":      "Straight-cut",
  "relaxed":              "Relaxed",
  "oversized":            "Oversized",
  "boxy":                 "Boxy",
  "tapered":              "Tapered",
  "loose-flowing":        "Loose / Wide",
  "structured-tailored":  "Structured / Tailored",
};

const OUTFIT_GIVES_LABELS: Record<string, string> = {
  "feel-like-myself":    "I feel completely like myself",
  "confidence":          "Confidence",
  "feel-put-together":   "I feel put-together",
  "comfort-ease":        "Comfort and ease",
  "sense-of-expression": "Creative expression",
  "feel-attractive":     "I feel attractive",
  "sense-of-power":      "A sense of power",
  "effortlessness":      "Effortlessness",
};

const LIFESTYLE_LABELS: Record<string, string> = {
  "work-office":               "Work / Office",
  "everyday-casual":           "Everyday Casual",
  "dinners-going-out":         "Dinners & Going Out",
  "events-special-occasions":  "Events & Special Occasions",
  "family-parenting":          "Family & Parenting",
  "travel":                    "Travel",
  "active-busy-days":          "Active & Busy Days",
};

function humanizeId(id: string): string {
  return id.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

function labelFrom(map: Record<string, string>, id: string): string {
  return map[id] ?? humanizeId(id);
}

function PassportSnapshot({ profile }: { profile: Record<string, unknown> }) {
  const signals: Array<{ label: string; value: string }> = [];

  const personalities = (profile.stylePersonalities as string[] | undefined) ?? [];
  const validPersonalities = personalities.filter(p => p !== "not-sure");
  if (validPersonalities.length > 0) {
    signals.push({ label: "Style direction", value: validPersonalities.map(p => labelFrom(STYLE_PERSONALITY_LABELS, p)).join(" · ") });
  }

  const goals = (profile.currentGoal as string[] | undefined) ?? [];
  const validGoals = goals.filter(g => g !== "not-sure-yet");
  if (validGoals.length > 0) {
    const first = validGoals[0];
    const label = CURRENT_GOAL_LABELS[first] ?? humanizeId(first);
    signals.push({ label: "Right now", value: label.charAt(0).toLowerCase() + label.slice(1) });
  }

  const gives = (profile.successfulOutfitGives as string[] | undefined) ?? [];
  const validGives = gives.filter(g => g !== "not-sure").slice(0, 2);
  if (validGives.length > 0) {
    signals.push({ label: "Great outfit gives", value: validGives.map(g => labelFrom(OUTFIT_GIVES_LABELS, g)).join(" · ") });
  }

  const colours = (profile.favoriteColors as string[] | undefined) ?? [];
  if (colours.length > 0) {
    signals.push({ label: "Favourite colours", value: colours.slice(0, 4).join(", ") });
  }

  const silhouettes = (profile.silhouette as string[] | undefined) ?? [];
  const validSilhouettes = silhouettes.filter(s => s !== "not-sure");
  if (validSilhouettes.length > 0) {
    signals.push({ label: "Fit direction", value: validSilhouettes.slice(0, 2).map(s => labelFrom(SILHOUETTE_LABELS, s)).join(" · ") });
  }

  const lifestyle = (profile.lifestyle as string[] | undefined) ?? [];
  if (lifestyle.length > 0 && signals.length < 5) {
    signals.push({ label: "Dresses for", value: lifestyle.slice(0, 3).map(l => labelFrom(LIFESTYLE_LABELS, l)).join(", ") });
  }

  if (signals.length === 0) return null;

  return (
    <ul style={{ listStyle: "none", padding: 0, margin: "0 0 1.25rem", borderTop: "1px solid var(--fg-12)" }}>
      {signals.slice(0, 5).map(s => (
        <li key={s.label} style={{ display: "flex", gap: "1rem", padding: "0.875rem 0", borderBottom: "1px solid var(--fg-12)" }}>
          <div style={{ fontSize: "0.62rem", textTransform: "uppercase", letterSpacing: "0.3em", color: "var(--fg-55)", width: "8rem", flexShrink: 0, paddingTop: "0.125rem" }}>
            {s.label}
          </div>
          <div style={{ fontSize: "0.9rem", lineHeight: 1.625, color: "var(--fg-85)" }}>
            {s.value}
          </div>
        </li>
      ))}
    </ul>
  );
}

export async function loader({ request }: LoaderFunctionArgs) {
  const customer = await requireCurrentNaiaCustomer(request);
  const customerId = customer.id;

  const [sessions, editorialReports, buyOrSkipHistory, reviewCount, closetCount] =
    await Promise.all([
      prisma.stylingSession.findMany({
        where: { customerId },
        take: 3,
        orderBy: { createdAt: "desc" },
        select: {
          id: true, createdAt: true, currentMood: true, desiredFeeling: true, occasion: true, styleFrom: true,
          suggestions: {
            take: 1, select: { id: true, heroImageUrl: true, outfitName: true, savedAsLook: true,
              items: { take: 1, select: { closetItemId: true, productTitle: true, productImageUrl: true, closetItem: { select: { name: true, imageUrl: true } } } } }
          },
          review: { select: { id: true } },
        },
      }),
      getPublishedEditorialReports(),
      prisma.buyOrSkipAnalysis.findMany({
        where: { customerId },
        take: 3,
        orderBy: { createdAt: "desc" },
        select: { id: true, productName: true, verdict: true, createdAt: true, imageUrl: true, category: true },
      }),
      prisma.postOutfitReview.count({ where: { customerId } }),
      prisma.closetItem.count({ where: { customerId } }),
    ]);

  const latestEditorial = editorialReports[0] ?? null;
  const trendReport = latestEditorial
    ? { slug: latestEditorial.slug, title: latestEditorial.title, season: latestEditorial.season, summary: latestEditorial.summary }
    : null;

  const p = customer.onboardingProfile;
  // VIEW only when profileVersion=6 (atomically set on Rev 6 onboarding/refresh completion).
  // Legacy customers (completed=true, profileVersion=null) → CONTINUE (need refresh).
  const passportState: "start" | "continue" | "view" =
    !p ? "start"
    : (p as any).profileVersion === 6 ? "view"
    : "continue";

  return {
    firstName: customer.firstName ?? null,
    profile: p,
    sessions, trendReport, buyOrSkipHistory, reviewCount, closetCount,
    passportState,
  };
}

export default function MyNaiaOverview() {
  const { firstName, profile, sessions, trendReport, buyOrSkipHistory, reviewCount, closetCount, passportState } =
    useLoaderData<typeof loader>();

  const quote = getDailyQuote();

  const attentionItems: Array<{ title: string; note: string; cta: string; to: string }> = [];
  if (!profile) {
    attentionItems.push({ title: "Your Style Passport is incomplete", note: "A few details are still missing to refine your styling direction.", cta: "Continue", to: "/passport" });
  } else if (!(profile as any).completed) {
    attentionItems.push({ title: "Your Style Passport is incomplete", note: "A few more answers help nAia refine its recommendations.", cta: "Continue", to: "/passport" });
  }
  if (closetCount === 0) {
    attentionItems.push({ title: "Your closet is empty", note: "Upload pieces so nAia can style you from your own wardrobe.", cta: "Add a Piece", to: "/closet" });
  }

  return (
    <MyNaiaLayout>
      <div className="mn-page-sections">

        {/* Welcome */}
        <section>
          <div className="mn-eyebrow">Welcome back</div>
          <h2 style={{ fontFamily: "var(--ff-display)", fontWeight: 200, marginTop: "0.75rem", fontSize: "clamp(2.25rem,6vw,3.75rem)", lineHeight: 0.95, letterSpacing: "0.02em", textTransform: "uppercase" }}>
            <span style={{ fontFamily: "var(--ff-editorial)", fontStyle: "italic", color: "var(--lipstick)", textTransform: "none", fontWeight: 400 }}>
              {firstName ? `Welcome, ${firstName}.` : "Welcome."}
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
              <Link to="/style-me" className="mn-styleme-btn">
                Start StyleMe
              </Link>
              <Link to="/style-me" className="mn-styleme-link">
                How StyleMe Works
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M7 17 17 7M17 7H7M17 7v10" />
                </svg>
              </Link>
            </div>
          </div>
        </section>

        {/* Style Passport CTA — three states */}
        <section className="mn-section">
          <div className="mn-section-head">
            <div className="mn-eyebrow">Your Style Passport</div>
          </div>
          <div className="mn-section-body">
            {passportState === "start" && (
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap" }}>
                <div>
                  <div style={{ fontSize: "0.95rem", lineHeight: 1.625, color: "var(--fg-90, var(--fg))", marginBottom: "0.375rem" }}>
                    nAia builds every recommendation from your Style Passport.
                  </div>
                  <p style={{ fontSize: "0.82rem", color: "var(--fg-55)", lineHeight: 1.625 }}>
                    Answer a few questions so nAia knows your style, your life, and what great dressing means to you.
                  </p>
                </div>
                <Link to="/passport" className="mn-see-link" style={{ flexShrink: 0 }}>
                  START YOUR STYLE PASSPORT
                </Link>
              </div>
            )}
            {passportState === "continue" && (
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap" }}>
                <div>
                  <div style={{ fontSize: "0.95rem", lineHeight: 1.625, color: "var(--fg-90, var(--fg))", marginBottom: "0.375rem" }}>
                    Your Style Passport is in progress.
                  </div>
                  <p style={{ fontSize: "0.82rem", color: "var(--fg-55)", lineHeight: 1.625 }}>
                    A few more answers and nAia will have everything it needs to personalise your experience.
                  </p>
                </div>
                <Link to="/passport" className="mn-see-link" style={{ flexShrink: 0 }}>
                  CONTINUE YOUR STYLE PASSPORT
                </Link>
              </div>
            )}
            {passportState === "view" && (
              <div>
                {profile && <PassportSnapshot profile={profile as Record<string, unknown>} />}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap" }}>
                  <p style={{ fontSize: "0.82rem", color: "var(--fg-55)", lineHeight: 1.625, margin: 0 }}>
                    Update your answers any time as your style evolves.
                  </p>
                  <Link to="/passport" className="mn-see-link" style={{ flexShrink: 0 }}>
                    VIEW STYLE PASSPORT
                  </Link>
                </div>
              </div>
            )}
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
                    <div style={{ minWidth: 0 }}>
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
          <div className="mn-section-body">
            <style>{`@media (min-width:640px){.mn-quick-grid{grid-template-columns:repeat(3,1fr)!important}}`}</style>
            <div className="mn-quick-grid" style={{ display: "grid", gap: "0.75rem" }}>
              <Link to="/style-me" className="mn-quick-tool">
                <div className="mn-quick-tool-title">Start StyleMe</div>
                <p className="mn-quick-tool-note">A look for your mood and your plans.</p>
                <div className="mn-quick-tool-cta">Open <span aria-hidden>↗</span></div>
              </Link>
              <Link to="/closet" className="mn-quick-tool">
                <div className="mn-quick-tool-title">Open My Closet</div>
                <p className="mn-quick-tool-note">Your saved wardrobe, ready to style.</p>
                <div className="mn-quick-tool-cta">Open <span aria-hidden>↗</span></div>
              </Link>
              <Link to="/buyskip" className="mn-quick-tool">
                <div className="mn-quick-tool-title">Buy or Skip</div>
                <p className="mn-quick-tool-note">Can&#8217;t decide whether to buy it? nAia will help you choose.</p>
                <div className="mn-quick-tool-cta">Get My Recommendation <span aria-hidden>↗</span></div>
              </Link>
            </div>
          </div>
        </section>

        {/* Latest StyleMe */}
        <section className="mn-section">
          <div className="mn-section-head">
            <div className="mn-eyebrow">Latest StyleMe</div>
            <Link to="/my-naia/saved" className="mn-see-link">View All Looks</Link>
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
                          to={`/style-me/result?sessionId=${session.id}`}
                          style={{
                            display: "grid", placeItems: "center", aspectRatio: "4/5",
                            border: "1px solid var(--fg-10)",
                            background: "color-mix(in oklab, var(--bg) 92%, white)",
                            position: "relative", overflow: "hidden", textDecoration: "none",
                          }}
                          aria-label={`View look — ${suggestion?.outfitName ?? "nAia Look"}`}
                        >
                          {(() => {
                            const thumb = suggestion?.heroImageUrl
                              ?? suggestion?.items?.[0]?.productImageUrl
                              ?? suggestion?.items?.[0]?.closetItem?.imageUrl
                              ?? null;
                            return thumb ? (
                              <img src={thumb} alt={suggestion?.outfitName ?? ""} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                            ) : (
                              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.25, color: "var(--fg)" }} aria-hidden="true">
                                <path d="M12 3 4.5 7.5v9L12 21l7.5-4.5v-9L12 3z" /><path d="m4.5 7.5 7.5 4.5 7.5-4.5M12 12v9" />
                              </svg>
                            );
                          })()}
                          {suggestion?.savedAsLook && (
                            <span style={{ position: "absolute", left: "0.75rem", top: "0.75rem", fontSize: "0.55rem", textTransform: "uppercase", letterSpacing: "0.3em", background: "var(--bg)", padding: "0.25rem 0.5rem", color: "var(--fg-80)" }}>Saved</span>
                          )}
                        </Link>
                        <div className="mn-look-date" style={{ marginTop: "0.75rem" }}>
                          {fmtDate(session.createdAt)}{session.occasion ? ` · ${session.occasion}` : ""}
                        </div>
                        <Link to={`/style-me/result?sessionId=${session.id}`} className="mn-look-title" style={{ marginTop: "0.375rem" }}>
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
                          <Link to={`/style-me/result?sessionId=${session.id}`} className="mn-look-action-link">View Look</Link>
                          <span className="mn-look-dot" aria-hidden="true">·</span>
                          <Link to={`/style-me?refine=${session.id}`} className="mn-look-action-link">Refine</Link>
                          {!session.review && (
                            <>
                              <span className="mn-look-dot" aria-hidden="true">·</span>
                              <Link to={`/post-wear-review?sessionId=${session.id}`} className="mn-look-action-link">Give Feedback</Link>
                            </>
                          )}
                          {session.review && (
                            <>
                              <span className="mn-look-dot" aria-hidden="true">·</span>
                              <Link to={`/post-wear-review?sessionId=${session.id}`} className="mn-look-action-link">View Feedback</Link>
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
            {trendReport && <Link to={`/trends/my-edits/${trendReport.slug}`} className="mn-see-link">Open My Trend Edit</Link>}
          </div>
          <div className="mn-section-body">
            {trendReport ? (
              <div style={{ display: "grid", gap: "1.5rem" }}>
                <style>{`@media(min-width:1024px){.mn-trend-grid{grid-template-columns:1.3fr 1fr!important;gap:2.5rem!important}}`}</style>
                <div className="mn-trend-grid" style={{ display: "grid" }}>
                  <div>
                    <div style={{ fontSize: "0.62rem", textTransform: "uppercase", letterSpacing: "0.3em", color: "var(--fg-55)" }}>
                      {trendReport.season ? `${trendReport.season} · ` : ""}Latest Personalised Edit
                    </div>
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
            <Link to="/buyskip" className="mn-see-link">Start A New Decision</Link>
          </div>
          <div className="mn-section-body">
            {buyOrSkipHistory.length > 0 ? (
              <ul style={{ listStyle: "none", padding: 0, margin: 0, borderTop: "1px solid var(--fg-12)" }}>
                {buyOrSkipHistory.map((d) => (
                  <li key={d.id} style={{ display: "flex", gap: "1rem", padding: "1.25rem 0", borderBottom: "1px solid var(--fg-12)", alignItems: "center" }}>
                    {d.imageUrl ? (
                      <img
                        src={d.imageUrl}
                        alt={d.productName ?? d.category ?? "Item"}
                        style={{ width: "56px", height: "56px", objectFit: "cover", flexShrink: 0, border: "1px solid var(--fg-10)" }}
                      />
                    ) : (
                      <div style={{ width: "56px", height: "56px", flexShrink: 0, background: "color-mix(in oklab, var(--bg) 88%, black)", border: "1px solid var(--fg-10)", display: "grid", placeItems: "center" }}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.3 }} aria-hidden="true">
                          <rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M9 21V9" />
                        </svg>
                      </div>
                    )}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: "0.95rem", lineHeight: 1.4, color: "var(--fg-90, var(--fg))", fontWeight: 400 }}>
                        {d.productName ?? (d.category ? d.category : "Item")}
                      </div>
                      <div style={{ marginTop: "0.25rem", fontSize: "0.62rem", textTransform: "uppercase", letterSpacing: "0.28em", color: "var(--fg-55)" }}>{fmtDate(d.createdAt)}</div>
                    </div>
                    <div style={{
                      fontSize: "0.62rem", textTransform: "uppercase", letterSpacing: "0.28em", flexShrink: 0,
                      color: d.verdict === "BUY" ? "var(--lipstick)" : d.verdict === "SKIP" ? "var(--fg-55)" : "var(--fg-70)",
                      fontWeight: 600,
                    }}>
                      {VERDICT_LABELS[d.verdict] ?? d.verdict}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mn-state-note">
                No decisions yet.{" "}
                <Link to="/buyskip" style={{ color: "var(--lipstick)", textDecoration: "underline", textUnderlineOffset: "4px" }}>Start your first</Link>
              </p>
            )}
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
                { label: "My Closet", value: `${closetCount} of 100 spaces used` },
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
