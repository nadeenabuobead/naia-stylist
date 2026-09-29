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
import { Link, useLoaderData, Form, useNavigation } from "react-router";
import { data, redirect, type LoaderFunctionArgs, type ActionFunctionArgs, type LinksFunction } from "react-router";
import prisma from "../db.server";
import { requireCurrentNaiaCustomer } from "~/lib/naia-session.server";
import MyNaiaLayout from "~/components/my-naia/MyNaiaLayout";
import naiaStyles from "~/styles/naia-design-system.css?url";
import { getCloudinaryConfig, buildPrivateDownloadUrl } from "~/lib/cloudinary-admin.server";
import { loadWardrobeIntelligence } from "~/lib/ai/wardrobe-intelligence.server";
import { readAndRecordChange } from "~/lib/ai/wardrobe-snapshot.server";
import { readClosetConfidence, recordClosetConfidence } from "~/lib/ai/wardrobe-confidence.server";
import {
  buildWardrobePage,
  type WardrobePage,
  type PageBlock,
  type PageEntry,
  type ClosetConfidence,
} from "~/lib/ai/wardrobe-page";

/**
 * Exactly the Passport fields the intelligence reads. Listed rather than
 * selected wholesale so a schema change cannot silently break this route.
 */
const PASSPORT_SELECT = {
  lifestyle: true, favoriteColors: true, avoidColors: true, stylePersonalities: true,
  silhouette: true, structure: true, fitPreferences: true, styleStruggles: true,
  styleSupport: true, becoming: true, styleExpression: true, styleDirections: true,
  explorationLevel: true, dressingHabits: true, dressingPreferences: true,
  coveragePreferences: true, preferredCoverage: true, dressingRequirementsNote: true,
  fitConcerns: true, dressesFor: true, neutralVsColour: true, colourIntensity: true,
  printAppetite: true,
} as const;

export const links: LinksFunction = () => [{ rel: "stylesheet", href: naiaStyles }];

export function meta() {
  return [{ title: "Wardrobe Intelligence | nAia" }];
}

/**
 * The one thing nAia cannot work out for itself: whether the Closet is most of
 * what she actually wears. Everything the page says about buying depends on it,
 * so it is asked plainly and stored with the time it was answered.
 */
export async function action({ request }: ActionFunctionArgs) {
  const naiaCustomer = await requireCurrentNaiaCustomer(request);
  const form = await request.formData();
  const saved = await recordClosetConfidence({
    customerId: naiaCustomer.id,
    answer: form.get("closetCompleteness"),
  });
  if (!saved) return data({ ok: false, error: "Pick one of the two answers." }, { status: 400 });
  return data({ ok: true });
}

export async function loader({ request }: LoaderFunctionArgs) {
  const naiaCustomer = await requireCurrentNaiaCustomer(request);
  const customer = await prisma.customer.findUnique({
    where: { id: naiaCustomer.id },
    select: {
      id: true,
      closetItems: { orderBy: { createdAt: "desc" } },
      // An explicit select, not `true`. A default select asks for every column,
      // including ones added by a migration that may not have run yet, and the
      // page would 500 for everyone in the window between deploy and migrate.
      // Naming the fields means this code runs correctly on either schema.
      onboardingProfile: { select: PASSPORT_SELECT },
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

  const { intelligence, needs, recommendations, garments } = await loadWardrobeIntelligence(customer.id, {
    imageUrlById,
    flags,
    passport: profile
      ? {
          lifestyle: profile.lifestyle,
          favoriteColors: profile.favoriteColors,
          avoidColors: profile.avoidColors,
          // Retired at Rev 7. Passed through because the existing comparison
          // view still reads it, and because a customer who has not answered the
          // Rev 7 question has nothing else. The needs layer never treats it as
          // current truth on its own — see currentStyleDirection().
          stylePersonalities: profile.stylePersonalities,
          silhouette: profile.silhouette,
          structure: profile.structure ?? null,
          fitPreferences: profile.fitPreferences,
          styleStruggles: profile.styleStruggles,
          styleSupport: profile.styleSupport,
          becoming: profile.becoming,

          // Rev 7 — the fields that actually describe the life being dressed for.
          styleExpression: profile.styleExpression,
          styleDirections: profile.styleDirections,
          explorationLevel: profile.explorationLevel ?? null,
          dressingHabits: profile.dressingHabits,
          dressingPreferences: profile.dressingPreferences,
          coveragePreferences: profile.coveragePreferences,
          preferredCoverage: profile.preferredCoverage ?? null,
          dressingRequirementsNote: profile.dressingRequirementsNote ?? null,
          fitConcerns: profile.fitConcerns,
          dressesFor: profile.dressesFor,
          neutralVsColour: profile.neutralVsColour ?? null,
          colourIntensity: profile.colourIntensity ?? null,
          printAppetite: profile.printAppetite ?? null,
        }
      : null,
  });

  // What moved since the last reading, recorded as we go so the analysis keeps
  // up with the Closet rather than starting fresh each visit.
  const change = await readAndRecordChange({
    customerId: customer.id,
    needs,
    recommendations,
    garments,
    closetCount: customer.closetItems.length,
    createdAtById: new Map(customer.closetItems.map((i: { id: string; createdAt: Date }) => [i.id, i.createdAt])),
  });

  // The page model decides where every conclusion lives. Built here so the
  // rendered page and the audited model can never drift apart.
  const page = buildWardrobePage({
    intelligence,
    needs,
    recommendations,
    closetCount: customer.closetItems.length,
    confidence: await readClosetConfidence(customer.id),
    garmentName: (id) => garments.find((g) => g.id === id)?.name ?? null,
    change,
    lifestyle: profile?.lifestyle ?? [],
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

  return data({
    page,
    garmentCards,
    footer: {
      signalAvailability: intelligence.signalAvailability,
      wearNote: intelligence.wear.learningNote,
    },
  });
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

// ── Stylist marks ───────────────────────────────────────────────────────────
//
// One small, reusable set — arrow, curve, underline, circle, bracket — reused
// everywhere an annotation is needed, never a bespoke scribble per section.
// Restrained hand-drawn quality comes from a slight, deliberate wobble in the
// path, not from randomness (a straight arrow read as a diagram; a fully
// random one read as messy). Colour is always currentColor, so a mark takes
// on `--lipstick` from its `.wi-annot` wrapper.

type MarkKind = "arrow" | "curve" | "underline" | "circle" | "bracket";

function Mark({ kind, className }: { kind: MarkKind; className?: string }) {
  const common = { fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  switch (kind) {
    case "arrow":
      return (
        <svg className={className} viewBox="0 0 64 40" aria-hidden="true" focusable="false">
          <path {...common} d="M4 8 C 24 6, 40 20, 54 28" />
          <path {...common} d="M44 24 L55 29 L50 17" />
        </svg>
      );
    case "curve":
      return (
        <svg className={className} viewBox="0 0 64 56" aria-hidden="true" focusable="false">
          <path {...common} d="M6 6 C 4 30, 20 46, 50 40" />
          <path {...common} d="M40 32 L51 41 L38 45" />
        </svg>
      );
    case "underline":
      return (
        <svg className={className} viewBox="0 0 120 12" aria-hidden="true" focusable="false" preserveAspectRatio="none">
          <path {...common} d="M2 6 C 30 10, 60 2, 90 7 S 115 5, 118 6" />
        </svg>
      );
    case "circle":
      return (
        <svg className={className} viewBox="0 0 80 44" aria-hidden="true" focusable="false" preserveAspectRatio="none">
          <path {...common} d="M40 3 C 62 2, 77 12, 76 22 C 75 34, 55 42, 38 41 C 18 40, 3 32, 4 20 C 5 9, 20 3, 40 4" />
        </svg>
      );
    case "bracket":
      return (
        <svg className={className} viewBox="0 0 200 26" aria-hidden="true" focusable="false" preserveAspectRatio="none">
          <path {...common} d="M2 4 C 2 18, 6 22, 16 22 L 92 22 C 98 22, 98 24, 100 25 C 102 24, 102 22, 108 22 L 184 22 C 194 22, 198 18, 198 4" />
        </svg>
      );
  }
}

/**
 * A stylist note: `.sp-shell-accent`'s exact italic serif in `--lipstick`,
 * scaled down and set looser than the hero's own use of it, paired with one
 * mark. Never a new typeface — the hand-drawn feeling comes entirely from
 * the mark plus this existing accent treatment, per the approved direction.
 */
function Annotation({
  text, mark, className,
}: { text: string; mark?: MarkKind; className?: string }) {
  return (
    <span className={`wi-annot${className ? ` ${className}` : ""}`}>
      {mark && <Mark kind={mark} className={`wi-annot-mark wi-annot-mark--${mark}`} />}
      <em className="wi-annot-text sp-shell-accent">{text}</em>
    </span>
  );
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

function Strip({
  ids, byId, size = 56, showAll = false,
}: { ids: string[]; byId: Map<string, GarmentCard>; size?: number; showAll?: boolean }) {
  if (ids.length === 0) return null;
  const shown = showAll ? ids : ids.slice(0, MAX_STRIP);
  const overflow = ids.length - shown.length;
  return (
    <div className="wi-strip">
      {shown.map((id) => <Thumb key={id} card={byId.get(id)} size={size} />)}
      {overflow > 0 && <span className="wi-strip-more">+{overflow} more</span>}
    </div>
  );
}

/**
 * The one action a garment entry can carry. `reveal` shows pieces already in
 * the payload; `link` goes somewhere that keeps this piece selected. Anything
 * that would drop the garment is not offered at all, so there is no case here
 * for a button that leads nowhere useful.
 */
function EntryAction({
  entry, byId, open, onToggle,
}: {
  entry: PageEntry;
  byId: Map<string, GarmentCard>;
  open: boolean;
  onToggle: () => void;
}) {
  const action = entry.action;
  if (!action) return null;
  if (action.kind === "link") {
    return <Link to={action.to} className="wi-note-action">{action.label}</Link>;
  }
  // Moves to evidence already on this page. It cannot lose the garment context
  // because it never leaves the page.
  if (action.kind === "jump") {
    return <a href={action.to} className="wi-note-action">{action.label}</a>;
  }
  return (
    <>
      <button type="button" className="wi-note-action" aria-expanded={open} onClick={onToggle}>
        {open ? action.hideLabel : action.label}
      </button>
      {/* Every piece, not a sample — the button names the count. */}
      {open && <Strip ids={action.garmentIds} byId={byId} size={64} showAll />}
    </>
  );
}

/**
 * Wraps background/provenance content behind a single toggle, keyed on the
 * block's own id in the SAME shared openId state entry-level reveals use — at
 * most one thing open anywhere on the page at a time, by the same rule.
 * Renders children directly when the block carries no disclosure at all.
 */
function Disclosure({
  block, openId, setOpenId, children,
}: {
  block: PageBlock;
  openId: string | null;
  setOpenId: (id: string | null) => void;
  children: React.ReactNode;
}) {
  if (!block.disclosure) return <>{children}</>;
  const isOpen = openId === block.id;
  return (
    <>
      <button
        type="button"
        className="wi-note-action"
        aria-expanded={isOpen}
        onClick={() => setOpenId(isOpen ? null : block.id)}
      >
        {isOpen ? block.disclosure.hideLabel : block.disclosure.label}
      </button>
      {isOpen && children}
    </>
  );
}

function Block({
  block, byId, openId, setOpenId,
}: {
  block: PageBlock;
  byId: Map<string, GarmentCard>;
  openId: string | null;
  setOpenId: (id: string | null) => void;
}) {
  const label = block.label ? <p className="wi-sublabel">{block.label}</p> : null;

  switch (block.kind) {
    // ── One entry per garment, carrying everything the page knows about it.
    // ── Piece worth rediscovering (dynamic — whichever entry ranks first)
    //    is the major visual "aha" moment; any grouped entry (identical
    //    partner sets, e.g. two blazers) stays secondary and smaller.
    case "garments": {
      const [primary, ...secondary] = block.entries;
      return (
        <div className="wi-block">
          {label}
          <div className="wi-pieces">
            {primary && (() => {
              const meta = (primary.meta ?? {}) as Record<string, unknown>;
              const members = meta.members as Array<{ garmentId: string; title: string }> | undefined;
              const isOpen = openId === primary.id;
              const revealIds = primary.action?.kind === "reveal" ? primary.action.garmentIds : [];
              // "Try this with denim" only when a genuine denim/jeans match
              // exists among the real, already-resolved partners — never
              // invented for a customer whose matches don't include one.
              const denimId = revealIds.find((id) => {
                const c = byId.get(id);
                return c && /denim|jean/i.test(`${c.name ?? ""} ${c.subcategory ?? ""}`);
              });
              const card = members ? undefined : byId.get(String(meta.garmentId));
              return (
                <article className="wi-piece wi-piece--rediscover">
                  <div className="wi-rediscover-source">
                    {card ? <Thumb card={card} size={220} /> : <Strip ids={members?.map((m) => m.garmentId) ?? []} byId={byId} size={148} showAll />}
                    {!members && card && <p className="wi-wear-name">{cardLabel(card)}</p>}
                  </div>
                  <div className="wi-piece-text">
                    {typeof meta.label === "string" && <p className="wi-hero-label">{meta.label}</p>}
                    <h3 className="wi-piece-name">{primary.title}</h3>
                    {primary.body && <p className="wi-piece-headline">{primary.body}</p>}
                    {typeof meta.rediscover === "string" && <p className="wi-piece-note">{meta.rediscover}</p>}
                    <EntryAction
                      entry={primary}
                      byId={byId}
                      open={isOpen}
                      onToggle={() => setOpenId(isOpen ? null : primary.id)}
                    />
                    {isOpen && (
                      <div className="wi-rediscover-matches">
                        <Mark kind="curve" className="wi-annot-mark wi-annot-mark--curve wi-rediscover-connector" />
                        <div className="wi-rediscover-matches-strip">
                          {revealIds.map((id) => (
                            <div key={id} className="wi-rediscover-match">
                              <Thumb card={byId.get(id)} size={72} />
                              {id === denimId && (
                                <Annotation className="wi-annot--rediscover-denim" mark="arrow" text="try this with denim" />
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </article>
              );
            })()}

            {secondary.map((e) => {
              const meta = (e.meta ?? {}) as Record<string, unknown>;
              const members = meta.members as Array<{ garmentId: string; title: string }> | undefined;
              if (members && members.length > 1) {
                return (
                  <article key={e.id} className="wi-piece wi-piece--group">
                    <div className="wi-piece-group-imgs">
                      {members.map((m) => (
                        <div key={m.garmentId} className="wi-piece-img">
                          <Thumb card={byId.get(m.garmentId)} size={112} />
                        </div>
                      ))}
                      <Mark kind="bracket" className="wi-annot-mark wi-annot-mark--bracket wi-piece-group-bracket" />
                    </div>
                    <div className="wi-piece-text">
                      <h3 className="wi-piece-name">{e.title}</h3>
                      <p className="wi-piece-group-names">{members.map((m) => m.title).join(" · ")}</p>
                      {e.body && <p className="wi-piece-headline">{e.body}</p>}
                      <EntryAction
                        entry={e}
                        byId={byId}
                        open={openId === e.id}
                        onToggle={() => setOpenId(openId === e.id ? null : e.id)}
                      />
                    </div>
                  </article>
                );
              }
              const card = byId.get(String(meta.garmentId));
              return (
                <article key={e.id} className="wi-piece">
                  <div className="wi-piece-img">
                    {card?.imageUrl
                      ? <img src={card.imageUrl} alt={e.title ?? ""} loading="lazy" />
                      : <span className="wi-thumb-fallback">{card?.category.slice(0, 2) ?? "—"}</span>}
                  </div>
                  <div className="wi-piece-text">
                    {typeof meta.label === "string" && <p className="wi-hero-label">{meta.label}</p>}
                    <h3 className="wi-piece-name">{e.title}</h3>
                    {e.body && <p className="wi-piece-headline">{e.body}</p>}
                    {typeof meta.reason === "string" && <p className="wi-piece-reason">{meta.reason}</p>}
                    {typeof meta.note === "string" && <p className="wi-piece-note">{meta.note}</p>}
                    {typeof meta.rediscover === "string" && <p className="wi-piece-note">{meta.rediscover}</p>}
                    <EntryAction
                      entry={e}
                      byId={byId}
                      open={openId === e.id}
                      onToggle={() => setOpenId(openId === e.id ? null : e.id)}
                    />
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      );
    }

    case "findings": {
      // "You already have plenty of these" groups the neutral tops visually
      // — the one annotated moment this block ever carries, and only for
      // Low Priority (the work-variety finding above gets none).
      const isLowPriority = block.id === "low-priority";
      return (
        <div className="wi-block">
          {label}
          {block.entries.map((e) => (
            <article key={e.id} className={`wi-finding${e.role === "pointer" ? " wi-finding--pointer" : ""}`}>
              <h3 className="wi-finding-title">{e.title}</h3>
              {e.body && <p className="wi-finding-body">{e.body}</p>}
              {e.garmentIds.length > 0 && isLowPriority ? (
                <div className="wi-bracket-group">
                  <Strip ids={e.garmentIds} byId={byId} />
                  <Mark kind="bracket" className="wi-annot-mark wi-annot-mark--bracket wi-bracket-group-mark" />
                  <Annotation className="wi-annot--low-priority" text="you already have plenty of these" />
                </div>
              ) : (
                <Strip ids={e.garmentIds} byId={byId} />
              )}
              <EntryAction
                entry={e}
                byId={byId}
                open={openId === e.id}
                onToggle={() => setOpenId(openId === e.id ? null : e.id)}
              />
            </article>
          ))}
        </div>
      );
    }

    case "recommendations":
      return (
        <div className="wi-block">
          {label}
          {block.entries.map((e) => {
            const attrs = ((e.meta ?? {}).attributes ?? []) as Array<{ kind: string; label: string }>;
            const isOpen = openId === e.id;
            return (
              <article key={e.id} className="wi-rec">
                <h4 className="wi-rec-title">{e.title}</h4>
                {attrs.length > 0 && (
                  <p className="wi-rec-attrs">
                    {attrs.map((a, i) => (
                      <span key={a.kind}>
                        {i > 0 && <span className="wi-rec-sep" aria-hidden="true">·</span>}
                        {a.label}
                      </span>
                    ))}
                  </p>
                )}
                {e.body && <p className="wi-rec-body">{e.body}</p>}
                {/* "Different shape = more options" groups the real pieces
                    this addition would pair with — never a garment image for
                    the addition itself, since the shape is unresolved. */}
                {e.garmentIds.length > 0 ? (
                  <div className="wi-bracket-group">
                    <Strip ids={e.garmentIds} byId={byId} />
                    <Mark kind="bracket" className="wi-annot-mark wi-annot-mark--bracket wi-bracket-group-mark" />
                    <Annotation className="wi-annot--worth-considering" text="different shape = more options" />
                  </div>
                ) : (
                  <Strip ids={e.garmentIds} byId={byId} />
                )}
                {e.action?.kind === "reveal" && e.action.detail && (
                  <>
                    <button
                      type="button"
                      className="wi-note-action"
                      aria-expanded={isOpen}
                      onClick={() => setOpenId(isOpen ? null : e.id)}
                    >
                      {isOpen ? e.action.hideLabel : e.action.label}
                    </button>
                    {isOpen && <p className="wi-rec-why">{e.action.detail}</p>}
                  </>
                )}
              </article>
            );
          })}
        </div>
      );

    case "pairings":
      return (
        <div className="wi-block" id={block.id}>
          {label}
          <ul className="wi-pairs">
            {block.entries.map((e) => (
              <li key={e.id} className="wi-pair">
                <div className="wi-pair-pieces">
                  {e.garmentIds.map((id, i) => (
                    <span key={id} className="wi-pair-piece">
                      {i > 0 && <span className="wi-plus" aria-hidden="true">+</span>}
                      <Thumb card={byId.get(id)} size={84} />
                    </span>
                  ))}
                </div>
                <div className="wi-pair-text"><p className="wi-pair-reason">{e.body}</p></div>
              </li>
            ))}
          </ul>
        </div>
      );

    // ── Closet CAPABILITY, from reviewed garment ratings. Never her preference:
    //    what she asks to feel is a different question, answered in section 6.
    //    Background relative to what to wear/buy/skip, so it stays collapsed.
    case "capability":
      return (
        <div className="wi-block">
          {label}
          <Disclosure block={block} openId={openId} setOpenId={setOpenId}>
            {block.entries.map((e) => {
              const strengths = ((e.meta ?? {}).strengths ?? []) as Array<{ intention: string; label: string; strong: number }>;
              return (
                <div key={e.id}>
                  <ul className="wi-caps">
                    {strengths.map((c) => (
                      <li key={c.intention} className="wi-cap">
                        <span className="wi-cap-label">{c.label}</span>
                        <span className="wi-cap-count">{c.strong} pieces</span>
                      </li>
                    ))}
                  </ul>
                  {e.body && <p className="wi-cap-note">{e.body}</p>}
                </div>
              );
            })}
          </Disclosure>
        </div>
      );

    // ── COVERAGE, moved out of the Passport-comparison list: an actionable
    //    limitation, not provenance. The summary sentence is always visible;
    //    the per-piece breakdown is the customer's choice to open.
    case "coverage":
      return (
        <div className="wi-block">
          {label}
          {block.entries.map((e) => {
            const isOpen = openId === e.id;
            return (
              <div key={e.id} className="wi-coverage-summary">
                <p className="wi-match-reading">{e.body}</p>
                {e.action?.kind === "reveal" && (
                  <>
                    <button
                      type="button"
                      className="wi-note-action"
                      aria-expanded={isOpen}
                      onClick={() => setOpenId(isOpen ? null : e.id)}
                    >
                      {isOpen ? e.action.hideLabel : e.action.label}
                    </button>
                    {/* Thumbnails alone told her nothing. Each piece names the
                        requirement it may not meet on its own, and either the
                        layer she owns that helps or the plain fact that nAia
                        has not found one. Never "this cannot work". */}
                    {isOpen && (
                      <ul className="wi-coverage-list">
                        {((e.meta?.blockedDetail ?? []) as Array<{
                          garmentId: string; name: string; reason: string; layers: string[]; layerIds: string[];
                        }>).map((b) => (
                          <li key={b.garmentId} className="wi-coverage-item">
                            <Thumb card={byId.get(b.garmentId)} size={56} />
                            <div className="wi-coverage-text">
                              <p className="wi-coverage-name">{b.name}</p>
                              <p className="wi-coverage-reason">
                                On its own, this may not meet your preference for {b.reason.replace(/^keeping your /, "").replace(/^avoiding /, "avoiding ")}.
                              </p>
                              {b.layers.length > 0 ? (
                                <>
                                  <p className="wi-coverage-layer">
                                    Worn with your {b.layers[0]}, it could still work.
                                  </p>
                                  <Strip ids={[b.garmentId, ...b.layerIds.slice(0, 1)]} byId={byId} size={48} showAll />
                                </>
                              ) : (
                                <p className="wi-coverage-layer wi-coverage-layer--none">
                                  nAia hasn&rsquo;t found a suitable layering option among the pieces you&rsquo;ve added.
                                </p>
                              )}
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>
      );

    // ── "Ways to get dressed": the outfit is the answer, shown directly
    //    under its own life-area heading — never a heading, a "shown below"
    //    sentence, and the images somewhere else. Tag/provenance evidence
    //    (and most-versatile's folded-in note) sit behind "Why this works".
    // ── The visual centre of the page. Large photography, one panel per
    //    life area, offset rather than identical — the outfit itself is the
    //    answer, and the tag/provenance text sits behind "Why this works".
    case "lifestyle-combos":
      return (
        <div className="wi-block wi-wear">
          {label}
          <div className="wi-wear-grid">
            {block.entries.map((e, i) => {
              const emeta = (e.meta ?? {}) as Record<string, unknown>;
              const versatileId = emeta.mostVersatileGarmentId as string | undefined;
              // "Adds structure" names the outer/structured layer in a
              // combination — the one outerwear piece present, when there is
              // exactly one, real evidence rather than a guess.
              const outerwearIds = e.garmentIds.filter((id) => byId.get(id)?.category === "OUTERWEAR");
              const structureId = e.title === "For work" && outerwearIds.length === 1 ? outerwearIds[0] : undefined;
              return (
                <article key={e.id} className={`wi-wear-panel wi-wear-panel--${i % 3}`}>
                  <p className="wi-wear-label">{e.title}</p>
                  <div className="wi-wear-images">
                    {e.garmentIds.map((id) => {
                      const card = byId.get(id);
                      if (!card) return null;
                      return (
                        <div key={id} className="wi-wear-imgwrap">
                          <Thumb card={card} size={148} />
                          <p className="wi-wear-name">{cardLabel(card)}</p>
                          {id === structureId && (
                            <Annotation className="wi-annot--work-structure" mark="curve" text="adds structure" />
                          )}
                          {id === versatileId && (
                            <Annotation className="wi-annot--work-versatile" mark="underline" text="one of your most versatile pieces" />
                          )}
                        </div>
                      );
                    })}
                  </div>
                  {e.body && <p className="wi-finding-body">{e.body}</p>}
                  <EntryAction
                    entry={e}
                    byId={byId}
                    open={openId === e.id}
                    onToggle={() => setOpenId(openId === e.id ? null : e.id)}
                  />
                </article>
              );
            })}
          </div>
        </div>
      );

    // ── Your wardrobe profile: colours, silhouettes, StyleMe history and wear
    //    behaviour always visible at one line each; the Passport comparison,
    //    capability counts and hero evidence behind one reveal.
    case "profile": {
      const meta = (block.meta ?? {}) as Record<string, unknown>;
      const summaryLines = (meta.summaryLines ?? []) as string[];
      const palette = (meta.palette ?? []) as Array<{ colour: string; count: number }>;
      const shapes = (meta.shapes ?? []) as Array<{ label: string }>;
      return (
        <div className="wi-block">
          {label}
          {palette.length > 0 && (
            <div className="wi-palette">
              {palette.map((c) => (
                <div key={c.colour} className="wi-palette-row">
                  <span className="wi-swatch" style={swatchStyle(c.colour)} aria-hidden="true" />
                  <span className="wi-palette-name">{c.colour}</span>
                  <span className="wi-palette-count">{c.count}</span>
                </div>
              ))}
            </div>
          )}
          {shapes.length > 0 && (
            <p className="wi-shapes-line">
              {shapes.map((sh, i) => (
                <span key={sh.label}>
                  {i > 0 && <span className="wi-shapes-sep" aria-hidden="true">·</span>}
                  {sh.label}
                </span>
              ))}
            </p>
          )}
          {summaryLines.map((line, i) => <p key={i} className="wi-reading wi-reading--sm">{line}</p>)}
          <Disclosure block={block} openId={openId} setOpenId={setOpenId}>
            <div className="wi-history">
              {block.entries.map((e) => {
                const emeta = (e.meta ?? {}) as Record<string, unknown>;
                const strengths = emeta.strengths as Array<{ intention: string; label: string; strong: number }> | undefined;
                return (
                  <div key={e.id} className="wi-hist-item">
                    {e.title && <p className="wi-hist-head">{e.title}</p>}
                    {e.body && <p className="wi-hist-body">{e.body}</p>}
                    {strengths && (
                      <ul className="wi-caps">
                        {strengths.map((c) => (
                          <li key={c.intention} className="wi-cap">
                            <span className="wi-cap-label">{c.label}</span>
                            <span className="wi-cap-count">{c.strong} pieces</span>
                          </li>
                        ))}
                      </ul>
                    )}
                    <EntryAction
                      entry={e}
                      byId={byId}
                      open={openId === e.id}
                      onToggle={() => setOpenId(openId === e.id ? null : e.id)}
                    />
                  </div>
                );
              })}
            </div>
          </Disclosure>
        </div>
      );
    }

    default:
      return null;
  }
}

export default function WardrobeIntelligencePage() {
  const { page, garmentCards } = useLoaderData<typeof loader>();
  const byId = new Map<string, GarmentCard>(garmentCards.map((c: GarmentCard) => [c.id, c]));
  const [openId, setOpenId] = useState<string | null>(null);
  // The full question is a first-visit card. Once answered it collapses to a
  // status line, reopening only if she chooses to change the answer.
  const [editingCompleteness, setEditingCompleteness] = useState(false);
  const navigation = useNavigation();
  const saving = navigation.state !== "idle";
  const model = page as WardrobePage;

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

        <header className="wi-masthead">
          <p className="wi-eyebrow">Wardrobe Intelligence</p>
          <h1 className="wi-title">Your wardrobe, <span className="sp-shell-accent">understood.</span></h1>
          {model.reading && (
            <div className="wi-sub-wrap">
              <p className="wi-sub">{model.reading}</p>
              {/* Only when the reading actually names a thinner area — never
                  invented when the wardrobe reads as fully strong. */}
              {/fewer ways to combine/i.test(model.reading) && (
                <Annotation className="wi-annot--hero-focus" mark="arrow" text="this is where I'd focus" />
              )}
            </div>
          )}
          {/* Conclusions about spending have to show what they are based on. */}
          <p className="wi-basis">{model.basis}</p>
          {model.changeLines.length > 0 && (
            <ul className="wi-changes wi-changes--hero">
              {model.changeLines.map((line, i) => <li key={i} className="wi-change">{line}</li>)}
            </ul>
          )}
        </header>

        {!model.ready && (
          <section className="wi-notready">
            <p className="wi-notready-text">{model.readyNote}</p>
            <Link to="/closet" className="wi-cta">Add pieces to your Closet</Link>
          </section>
        )}

        {model.confidence !== "unknown" && model.ready && (
          <p className="wi-basis-status">
            Based on {model.closetCount} pieces
            <span className="wi-basis-sep" aria-hidden="true">·</span>
            {model.confidence === "mostly" ? "Most of your wardrobe added" : "You're still adding items"}
            <span className="wi-basis-sep" aria-hidden="true">·</span>
            <button type="button" className="wi-basis-change" onClick={() => setEditingCompleteness(true)}>
              {model.confidence === "mostly" ? "Change" : "Update"}
            </button>
          </p>
        )}

        {(model.confidence === "unknown" || editingCompleteness) && model.ready && (
          <section className="wi-completeness">
            <p className="wi-completeness-q">Is this most of the wardrobe you currently wear?</p>
            <p className="wi-completeness-why">
              This helps nAia tell the difference between pieces you're missing and pieces you
              haven't added yet.
            </p>
            <Form method="post" className="wi-completeness-answers">
              <button type="submit" name="closetCompleteness" value="mostly"
                      className="wi-completeness-btn" disabled={saving}>
                Yes, mostly
              </button>
              <button type="submit" name="closetCompleteness" value="still-adding"
                      className="wi-completeness-btn" disabled={saving}>
                I'm still adding pieces
              </button>
            </Form>
          </section>
        )}

        {/* One horizontal rule on the whole page — before "Your wardrobe
            profile", marking the shift from decisions to background. The
            other moments flow into each other on spacing alone. */}
        {model.sections.map((section) => (
          <section
            key={section.id}
            className={section.id === "profile" ? "wi-chapter wi-chapter--rule" : "wi-chapter"}
            aria-labelledby={`wi-${section.id}-h`}
          >
            <h2 id={`wi-${section.id}-h`} className="wi-chapter-title">{section.title}</h2>
            {section.sub && <p className="wi-chapter-sub">{section.sub}</p>}
            {section.blocks.map((block) => (
              <Block key={block.id} block={block} byId={byId} openId={openId} setOpenId={setOpenId} />
            ))}
          </section>
        ))}

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
  /* Basis line. Always visible: a conclusion about spending has to show what
     it is based on. */
  .wi-basis{font-family:var(--naia-ff-ui);font-size:11px;letter-spacing:.06em;color:rgba(40,21,12,0.55);margin:14px 0 0}

  /* One entry per garment. The cream tank was a hero AND a separate note, so it
     was featured twice; everything known about a piece now sits in one place. */
  .wi-pieces{display:flex;flex-direction:column;gap:28px}
  .wi-piece{display:grid;grid-template-columns:96px minmax(0,1fr);gap:20px;align-items:start}
  @media(min-width:700px){.wi-piece{grid-template-columns:132px minmax(0,1fr);gap:26px}}
  .wi-piece-img{aspect-ratio:3/4;background:rgba(40,21,12,0.04);overflow:hidden;display:flex;align-items:center;justify-content:center}
  .wi-piece-img img{width:100%;height:100%;object-fit:cover}
  .wi-piece-text{min-width:0}
  .wi-piece-name{font-family:var(--naia-ff-display);font-size:1.0625rem;line-height:1.25;margin:6px 0 8px;text-wrap:balance}
  .wi-piece-headline{margin:0 0 8px;font-size:.9375rem;line-height:1.55;color:var(--naia-ink)}
  .wi-piece-reason,.wi-piece-note{margin:0 0 8px;font-size:.875rem;line-height:1.6;color:rgba(40,21,12,0.72)}
  .wi-piece--group{grid-template-columns:240px minmax(0,1fr)}
  @media(min-width:700px){.wi-piece--group{grid-template-columns:300px minmax(0,1fr)}}
  .wi-piece-group-imgs{position:relative;display:flex;gap:16px;padding-bottom:20px}
  .wi-piece-group-names{margin:0 0 8px;font-size:.8125rem;letter-spacing:.02em;color:rgba(40,21,12,0.6)}
  .wi-piece-group-bracket{position:absolute;left:6px;right:6px;bottom:0;width:calc(100% - 12px);height:18px}

  /* ── Stylist marks and notes ─────────────────────────────────────────────
     One small reusable set (arrow, curve, underline, circle, bracket), the
     existing burgundy italic serif for every note — restrained, attached to
     the specific garment or group it refers to, never a floating caption. */
  .wi-annot{position:absolute;display:inline-flex;align-items:flex-start;gap:6px;pointer-events:none;z-index:2;max-width:200px}
  .wi-annot-text{font-size:.9375rem;line-height:1.25;white-space:normal}
  .wi-annot-mark{color:var(--lipstick);opacity:.82;flex-shrink:0}
  .wi-annot-mark--arrow,.wi-annot-mark--curve{width:44px;height:36px}
  .wi-annot-mark--underline{width:100%;height:8px}
  .wi-annot-mark--circle{width:56px;height:32px}
  .wi-annot-mark--bracket{width:100%;height:18px}

  /* Hero: points toward the thinner half of the reading, never invented when
     the wardrobe reads as fully strong. */
  .wi-sub-wrap{position:relative;padding-bottom:34px}
  .wi-annot--hero-focus{top:100%;right:0;flex-direction:row-reverse;text-align:right}
  .wi-annot--hero-focus .wi-annot-mark{transform:scaleX(-1)}

  /* Work: "adds structure" and "one of your most versatile pieces" attach to
     the specific photo they describe, not the panel as a whole. Both sit in
     the margin to the RIGHT of their own image — never above/below, which is
     the gap the next image in the same stacked column also needs. */
  .wi-wear-imgwrap{position:relative}
  /* Both sit BELOW their own image, in flow order (trousers, then its note,
     then the blazer, then its note) — never to the side, which a 3-column
     grid does not reliably have room for; never above, which collides with
     whatever the previous image in the same stacked column left behind. */
  /* The annotation sits OUTSIDE its image wrapper (top:100%), so it is the
     styling sentence below — not the wrapper's own padding — that has to
     leave room for it: two lines of the small italic note plus its mark.
     Scoped to panels that actually carry one, so Everyday/Dinners keep
     their normal spacing. */
  .wi-wear-panel:has(.wi-annot) .wi-finding-body{margin-top:80px}
  .wi-annot--work-structure,.wi-annot--work-versatile{top:100%;left:0;width:100%;margin-top:4px;flex-direction:column;align-items:flex-start}
  .wi-annot--work-structure .wi-annot-mark{transform:rotate(160deg)}
  .wi-annot--work-versatile .wi-annot-text{font-size:.8125rem}

  /* Rediscovery: a plain connector from the source photo to its matches, and
     one conditional micro-note on the actual denim match, when one exists. */
  .wi-rediscover-source{position:relative}
  .wi-rediscover-matches{position:relative;margin-top:18px;padding-top:22px}
  .wi-rediscover-connector{position:absolute;top:-10px;left:8px;width:60px;height:40px;color:var(--lipstick);opacity:.75;transform:rotate(90deg) scaleX(-1)}
  .wi-rediscover-matches-strip{display:flex;flex-wrap:wrap;gap:14px}
  .wi-rediscover-match{position:relative}
  .wi-annot--rediscover-denim{top:100%;left:0;margin-top:6px;width:150px;flex-direction:column;align-items:flex-start}

  /* Grouped blazers / Low Priority / Worth Considering: a bracket collecting
     a row of real pieces, with one note attached to the group as a whole. */
  .wi-bracket-group{position:relative;padding-bottom:26px}
  .wi-bracket-group-mark{position:absolute;left:4px;right:4px;bottom:6px;width:calc(100% - 8px)}
  .wi-annot--low-priority,.wi-annot--worth-considering{position:static;display:block;margin-top:8px;max-width:none}
  .wi-annot--low-priority .wi-annot-mark,.wi-annot--worth-considering .wi-annot-mark{display:none}

  @media(max-width:699px){
    /* Mobile: notes sit immediately above/below their garment, short vertical
       connectors only, nothing overlaps, no horizontal scroll. */
    .wi-annot{position:static;display:flex;margin-top:6px;max-width:none}
    .wi-annot-mark--arrow,.wi-annot-mark--curve{width:26px;height:20px;transform:rotate(90deg)!important}
    .wi-annot--hero-focus{flex-direction:row;text-align:left}
    .wi-annot--work-structure,.wi-annot--work-versatile{width:auto}
    .wi-annot--work-structure .wi-annot-mark{transform:rotate(90deg)}
    .wi-annot--work-versatile .wi-annot-mark{transform:none}
    .wi-rediscover-connector{display:none}
    .wi-annot--rediscover-denim{position:static;margin-top:4px;width:auto}
  }

  /* ── Wear what you already own — the visual centre ───────────────────────
     Three panels, gently offset rather than identical bordered cards; large
     recognisable photography carries the weight, not the panel chrome. Kept
     close in scale between Work/Everyday/Dinners — the gap gets its emphasis
     later, in "What deserves your attention" and "Shop smarter", not here. */
  .wi-wear-grid{display:flex;flex-direction:column;gap:56px}
  @media(min-width:900px){
    .wi-wear-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:40px;align-items:start}
    .wi-wear-panel--1{margin-top:34px}
    .wi-wear-panel--2{margin-top:14px}
  }
  .wi-wear-label{font-family:var(--naia-ff-ui);font-size:9.5px;letter-spacing:3px;text-transform:uppercase;color:rgba(40,21,12,0.55);margin:0 0 16px}
  .wi-wear-images{display:flex;flex-wrap:wrap;gap:18px;margin-bottom:16px}
  .wi-wear-imgwrap{flex:1 1 40%;min-width:110px;max-width:200px}
  .wi-wear-imgwrap:nth-child(2){margin-top:16px}
  .wi-wear-imgwrap:nth-child(3){margin-top:-10px}
  .wi-wear-imgwrap figure.wi-thumb{width:100%!important;height:auto!important;aspect-ratio:3/4}
  .wi-wear-name{font-family:var(--naia-ff-ui);font-size:10px;letter-spacing:.04em;color:rgba(40,21,12,0.6);margin:8px 0 0}

  /* Rediscovery source photo: the largest image on the page. */
  .wi-piece--rediscover{grid-template-columns:220px minmax(0,1fr)}
  @media(min-width:700px){.wi-piece--rediscover{grid-template-columns:260px minmax(0,1fr)}}
  .wi-piece--rediscover .wi-rediscover-source figure.wi-thumb{width:100%!important;height:auto!important;aspect-ratio:3/4}

  /* Coverage detail: one row per piece, with its own reason and layer evidence. */
  .wi-coverage-list{list-style:none;margin:14px 0 0;padding:0;display:flex;flex-direction:column;gap:16px}
  .wi-coverage-item{display:grid;grid-template-columns:56px minmax(0,1fr);gap:14px;align-items:start}
  .wi-coverage-text{min-width:0}
  .wi-coverage-name{font-family:var(--naia-ff-display);font-size:.9375rem;margin:0 0 4px}
  .wi-coverage-reason{font-size:.8125rem;line-height:1.6;color:rgba(40,21,12,0.72);margin:0 0 4px}
  .wi-coverage-layer{font-size:.8125rem;line-height:1.6;color:var(--naia-ink);margin:0}
  .wi-coverage-layer--none{color:rgba(40,21,12,0.55);font-style:italic}

  /* Once answered, a compact editable status instead of the first-visit card. */
  .wi-basis-status{font-family:var(--naia-ff-ui);font-size:11px;letter-spacing:.06em;color:rgba(40,21,12,0.6);margin:0 0 36px;display:flex;flex-wrap:wrap;align-items:center;gap:8px}
  .wi-basis-sep{opacity:.4}
  .wi-basis-change{font:inherit;letter-spacing:inherit;color:var(--naia-ink);background:none;border:0;border-bottom:1px solid var(--naia-accent);padding:0;cursor:pointer}

  /* The completeness question. Asked once, plainly, and never again once
     answered. */
  .wi-completeness{border:1px solid var(--naia-border);padding:22px 24px;margin:0 0 44px}
  .wi-completeness-q{font-family:var(--naia-ff-display);font-size:1.0625rem;margin:0 0 8px}
  .wi-completeness-why{font-size:.875rem;line-height:1.6;color:rgba(40,21,12,0.7);margin:0 0 16px}
  .wi-completeness-answers{display:flex;flex-wrap:wrap;gap:10px}
  .wi-completeness-btn{font-family:var(--naia-ff-ui);font-size:10px;letter-spacing:2px;text-transform:uppercase;padding:11px 18px;border:1px solid var(--naia-ink);background:transparent;color:var(--naia-ink);cursor:pointer}
  .wi-completeness-btn:hover:not(:disabled){background:var(--naia-ink);color:#fff}
  .wi-completeness-btn:disabled{opacity:.5;cursor:default}

  /* What moved since last time. Sits above everything because it is the reason
     to come back. */
  .wi-block--change{border-left:2px solid var(--naia-accent);padding-left:18px}
  .wi-changes{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px}
  .wi-change{font-size:.9375rem;line-height:1.55;color:var(--naia-ink)}
  .wi-changes--hero{margin:14px 0 0;padding-left:16px;border-left:2px solid var(--naia-accent)}

  .wi-block-note{font-size:.8125rem;line-height:1.55;color:rgba(40,21,12,0.6);margin:-6px 0 16px}

  /* A pointer names a finding explained in the section that owns it. */
  .wi-finding--pointer .wi-finding-title{font-size:.9375rem;opacity:.85}

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
  /* The generated summary sentence is never reworded to fit. On desktop the
     container is released so it sits on one line where the viewport allows;
     balance only affects how it breaks when it genuinely cannot. */
  @media(min-width:900px){
    .wi-opening-reading{max-width:62ch;text-wrap:balance}
  }
  .wi-opening-reading{font-family:var(--naia-ff-body);font-size:1.6rem;font-style:italic;line-height:1.45;color:var(--naia-ink);margin:0 0 18px}
  @media(min-width:768px){.wi-opening-reading{font-size:1.9rem}}
  /* The three snapshot stats.
     Each separator is rendered INSIDE its stat, so a stat that wraps carries
     its dot onto the new line — that is where the stray leading "·" came from.
     Above 700px the row simply does not wrap; below it the stats stack and the
     separators are hidden entirely, so a dot can never start a line. */
  .wi-opening-facts{display:flex;flex-wrap:wrap;gap:6px 0;margin:0;font-family:var(--naia-ff-ui);font-size:11px;letter-spacing:1.6px;text-transform:uppercase;color:rgba(40,21,12,0.55)}
  @media(min-width:700px){.wi-opening-facts{flex-wrap:nowrap}}
  .wi-fact{display:inline-flex;align-items:baseline;white-space:nowrap}
  .wi-fact-sep{padding:0 12px;color:rgba(40,21,12,0.3)}
  /* Below the no-wrap threshold, stack rather than wrap mid-row. */
  @media(max-width:699px){
    .wi-opening-facts{flex-direction:column;gap:8px}
    .wi-fact-sep{display:none}
  }
  .wi-fact-value{font-family:var(--naia-ff-display);font-size:18px;font-weight:300;letter-spacing:0;color:var(--naia-ink);margin-right:7px}

  /* ── Sections ─────────────────────────────────────────────────────────── */
  /* Evidence headings stay below the lead titles. Before, every section
     shouted at 1.9rem and the page read as ten equal chapters. */
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
  .wi-opp-body{font-family:var(--naia-ff-ui);font-size:13px;line-height:1.75;color:rgba(40,21,12,0.65);margin:0;max-width:38em}
  /* ══ CHAPTERS ════════════════════════════════════════════════════════
     Five chapters, one typographic treatment. Every chapter title shares the
     same family, size, weight, letter-spacing, rule and spacing — the page
     previously had four different heading scales and read as a stack of
     unrelated reports. Subsection labels are smaller by design, but there is
     exactly one chapter level. */
  .wi-chapter{padding-top:0;margin-bottom:80px}
  .wi-chapter--rule{padding-top:32px;border-top:2px solid var(--naia-ink)}
  @media(min-width:900px){.wi-chapter{margin-bottom:104px}.wi-chapter--rule{padding-top:38px}}
  .wi-chapter-title{
    font-family:var(--naia-ff-display);
    font-size:1.75rem;
    font-weight:200;
    letter-spacing:0.035em;
    text-transform:uppercase;
    line-height:1.06;
    color:var(--naia-ink);
    /* Generous, equal breathing room under every chapter title. The old
       "What nAia knows right now" sat 10px off its content. */
    margin:0 0 36px;
  }
  @media(min-width:900px){.wi-chapter-title{font-size:2.125rem;margin:0 0 44px}}
  .wi-chapter-sub{font-family:var(--naia-ff-body);font-size:15px;font-style:italic;line-height:1.7;color:rgba(40,21,12,0.6);margin:-24px 0 36px;max-width:40em}
  @media(min-width:900px){.wi-chapter-sub{margin:-30px 0 44px}}

  /* Blocks inside a chapter. Quieter than a chapter, louder than body copy. */
  .wi-block{margin-bottom:56px}
  .wi-block:last-child{margin-bottom:0}
  @media(min-width:900px){.wi-block{margin-bottom:68px}}
  .wi-sublabel{font-family:var(--naia-ff-ui);font-size:9.5px;letter-spacing:3px;text-transform:uppercase;color:var(--naia-ink);margin:0 0 22px;padding-bottom:10px;border-bottom:1px solid var(--naia-border)}
  .wi-sublabel--quiet{color:rgba(40,21,12,0.5)}

  /* Opening snapshot — the summary sentence is never reworded to fit, so on
     desktop its container is released rather than its type reduced. */
  .wi-opening{margin-bottom:52px}
  @media(min-width:900px){
    .wi-opening-reading{max-width:62ch;text-wrap:balance}
  }

  /* Compact Wardrobe DNA, in chapter 1 and nowhere else. */
  .wi-dna-grid{display:grid;gap:34px}
  @media(min-width:860px){.wi-dna-grid{grid-template-columns:repeat(3,1fr);gap:44px}}
  .wi-dna-cell{min-width:0}

  /* Transparency footer — the quietest thing on the page. */
  .wi-footnote{border-top:1px solid var(--naia-border);padding-top:22px;margin-bottom:48px}

  /* ── What nAia knows right now ────────────────────────────────────────
     At most four conclusions, each a headline the customer can act on with
     one plain sentence under it. Not bullets of equal weight. */
  .wi-knows-list{list-style:none;margin:0;padding:0;display:grid;gap:30px}
  @media(min-width:900px){.wi-knows-list{grid-template-columns:1fr 1fr;gap:40px 56px}}
  .wi-knows-item{padding-left:18px;border-left:2px solid var(--naia-accent)}
  .wi-knows-head{font-family:var(--naia-ff-ui);font-size:12px;font-weight:600;letter-spacing:1.6px;text-transform:uppercase;color:var(--naia-ink);margin:0 0 9px;line-height:1.45}
  .wi-knows-text{font-family:var(--naia-ff-body);font-size:1rem;line-height:1.65;color:rgba(40,21,12,0.72);margin:0;max-width:34em}
  @media(min-width:900px){.wi-knows-text{font-size:1.0625rem}}

  /* ── What your wardrobe can dress you for ─────────────────────────── */
  .wi-registers{list-style:none;margin:0;padding:0;display:grid;gap:30px}
  @media(min-width:760px){.wi-registers{grid-template-columns:repeat(3,1fr);gap:40px}}
  .wi-register{border-top:1px solid var(--naia-border);padding-top:16px}
  .wi-register.is-strong{border-top-color:var(--naia-ink)}
  .wi-register.is-needs-range,.wi-register.is-less-than-it-looks{border-top-color:var(--naia-accent)}
  .wi-register-name{font-family:var(--naia-ff-ui);font-size:10px;letter-spacing:2.6px;text-transform:uppercase;color:rgba(40,21,12,0.55);margin:0 0 12px;display:flex;flex-wrap:wrap;gap:8px;align-items:baseline}
  .wi-register-flag{font-size:8.5px;letter-spacing:1.5px;color:var(--naia-accent);text-transform:uppercase}
  .wi-register-verdict{font-family:var(--naia-ff-display);font-size:1.25rem;font-weight:200;letter-spacing:0.02em;line-height:1.2;color:var(--naia-ink);margin:0 0 10px}
  .wi-register-note{font-family:var(--naia-ff-ui);font-size:13px;line-height:1.75;color:rgba(40,21,12,0.66);margin:0;max-width:30em}

  /* ── What your wardrobe needs ─────────────────────────────────────── */
  .wi-finding{margin-bottom:26px}
  .wi-finding:last-child{margin-bottom:0}
  .wi-finding-title{font-family:var(--naia-ff-body);font-size:1.1875rem;font-style:italic;font-weight:400;line-height:1.5;color:var(--naia-ink);margin:0 0 8px;max-width:32em}
  .wi-finding-body{font-family:var(--naia-ff-ui);font-size:13px;line-height:1.8;color:rgba(40,21,12,0.68);margin:0;max-width:40em}

  /* The conclusion the customer came for. Previously a 9px eyebrow. */
  .wi-verdict{border-top:1px solid var(--naia-ink);padding-top:26px;margin-top:8px}
  .wi-verdict-q{font-family:var(--naia-ff-ui);font-size:10px;letter-spacing:2.8px;text-transform:uppercase;color:rgba(40,21,12,0.55);margin:0 0 14px;font-weight:400}
  .wi-verdict-a{font-family:var(--naia-ff-display);font-size:1.5rem;font-weight:200;line-height:1.2;letter-spacing:0.01em;color:var(--naia-ink);margin:0 0 12px;max-width:22em}
  @media(min-width:900px){.wi-verdict-a{font-size:1.875rem}}
  .wi-verdict-why{font-family:var(--naia-ff-body);font-size:1rem;font-style:italic;line-height:1.65;color:rgba(40,21,12,0.7);margin:0;max-width:34em}
  .wi-verdict-next{margin-top:34px}

  /* ── Activity evidence (quiet) ────────────────────────────────────── */
  /* ── What your styling history shows ──────────────────────────────── */
  .wi-history{display:grid;gap:34px}
  @media(min-width:860px){.wi-history{grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:44px}}
  .wi-hist-item{border-top:1px solid var(--naia-border);padding-top:16px}
  .wi-hist-head{font-family:var(--naia-ff-ui);font-size:9.5px;letter-spacing:2.6px;text-transform:uppercase;color:var(--naia-ink);margin:0 0 14px}
  .wi-caps{list-style:none;margin:0 0 18px;padding:0;display:flex;flex-direction:column;gap:10px}
  .wi-cap{display:flex;align-items:baseline;gap:14px;border-bottom:1px solid var(--naia-border);padding-bottom:9px}
  .wi-cap-label{font-family:var(--naia-ff-body);font-size:1.0625rem;font-style:italic;color:var(--naia-ink);flex:1}
  .wi-cap-count{font-family:var(--naia-ff-ui);font-size:10px;letter-spacing:2px;text-transform:uppercase;color:rgba(40,21,12,0.5)}
  .wi-cap-note{font-family:var(--naia-ff-ui);font-size:13px;line-height:1.8;color:rgba(40,21,12,0.66);margin:0;max-width:40em}
  .wi-hist-body{font-family:var(--naia-ff-ui);font-size:13px;line-height:1.8;color:rgba(40,21,12,0.66);margin:14px 0 0;max-width:34em}
  .wi-hist-item .wi-strip{margin:0}

  /* ── What would add the most ──────────────────────────────────────── */
  .wi-rec{margin-bottom:32px;padding-left:18px;border-left:2px solid var(--naia-accent)}
  .wi-rec:last-child{margin-bottom:0}
  .wi-rec--quiet{border-left-color:var(--naia-border)}
  .wi-rec-title{font-family:var(--naia-ff-display);font-size:1.1875rem;font-weight:200;letter-spacing:0.03em;text-transform:uppercase;line-height:1.2;color:var(--naia-ink);margin:0 0 8px}
  @media(min-width:900px){.wi-rec-title{font-size:1.375rem}}
  .wi-rec-attrs{font-family:var(--naia-ff-ui);font-size:11px;letter-spacing:1.8px;text-transform:uppercase;color:var(--naia-accent);margin:0 0 12px}
  .wi-rec--quiet .wi-rec-attrs{color:rgba(40,21,12,0.5)}
  .wi-rec-sep{padding:0 9px;color:rgba(40,21,12,0.3)}
  .wi-rec-body{font-family:var(--naia-ff-ui);font-size:13px;line-height:1.8;color:rgba(40,21,12,0.68);margin:0;max-width:40em}
  .wi-rec .wi-strip{margin-top:16px}

  /* ── How your Closet matches you ──────────────────────────────────── */
  .wi-matches{list-style:none;margin:0 0 28px;padding:0;display:flex;flex-direction:column;gap:26px}
  .wi-match{padding-left:16px;border-left:1px solid var(--naia-border)}
  .wi-match.is-gap{border-left-color:var(--naia-accent)}
  .wi-match.is-strong{border-left-color:var(--naia-ink)}
  .wi-match-head{font-family:var(--naia-ff-ui);font-size:10px;letter-spacing:2.4px;text-transform:uppercase;margin:0 0 9px;display:flex;flex-wrap:wrap;gap:8px;align-items:baseline}
  .wi-match-dim{color:var(--naia-ink)}
  .wi-match-sep{color:rgba(40,21,12,0.3)}
  .wi-match-state{color:rgba(40,21,12,0.55)}
  .wi-match.is-gap .wi-match-state{color:var(--naia-accent)}
  .wi-match-reading{font-family:var(--naia-ff-body);font-size:1.0625rem;font-style:italic;line-height:1.65;color:var(--naia-ink);margin:0;max-width:36em}

  /* ── Register depth ───────────────────────────────────────────────────── */
  .wi-registers{list-style:none;margin:0 0 40px;padding:0;display:grid;gap:22px}
  @media(min-width:640px){.wi-registers{grid-template-columns:repeat(3,1fr);gap:28px}}
  .wi-register{border-top:1px solid var(--naia-border);padding-top:14px}
  .wi-register-name{font-family:var(--naia-ff-ui);font-size:9px;letter-spacing:2.5px;text-transform:uppercase;color:rgba(40,21,12,0.55);margin:0 0 10px;display:flex;flex-wrap:wrap;gap:8px;align-items:baseline}
  .wi-register-verdict{font-family:var(--naia-ff-body);font-size:1.0625rem;font-style:italic;line-height:1.5;color:var(--naia-ink);margin:0 0 8px}
  .wi-register-note{font-family:var(--naia-ff-ui);font-size:11.5px;line-height:1.65;color:rgba(40,21,12,0.55);margin:8px 0 0}

  .wi-finding{margin-bottom:28px}
  .wi-finding:last-child{margin-bottom:0}
  .wi-finding-title{font-family:var(--naia-ff-body);font-size:1.1875rem;font-style:italic;font-weight:400;line-height:1.5;color:var(--naia-ink);margin:0 0 8px;max-width:32em}
  .wi-finding-body{font-family:var(--naia-ff-ui);font-size:13px;line-height:1.8;color:rgba(40,21,12,0.68);margin:0;max-width:40em}


  /* ── Passport synthesis ───────────────────────────────────────────────── */


  /* ── Passport vs Closet ───────────────────────────────────────────────── */

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

  /* ── What nAia knows so far: reassurance, not a provenance panel ──────── */
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
  }
  @media(max-width:640px){
    .wi-switch{gap:20px}
    .wi-switch-item{font-size:9px;letter-spacing:1.6px}
    .wi-opening-reading{font-size:1.35rem}
    .wi-opening-facts{flex-direction:column;gap:8px}
    .wi-fact-sep{display:none}
    /* Supporting hero cards stay small: image, label, name, one reason. */
    .wi-hero{flex:0 0 58%}
    .wi-hero-featured-headline{font-size:1.2rem}
    .wi-hero-featured-name{font-size:1.35rem}
    /* Pairings go vertical: imagery on top, reading underneath. */
    .wi-pair{flex-direction:column;align-items:flex-start;gap:14px}
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
