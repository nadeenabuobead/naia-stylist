// app/routes/closet.intelligence.tsx
//
// WARDROBE INTELLIGENCE — the customer-facing interpretation layer for the Closet.
//
// My Closet stays the place where pieces are browsed and managed. This route is
// where nAia reads the wardrobe as a whole. It renders only what the engine
// marks "available"; every "learning" block states plainly what nAia still needs.
//
// It does not generate outfits (StyleMe) and does not restate the Style Passport.

import { useState } from "react";
import { Link, useLoaderData } from "react-router";
import { data, redirect, type LoaderFunctionArgs, type LinksFunction } from "react-router";
import prisma from "../db.server";
import { requireCurrentNaiaCustomer } from "~/lib/naia-session.server";
import MyNaiaLayout from "~/components/my-naia/MyNaiaLayout";
import naiaStyles from "~/styles/naia-design-system.css?url";
import { getCloudinaryConfig, buildPrivateDownloadUrl } from "~/lib/cloudinary-admin.server";
import { loadWardrobeIntelligence } from "~/lib/ai/wardrobe-intelligence.server";

export const links: LinksFunction = () => [{ rel: "stylesheet", href: naiaStyles }];

export function meta() {
  return [{ title: "Wardrobe Intelligence | nAia" }];
}

export async function loader({ request }: LoaderFunctionArgs) {
  const naiaCustomer = await requireCurrentNaiaCustomer(request);
  const customer = await prisma.customer.findUnique({
    where: { id: naiaCustomer.id },
    include: {
      closetItems: { orderBy: { createdAt: "desc" } },
      onboardingProfile: true,
    },
  });
  if (!customer) return redirect("/auth/shopify/login");

  // Signed display URLs — identical resolution to /closet.
  const cfg = getCloudinaryConfig();

  const imageUrlById = new Map<string, string | null>();
  for (const item of customer.closetItems) {
    if (item.imagePublicId && item.imageFormat && cfg) {
      imageUrlById.set(item.id, buildPrivateDownloadUrl(cfg, item.imagePublicId, item.imageFormat, "private"));
    } else {
      imageUrlById.set(item.id, item.imageUrl ?? null);
    }
  }

  const profile = customer.onboardingProfile;

  // Phase 3C V2 DERIVED intention potential is shadow/validation output. It stays
  // off unless this flag is explicitly set, and nothing on this page depends on it
  // while it is off. Curated and admin-corrected intentions are unaffected.
  const flags = {
    derivedIntentionIntelligence: process.env.WARDROBE_V2_INTENTIONS === "true",
  };

  const { intelligence, garments } = await loadWardrobeIntelligence(customer.id, {
    imageUrlById,
    flags,
    passport: profile
      ? {
          lifestyle: profile.lifestyle,
          favoriteColors: profile.favoriteColors,
          avoidColors: profile.avoidColors,
          stylePersonalities: profile.stylePersonalities,
          silhouette: profile.silhouette,
          structure: profile.structure ?? null,
          fitPreferences: profile.fitPreferences,
          styleStruggles: profile.styleStruggles,
          styleSupport: profile.styleSupport,
          becoming: profile.becoming,
        }
      : null,
  });

  // Only the fields the view needs — keeps the loader payload small.
  const garmentCards = garments.map((g) => ({
    id: g.id,
    name: g.name,
    category: g.category,
    subcategory: g.subcategory,
    primaryColor: g.primaryColor,
    imageUrl: g.imageUrl,
  }));

  return data({ intelligence, garmentCards });
}

type GarmentCard = {
  id: string;
  name: string | null;
  category: string;
  subcategory: string | null;
  primaryColor: string | null;
  imageUrl: string | null;
};

// Swatch hexes for colours that actually appear in Closet vocabulary.
// Unknown colours render as an outlined ring rather than a guessed fill.
const SWATCH: Readonly<Record<string, string>> = {
  black: "#1A1512", white: "#FBF9F6", cream: "#EFE6D8", ivory: "#F2EAD9",
  beige: "#DCCCB6", "off-white": "#F4EFE7", nude: "#E3C9B4", tan: "#C79E74",
  camel: "#B68B5B", taupe: "#B3A294", stone: "#CFC5B8", brown: "#6B4A32",
  "dark brown": "#4A3123", chocolate: "#4A3123", grey: "#9A948D", gray: "#9A948D",
  "light grey": "#C6C1BA", "dark grey": "#55514C", charcoal: "#3B3835",
  silver: "#C3C3C3", navy: "#22304A", blue: "#3C5A8A", "light blue": "#A8C0DA",
  denim: "#4A6685", teal: "#2F6E6B", green: "#3F6140", olive: "#6B6A3C",
  sage: "#A3AE96", red: "#8E2B27", burgundy: "#5C1E27", wine: "#5C1E27",
  maroon: "#5C1E27", pink: "#D9A2AA", blush: "#E6C4C0", purple: "#5C4370",
  lilac: "#B9A7C8", lavender: "#C5B7D4", yellow: "#D9B44A", mustard: "#B98F2E",
  gold: "#B99348", orange: "#C1703C", rust: "#9C5432", terracotta: "#B0664A",
  multicolor: "#B3A294",
};

function swatchStyle(colour: string): React.CSSProperties {
  const hex = SWATCH[colour.toLowerCase()];
  return hex
    ? { background: hex, borderColor: "rgba(40,21,12,0.18)" }
    : { background: "transparent", borderColor: "rgba(40,21,12,0.35)" };
}

function cardLabel(card: GarmentCard): string {
  if (card.name && card.name.trim() !== "") return card.name.trim();
  const parts = [card.primaryColor, card.subcategory ?? card.category.toLowerCase()].filter(Boolean);
  return parts.join(" ");
}

/** Never render a wall of thumbnails; the point is a glance, not an inventory. */
const MAX_STRIP = 8;

function Thumb({ card, size = 72 }: { card: GarmentCard | undefined; size?: number }) {
  if (!card) return null;
  return (
    <figure className="wi-thumb" style={{ width: size, height: size }}>
      {card.imageUrl ? (
        <img src={card.imageUrl} alt={cardLabel(card)} loading="lazy" />
      ) : (
        <span className="wi-thumb-fallback">{card.category.slice(0, 2)}</span>
      )}
    </figure>
  );
}

function LearningNote({ children }: { children: React.ReactNode }) {
  return <p className="wi-learning">{children}</p>;
}

export default function WardrobeIntelligencePage() {
  const { intelligence, garmentCards } = useLoaderData<typeof loader>();
  const byId = new Map<string, GarmentCard>(garmentCards.map((c: GarmentCard) => [c.id, c]));
  const [openObservation, setOpenObservation] = useState<string | null>(null);
  const [openRediscover, setOpenRediscover] = useState<string | null>(null);

  const { dna, heroes, pairings, observations, opportunities, passportView, wear } = intelligence;

  return (
    <MyNaiaLayout compact>
      <style>{css}</style>

      <div className="mn-page-sections">
        <Link to="/my-naia" className="mn-back-link">
          <span aria-hidden="true">←</span> Back to Overview
        </Link>

        <nav className="wi-switch" aria-label="Closet views">
          <Link to="/closet" className="wi-switch-item">My Closet</Link>
          <span className="wi-switch-item is-on" aria-current="page">Wardrobe Intelligence</span>
        </nav>

        {/* ── Masthead ───────────────────────────────────────────────────── */}
        <header className="wi-masthead">
          <p className="wi-eyebrow">Wardrobe Intelligence</p>
          <h1 className="wi-title">Your wardrobe, <span className="sp-shell-accent">understood.</span></h1>
          <p className="wi-sub">Patterns, possibilities and insights based on what you own.</p>
        </header>

        {!intelligence.ready && (
          <section className="wi-notready">
            <p className="wi-notready-text">{intelligence.readyNote}</p>
            <Link to="/closet" className="wi-cta">Add pieces to your Closet</Link>
          </section>
        )}

        {/* ── Opening: what nAia understands, then a little support ────────
            Deliberately not a metrics grid. The reading is the headline; the
            facts sit under it on one line and wrap naturally on mobile. */}
        <section className="wi-opening" aria-label="Wardrobe snapshot">
          {intelligence.snapshotReading && (
            <p className="wi-opening-reading">{intelligence.snapshotReading}</p>
          )}
          <p className="wi-opening-facts">
            {intelligence.snapshot.map((metric, index) => (
              <span key={metric.id} className="wi-fact">
                {index > 0 && <span className="wi-fact-sep" aria-hidden="true">·</span>}
                <span className="wi-fact-value">{metric.value}</span> {metric.label}
              </span>
            ))}
          </p>
        </section>

        {intelligence.ready && (
          <>
            {/* ── Wardrobe DNA ──────────────────────────────────────────── */}
            <section className="wi-section wi-dna" aria-labelledby="wi-dna-h">
              <h2 id="wi-dna-h" className="wi-section-title">Your wardrobe DNA</h2>

              {dna.state === "learning" && <LearningNote>{dna.learningNote}</LearningNote>}

              {dna.palette.length > 0 && (
                <div className="wi-dna-block">
                  <div className="wi-palette">
                    {dna.palette.map((colour) => (
                      <div key={colour.colour} className="wi-palette-row">
                        <span className="wi-swatch" style={swatchStyle(colour.colour)} aria-hidden="true" />
                        <span className="wi-palette-name">{colour.colour}</span>
                        <span className="wi-palette-count">{colour.count}</span>
                      </div>
                    ))}
                  </div>
                  {dna.paletteReading && <p className="wi-reading">{dna.paletteReading}</p>}
                </div>
              )}

              {/* Shapes as words, not a tally. The counts stay in the data as
                  evidence; a customer wants the shape, not the arithmetic. */}
              {dna.shapes.length > 0 && (
                <div className="wi-dna-block">
                  <p className="wi-microhead">Shapes you come back to</p>
                  <p className="wi-shapes-line">
                    {dna.shapes.map((shape, index) => (
                      <span key={shape.label}>
                        {index > 0 && <span className="wi-shapes-sep" aria-hidden="true">·</span>}
                        {shape.label}
                      </span>
                    ))}
                  </p>
                  {dna.shapesReading && <p className="wi-reading wi-reading--sm">{dna.shapesReading}</p>}
                </div>
              )}

              {dna.traits.length > 0 && (
                <div className="wi-dna-block">
                  <p className="wi-microhead">Character</p>
                  <div className="wi-traits">
                    {dna.traits.map((trait) => (
                      <div key={trait.id} className="wi-trait">
                        <span className="wi-trait-label">{trait.label}</span>
                        <span className="wi-trait-evidence">{trait.evidence}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </section>

            {/* ── Heroes ────────────────────────────────────────────────── */}
            <section className="wi-section" aria-labelledby="wi-heroes-h">
              <h2 id="wi-heroes-h" className="wi-section-title">Wardrobe heroes</h2>
              <p className="wi-section-sub">The pieces doing the most work in your Closet.</p>

              {/* One featured hero carries the section; the rest support it.
                  Four identical cards in a three-column grid left an orphan and
                  made every hero feel the same. */}
              {heroes.state === "learning" ? (
                <LearningNote>{heroes.learningNote}</LearningNote>
              ) : (
                <>
                  {heroes.heroes.slice(0, 1).map((hero) => {
                    const card = byId.get(hero.garmentId);
                    return (
                      <article key={hero.garmentId} className="wi-hero-featured">
                        <div className="wi-hero-featured-img">
                          {card?.imageUrl ? (
                            <img src={card.imageUrl} alt={hero.name} loading="lazy" />
                          ) : (
                            <span className="wi-thumb-fallback">{hero.category}</span>
                          )}
                        </div>
                        <div className="wi-hero-featured-text">
                          <p className="wi-hero-label">{hero.labelText}</p>
                          <h3 className="wi-hero-featured-name">{hero.name}</h3>
                          <p className="wi-hero-featured-headline">{hero.headline}</p>
                          {hero.reasons[0] && <p className="wi-hero-featured-reason">{hero.reasons[0]}</p>}
                        </div>
                      </article>
                    );
                  })}

                  {heroes.heroes.length > 1 && (
                    <div className="wi-heroes">
                      {heroes.heroes.slice(1).map((hero) => {
                        const card = byId.get(hero.garmentId);
                        return (
                          <article key={hero.garmentId} className="wi-hero">
                            <div className="wi-hero-img">
                              {card?.imageUrl ? (
                                <img src={card.imageUrl} alt={hero.name} loading="lazy" />
                              ) : (
                                <span className="wi-thumb-fallback">{hero.category}</span>
                              )}
                            </div>
                            <p className="wi-hero-label">{hero.labelText}</p>
                            <h3 className="wi-hero-name">{hero.name}</h3>
                            {hero.reasons[0] && <p className="wi-hero-reason">{hero.reasons[0]}</p>}
                          </article>
                        );
                      })}
                    </div>
                  )}
                </>
              )}
            </section>

            {/* ── What works well together ──────────────────────────────── */}
            <section className="wi-section" aria-labelledby="wi-pairs-h">
              <h2 id="wi-pairs-h" className="wi-section-title">What works well together</h2>
              <p className="wi-section-sub">
                Relationships nAia can already see between your pieces. For a full outfit for a
                specific moment, StyleMe is still the place to go.
              </p>

              {/* A badge on every row says nothing. When every displayed
                  relationship is novel, the state is stated once, quietly. */}
              {pairings.untriedPresentation === "section" && pairings.untriedNote && (
                <p className="wi-pairs-note">{pairings.untriedNote}</p>
              )}

              {pairings.state === "learning" ? (
                <LearningNote>{pairings.learningNote}</LearningNote>
              ) : (
                <ul className="wi-pairs">
                  {pairings.pairings.map((pair) => (
                    <li key={pair.id} className="wi-pair">
                      <div className="wi-pair-pieces">
                        {pair.garmentIds.map((id, index) => (
                          <span key={id} className="wi-pair-piece">
                            {index > 0 && <span className="wi-plus" aria-hidden="true">+</span>}
                            <Thumb card={byId.get(id)} size={84} />
                          </span>
                        ))}
                      </div>
                      <div className="wi-pair-text">
                        <p className="wi-pair-reason">{pair.reason}</p>
                        {pair.untried && pairings.untriedPresentation === "per-item" && (
                          <p className="wi-pair-tag">Worth trying</p>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* ── What nAia is noticing ─────────────────────────────────── */}
            {observations.length > 0 && (
              <section className="wi-section" aria-labelledby="wi-notice-h">
                <h2 id="wi-notice-h" className="wi-section-title">What nAia is noticing</h2>

                <ol className="wi-notes">
                  {observations.map((obs, index) => {
                    // A discovery gets the weight of a discovery. Descriptive
                    // patterns stay quieter so the difference is legible.
                    const isDiscovery = obs.tier === "discovery";
                    // Small evidence sets are shown outright — making someone
                    // click to find a single garment is a bad trade.
                    const inlinePieces = obs.garmentIds.length > 0 && obs.garmentIds.length <= 3;
                    const expanded = openObservation === obs.id;
                    const shown = inlinePieces
                      ? obs.garmentIds
                      : expanded
                        ? obs.garmentIds.slice(0, MAX_STRIP)
                        : [];
                    const overflow = expanded ? Math.max(0, obs.garmentIds.length - MAX_STRIP) : 0;

                    return (
                      <li key={obs.id} className={`wi-note wi-note--${obs.tier}`}>
                        <span className="wi-note-num" aria-hidden="true">
                          {String(index + 1).padStart(2, "0")}
                        </span>
                        <div className="wi-note-body">
                          <p className="wi-note-head">{obs.headline}</p>
                          <p className="wi-note-claim">{obs.observation}</p>
                          {obs.explanation && <p className="wi-note-why">{obs.explanation}</p>}

                          {!inlinePieces && obs.action && obs.garmentIds.length > 0 && (
                            <button
                              type="button"
                              className="wi-note-action"
                              aria-expanded={expanded}
                              onClick={() => setOpenObservation(expanded ? null : obs.id)}
                            >
                              {expanded ? "Hide pieces" : obs.action.label}
                            </button>
                          )}

                          {shown.length > 0 && (
                            <div className="wi-strip">
                              {shown.map((id) => (
                                <Thumb key={id} card={byId.get(id)} size={isDiscovery ? 78 : 64} />
                              ))}
                              {overflow > 0 && <span className="wi-strip-more">+{overflow} more</span>}
                            </div>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ol>
              </section>
            )}

            {/* ── Opportunities ─────────────────────────────────────────── */}
            <section className="wi-section" aria-labelledby="wi-opp-h">
              <h2 id="wi-opp-h" className="wi-section-title">Wardrobe opportunities</h2>

              {opportunities.state === "learning" ? (
                <LearningNote>{opportunities.learningNote}</LearningNote>
              ) : (
                <div className="wi-opps">
                  {opportunities.rediscover.length > 0 && (
                    <div className="wi-opp">
                      <p className="wi-opp-tier">Rediscover</p>
                      <p className="wi-opp-lead">Pieces worth another look.</p>
                      {opportunities.rediscover.map((piece) => (
                        <article key={piece.garmentId} className="wi-rediscover">
                          <div className="wi-rediscover-img">
                            {piece.imageUrl ? (
                              <img src={piece.imageUrl} alt={piece.name} loading="lazy" />
                            ) : (
                              <span className="wi-thumb-fallback">piece</span>
                            )}
                          </div>
                          <div className="wi-rediscover-text">
                            <h3 className="wi-rediscover-name">{piece.name}</h3>
                            <p className="wi-opp-body">{piece.body}</p>
                            {piece.worksWithIds.length > 0 && (
                              <>
                                <button
                                  type="button"
                                  className="wi-note-action"
                                  aria-expanded={openRediscover === piece.garmentId}
                                  onClick={() =>
                                    setOpenRediscover(openRediscover === piece.garmentId ? null : piece.garmentId)
                                  }
                                >
                                  {openRediscover === piece.garmentId ? "Hide possibilities" : "See possibilities"}
                                </button>
                                {openRediscover === piece.garmentId && (
                                  <div className="wi-strip">
                                    {piece.worksWithIds.map((id) => (
                                      <Thumb key={id} card={byId.get(id)} size={64} />
                                    ))}
                                  </div>
                                )}
                              </>
                            )}
                          </div>
                        </article>
                      ))}
                    </div>
                  )}

                  {/* Worth considering. When nAia found no evidenced gap that
                      is a conclusion, not an empty state — so it reads as one. */}
                  {opportunities.worthConsidering.length > 0 ? (
                    <div className="wi-opp wi-opp--quiet">
                      <p className="wi-opp-tier">Worth considering</p>
                      {opportunities.worthConsidering.map((gap) => (
                        <div key={gap.id}>
                          <h3 className="wi-opp-title">{gap.title}</h3>
                          <p className="wi-opp-body">{gap.body}</p>
                          {gap.garmentIds.length > 0 && (
                            <div className="wi-strip">
                              {gap.garmentIds.slice(0, MAX_STRIP).map((id) => (
                                <Thumb key={id} card={byId.get(id)} size={56} />
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                      <p className="wi-opp-foot">
                        nAia only raises this where the same need keeps coming up and nothing you
                        own solves it well.
                      </p>
                    </div>
                  ) : (
                    opportunities.noGapNote && (
                      <div className="wi-opp wi-nogap">
                        <p className="wi-opp-tier">Worth considering</p>
                        <p className="wi-nogap-line">{opportunities.noGapNote}</p>
                      </div>
                    )
                  )}
                </div>
              )}
            </section>

            {/* ── Passport vs Closet ────────────────────────────────────── */}
            <section className="wi-section" aria-labelledby="wi-pass-h">
              <h2 id="wi-pass-h" className="wi-section-title">Your Passport and your Closet</h2>
              <p className="wi-section-sub">
                Your Style Passport is what you told nAia. Your Closet is what you own. This is
                simply the two side by side.
              </p>

              {passportView.state === "learning" ? (
                <LearningNote>{passportView.learningNote}</LearningNote>
              ) : (
                <dl className="wi-compare">
                  {passportView.comparisons.map((c) => (
                    <div key={c.id} className="wi-compare-row">
                      <div className="wi-compare-col">
                        <dt className="wi-microhead">You said</dt>
                        <dd className="wi-compare-text">{c.stated}</dd>
                      </div>
                      <div className="wi-compare-col">
                        <dt className="wi-microhead">Your Closet shows</dt>
                        <dd className="wi-compare-text">{c.observed}</dd>
                      </div>
                      <p className="wi-compare-reading">{c.reading}</p>
                    </div>
                  ))}
                </dl>
              )}
            </section>
          </>
        )}

        {/* ── What nAia knows so far ────────────────────────────────────
            Transparency, not a provenance panel. All five signal types are kept
            in the payload for QA and future tooling; the customer gets two lines
            and a sentence. It should reassure, not compete. */}
        <section className="wi-section wi-knows-section" aria-labelledby="wi-wear-h">
          <h2 id="wi-wear-h" className="wi-knows-title">What nAia knows so far</h2>

          <dl className="wi-knows">
            <div className="wi-knows-row">
              <dt className="wi-knows-key">Reading</dt>
              <dd className="wi-knows-val">
                {intelligence.signalAvailability
                  .filter((signal) => signal.state !== "unavailable")
                  .map((signal) => signal.title)
                  .join(" · ") || "Your Closet"}
              </dd>
            </div>
            <div className="wi-knows-row">
              <dt className="wi-knows-key">Still learning</dt>
              <dd className="wi-knows-val wi-knows-val--muted">
                {intelligence.signalAvailability
                  .filter((signal) => signal.state === "unavailable")
                  .map((signal) => signal.title)
                  .join(" · ")}
              </dd>
            </div>
          </dl>

          <p className="wi-knows-note">{wear.learningNote}</p>
        </section>

        <div className="wi-foot">
          <Link to="/closet" className="wi-cta">Back to My Closet</Link>
        </div>
      </div>
    </MyNaiaLayout>
  );
}

// ── wi-* design system ────────────────────────────────────────────────────────
// Editorial, not dashboard: hairlines instead of boxes, garment imagery instead
// of charts, and a different structure per section so the page reads as a piece
// of writing rather than a grid of identical cards.
// Tokens come from naia-design-system.css — no new design system is introduced.

const css = `
  .mn-page-sections{gap:0}
  .mn-page-sections>.mn-back-link{display:block;margin-bottom:1.5rem}

  /* ── Closet / Intelligence switch ─────────────────────────────────────── */
  .wi-switch{display:flex;gap:28px;border-bottom:1px solid var(--naia-border);padding-bottom:10px;margin-bottom:40px}
  .wi-switch-item{font-family:var(--naia-ff-ui);font-size:10px;letter-spacing:2.5px;text-transform:uppercase;color:rgba(40,21,12,0.45);text-decoration:none;padding-bottom:10px;margin-bottom:-11px;border-bottom:1px solid transparent}
  a.wi-switch-item:hover{color:var(--naia-ink)}
  .wi-switch-item.is-on{color:var(--naia-ink);border-bottom-color:var(--naia-accent)}

  /* ── Masthead ─────────────────────────────────────────────────────────── */
  .wi-masthead{margin-bottom:52px}
  .wi-eyebrow{font-family:var(--naia-ff-ui);font-size:9px;letter-spacing:3px;text-transform:uppercase;color:rgba(40,21,12,0.5);margin:0 0 18px}
  .wi-title{font-family:var(--naia-ff-display);font-size:2rem;font-weight:200;line-height:0.94;letter-spacing:0.02em;text-transform:uppercase;color:var(--naia-ink);margin:0 0 20px}
  @media(min-width:640px){.wi-title{font-size:3rem}}
  @media(min-width:1024px){.wi-title{font-size:4.25rem}}
  .wi-sub{font-family:var(--naia-ff-body);font-style:italic;font-size:1.05rem;line-height:1.7;color:rgba(40,21,12,0.65);margin:0;max-width:34em}

  /* ── Not-ready state ──────────────────────────────────────────────────── */
  .wi-notready{border-top:1px solid var(--naia-border);padding-top:28px;margin-bottom:44px}
  .wi-notready-text{font-family:var(--naia-ff-body);font-size:1.15rem;font-style:italic;line-height:1.7;color:var(--naia-ink);margin:0 0 20px;max-width:32em}

  /* ── Opening: a reading, then a little support ────────────────────────── */
  .wi-opening{border-top:1px solid var(--naia-ink);padding-top:26px;margin-bottom:64px;max-width:34em}
  .wi-opening-reading{font-family:var(--naia-ff-body);font-size:1.6rem;font-style:italic;line-height:1.45;color:var(--naia-ink);margin:0 0 18px}
  @media(min-width:768px){.wi-opening-reading{font-size:1.9rem}}
  .wi-opening-facts{display:flex;flex-wrap:wrap;gap:6px 0;margin:0;font-family:var(--naia-ff-ui);font-size:11px;letter-spacing:1.6px;text-transform:uppercase;color:rgba(40,21,12,0.55)}
  .wi-fact{display:inline-flex;align-items:baseline}
  .wi-fact-sep{padding:0 12px;color:rgba(40,21,12,0.3)}
  .wi-fact-value{font-family:var(--naia-ff-display);font-size:18px;font-weight:300;letter-spacing:0;color:var(--naia-ink);margin-right:7px}

  /* ── Sections ─────────────────────────────────────────────────────────── */
  .wi-section{margin-bottom:72px}
  .wi-section-title{font-family:var(--naia-ff-display);font-size:1.5rem;font-weight:200;letter-spacing:0.04em;text-transform:uppercase;color:var(--naia-ink);margin:0 0 12px;line-height:1.05}
  @media(min-width:768px){.wi-section-title{font-size:1.9rem}}
  .wi-section-sub{font-family:var(--naia-ff-body);font-size:15px;font-style:italic;line-height:1.7;color:rgba(40,21,12,0.6);margin:0 0 32px;max-width:36em}
  .wi-microhead{font-family:var(--naia-ff-ui);font-size:8px;letter-spacing:2.5px;text-transform:uppercase;color:rgba(40,21,12,0.5);margin:0 0 14px}
  .wi-learning{font-family:var(--naia-ff-body);font-size:15px;font-style:italic;line-height:1.75;color:rgba(40,21,12,0.6);margin:0;padding-left:16px;border-left:1px solid var(--naia-border);max-width:34em}

  /* ── Wardrobe DNA ─────────────────────────────────────────────────────── */
  .wi-dna-block{padding:28px 0;border-top:1px solid var(--naia-border)}
  .wi-dna-block:first-of-type{border-top-color:var(--naia-ink)}
  .wi-palette{display:flex;flex-direction:column}
  .wi-palette-row{display:flex;align-items:center;gap:16px;padding:9px 0;border-bottom:1px solid rgba(206,193,184,0.5)}
  .wi-palette-row:last-child{border-bottom:none}
  .wi-swatch{width:30px;height:30px;border-radius:50%;border:1px solid;flex-shrink:0}
  .wi-palette-name{font-family:var(--naia-ff-display);font-size:17px;font-weight:300;letter-spacing:0.08em;text-transform:uppercase;color:var(--naia-ink);flex:1}
  .wi-palette-count{font-family:var(--naia-ff-ui);font-size:10px;letter-spacing:1.5px;color:rgba(40,21,12,0.45)}
  .wi-reading{font-family:var(--naia-ff-body);font-size:1.25rem;font-style:italic;line-height:1.65;color:var(--naia-ink);margin:24px 0 0;max-width:30em}
  .wi-reading--sm{font-size:1.05rem;color:rgba(40,21,12,0.7)}
  /* flex-wrap, or the shape words push the page sideways on a narrow screen. */
  .wi-shapes-line{display:flex;flex-wrap:wrap;align-items:baseline;font-family:var(--naia-ff-display);font-size:19px;font-weight:300;letter-spacing:0.07em;text-transform:uppercase;color:var(--naia-ink);margin:0;line-height:1.7}
  .wi-shapes-sep{padding:0 10px;color:rgba(40,21,12,0.3)}
  .wi-traits{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:24px 36px}
  .wi-trait{display:flex;flex-direction:column;gap:7px}
  .wi-trait-label{font-family:var(--naia-ff-display);font-size:20px;font-weight:300;letter-spacing:0.03em;text-transform:uppercase;color:var(--naia-ink);line-height:1.1}
  .wi-trait-evidence{font-family:var(--naia-ff-body);font-size:13.5px;font-style:italic;line-height:1.55;color:rgba(40,21,12,0.6)}

  /* ── Heroes: one featured piece, then a supporting row ────────────────── */
  .wi-hero-featured{display:grid;grid-template-columns:minmax(0,300px) 1fr;gap:40px;align-items:center;padding:8px 0 36px;margin-bottom:36px;border-bottom:1px solid var(--naia-border)}
  .wi-hero-featured-img{aspect-ratio:3/4;background:var(--naia-muted-bg);display:flex;align-items:center;justify-content:center;overflow:hidden}
  .wi-hero-featured-img img{width:100%;height:100%;object-fit:contain}
  .wi-hero-featured-text{min-width:0}
  .wi-hero-featured-name{font-family:var(--naia-ff-display);font-size:1.7rem;font-weight:200;letter-spacing:0.04em;text-transform:uppercase;color:var(--naia-ink);margin:0 0 14px;line-height:1.1}
  .wi-hero-featured-headline{font-family:var(--naia-ff-body);font-size:1.4rem;font-style:italic;line-height:1.5;color:var(--naia-ink);margin:0 0 14px;max-width:22em}
  .wi-hero-featured-reason{font-family:var(--naia-ff-ui);font-size:12.5px;line-height:1.7;color:rgba(40,21,12,0.6);margin:0;max-width:34em}
  .wi-heroes{display:grid;grid-template-columns:repeat(3,1fr);gap:28px}
  .wi-hero-img{aspect-ratio:3/4;background:var(--naia-muted-bg);display:flex;align-items:center;justify-content:center;overflow:hidden;margin-bottom:14px}
  .wi-hero-img img{width:100%;height:100%;object-fit:contain}
  .wi-hero-name{font-family:var(--naia-ff-display);font-size:14px;font-weight:300;letter-spacing:0.08em;text-transform:uppercase;color:var(--naia-ink);margin:0 0 8px;line-height:1.25}
  .wi-hero-reason{font-family:var(--naia-ff-ui);font-size:11.5px;line-height:1.65;color:rgba(40,21,12,0.6);margin:0}

  /* ── Pairings ─────────────────────────────────────────────────────────── */
  .wi-pairs-note{font-family:var(--naia-ff-body);font-size:15px;font-style:italic;line-height:1.7;color:rgba(40,21,12,0.6);margin:-14px 0 26px;max-width:36em}
  .wi-pairs{list-style:none;margin:0;padding:0}
  .wi-pair{display:flex;align-items:center;gap:32px;padding:24px 0;border-top:1px solid var(--naia-border)}
  .wi-pair:first-child{border-top-color:var(--naia-ink)}
  .wi-pair-pieces{display:flex;align-items:center;flex-shrink:0}
  .wi-pair-piece{display:flex;align-items:center}
  .wi-plus{font-family:var(--naia-ff-body);font-size:18px;color:rgba(40,21,12,0.35);padding:0 12px}
  .wi-thumb{margin:0;background:var(--naia-muted-bg);display:flex;align-items:center;justify-content:center;overflow:hidden;flex-shrink:0}
  .wi-thumb img{width:100%;height:100%;object-fit:contain}
  .wi-thumb-fallback{font-family:var(--naia-ff-ui);font-size:9px;letter-spacing:1.5px;text-transform:uppercase;color:rgba(40,21,12,0.4)}
  .wi-pair-text{flex:1;min-width:0}
  .wi-pair-reason{font-family:var(--naia-ff-body);font-size:1.05rem;font-style:italic;line-height:1.6;color:var(--naia-ink);margin:0}
  .wi-pair-tag{display:inline-block;font-family:var(--naia-ff-ui);font-size:8px;letter-spacing:2.2px;text-transform:uppercase;color:var(--naia-accent);margin:10px 0 0;padding:4px 9px;border:1px solid var(--naia-tint-mid)}

  /* ── What nAia is noticing ────────────────────────────────────────────── */
  .wi-notes{list-style:none;margin:0;padding:0;counter-reset:wi}
  .wi-note{display:flex;gap:24px;padding:26px 0;border-top:1px solid var(--naia-border)}
  .wi-note:first-child{border-top-color:var(--naia-ink)}
  .wi-note-num{font-family:var(--naia-ff-display);font-size:13px;font-weight:300;letter-spacing:1px;color:rgba(40,21,12,0.32);padding-top:4px;flex-shrink:0}
  .wi-note-body{flex:1;min-width:0}
  .wi-note-head{font-family:var(--naia-ff-ui);font-size:8.5px;letter-spacing:2.5px;text-transform:uppercase;color:var(--naia-accent);margin:0 0 10px}
  .wi-note-claim{font-family:var(--naia-ff-body);font-size:1.2rem;font-style:italic;line-height:1.6;color:var(--naia-ink);margin:0;max-width:32em}
  .wi-note-why{font-family:var(--naia-ff-ui);font-size:12.5px;line-height:1.7;color:rgba(40,21,12,0.6);margin:12px 0 0;max-width:38em}
  .wi-note-action{background:none;border:none;padding:0;margin-top:14px;cursor:pointer;font-family:var(--naia-ff-ui);font-size:9px;letter-spacing:2.5px;text-transform:uppercase;color:var(--naia-ink);text-decoration:underline;text-underline-offset:4px}
  .wi-note-action:hover{color:var(--naia-accent)}
  .wi-strip{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-top:16px}
  .wi-strip-more{font-family:var(--naia-ff-ui);font-size:9px;letter-spacing:1.6px;text-transform:uppercase;color:rgba(40,21,12,0.5)}
  /* A discovery is something the customer could not see for herself. It gets the
     weight of one; a descriptive pattern stays quiet underneath. */
  .wi-note--discovery{padding:34px 0 30px}
  .wi-note--discovery .wi-note-num{color:var(--naia-accent)}
  .wi-note--discovery .wi-note-head{font-size:9px;letter-spacing:2.8px}
  .wi-note--discovery .wi-note-claim{font-size:1.5rem;line-height:1.5;max-width:26em}
  .wi-note--discovery .wi-note-body{border-left:1px solid var(--naia-accent);padding-left:22px;margin-left:-1px}
  .wi-note--pattern .wi-note-claim{font-size:1.08rem;color:rgba(40,21,12,0.82)}
  .wi-note--pattern .wi-note-head{color:rgba(40,21,12,0.45)}
  @media(min-width:768px){.wi-note--discovery .wi-note-claim{font-size:1.75rem}}

  /* ── Opportunities — three distinct treatments ────────────────────────── */
  .wi-opps{display:flex;flex-direction:column;gap:48px}
  .wi-opp-tier{font-family:var(--naia-ff-ui);font-size:9px;letter-spacing:3px;text-transform:uppercase;color:var(--naia-ink);margin:0 0 16px;padding-bottom:10px;border-bottom:1px solid var(--naia-ink)}
  .wi-opp-title{font-family:var(--naia-ff-body);font-size:1.3rem;font-style:italic;font-weight:400;line-height:1.5;color:var(--naia-ink);margin:0 0 10px;max-width:30em}
  .wi-opp-body{font-family:var(--naia-ff-ui);font-size:13px;line-height:1.75;color:rgba(40,21,12,0.65);margin:0;max-width:38em}
  .wi-opp-lead{font-family:var(--naia-ff-body);font-size:1.05rem;font-style:italic;line-height:1.6;color:var(--naia-ink);margin:0 0 20px}
  .wi-opp--quiet{background:rgba(227,212,201,0.32);padding:28px;margin:0 -28px}
  .wi-opp--quiet .wi-opp-tier{border-bottom-color:rgba(40,21,12,0.25)}
  .wi-nogap{border-top:1px solid var(--naia-ink);padding-top:16px}
  .wi-nogap-line{font-family:var(--naia-ff-body);font-size:1.3rem;font-style:italic;line-height:1.6;color:var(--naia-ink);margin:0;max-width:30em}
  .wi-opp-foot{font-family:var(--naia-ff-body);font-size:13px;font-style:italic;line-height:1.6;color:rgba(40,21,12,0.55);margin:20px 0 0;max-width:34em}

  /* ── Passport vs Closet ───────────────────────────────────────────────── */
  .wi-compare{margin:0;padding:0}
  .wi-compare-row{display:grid;grid-template-columns:1fr 1fr;gap:28px;padding:24px 0;border-top:1px solid var(--naia-border)}
  .wi-compare-row:first-child{border-top-color:var(--naia-ink)}
  .wi-compare-col dt{margin-bottom:10px}
  .wi-compare-text{font-family:var(--naia-ff-body);font-size:1.02rem;font-style:italic;line-height:1.6;color:var(--naia-ink);margin:0}
  .wi-compare-reading{grid-column:1/-1;font-family:var(--naia-ff-ui);font-size:12.5px;line-height:1.7;color:rgba(40,21,12,0.6);margin:6px 0 0}

  /* ── Wear intelligence — quiet, honest ────────────────────────────────── */

  /* ── Hero label chip ──────────────────────────────────────────────────── */
  .wi-hero-label{font-family:var(--naia-ff-ui);font-size:8px;letter-spacing:2.5px;text-transform:uppercase;color:var(--naia-accent);margin:0 0 8px}

  /* ── Rediscover — image-led, one piece at a time ──────────────────────── */
  .wi-rediscover{display:flex;gap:22px;align-items:flex-start;padding:20px 0;border-bottom:1px solid rgba(206,193,184,0.5)}
  .wi-rediscover:last-child{border-bottom:none}
  .wi-rediscover-img{flex:0 0 120px;aspect-ratio:3/4;background:var(--naia-muted-bg);display:flex;align-items:center;justify-content:center;overflow:hidden}
  .wi-rediscover-img img{width:100%;height:100%;object-fit:contain}
  .wi-rediscover-text{flex:1;min-width:0}
  .wi-rediscover-name{font-family:var(--naia-ff-display);font-size:15px;font-weight:300;letter-spacing:0.08em;text-transform:uppercase;color:var(--naia-ink);margin:0 0 10px;line-height:1.2}
  .wi-opp-title--calm{font-style:italic;color:rgba(40,21,12,0.75);margin:0}

  /* ── What nAia knows so far: reassurance, not a provenance panel ──────── */
  .wi-knows-section{border-top:1px solid var(--naia-border);padding-top:28px;margin-bottom:40px}
  .wi-knows-title{font-family:var(--naia-ff-ui);font-size:9px;letter-spacing:3px;text-transform:uppercase;color:rgba(40,21,12,0.5);margin:0 0 18px;font-weight:400}
  .wi-knows{margin:0 0 16px;padding:0}
  .wi-knows-row{display:flex;flex-wrap:wrap;gap:4px 16px;align-items:baseline;padding:7px 0}
  .wi-knows-key{font-family:var(--naia-ff-ui);font-size:8px;letter-spacing:2px;text-transform:uppercase;color:rgba(40,21,12,0.45);flex:0 0 96px}
  .wi-knows-val{font-family:var(--naia-ff-display);font-size:13px;font-weight:300;letter-spacing:0.08em;text-transform:uppercase;color:var(--naia-ink);margin:0}
  .wi-knows-val--muted{color:rgba(40,21,12,0.45)}
  .wi-knows-note{font-family:var(--naia-ff-body);font-size:14px;font-style:italic;line-height:1.65;color:rgba(40,21,12,0.55);margin:0;max-width:40em}

  /* ── Footer CTA ───────────────────────────────────────────────────────── */
  .wi-foot{margin:8px 0 24px}
  .wi-cta{display:inline-flex;align-items:center;padding:12px 28px;background:var(--naia-ink);color:var(--naia-bg);text-decoration:none;font-family:var(--naia-ff-ui);font-size:10px;letter-spacing:2.5px;text-transform:uppercase;border-radius:9999px;transition:opacity .13s}
  .wi-cta:hover{opacity:.8}
  .wi-cta:focus-visible{outline:2px solid var(--naia-ink);outline-offset:2px}

  /* ── Mobile: rework, don't just stack ─────────────────────────────────── */
  @media(max-width:860px){
    .wi-hero-featured{grid-template-columns:1fr;gap:20px}
    .wi-hero-featured-img{max-height:380px}
    .wi-heroes{display:flex;gap:14px;overflow-x:auto;scroll-snap-type:x mandatory;margin:0 -20px;padding:0 20px 8px;-webkit-overflow-scrolling:touch}
    .wi-hero{flex:0 0 46%;scroll-snap-align:start}
    .wi-compare-row{grid-template-columns:1fr;gap:18px}
  }
  @media(max-width:640px){
    .wi-switch{gap:20px}
    .wi-switch-item{font-size:9px;letter-spacing:1.6px}
    .wi-opening-reading{font-size:1.35rem}
    .wi-opening-facts{flex-direction:column;gap:8px}
    .wi-fact-sep{display:none}
    .wi-section{margin-bottom:56px}
    /* Supporting hero cards stay small: image, label, name, one reason. */
    .wi-hero{flex:0 0 58%}
    .wi-hero-featured-headline{font-size:1.2rem}
    .wi-hero-featured-name{font-size:1.35rem}
    /* Pairings go vertical: imagery on top, reading underneath. */
    .wi-pair{flex-direction:column;align-items:flex-start;gap:14px}
    .wi-opp--quiet{margin:0 -20px;padding:24px 20px}
    .wi-note{gap:14px}
    .wi-note--discovery .wi-note-claim{font-size:1.22rem}
    .wi-note--discovery .wi-note-body{padding-left:16px}
    .wi-note--pattern .wi-note-claim{font-size:1.02rem}
    .wi-reading{font-size:1.1rem}
    .wi-rediscover{gap:14px}
    .wi-rediscover-img{flex-basis:88px}
    .wi-knows-key{flex-basis:100%}
  }
`;
