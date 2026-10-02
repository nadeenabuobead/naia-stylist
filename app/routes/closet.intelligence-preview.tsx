// app/routes/closet.intelligence-preview.tsx
//
// WARDROBE INTELLIGENCE — presentation preview.
//
// A separate route, not wired into navigation and not replacing
// closet.intelligence.tsx. It reuses that route's exact read-only data path
// (same engine, same needs/recommendations, same buildWardrobePage output)
// so nothing shown here is hard-coded — a different customer's counts,
// garments and findings render here automatically. It never calls
// readAndRecordChange or the completeness action: this pass makes no writes.
//
// Composition: one vertical page, six sections, no right rail and no panel
// that swaps out the main screen. Deep evidence (Passport alignment, full
// wardrobe-profile provenance, the full per-register breakdown, "why this
// recommendation") lives behind small secondary links, each opening a single
// dialog — never replacing what's on screen.
//
// "Your Closet, styled." (Moodboard V1) is a presentation-only diversity
// SELECTION over combinations intelligence.pairings.bestByRegister already
// ranked — see selectMoodboardLooks() below. It generates, rescores, and
// invents nothing: every look shown is a real resolved combination. It does
// NOT attempt Travel or Active registers (the engine has no such registers
// today — Travel folds into Everyday, Active is a fragile regex relabel) or
// "swap a piece" (no engine primitive for it yet) — both are separately
// scoped engine (V2) work.

import { useState } from "react";
import { redirect, type LoaderFunctionArgs, type LinksFunction, data } from "react-router";
import { useLoaderData } from "react-router";
import prisma from "../db.server";
import { requireCurrentNaiaCustomer } from "~/lib/naia-session.server";
import MyNaiaLayout from "~/components/my-naia/MyNaiaLayout";
import naiaStyles from "~/styles/naia-design-system.css?url";
import { getCloudinaryConfig, buildPrivateDownloadUrl } from "~/lib/cloudinary-admin.server";
import { loadWardrobeIntelligence } from "~/lib/ai/wardrobe-intelligence.server";
import { readClosetConfidence } from "~/lib/ai/wardrobe-confidence.server";
import { buildWardrobePage, type WardrobePage, type PageEntry } from "~/lib/ai/wardrobe-page";
import { registerDisplay, type DepthState } from "~/lib/ai/wardrobe-copy";
import { type RegisterId } from "~/lib/ai/wardrobe-needs";
import { SILHOUETTE_LABELS } from "~/lib/ai/wardrobe-intelligence";

// Duplicated from closet.intelligence.tsx rather than importing a private
// constant — this route makes no change to that file at all.
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
  return [{ title: "Wardrobe Intelligence — preview | nAia" }];
}

// No `action` export — this route never writes. The closet-status control
// below is local, transient React state, exactly like the reference.
export async function loader({ request }: LoaderFunctionArgs) {
  const naiaCustomer = await requireCurrentNaiaCustomer(request);
  const customer = await prisma.customer.findUnique({
    where: { id: naiaCustomer.id },
    select: {
      id: true,
      closetItems: { orderBy: { createdAt: "desc" } },
      onboardingProfile: { select: PASSPORT_SELECT },
    },
  });
  if (!customer) return redirect("/auth/shopify/login");

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
  const flags = { derivedIntentionIntelligence: process.env.WARDROBE_V2_INTENTIONS === "true" };

  const { intelligence, needs, recommendations, garments } = await loadWardrobeIntelligence(customer.id, {
    imageUrlById,
    flags,
    passport: profile
      ? {
          lifestyle: profile.lifestyle, favoriteColors: profile.favoriteColors, avoidColors: profile.avoidColors,
          stylePersonalities: profile.stylePersonalities, silhouette: profile.silhouette,
          structure: profile.structure ?? null, fitPreferences: profile.fitPreferences,
          styleStruggles: profile.styleStruggles, styleSupport: profile.styleSupport, becoming: profile.becoming,
          styleExpression: profile.styleExpression, styleDirections: profile.styleDirections,
          explorationLevel: profile.explorationLevel ?? null, dressingHabits: profile.dressingHabits,
          dressingPreferences: profile.dressingPreferences, coveragePreferences: profile.coveragePreferences,
          preferredCoverage: profile.preferredCoverage ?? null,
          dressingRequirementsNote: profile.dressingRequirementsNote ?? null,
          fitConcerns: profile.fitConcerns, dressesFor: profile.dressesFor,
          neutralVsColour: profile.neutralVsColour ?? null, colourIntensity: profile.colourIntensity ?? null,
          printAppetite: profile.printAppetite ?? null,
        }
      : null,
  });

  // Read-only preview: no change-tracking write, no completeness write.
  const page = buildWardrobePage({
    intelligence,
    needs,
    recommendations,
    closetCount: customer.closetItems.length,
    confidence: await readClosetConfidence(customer.id),
    garmentName: (id) => garments.find((g) => g.id === id)?.name ?? null,
    change: null,
    lifestyle: profile?.lifestyle ?? [],
  });

  const garmentCards = garments.map((g) => ({
    id: g.id, name: g.name, category: g.category, subcategory: g.subcategory,
    primaryColor: g.primaryColor, imageUrl: g.imageUrl,
    // Carried only for the Coverage state's per-piece reason sentence below —
    // presentation only, no new engine field.
    hemLength: g.hemLength ?? null,
  }));

  // ── "Your wardrobe at a glance" — the two highest-value register readings ──
  //
  // registerDisplay() is the same, already-shipped customer-safe vocabulary
  // the profile/lifestyle line already uses ("Plenty of options", "Fewer
  // combinations", ...) — nothing new is invented here. Only registers she
  // actually needs (needed === true) are candidates, and "learning" is
  // excluded: it isn't a conclusion, it's an absence of one. From what's
  // left, only the single BEST and single WORST reading survive — an
  // editorial contrast, not a per-register report. A customer with only one
  // needed register, or every needed register in the same state, gets one
  // line, not two padded-out ones. These are also the real basis for the
  // "Strongest" / "Needs attention" headline cards.
  const DEPTH_RANK: Readonly<Record<DepthState, number>> = {
    strong: 0, "limited-variety": 1, "needs-range": 2, "less-than-it-looks": 3, empty: 4, learning: -1,
  };
  const glanceCandidates = needs.registers
    .filter((r) => r.needed)
    .map(registerDisplay)
    .filter((d) => d.state !== "learning");
  const glanceRegisters: Array<{ heading: string; stateText: string }> = [];
  if (glanceCandidates.length > 0) {
    const best = [...glanceCandidates].sort((a, b) => DEPTH_RANK[a.state] - DEPTH_RANK[b.state])[0];
    const worst = [...glanceCandidates].sort((a, b) => DEPTH_RANK[b.state] - DEPTH_RANK[a.state])[0];
    glanceRegisters.push({ heading: best.heading, stateText: best.stateText });
    if (worst.heading !== best.heading) glanceRegisters.push({ heading: worst.heading, stateText: worst.stateText });
  }

  // ── Every register's real reading, for "How your wardrobe supports your life" ──
  // Same registerDisplay() vocabulary, every needed register this time (not
  // just the contrast pair) — real depth verdicts only for the three actual
  // registers the engine computes (everyday/work/occasion). No Activewear or
  // Travel verdict is invented here; a real "also works for the gym" bonus
  // pairing (when the Closet has one) is read separately, client-side, from
  // the existing wear block — that mechanism already exists and is not
  // duplicated here.
  const allRegisterReadings = needs.registers
    .filter((r) => r.needed)
    .map((r) => ({ register: r.register, usableCount: r.usableCount, ...registerDisplay(r) }))
    .filter((d) => d.state !== "learning");

  // ── Real neutral share, for "What your wardrobe looks like" ─────────────
  // dna.palette[].share is already a real computed fraction (not invented
  // here) — this just sums the ones already flagged wardrobe-neutral.
  const neutralSharePct = intelligence.dna.palette.length > 0
    ? Math.round(intelligence.dna.palette.filter((p) => p.neutral).reduce((sum, p) => sum + p.share, 0) * 100)
    : null;

  // ── The real "enough" clusters behind the low-priority finding ───────────
  // notAPriority.body only explains why ONE cluster is LOW priority (thinner
  // area elsewhere); needs.enough already computes up to 3 real repetition
  // clusters with their own count and "why it's enough" sentence — all of
  // them are surfaced here now, not just the one the low-priority finding
  // happened to reference, so "Where your wardrobe repeats" shows real
  // breadth instead of a single example.
  const enoughClusters = needs.enough.map((e) => ({ title: e.title, body: e.body, garmentIds: e.garmentIds, count: e.garmentIds.length }));
  const enoughCluster = enoughClusters[0] ?? null;

  // ── Real pieces worth rediscovering, one per garment ─────────────────────
  // "worth-trying" entries are either a single piece (meta.garmentId) or a
  // real GROUPED finding about several pieces that share the same matches
  // (meta.members, e.g. two blazers she marked as hard to style) — this
  // flattens both shapes into one simple list of real pieces, each carrying
  // its own real compatible-match ids. No new finding, no invented piece:
  // every entry here already existed as real engine output.
  const worthTryingEntries = page.sections.find((s) => s.id === "wear")?.blocks.find((b) => b.id === "worth-trying")?.entries ?? [];
  const rediscoverPieces: Array<{ garmentId: string; matchIds: string[]; insight: string }> = [];
  for (const entry of worthTryingEntries) {
    const members = entry.meta?.members as Array<{ garmentId: string; title: string }> | undefined;
    if (members && members.length > 0) {
      // The real engine finding here is a single compound sentence shared
      // across the whole group ("You marked both X and Y as difficult to
      // style — the same N pieces work with either."). Showing that same
      // long sentence on every member's card makes the row read as denser
      // than the single-piece card beside it. Same real facts (marked
      // difficult to style; N real compatible pieces), one normalized
      // short line per card instead.
      const insight = `Marked difficult to style — ${entry.garmentIds.length} compatible pieces.`;
      for (const m of members) rediscoverPieces.push({ garmentId: m.garmentId, matchIds: entry.garmentIds, insight });
    } else {
      const gid = entry.meta?.garmentId as string | undefined;
      // meta.label is the engine's own short real insight line for this
      // piece (e.g. "Works across relaxed and polished looks"); body is the
      // longer rediscovery explanation, used only if label isn't present.
      const insight = (entry.meta?.label as string | undefined) ?? entry.body ?? "";
      if (gid) rediscoverPieces.push({ garmentId: gid, matchIds: entry.garmentIds, insight });
    }
  }

  // ── Every real ranked combination per register ───────────────────────────
  // intelligence.pairings.bestByRegister already ranks up to 5 real
  // candidates per register by score (the engine's own cap, not a display
  // choice) — kept here in full, unsliced, as the shared source for both the
  // top-2 preview below and the moodboard's diversity selection.
  const allCombosByRegister: Partial<Record<RegisterId, Array<{ id: string; reason: string; garmentIds: string[] }>>> = {};
  for (const register of ["everyday", "work", "occasion"] as const) {
    const all = intelligence.pairings.bestByRegister[register];
    if (all && all.length > 0) {
      allCombosByRegister[register] = all.map((p) => ({ id: p.id, reason: p.reason, garmentIds: p.garmentIds }));
    }
  }

  // ── Top 2 per register, for "How your wardrobe supports your life" ──────
  // A second one reads as a genuine swap rather than one example pair. No
  // new pairing logic — same list moodboardLooks draws from below.
  const bestByRegisterPreview: Partial<Record<RegisterId, Array<{ id: string; reason: string; garmentIds: string[] }>>> = {};
  for (const register of ["everyday", "work", "occasion"] as const) {
    const top = allCombosByRegister[register]?.slice(0, 2);
    if (top) bestByRegisterPreview[register] = top;
  }

  // ── "Your Closet, styled." — a diverse real-look selection ───────────────
  // See selectMoodboardLooks() below: chooses among the real combos above,
  // generates nothing.
  const moodboardLooks = selectMoodboardLooks(allCombosByRegister);

  // ── The real recommendation's structured evidence, for the shopping card ──
  // Same object the title/body already come from — attributes and criteria
  // were already computed, just not threaded to the client before. Only
  // fields that are actually non-null are ever shown; nothing here invents a
  // rise, fabric or colour the engine didn't resolve for this customer.
  const topRecommendation = recommendations.recommendations[0];
  const recommendationDetail = topRecommendation
    ? {
        register: topRecommendation.register,
        attributes: topRecommendation.attributes,
        structure: topRecommendation.criteria.structure,
        coverage: topRecommendation.criteria.coverage,
        resolvingSilhouettes: topRecommendation.criteria.resolvingSilhouettes.map((s) => SILHOUETTE_LABELS[s] ?? s),
        unlocksIds: topRecommendation.unlocksIds,
      }
    : null;

  return data({
    page, garmentCards, glanceRegisters, allRegisterReadings, neutralSharePct,
    enoughCluster, enoughClusters, rediscoverPieces, bestByRegisterPreview, moodboardLooks, recommendationDetail,
  });
}

/**
 * Two real combinations "read" as the same outfit — not two different ways
 * to wear the Closet — when they differ by at most one swapped piece (one
 * garment removed, one added; an identical set counts too, diff 0). A real
 * customer's top-ranked combos are frequently just that: the same anchor
 * pieces with one jean or one trouser swapped. This is one of two tests
 * that decide whether a look earns its own moodboard slot — it never
 * touches which combinations exist or how they're ranked.
 */
function combosReadAsSameOutfit(a: string[], b: string[]): boolean {
  const setA = new Set(a);
  const setB = new Set(b);
  const onlyInA = a.filter((id) => !setB.has(id)).length;
  const onlyInB = b.filter((id) => !setA.has(id)).length;
  return onlyInA + onlyInB <= 2;
}

/**
 * Moodboard V1 diversity selection — presentation only.
 *
 * Chooses which of the engine's ALREADY-RANKED real combinations to show on
 * "Your Closet, styled." It never generates, rescores, or invents a look —
 * every candidate here is a real intelligence.pairings.bestByRegister entry.
 * It round-robins across registers, consuming each register's own real rank
 * order first-to-last (so "best" stays best and a thin register doesn't
 * crowd out a deep one), and rejects a candidate on either of two tests:
 * it reads as the same outfit as one already selected (one swapped piece,
 * see combosReadAsSameOutfit), OR it reuses a garment already anchoring a
 * selected look. That second test is the stronger one in practice: a real
 * Closet's top-ranked combos per register are frequently the SAME blazer or
 * hoodie paired with several different shirts/trousers in turn — each pair
 * can differ by two real pieces and still not pass combosReadAsSameOutfit,
 * yet repeating the same anchor garment across "distinct" hero slots is
 * exactly the repetition this selector exists to prevent. Each garment may
 * anchor at most one selected look. Quality over quantity: stops at
 * `targetCount` (6) or when every register is exhausted of genuinely
 * distinct candidates, whichever comes first. A Closet whose real depth is
 * mostly one or two formulas gets fewer, honestly distinct looks, never
 * padded out to 6 with near-repeats.
 */
function selectMoodboardLooks(
  byRegister: Partial<Record<RegisterId, Array<{ id: string; reason: string; garmentIds: string[] }>>>,
  targetCount = 6,
): Array<{ id: string; register: RegisterId; reason: string; garmentIds: string[] }> {
  const registers = (["everyday", "work", "occasion"] as const).filter((r) => (byRegister[r]?.length ?? 0) > 0);
  const queues: Partial<Record<RegisterId, Array<{ id: string; reason: string; garmentIds: string[] }>>> = {};
  for (const r of registers) queues[r] = [...(byRegister[r] ?? [])];

  const selected: Array<{ id: string; register: RegisterId; reason: string; garmentIds: string[] }> = [];
  const usedCount = new Map<string, number>();

  const fits = (ids: string[]) => ids.every((id) => (usedCount.get(id) ?? 0) < 1);
  const isSameAsSelected = (ids: string[]) => selected.some((s) => combosReadAsSameOutfit(s.garmentIds, ids));

  let progress = true;
  while (selected.length < targetCount && progress) {
    progress = false;
    for (const r of registers) {
      if (selected.length >= targetCount) break;
      const queue = queues[r]!;
      const pickIdx = queue.findIndex((c) => fits(c.garmentIds) && !isSameAsSelected(c.garmentIds));
      if (pickIdx === -1) continue;
      const [chosen] = queue.splice(pickIdx, 1);
      selected.push({ ...chosen, register: r });
      for (const id of chosen.garmentIds) usedCount.set(id, (usedCount.get(id) ?? 0) + 1);
      progress = true;
    }
  }
  return selected;
}

type GarmentCard = {
  id: string; name: string | null; category: string; subcategory: string | null;
  primaryColor: string | null; imageUrl: string | null; hemLength: string | null;
};

const SWATCH: Readonly<Record<string, string>> = {
  black: "#1A1512", white: "#E3DDD2", cream: "#EFE6D8", ivory: "#F2EAD9",
  beige: "#DCCCB6", "off-white": "#F4EFE7", nude: "#E3C9B4", tan: "#C79E74",
  camel: "#B68B5B", taupe: "#B3A294", stone: "#CFC5B8", brown: "#6B4A32",
  grey: "#9A948D", gray: "#9A948D", charcoal: "#3B3835", navy: "#22304A",
  blue: "#3C5A8A", denim: "#4A6685", green: "#3F6140", burgundy: "#5C1E27",
};

function swatchColour(name: string): string {
  return SWATCH[name.toLowerCase()] ?? "#B3A294";
}

function cardLabel(card: GarmentCard | undefined): string {
  if (!card) return "This piece";
  if (card.name && card.name.trim() !== "") return card.name.trim();
  return [card.primaryColor, card.subcategory ?? card.category.toLowerCase()].filter(Boolean).join(" ");
}

/** Strips the recommendation-title verb phrase down to its noun phrase, for
 * compact display (headline card, glance strip). Same transform in both
 * places — one source, not two copies drifting apart. */
function shortRecTitle(title: string | undefined): string {
  return (title ?? "").replace(/^Look for |^One option to explore: /i, "").replace(/\.$/, "");
}

/** A real moodboard combo's `reason` is a genuine engine sentence, not an
 * invented editorial caption — but some run two clauses together. First
 * sentence only, capped, so every card reads at a similar glance-length
 * rather than one running noticeably longer than its neighbours. */
function shortReason(reason: string): string {
  const first = reason.split(/(?<=[.!?])\s+/)[0] ?? reason;
  return first.length > 90 ? `${first.slice(0, 87)}…` : first;
}

/** A plain, real noun for "swap the ___" — derived from the actual changed
 * piece's own category/subcategory, never a fixed label for one customer's
 * items. */
function swapNoun(card: GarmentCard | undefined): string {
  if (!card) return "piece";
  const n = (card.subcategory ?? card.category).toLowerCase();
  if (/jean|denim/.test(card.name ?? "") || /jean/.test(n)) return "jeans";
  if (/trouser|pant/.test(n)) return "trousers";
  if (/skirt/.test(n)) return "skirt";
  if (/dress/.test(n)) return "dress";
  if (/blazer|jacket|coat|cardigan/.test(n)) return "layer";
  if (/shoe|boot|loafer|sneaker|heel|sandal/.test(n)) return "shoes";
  if (/bag|tote|clutch/.test(n)) return "bag";
  if (/top|shirt|blouse|tee|tank|sweater|knit/.test(n)) return "top";
  return n || "piece";
}

function joinWords(words: string[]): string {
  const unique = [...new Set(words)];
  if (unique.length <= 1) return unique[0] ?? "piece";
  return `${unique.slice(0, -1).join(", ")} and ${unique[unique.length - 1]}`;
}

const LEGS_COVERED_POLICY_LINE = 'For this preference, nAia currently checks for full-length pieces.';

/**
 * Context-aware framing for a coverage finding, using only signals that
 * already exist on the real garment/finding: category (activewear reads
 * differently than everyday clothing), a genuine rescuing layer, and the
 * midi length itself (an open policy question, not an asserted failure —
 * see the coverage-semantics spec). No new engine field, no new gating: the
 * SAME set of garments still appears here, only how each one is framed
 * changes. A true "matches your preference" state (for garments that
 * already pass) isn't computed here — only contradictions are surfaced —
 * so that third state isn't shown until that's real.
 */
function coverageContext(reason: string, hasRescue: boolean, category: string | undefined, hemLength: string | null): "may-depend" | "doesnt-match" {
  if (category === "ACTIVEWEAR") return "may-depend";
  if (reason === "keeping your legs covered" && hemLength === "midi") return "may-depend";
  if (hasRescue) return "may-depend";
  return "doesnt-match";
}

/**
 * The per-piece Coverage reason, in her language.
 *
 * midi gets its own, softer framing (styling may still change whether it
 * works) since whether it should qualify is a live, open question — every
 * other insufficient length (mini/knee) reads as a plain, unambiguous fact.
 * Driven entirely by the real `hemLength` value on the real garment —
 * nothing here is specific to one customer or one piece.
 */
function coverageReasonSentence(reason: string, hemLength: string | null): string {
  if (reason === "keeping your legs covered" && hemLength === "midi") {
    return "You usually prefer more leg coverage. This midi length sits outside that preference, but how you style it may change whether it works for you.";
  }
  if (reason === "keeping your legs covered" && (hemLength === "mini" || hemLength === "knee")) {
    return "You usually prefer more leg coverage, and this is shorter than the pieces you typically choose.";
  }
  const plain = reason.replace(/^keeping your /, "").replace(/^avoiding /, "avoiding ");
  return `May not meet your preference for ${plain} on its own.`;
}

function Thumb({ card, height = 220 }: { card: GarmentCard | undefined; height?: number }) {
  if (!card) return null;
  return (
    <div className="wip-thumb" style={{ height }}>
      {card.imageUrl
        ? <img src={card.imageUrl} alt={cardLabel(card)} loading="lazy" />
        : <span className="wip-thumb-fallback">{card.category.slice(0, 2)}</span>}
    </div>
  );
}

/** The one shared evidence-image frame for the four summary cards (lifestyle,
 * repeats, worth adding, skip for now). Height is fixed here, not passed per
 * call site, so it can't drift apart the way the old per-call `height` prop
 * once did. */
function EvidenceThumb({ card }: { card: GarmentCard | undefined }) {
  return <Thumb card={card} height={100} />;
}

function cap(s: string): string {
  return s.length > 0 ? s[0].toUpperCase() + s.slice(1) : s;
}

/**
 * Builds the "Why nAia recommends this" copy entirely from fields the
 * recommendation engine already resolved for this customer — never a fixed
 * sentence. Each clause is independently conditional: a register reading, a
 * silhouette gap, an unlock count and a colour lead may each be present or
 * absent for a different customer/recommendation, and a clause that has
 * nothing to cite is dropped rather than filled in with guessed wording.
 */
function buildWhyNaiaRecommends(input: {
  registerReading: { heading: string; stateText: string } | undefined;
  recTitle: string;
  resolvingSilhouettes: string[];
  unlocksCount: number;
  colourLead: string | undefined;
}): string[] {
  const { registerReading, recTitle, resolvingSilhouettes, unlocksCount, colourLead } = input;
  const sentences: string[] = [];

  if (registerReading) {
    sentences.push(`Your ${registerReading.heading.toLowerCase()} wardrobe has ${registerReading.stateText.toLowerCase()}.`);
  }

  const addsVariety = resolvingSilhouettes.length > 0;
  const worksWithOwned = unlocksCount > 0;
  if (addsVariety && worksWithOwned) {
    sentences.push(`${cap(recTitle)} would add more shape variety and work with ${unlocksCount} piece${unlocksCount === 1 ? "" : "s"} you already own.`);
  } else if (addsVariety) {
    sentences.push(`${cap(recTitle)} would add more shape variety to this register.`);
  } else if (worksWithOwned) {
    sentences.push(`${cap(recTitle)} would work with ${unlocksCount} piece${unlocksCount === 1 ? "" : "s"} you already own.`);
  }

  if (colourLead) {
    sentences.push(`${cap(colourLead)} is one of your preferred colours, but it appears less often in your Closet.`);
  }

  return sentences;
}

// ── Dialog ───────────────────────────────────────────────────────────────────
//
// Every piece of deep or secondary evidence (full compatible-pieces list, a
// specific pairing, a specific work combination, why a recommendation was
// made, Passport alignment, full wardrobe-profile provenance, the full
// per-register breakdown, methodology) lives behind one of these. None of
// them ever replaces the main page — they open on top of it and close back
// to exactly where the reader was.

type DialogState =
  | { kind: "matches"; anchorId: string }
  | { kind: "pair"; anchorId: string; garmentId: string }
  | { kind: "workCombo" }
  | { kind: "moodboardLook"; lookId: string }
  | { kind: "coverage" }
  | { kind: "status" }
  | null;

function DialogShell({
  title, subtitle, onClose, children, className,
}: { title: string; subtitle?: string; onClose: () => void; children: React.ReactNode; className?: string }) {
  return (
    <div className="wip-dialog-backdrop" onClick={onClose}>
      <div
        className={className ? `wip-dialog ${className}` : "wip-dialog"}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="wip-dialog-head">
          <div>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button type="button" className="wip-dialog-close" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="wip-dialog-body">{children}</div>
      </div>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function WardrobeIntelligencePreview() {
  const {
    page, garmentCards, glanceRegisters, allRegisterReadings, neutralSharePct,
    enoughCluster, enoughClusters, rediscoverPieces, bestByRegisterPreview, moodboardLooks, recommendationDetail,
  } = useLoaderData<typeof loader>() as {
    page: WardrobePage; garmentCards: GarmentCard[];
    glanceRegisters: Array<{ heading: string; stateText: string }>;
    allRegisterReadings: Array<{ register: RegisterId; usableCount: number; heading: string; state: DepthState; stateText: string; plain: string }>;
    neutralSharePct: number | null;
    enoughCluster: { title: string; body: string; garmentIds: string[]; count: number } | null;
    enoughClusters: Array<{ title: string; body: string; garmentIds: string[]; count: number }>;
    rediscoverPieces: Array<{ garmentId: string; matchIds: string[]; insight: string }>;
    bestByRegisterPreview: Partial<Record<RegisterId, Array<{ id: string; reason: string; garmentIds: string[] }>>>;
    moodboardLooks: Array<{ id: string; register: RegisterId; reason: string; garmentIds: string[] }>;
    recommendationDetail: {
      register: RegisterId;
      attributes: Array<{ kind: string; values: string[]; label: string; source: string }>;
      structure: string | null;
      coverage: string[];
      resolvingSilhouettes: string[];
      unlocksIds: string[];
    } | null;
  };
  const byId = new Map(garmentCards.map((c) => [c.id, c]));

  // Same locked labels wardrobe-copy.ts already uses for these three real
  // registers — not new vocabulary, just named here too since that constant
  // isn't exported for the client to reuse directly.
  const REGISTER_LABEL: Record<RegisterId, string> = {
    everyday: "Everyday", work: "Work", occasion: "Dinners & events",
  };
  // Same labels COVERAGE_RULES already uses server-side — repeated here only
  // because that map isn't exported, not a new vocabulary.
  const COVERAGE_LABEL: Record<string, string> = {
    "legs-covered": "Full length", "prefer-full-length-trousers": "Full length",
    "arms-covered": "Sleeved", "avoid-sleeveless": "Sleeved",
    "chest-neckline-covered": "Higher neckline", "prefer-higher-necklines": "Higher neckline",
    "longer-tops": "Longer cut", "no-cropped-tops": "Not cropped", "looser-fitting": "Easier fit",
  };
  // A visual encoding of the real categorical depth state — not a fabricated
  // score. The same five states registerDisplay() already returns, just
  // given a relative bar length so "strong" reads as visibly fuller than
  // "needs-range" without inventing a number.
  const DEPTH_FILL: Record<DepthState, number> = {
    strong: 100, "limited-variety": 70, "needs-range": 55, "less-than-it-looks": 35, empty: 15, learning: 0,
  };

  const [dialog, setDialog] = useState<DialogState>(null);
  const [activeMoodRegister, setActiveMoodRegister] = useState<RegisterId | null>(null);
  const [previewStatus, setPreviewStatus] = useState<string | null>(null);
  const [expandedWhy, setExpandedWhy] = useState<Set<string>>(new Set());

  // ── Real data, read from the same page model the live route renders ──────
  const wear = page.sections.find((s) => s.id === "wear");
  const attention = page.sections.find((s) => s.id === "attention");
  const shop = page.sections.find((s) => s.id === "shop");
  const profileSection = page.sections.find((s) => s.id === "profile");

  const waysEntries = wear?.blocks.find((b) => b.id === "ways-to-get-dressed")?.entries ?? [];
  const workFinding = attention?.blocks.find((b) => b.kind === "findings")?.entries[0];
  // The finding's own claim key ("depth-gap:work") names which real register
  // it's about — read from it rather than assuming "work", so this is never
  // wrong for a customer whose strongest finding is elsewhere.
  const attentionRegister = (workFinding?.claim.match(/^depth-gap:(\w+)/)?.[1] as RegisterId | undefined);
  const attentionCombo = attentionRegister ? waysEntries.find((e) => e.id === `explore-${attentionRegister}`) : undefined;
  const coverage = attention?.blocks.find((b) => b.kind === "coverage")?.entries[0];
  const lowPriority = shop?.blocks.find((b) => b.id === "low-priority")?.entries[0];
  const worthConsidering = shop?.blocks.find((b) => b.id === "worth-considering")?.entries[0];
  const profileBlock = profileSection?.blocks.find((b) => b.id === "profile");

  const paletteRows = (profileBlock?.meta?.palette ?? []) as Array<{ colour: string; count: number; share: number }>;
  const shapeChips = (profileBlock?.meta?.shapes ?? []) as Array<{ label: string; count: number }>;
  const summaryLines = (profileBlock?.meta?.summaryLines ?? []) as string[];
  const profileEntries = (profileBlock?.entries ?? []).filter((e) => e.id !== "closet-capability" && !e.id.startsWith("hero-"));

  const blockedDetail = (coverage?.meta?.blockedDetail ?? []) as Array<{
    garmentId: string; name: string; reason: string; layers: string[];
  }>;

  const recColourAttr = recommendationDetail?.attributes.find((a) => a.kind === "colour");
  // colourAttr.label is already the single LEAD colour (the one she owns
  // least of among her stated favourites) and .values is [lead,
  // ...alternatives] in that same order — the engine already separates
  // these; this just stops flattening them into one line that reads as
  // though all three were equally "best fit".
  const recColourLead = recColourAttr?.label;
  const recColourAlternatives = recColourAttr?.values.slice(1) ?? [];
  // Only real, non-null evidence becomes a bullet — rise and fabric aren't
  // derivable at all today (no such field exists anywhere in the engine),
  // so they're never shown, never guessed.
  const recBullets = [
    ...(recommendationDetail?.coverage ?? []).map((c) => COVERAGE_LABEL[c]).filter((v, i, a) => v && a.indexOf(v) === i),
    ...(recommendationDetail?.resolvingSilhouettes ?? []),
    ...(recommendationDetail?.structure ? [recommendationDetail.structure === "structured" ? "Structured" : "Fluid"] : []),
  ];
  const recTitle = (worthConsidering?.title ?? "").replace(/^Look for |\.$/g, "");
  // Built entirely from fields the engine already resolved for this
  // customer — see buildWhyNaiaRecommends(). A clause with nothing to cite
  // is dropped, never filled in with guessed wording.
  const whyNaiaLines = buildWhyNaiaRecommends({
    registerReading: allRegisterReadings.find((r) => r.register === recommendationDetail?.register),
    recTitle,
    resolvingSilhouettes: recommendationDetail?.resolvingSilhouettes ?? [],
    unlocksCount: recommendationDetail?.unlocksIds.length ?? 0,
    colourLead: recColourLead,
  });

  function closeDialog() { setDialog(null); }
  function toggleWhy(id: string) {
    setExpandedWhy((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function renderDialog() {
    if (!dialog) return null;
    if (dialog.kind === "matches") {
      const piece = rediscoverPieces.find((p) => p.garmentId === dialog.anchorId);
      if (!piece) return null;
      const anchor = byId.get(piece.garmentId);
      return (
        <DialogShell
          title={`${piece.matchIds.length} compatible pieces.`}
          subtitle={`Potential matches for your ${cardLabel(anchor).toLowerCase()}.`}
          onClose={closeDialog}
          className="wip-dialog--matches"
        >
          <div className="wip-match-grid">
            {piece.matchIds.map((id) => {
              const card = byId.get(id);
              return (
                <button key={id} type="button" className="wip-match-tile" onClick={() => setDialog({ kind: "pair", anchorId: piece.garmentId, garmentId: id })}>
                  <Thumb card={card} height={92} />
                  <p>{cardLabel(card)}</p>
                </button>
              );
            })}
          </div>
          <p className="wip-dialog-note">Each piece is shown once — choose one to see it paired.</p>
        </DialogShell>
      );
    }
    if (dialog.kind === "pair") {
      const piece = rediscoverPieces.find((p) => p.garmentId === dialog.anchorId);
      const anchor = byId.get(dialog.anchorId);
      const card = byId.get(dialog.garmentId);
      return (
        <DialogShell title="Try these together." subtitle="A potential pairing from the resolved matching results." onClose={closeDialog}>
          <div className="wip-pair">
            <div><Thumb card={anchor} height={230} /><p>{cardLabel(anchor)}</p></div>
            <div><Thumb card={card} height={230} /><p>{cardLabel(card)}</p></div>
          </div>
          <p className="wip-dialog-note">A good starting point — add shoes and finishing pieces to complete the look.</p>
          {piece && (
            <button type="button" className="wip-link" onClick={() => setDialog({ kind: "matches", anchorId: dialog.anchorId })}>← View all {piece.matchIds.length} matches</button>
          )}
        </DialogShell>
      );
    }
    if (dialog.kind === "workCombo" && attentionCombo) {
      return (
        <DialogShell title="An existing work combination." subtitle="Start with the pieces you already own." onClose={closeDialog}>
          <div className="wip-match-grid" style={{ gridTemplateColumns: `repeat(${attentionCombo.garmentIds.length}, minmax(0,1fr))` }}>
            {attentionCombo.garmentIds.map((id) => {
              const card = byId.get(id);
              return <div key={id} className="wip-match-tile"><Thumb card={card} height={170} /><p>{cardLabel(card)}</p></div>;
            })}
          </div>
          <p className="wip-combo-text">{attentionCombo.body}</p>
          <p className="wip-dialog-note">Add shoes and finishing pieces to complete the look.</p>
        </DialogShell>
      );
    }
    if (dialog.kind === "moodboardLook") {
      const look = moodboardLooks.find((l) => l.id === dialog.lookId);
      if (!look) return null;
      return (
        <DialogShell title={`A ${REGISTER_LABEL[look.register].toLowerCase()} look.`} subtitle="A real combination from what you already own." onClose={closeDialog}>
          <div className="wip-match-grid" style={{ gridTemplateColumns: `repeat(${look.garmentIds.length}, minmax(0,1fr))` }}>
            {look.garmentIds.map((id) => {
              const card = byId.get(id);
              return <div key={id} className="wip-match-tile"><Thumb card={card} height={170} /><p>{cardLabel(card)}</p></div>;
            })}
          </div>
          <p className="wip-combo-text">{look.reason}</p>
          <a className="wip-link" href="/style-me">Style this look in StyleMe →</a>
        </DialogShell>
      );
    }
    if (dialog.kind === "coverage" && coverage) {
      return (
        <DialogShell title="How your wardrobe matches your preferences." subtitle="nAia looks at pieces in context — including what they&rsquo;re for, whether they&rsquo;re layered, and how you might wear them." onClose={closeDialog}>
          {blockedDetail.some((b) => b.reason === "keeping your legs covered") && (
            <>
              <button type="button" className="wip-link" onClick={() => toggleWhy("coverage-policy")}>
                {expandedWhy.has("coverage-policy") ? "Hide" : "How is this checked?"}
              </button>
              {expandedWhy.has("coverage-policy") && <p className="wip-coverage-policy">{LEGS_COVERED_POLICY_LINE}</p>}
            </>
          )}
          <div className="wip-coverage-list">
            {blockedDetail.map((b) => {
              const card = byId.get(b.garmentId);
              const state = coverageContext(b.reason, b.layers.length > 0, card?.category, card?.hemLength ?? null);
              return (
                <div key={b.garmentId} className="wip-coverage-item">
                  <Thumb card={card} height={140} />
                  <div className="wip-coverage-item-text">
                    <span className={`wip-coverage-state wip-coverage-state--${state}`}>
                      {state === "may-depend" ? "May depend on how you wear it" : "Outside your usual preference"}
                    </span>
                    <h3>{b.name}</h3>
                    <p>
                      {card?.category === "ACTIVEWEAR"
                        ? "You've tagged this as activewear, so your everyday coverage preference may not apply in the same way."
                        : coverageReasonSentence(b.reason, card?.hemLength ?? null)}
                    </p>
                    {b.layers.length > 0 && <p className="wip-coverage-rescue">Worn with your {b.layers[0]}, it could still work.</p>}
                  </div>
                </div>
              );
            })}
          </div>
        </DialogShell>
      );
    }
    if (dialog.kind === "status") {
      return (
        <DialogShell title="How much have you added?" subtitle="This changes how confidently a finding can discuss what's missing." onClose={closeDialog}>
          <div className="wip-status-options">
            <button type="button" className="wip-status-choice" onClick={() => { setPreviewStatus("Most of my wardrobe added"); closeDialog(); }}>
              <b>Yes, most of my wardrobe</b>
              <span>The added pieces represent most of what I currently wear.</span>
            </button>
            <button type="button" className="wip-status-choice" onClick={() => { setPreviewStatus("Still adding pieces"); closeDialog(); }}>
              <b>I&rsquo;m still adding pieces</b>
              <span>Some useful pieces may not be in my digital Closet yet.</span>
            </button>
          </div>
          <p className="wip-dialog-note">Preview interaction only. This choice is local to this session and does not recalculate the findings shown here.</p>
        </DialogShell>
      );
    }
    return null;
  }

  if (rediscoverPieces.length === 0) {
    // No dynamic rediscovery candidate for this Closet — the preview has
    // nothing honest to lead with. Real state, not an error.
    return (
      <MyNaiaLayout compact>
        <style>{css}</style>
        <div className="wip-app">
          <main className="wip-main">
            <p className="wip-empty">
              Nothing to preview yet — this Closet doesn&rsquo;t currently have a &ldquo;piece worth
              rediscovering&rdquo; finding to lead with.
            </p>
          </main>
        </div>
      </MyNaiaLayout>
    );
  }

  return (
    <MyNaiaLayout compact>
      <style>{css}</style>
      <div className="wip-app">
        <main className="wip-main">
          <p className="wip-eyebrow">My nAia / Wardrobe Intelligence</p>
          <div className="wip-hero">
            <header className="wip-header">
              <h1 className="wip-h1">Your wardrobe, <em className="sp-shell-accent">understood.</em></h1>
              <div className="wip-status">
                <button type="button" className="wip-link" onClick={() => setDialog({ kind: "status" })}>
                  {previewStatus ? `${previewStatus} ↗` : "Is your Closet up to date? →"}
                </button>
              </div>
            </header>
            <div className="wip-summary-row">
              <p className="wip-summary">
                nAia&rsquo;s perspective on what you own, how you wear it, and where to focus next.{" "}
                {page.reading ?? "Find more in what you own. See what deserves your attention."}
              </p>
              {/* Only a real stat is shown — the engine has no "possible
                  outfits" or "Passport match %" metric, so those are omitted
                  rather than approximated. */}
              <div className="wip-hero-stats">
                <div className="wip-hero-stat">
                  <strong>{garmentCards.length}</strong>
                  <span>Pieces in closet</span>
                </div>
              </div>
            </div>

            {/* ── Section 1: 3 headline insights — clearly subordinate to the
                H1 above, not competing with it ──────────────────────────── */}
            <div className="wip-cards">
              {glanceRegisters[0] && (
                <div className="wip-card">
                  <span className="wip-card-kicker wip-card-kicker--positive">Strongest</span>
                  <h3>{glanceRegisters[0].heading} wardrobe</h3>
                  <p>{glanceRegisters[0].stateText}</p>
                </div>
              )}
              {glanceRegisters[1] && (
                <div className="wip-card">
                  <span className="wip-card-kicker">Needs attention</span>
                  <h3>{glanceRegisters[1].heading} wardrobe</h3>
                  <p>{glanceRegisters[1].stateText}</p>
                </div>
              )}
              {(worthConsidering || lowPriority) && (
                <div className="wip-card">
                  <span className="wip-card-kicker wip-card-kicker--positive">Best next move</span>
                  <h3>{worthConsidering ? shortRecTitle(worthConsidering.title) : lowPriority!.title}</h3>
                  {recColourLead && <p>Best colour: {recColourLead[0].toUpperCase()}{recColourLead.slice(1)}</p>}
                </div>
              )}
            </div>
          </div>

          {/* ── Section 2: Style Passport summary ────────────────────────────
              Lovable's horizontal summary-card shell, populated only with
              real findings. No percentage: the engine has no Passport-match
              score, so that half of the reference card is replaced with a
              real qualitative takeaway instead of an invented number. ──── */}
          {coverage && (() => {
            // Same count the sentence below already states (blockedDetail.length) —
            // previously this used a narrower "may-depend only" filter, producing a
            // different number (e.g. "4") than the sentence's total (e.g. "Six"),
            // which read as two conflicting counts for the same finding.
            const closerLookCount = blockedDetail.length;
            const takeaway = summaryLines.find((l) => /colour|color/i.test(l)) ?? summaryLines[0] ?? null;
            if (!takeaway && !coverage.body) return null;
            return (
              <section className="wip-card-shell wip-passport-card">
                <div className="wip-passport-col">
                  <span className="wip-eyebrow-accent">Style Passport</span>
                  {takeaway && <p className="wip-passport-takeaway">{takeaway}</p>}
                </div>
                <div className="wip-passport-divider" />
                <div className="wip-passport-col">
                  {closerLookCount > 0 && <p className="wip-passport-count">{closerLookCount} {closerLookCount === 1 ? "piece needs" : "pieces need"} a closer look</p>}
                  <p className="wip-passport-body">{coverage.body}</p>
                  <button type="button" className="wip-link" onClick={() => setDialog({ kind: "coverage" })}>See which →</button>
                </div>
              </section>
            );
          })()}

          {/* ── Section 3: what your wardrobe looks like ─────────────────────
              Segmented colour bar sized by each colour's real share, plus
              real silhouette chips — the same real palette/shape data the
              deeper profile dialog draws from, just surfaced here too. ──── */}
          {profileBlock && (paletteRows.length > 0 || shapeChips.length > 0) && (
            <section className="wip-section">
              <h2 className="wip-section-title">What your wardrobe looks like.</h2>
              <div className="wip-card-shell wip-looks-card">
                {neutralSharePct !== null && neutralSharePct >= 40 && (
                  <p className="wip-looks-headline">{neutralSharePct}% of your pieces are warm neutrals — easy to combine, though outfits can start to feel similar.</p>
                )}
                {paletteRows.length > 0 && (
                  <div className="wip-colour-bar">
                    {paletteRows.map((c) => (
                      <span key={c.colour} style={{ width: `${Math.max(c.share * 100, 2)}%`, background: swatchColour(c.colour) }} />
                    ))}
                  </div>
                )}
                <div className="wip-looks-legend-row">
                  {paletteRows.length > 0 && (
                    <div className="wip-legend">
                      {paletteRows.map((c) => (
                        <span key={c.colour} className="wip-legend-item">
                          <span className="wip-legend-dot" style={{ background: swatchColour(c.colour) }} />
                          {c.colour} <em>{c.count}</em>
                        </span>
                      ))}
                    </div>
                  )}
                  {shapeChips.length > 0 && (
                    <div className="wip-silhouette-group">
                      <span className="wip-eyebrow-accent">Silhouettes</span>
                      <div className="wip-chips">
                        {shapeChips.map((s) => <span key={s.label} className="wip-chip">{s.label} · {s.count}</span>)}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </section>
          )}

          {/* ── Section 3b: what nAia has learned — inline, replaces the old
              "See details →" modal. Same four concise sections built from
              the same real summaryLines/profileEntries/glanceRegisters data
              the modal used; the feedback section only renders when real
              feedback exists. ──────────────────────────────────────────── */}
          {profileBlock && (() => {
            const patternLines = [summaryLines[0], summaryLines[1]].filter((l): l is string => Boolean(l));
            const styleLines = [
              summaryLines[2],
              profileEntries.find((e) => e.id === "intentions-chosen")?.body,
            ].filter((l): l is string => Boolean(l));
            const feedbackBody = profileEntries.find((e) => e.id === "outcome-feedback")?.body;
            const supportSentence = glanceRegisters[0]
              ? `Your current Closet gives you the strongest support for ${glanceRegisters[0].heading.toLowerCase()} dressing` +
                (glanceRegisters[1] ? `, with fewer combinations for ${glanceRegisters[1].heading.toLowerCase()}.` : ".")
              : null;
            if (patternLines.length === 0 && styleLines.length === 0 && !feedbackBody && !supportSentence) return null;
            return (
              <section className="wip-section">
                <h2 className="wip-section-title">What nAia has learned about your wardrobe.</h2>
                <div className="wip-card-shell">
                  {patternLines.length > 0 && (
                    <div className="wip-profile-block">
                      <h3>Your wardrobe pattern</h3>
                      <p>{patternLines.join(" ")}</p>
                    </div>
                  )}
                  {styleLines.length > 0 && (
                    <div className="wip-profile-block">
                      <h3>How you tend to style</h3>
                      <p>{styleLines.join(" ")}</p>
                    </div>
                  )}
                  {feedbackBody && (
                    <div className="wip-profile-block">
                      <h3>What nAia is learning from your feedback</h3>
                      <p>{feedbackBody}</p>
                    </div>
                  )}
                  {supportSentence && (
                    <div className="wip-profile-block">
                      <h3>What your Closet can support</h3>
                      <p>{supportSentence}</p>
                    </div>
                  )}
                </div>
              </section>
            );
          })()}

          {/* ── Section 4: Your Closet, styled (Moodboard V1) — visual hero ─── */}
          {moodboardLooks.length > 0 && (() => {
            const registersPresent = (["everyday", "work", "occasion"] as const).filter((r) => moodboardLooks.some((l) => l.register === r));
            const active = activeMoodRegister && registersPresent.includes(activeMoodRegister) ? activeMoodRegister : registersPresent[0];
            const shown = moodboardLooks.filter((l) => l.register === active);
            const tabCounts = new Map(registersPresent.map((r) => [r, moodboardLooks.filter((l) => l.register === r).length] as const));
            // A "1" next to every tab says nothing a customer can use — only
            // show counts at all when they actually vary across tabs.
            const showTabCounts = [...tabCounts.values()].some((n) => n !== 1);
            return (
              <section className="wip-section wip-section--hero">
                <div className="wip-mood-head">
                  <div>
                    <h2 className="wip-section-title">Your Closet, styled.</h2>
                    <p className="wip-section-sub">Looks built only from what you already own.</p>
                  </div>
                  {/* Real registers with real counts only — no Travel/Wedding
                      tabs (no such register exists in the engine today) and
                      no "By mood" toggle (no mood grouping exists). */}
                  <div className="wip-mood-tabs">
                    {registersPresent.map((r) => (
                      <button
                        key={r}
                        type="button"
                        className={`wip-mood-tab${r === active ? " is-active" : ""}`}
                        onClick={() => setActiveMoodRegister(r)}
                      >
                        {REGISTER_LABEL[r]} {showTabCounts && <span>{tabCounts.get(r)}</span>}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="wip-mood-grid" style={{ "--mood-cols": shown.length >= 5 ? 3 : shown.length === 4 ? 2 : shown.length } as React.CSSProperties}>
                  {shown.map((look, i) => (
                    <button key={look.id} type="button" className="wip-mood-tile" onClick={() => setDialog({ kind: "moodboardLook", lookId: look.id })}>
                      <div className={`wip-mood-collage wip-mood-collage--n${Math.min(look.garmentIds.length, 4)}`}>
                        {look.garmentIds.map((id) => <Thumb key={id} card={byId.get(id)} height={140} />)}
                      </div>
                      <div className="wip-mood-card-body">
                        <span className="wip-mood-meta">{String(i + 1).padStart(2, "0")} · {REGISTER_LABEL[look.register]}</span>
                        <p className="wip-mood-reason">{shortReason(look.reason)}</p>
                        <div className="wip-mood-chips">
                          {look.garmentIds.map((id) => <span key={id} className="wip-chip">{cardLabel(byId.get(id))}</span>)}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </section>
            );
          })()}

          {/* ── Section 5: pieces worth rediscovering ──────────────────────── */}
          <section className="wip-section">
            <h2 className="wip-section-title">Pieces worth rediscovering.</h2>
            <p className="wip-section-sub">You have more ways to wear these than you think.</p>
            <div className="wip-piece-grid">
              {rediscoverPieces.slice(0, 3).map((piece) => {
                const card = byId.get(piece.garmentId);
                return (
                  <div key={piece.garmentId} className="wip-piece-card">
                    <div className="wip-piece-thumb"><Thumb card={card} height={170} /></div>
                    <h3>{cardLabel(card)}</h3>
                    {piece.insight && <p>{piece.insight}</p>}
                    <div className="wip-piece-actions">
                      <a className="wip-link" href="/style-me">Style this in StyleMe →</a>
                      {piece.matchIds.length > 0 && (
                        <button type="button" className="wip-link wip-link--secondary" onClick={() => setDialog({ kind: "matches", anchorId: piece.garmentId })}>
                          See {piece.matchIds.length} compatible pieces
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {/* ── Section 6: two-column analysis ─────────────────────────────── */}
          <section className="wip-section wip-analysis">
            <div className="wip-paired-grid">
            {allRegisterReadings.length > 0 && (
            <div className="wip-analysis-col">
              <h2 className="wip-section-title">How your wardrobe supports your life.</h2>
              <div className="wip-card-shell wip-paired-card wip-analysis-card">
              {(["everyday", "work", "occasion"] as const).map((register) => {
                const reading = allRegisterReadings.find((r) => r.register === register);
                if (!reading) return null;
                const combos = bestByRegisterPreview[register] ?? [];
                const interpretation = (register === "work" && reading.plain === "You own a lot that reads this way, but their combinations tend to repeat the same formula."
                  ? "You have enough work pieces, but many of your combinations repeat the same formula."
                  : reading.plain)
                  || (reading.state === "strong" && reading.usableCount > 0
                    ? `You have ${reading.usableCount} ${REGISTER_LABEL[register].toLowerCase()} pieces with plenty of ways to combine them.`
                    : "");
                const primary = combos[0];
                const secondary = combos[1];
                const sharedIds = secondary ? primary.garmentIds.filter((id) => secondary.garmentIds.includes(id)) : [];
                const changedIds = secondary ? secondary.garmentIds.filter((id) => !sharedIds.includes(id)) : [];
                const isSwap = secondary !== undefined && sharedIds.length > 0 && changedIds.length > 0;
                const isDistinctLook = secondary !== undefined && sharedIds.length === 0 && changedIds.length > 0;
                return (
                  <div key={register} className="wip-life-row">
                    <div className="wip-life-main">
                      <div className="wip-life-heading">
                        <h3>{REGISTER_LABEL[register]}</h3>
                        <span className="wip-life-state">{reading.stateText}</span>
                        <span className="wip-life-count">{reading.usableCount} usable pieces</span>
                      </div>
                      <div className="wip-life-bar"><div className="wip-life-bar-fill" style={{ width: `${DEPTH_FILL[reading.state]}%` }} /></div>
                      <p className="wip-life-text">{interpretation}</p>
                      {register === attentionRegister && attentionCombo && (
                        <button type="button" className="wip-link" onClick={() => setDialog({ kind: "workCombo" })}>View this combination →</button>
                      )}
                    </div>
                    {primary && (() => {
                      // Evidence tier: max 3 thumbnails per row. The swap/
                      // distinct-look piece (if any) always gets a slot;
                      // the rest come from the primary combo.
                      const extra = isSwap ? changedIds.slice(0, 1) : isDistinctLook ? secondary!.garmentIds.slice(0, 1) : [];
                      const lifeLookIds = [...primary.garmentIds.slice(0, 3 - extra.length), ...extra];
                      return (
                        <div className="wip-evidence-row">
                          {lifeLookIds.map((id) => <EvidenceThumb key={id} card={byId.get(id)} />)}
                        </div>
                      );
                    })()}
                  </div>
                );
              })}
              </div>
            </div>
            )}

            {enoughClusters.length > 0 && (
            <div className="wip-analysis-col">
              <h2 className="wip-section-title">Where your wardrobe repeats.</h2>
              <div className="wip-card-shell wip-paired-card wip-analysis-card">
              {/* Summary card, not an unlimited report: the strongest finding
                  gets the full treatment (body + evidence); up to 2 further
                  qualifying clusters (same engine output, same slice(0,3) —
                  nothing about which clusters qualify changes) are named in
                  a compact one-line summary instead of repeating the full
                  body/evidence presentation for each, so the card stays
                  bounded regardless of how many real clusters exist. */}
              {(() => {
                const [primary, ...more] = enoughClusters;
                return (
                  <>
                    <div className="wip-repeat-card">
                      <h3>{primary.title}</h3>
                      <p>{primary.body}</p>
                      {primary.garmentIds.length > 0 && (
                        <div className="wip-evidence-row">
                          {primary.garmentIds.slice(0, 5).map((id) => <EvidenceThumb key={id} card={byId.get(id)} />)}
                        </div>
                      )}
                    </div>
                    {more.length > 0 && (
                      <div className="wip-repeat-more">
                        {more.map((c) => (
                          <div key={c.title} className="wip-repeat-more-item">
                            <span className="wip-repeat-more-title">{c.title}</span>
                            <span className="wip-repeat-more-count">{c.count} pieces</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                );
              })()}
              </div>
            </div>
            )}
            </div>
          </section>

          {/* ── Section 7: shop smarter ─────────────────────────────────────── */}
          {(worthConsidering || lowPriority) && (
            <section className="wip-section">
              <h2 className="wip-section-title">Shop smarter.</h2>
              <div className="wip-paired-grid">
                {worthConsidering && (
                  <div className="wip-card-shell wip-paired-card wip-shop-col">
                    <span className="wip-shop-col-label wip-shop-col-label--buy">Worth adding</span>
                    <h3>{recTitle}</h3>
                    {(recBullets.length > 0 || recColourLead) && (
                      <ul>
                        {recBullets.map((b) => <li key={b}>{b}</li>)}
                        {recColourLead && <li>Best colour: {recColourLead[0].toUpperCase()}{recColourLead.slice(1)}</li>}
                        {recColourAlternatives.length > 0 && (
                          <li>Also within your palette: {recColourAlternatives.map((c) => c[0].toUpperCase() + c.slice(1)).join(", ")}</li>
                        )}
                      </ul>
                    )}
                    {worthConsidering.garmentIds.length > 0 && (
                      <>
                        <p className="wip-shop-evidence-label">Works with pieces you own</p>
                        <div className="wip-evidence-row">
                          {worthConsidering.garmentIds.slice(0, 4).map((id) => <EvidenceThumb key={id} card={byId.get(id)} />)}
                        </div>
                      </>
                    )}
                    {whyNaiaLines.length > 0 && (
                      <div className="wip-shop-why">
                        <span className="wip-shop-why-label">Why nAia recommends this</span>
                        <p>{whyNaiaLines.join(" ")}</p>
                      </div>
                    )}
                  </div>
                )}
                {lowPriority && (
                  <div className="wip-card-shell wip-paired-card wip-shop-col">
                    <span className="wip-shop-col-label">Skip for now</span>
                    <h3>{(lowPriority.title ?? "").replace(/^Another (similar |of your )?/i, "Another ")}</h3>
                    <p>{enoughCluster?.body ?? lowPriority.body}</p>
                    {enoughCluster && enoughCluster.garmentIds.length > 0 && (
                      <>
                        <p className="wip-shop-evidence-label">Similar pieces you own</p>
                        <div className="wip-evidence-row">
                          {enoughCluster.garmentIds.slice(0, 4).map((id) => <EvidenceThumb key={id} card={byId.get(id)} />)}
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            </section>
          )}

          <section className="wip-section wip-method">
            <h2 className="wip-section-title">How nAia works this out.</h2>
            <p className="wip-method-body">
              Wardrobe Intelligence looks at the pieces you&rsquo;ve added to your Closet, your Style Passport, and
              how your wardrobe works together to surface patterns, possibilities and useful next steps.
            </p>
            <p className="wip-method-body">
              As you add more pieces to your Closet, nAia gets a clearer picture of your wardrobe and where it
              can help most.
            </p>
            <p className="wip-legal">nAia only works with the wardrobe and preference information you choose to share.</p>
          </section>
        </main>
      </div>
      {renderDialog()}
    </MyNaiaLayout>
  );
}

const css = `
  /* Route-scoped override of the shared MyNaiaLayout body shell. The large
     gap before the footer is NOT this route's own padding — it's
     .mn-body's own padding-bottom:8rem (128px desktop / 6rem mobile),
     baked into naia-design-system.css and shared by every My nAia page.
     .wip-main only ever contributed its own 24px on top of that. Scoped
     with :has(.wip-app) so this never touches .mn-body on any other
     page — not a global change to the shared layout. */
  .mn-body.mn-body--compact:has(.wip-app){padding-bottom:2rem}

  .wip-app{max-width:1180px;margin:0 auto}
  .wip-main{padding:8px 0 24px}
  .wip-eyebrow{font-family:var(--naia-ff-ui);font-size:9px;letter-spacing:2.5px;text-transform:uppercase;color:rgba(40,21,12,0.5);margin:0 0 14px}

  /* Hero: headline, full width, dominant — summary below it, then the 3
     headline cards below that as a clearly subordinate summary layer. Never
     squeezed beside the H1, so nothing competes with it for attention. */
  .wip-hero{display:block}
  .wip-header{display:flex;align-items:flex-start;justify-content:space-between;gap:20px;flex-wrap:wrap}
  /* Matches sp-shell-title's own breakpoints (2rem/3rem/4.25rem) — the H1
     must read as the same scale of title as every other major nAia page,
     unmistakably larger than every section heading below it. */
  .wip-h1{font-family:var(--naia-ff-display);font-weight:200;font-size:2rem;letter-spacing:0.01em;text-transform:uppercase;line-height:1.05;margin:0}
  @media(min-width:640px){.wip-h1{font-size:3rem}}
  @media(min-width:1024px){.wip-h1{font-size:4.25rem}}
  .wip-h1 em{font-family:var(--naia-ff-body);font-style:italic;text-transform:none}
  .wip-status{padding-top:6px}
  .wip-link{border:0;background:none;padding:0;font-family:var(--naia-ff-ui);font-size:11.5px;color:var(--naia-accent);text-decoration:underline;text-underline-offset:3px;cursor:pointer}
  .wip-link--secondary{color:rgba(40,21,12,0.55)}
  .wip-summary{font-family:var(--naia-ff-ui);font-size:14px;line-height:1.6;color:rgba(40,21,12,0.72);margin:14px 0 0;max-width:620px}
  .wip-summary-row{display:flex;align-items:flex-end;justify-content:space-between;gap:24px;flex-wrap:wrap}
  .wip-hero-stats{display:flex;gap:28px;flex-shrink:0}
  .wip-hero-stat{display:flex;flex-direction:column;align-items:flex-end;text-align:right}
  .wip-hero-stat strong{font-family:var(--naia-ff-display);font-weight:300;font-size:2rem;color:var(--naia-ink);line-height:1}
  .wip-hero-stat span{font-family:var(--naia-ff-ui);font-size:9.5px;letter-spacing:1.4px;text-transform:uppercase;color:rgba(40,21,12,0.5);margin-top:4px}

  .wip-cards{display:flex;flex-wrap:wrap;margin-top:28px;padding-top:20px;border-top:1px solid var(--naia-border)}
  .wip-card{padding:0 30px;min-width:150px}
  .wip-card:first-child{padding-left:0}
  .wip-card + .wip-card{border-left:1px solid var(--naia-border)}
  .wip-card-kicker{display:block;font-family:var(--naia-ff-ui);font-size:9.5px;letter-spacing:1.6px;text-transform:uppercase;font-weight:700;color:rgba(40,21,12,0.5)}
  .wip-card-kicker--positive{color:var(--naia-accent)}
  .wip-card h3{font-family:var(--naia-ff-ui);font-weight:600;font-size:13.5px;line-height:1.3;margin:8px 0 4px;color:var(--naia-ink)}
  .wip-card p{font-family:var(--naia-ff-ui);font-size:11px;color:rgba(40,21,12,0.6);margin:0}
  @media(max-width:520px){
    .wip-cards{flex-direction:column;gap:14px}
    .wip-card{padding:0}
    .wip-card + .wip-card{border-left:0;border-top:1px solid var(--naia-border);padding-top:14px}
  }

  .wip-section{margin:0;padding:30px 0 0;border-top:1px solid var(--naia-border)}
  .wip-hero + .wip-section{border-top:0;padding-top:36px}
  /* ONE shared section-heading style — every main WI heading below the
     hero (What your wardrobe looks like / Your Closet, styled / Pieces
     worth rediscovering / How your wardrobe supports your life / Where
     your wardrobe repeats / Shop smarter / How nAia works this out) uses
     this exact rule, with no per-section size/weight/opacity override.
     Previously two modifiers (--hero, --quiet) made three different
     title treatments; "Shop smarter." being visibly smaller than its
     siblings was that inconsistency, not a one-off to patch. */
  .wip-section-title{font-family:var(--naia-ff-display);font-weight:300;font-size:1.5rem;line-height:1.25;letter-spacing:0;margin:0 0 6px;color:var(--naia-ink)}
  .wip-section-sub{font-family:var(--naia-ff-ui);font-size:12.5px;color:rgba(40,21,12,0.55);margin:0 0 18px}
  .wip-section-more{display:block;margin-top:14px}
  .wip-eyebrow-accent{display:block;font-family:var(--naia-ff-ui);font-size:9.5px;letter-spacing:1.8px;text-transform:uppercase;font-weight:700;color:var(--naia-accent);margin:0 0 10px}

  /* ONE shared card shell — Style Passport, What your wardrobe looks
     like, How your wardrobe supports your life, Where your wardrobe
     repeats, and both Shop smarter cards all use this exact visual
     treatment (border radius, border, background, internal padding).
     Each specific class below carries ONLY its own layout (grid
     columns, gap, max-width) — never a second copy of the shell
     properties that could drift from this one. The moodboard is the
     one deliberate exception, per its own editorial-plate treatment. */
  .wip-card-shell{background:var(--naia-surface);border:1px solid var(--naia-border);border-radius:8px;padding:26px 30px}
  @media(max-width:700px){.wip-card-shell{padding:20px}}

  /* Style Passport summary — one horizontal card, split in two: the real
     takeaway on the left, supporting detail + the "See which" link on the
     right. A divider (not a border around each half) keeps it reading as
     one card with two halves, not two separate cards. */
  .wip-passport-card{display:grid;grid-template-columns:1fr 1fr;gap:32px;margin-top:30px}
  @media(max-width:700px){.wip-passport-card{grid-template-columns:1fr;gap:16px}}
  .wip-passport-col{min-width:0}
  .wip-passport-divider{display:none}
  .wip-passport-takeaway{font-family:var(--naia-ff-ui);font-weight:600;font-size:15px;line-height:1.5;color:var(--naia-ink);margin:0}
  .wip-passport-count{font-family:var(--naia-ff-ui);font-size:11px;font-weight:600;color:var(--naia-accent);margin:0 0 6px}
  .wip-passport-body{font-family:var(--naia-ff-ui);font-size:12.5px;line-height:1.6;color:rgba(40,21,12,0.65);margin:0 0 10px}

  /* What your wardrobe looks like — a segmented proportional colour bar
     (each piece's real share as its width) instead of a row of equal
     circular swatches, plus the existing silhouette chips alongside it. */
  .wip-looks-headline{font-family:var(--naia-ff-ui);font-weight:600;font-size:13.5px;line-height:1.5;color:var(--naia-ink);margin:0 0 14px}
  .wip-colour-bar{display:flex;width:100%;height:14px;border-radius:7px;overflow:hidden;background:var(--naia-muted-bg)}
  .wip-colour-bar span{display:block;height:100%}
  .wip-looks-legend-row{display:flex;justify-content:space-between;align-items:flex-start;gap:24px;flex-wrap:wrap;margin-top:16px}
  .wip-legend{display:flex;flex-wrap:wrap;gap:12px 18px}
  .wip-legend-item{display:flex;align-items:center;gap:6px;font-family:var(--naia-ff-ui);font-size:11px;color:rgba(40,21,12,0.6)}
  .wip-legend-item em{font-style:normal;color:rgba(40,21,12,0.4)}
  .wip-legend-dot{width:9px;height:9px;border-radius:50%;flex-shrink:0}
  .wip-silhouette-group{flex-shrink:0}

  /* Your Closet, styled (Moodboard V1) — one contained editorial composition
     per look, not a grid of separate photos: a single shared cream surface
     behind every garment in the look, generous consistent padding, and no
     hard seams between images, so the eye reads "outfit" before it reads
     "three uploaded photos." */
  /* Column count is driven by --mood-cols (set inline from the real,
     deduplicated look count — 2x2 for 4, 3 columns for 5-6, the genuine
     count itself below that) so a thin result never leaves an orphan card
     under a forced 3-column row. Narrower viewports cap it down further. */
  .wip-mood-head{display:flex;justify-content:space-between;align-items:flex-end;gap:20px;flex-wrap:wrap;margin-bottom:20px}
  .wip-mood-tabs{display:flex;gap:8px;flex-shrink:0}
  .wip-mood-tab{font-family:var(--naia-ff-ui);font-size:11.5px;font-weight:600;letter-spacing:0.3px;color:rgba(40,21,12,0.6);background:var(--naia-bg);border:1px solid var(--naia-border);border-radius:20px;padding:7px 14px;cursor:pointer}
  .wip-mood-tab span{margin-left:5px;opacity:0.7}
  .wip-mood-tab.is-active{background:var(--naia-accent);border-color:var(--naia-accent);color:#fff}
  /* Content-hugging, centered fashion-plate container — not a full-width
     dashboard card. The previous aspect-ratio-only approach always
     stretched to the section's full ~1180px column, which is what left a
     huge empty cream rectangle around a modestly-sized image collage,
     especially on a 1-look tab (Everyday/Work often have just one). Capping
     the GRID itself (not just the collage inside it) is what actually
     removes that unused width, on every column count. */
  .wip-mood-grid{display:grid;grid-template-columns:repeat(var(--mood-cols,1),1fr);gap:16px;max-width:740px;margin:0 auto}
  @media(max-width:860px){.wip-mood-grid{grid-template-columns:repeat(min(var(--mood-cols,1),2),1fr)}}
  @media(max-width:560px){.wip-mood-grid{grid-template-columns:1fr}}
  .wip-mood-tile{display:block;width:100%;border:1px solid var(--naia-border);border-radius:8px;background:var(--naia-surface);padding:9px;text-align:left;cursor:pointer}
  .wip-mood-tile:hover{border-color:rgba(40,21,12,0.3)}
  /* A fixed height (not aspect-ratio) is what makes the 360-420px target
     reliable now that composition varies by piece count below — an
     aspect-ratio can't describe an asymmetric 1-large/2-small layout the
     same way it describes an even grid. object-fit:contain on every
     Thumb still prevents any cropping regardless of shape. */
  .wip-mood-collage{display:grid;gap:6px;height:330px}
  @media(max-width:700px){.wip-mood-collage{height:280px}}
  .wip-mood-collage .wip-thumb{border-radius:0;height:100% !important;background:none}
  /* One garment, rare fallback (e.g. a single dress): centered, not stretched. */
  .wip-mood-collage--n1{grid-template-columns:1fr;max-width:300px;margin:0 auto}
  /* Two pieces: a centered pair, not two images pulled to opposite edges of
     the tile. */
  .wip-mood-collage--n2{grid-template-columns:1fr 1fr;max-width:460px;margin:0 auto}
  /* Three pieces: one row, not a 2-row stack — stacking the lead across
     both rows (previous version) multiplied width AND height together,
     making it 2-3x the visual area of each support. A single shared row
     means only the WIDTH differs (lead ~25% wider), which reads as
     "moderately more prominent" rather than dominant, keeps every piece
     at the same height as its neighbours, and leaves no row-height
     mismatch to show up as unused canvas. */
  .wip-mood-collage--n3{grid-template-columns:1.25fr 1fr 1fr;max-width:600px;margin:0 auto}
  /* Four or more, rare: back to an even grid rather than guessing a
     composition no real candidate actually produces. */
  .wip-mood-collage--n4{grid-template-columns:1fr 1fr;grid-template-rows:1fr 1fr}
  .wip-mood-meta{display:block;font-family:var(--naia-ff-ui);font-size:11px;letter-spacing:1px;text-transform:uppercase;color:rgba(40,21,12,0.55);font-weight:600;margin-top:8px}
  .wip-mood-card-body{margin-top:8px}
  .wip-mood-reason{font-family:var(--naia-ff-ui);font-size:12.5px;line-height:1.55;color:rgba(40,21,12,0.7);margin:4px 0 7px}
  .wip-mood-chips{display:flex;flex-wrap:wrap;gap:5px}
  .wip-mood-chips .wip-chip{font-size:10px;padding:4px 10px}

  /* Pieces worth rediscovering */
  /* One curated editorial row, not three cards spread to the full container
     width: fixed, consistent column widths (not 1fr) so the row hugs its
     own content and sits left-aligned, closer together, rather than
     stretching each image into a wide, mostly-empty box. */
  /* Fixed-width tracks already stopped the row from stretching edge to
     edge, but a grid's content defaults to start-aligned — left-heavy —
     unless told to center. justify-content is what actually centers the
     group; the narrower column width + bigger gap make it read as one
     curated edit rather than three cards; the margin-bottom is the gap
     before the analysis cards below, which previously relied only on
     the next section's own top padding and read as too sudden. */
  .wip-piece-grid{display:grid;grid-template-columns:repeat(3,minmax(0,180px));gap:22px;justify-content:center;margin-bottom:16px}
  @media(max-width:900px){.wip-piece-grid{grid-template-columns:repeat(2,minmax(0,180px))}}
  @media(max-width:600px){.wip-piece-grid{grid-template-columns:minmax(0,220px)}}
  .wip-piece-card{display:flex;flex-direction:column}
  .wip-piece-thumb .wip-thumb{width:100%;border-radius:4px;margin-bottom:8px}
  .wip-piece-card h3{font-family:var(--naia-ff-ui);font-weight:700;font-size:14px;margin:0 0 3px;color:var(--naia-ink)}
  .wip-piece-card > p{font-family:var(--naia-ff-ui);font-size:12px;line-height:1.5;color:rgba(40,21,12,0.6);margin:0 0 8px}
  .wip-piece-actions{display:flex;flex-direction:column;gap:7px;align-items:flex-start}

  /* Two-column analysis: How your wardrobe supports your life | Where it repeats.
     Each column is its own bordered cream card, matching the moodboard/shop
     card treatment, rather than two borderless text blocks. */
  /* align-items:start so each column sizes to its own content — CSS grid's
     default stretch was forcing both columns to match the taller sibling's
     height, leaving a large empty gap under the shorter one. */
  /* ONE shared paired-card grid — both two-column rows (lifestyle/
     repetition and Worth adding/Skip for now) use this exact rule, so
     they share total row width, column width, gutter and stacking
     breakpoint. Shop Smarter previously had its own max-width:920px and a
     different gap, which is what made it visibly narrower than this row
     and left its card edges not lining up underneath. */
  .wip-paired-grid{display:grid;grid-template-columns:1fr 1fr;gap:24px}
  @media(max-width:900px){.wip-paired-grid{grid-template-columns:1fr;gap:20px}}
  /* align-items:stretch (the default — no longer overridden) is what makes
     each pair equally sized within its own row: both columns take the
     row's full height, and .wip-paired-card's flex:1/min-height below
     make the visible card box itself fill that height, so a shorter
     card's bottom border still lines up with its taller sibling's
     instead of ending early. */
  .wip-analysis-col{display:flex;flex-direction:column}
  /* Shared height across BOTH rows, not just within each row: without
     this, the lifestyle/repetition pair and the shop-smarter pair could
     each be internally equal-height but still end up two different
     heights from each other, breaking the "cards line up underneath"
     requirement. 420px is sized to the analysis row's real content (up
     to 3 register rows with evidence thumbnails) — the shorter
     Shop-smarter cards reach the same floor and stay top-aligned inside
     it (plain block flow, nothing centers their content vertically).
     Desktop only — mobile stacks to one column and sizes naturally. */
  .wip-paired-card{display:flex;flex-direction:column}
  /* 436px — measured, not estimated: a real HTML harness using this exact
     CSS and the real diagnostic customer's real text (3 register rows,
     merged heading/count line, 100px evidence thumbnails) rendered in an
     actual browser at desktop width came to 428.4px
     (document.getElementById(...).getBoundingClientRect().height); 436px
     keeps a small (~8px) comfortable margin rather than cutting exactly
     to the measured minimum. The repetition card's compact-summary
     treatment (primary finding full, any further qualifying clusters as
     a one-line title+count) was separately verified at a hypothetical
     3-cluster case: 290px, well inside this shared height regardless of
     how many real clusters a customer has. height (not min-height) is
     deliberate here, as requested — all four cards get this exact value.
     Desktop only — mobile/tablet stacks to natural height:auto. */
  @media(min-width:901px){.wip-paired-card{height:436px}}
  .wip-analysis-card{flex:1}

  /* How your wardrobe supports your life */
  .wip-life-row{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;padding:9px 0;border-top:1px solid var(--naia-border)}
  .wip-life-row:first-of-type{border-top:0;padding-top:0}
  .wip-life-main{flex:1;min-width:0}
  .wip-life-heading{display:flex;align-items:baseline;gap:9px;flex-wrap:wrap}
  .wip-life-heading h3{font-family:var(--naia-ff-ui);font-weight:700;font-size:14px;margin:0;color:var(--naia-ink)}
  .wip-life-state{font-family:var(--naia-ff-ui);font-size:10.5px;color:rgba(40,21,12,0.5)}
  .wip-life-bar{height:4px;background:var(--naia-border);border-radius:2px;margin:6px 0;max-width:180px;overflow:hidden}
  .wip-life-bar-fill{height:100%;background:var(--naia-accent);border-radius:2px}
  .wip-life-count{font-family:var(--naia-ff-ui);font-size:10.5px;color:rgba(40,21,12,0.5)}
  .wip-life-text{font-family:var(--naia-ff-ui);font-size:12.5px;line-height:1.45;color:rgba(40,21,12,0.65);margin:0}

  /* Where your wardrobe repeats — primary finding only */
  .wip-repeat-card{padding:9px 0;border-top:1px solid var(--naia-border)}
  .wip-repeat-card:first-child{border-top:0;padding-top:0}
  .wip-repeat-card h3{font-family:var(--naia-ff-ui);font-weight:700;font-size:14px;margin:0 0 5px;color:var(--naia-ink)}
  .wip-repeat-card p{font-family:var(--naia-ff-ui);font-size:12.5px;line-height:1.45;color:rgba(40,21,12,0.65);margin:0 0 8px}
  /* Any 2nd/3rd qualifying cluster — same engine data, compact one-line
     summary instead of a full body+evidence repeat, so the card stays a
     bounded summary rather than an unlimited report as more clusters
     exist. Existence is still surfaced (title + count), never hidden. */
  .wip-repeat-more{margin-top:8px;padding-top:8px;border-top:1px solid var(--naia-border)}
  .wip-repeat-more-item{display:flex;justify-content:space-between;gap:12px;padding:4px 0;font-family:var(--naia-ff-ui);font-size:11.5px;color:rgba(40,21,12,0.6)}
  .wip-repeat-more-title{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .wip-repeat-more-count{flex-shrink:0;color:rgba(40,21,12,0.45)}

  /* Shared evidence-tier thumbnail system — every evidence row on the page
     (lifestyle combos, repetition clusters, shop-smarter support) uses this
     one fixed size, so nothing competes on scale with the moodboard or the
     rediscovery images above it. */
  /* One shared evidence-thumbnail size across lifestyle/repetition/Shop
     Smarter — large enough to read as real wardrobe evidence rather than
     an icon, still well inside the now-fixed card dimensions. object-fit:
     contain (on .wip-thumb img, below) preserves each image's own aspect
     ratio regardless of this box being square. */
  .wip-evidence-row{display:flex;gap:8px;flex-wrap:wrap}
  /* Height is NOT set here — Thumb's own inline style={{height}} (the
     height={100} prop at each call site) always wins over this class
     regardless of what this rule declares, since inline style outranks
     any class selector in the cascade. Confirmed directly: every previous
     round that only changed this class's height (56->84->100px) had zero
     actual effect, because the real governing value was always the
     height={56} prop, unchanged until now. Width IS set here (nothing
     inline overrides it) — slightly narrower than tall, not square, to
     free horizontal room for the text column beside it in the lifestyle
     row without shrinking the image back into icon territory. */
  .wip-evidence-row .wip-thumb{width:86px;border-radius:4px}

  /* Shop smarter — each side its own bordered cream card, matching the
     analysis/moodboard card treatment. */
  /* Grid shape (width, gutter, stacking breakpoint) now comes entirely
     from .wip-paired-grid, shared with the analysis row — this used to
     declare its own max-width:920px and a different gap, which is what
     made Shop Smarter visibly narrower and its cards not line up
     underneath the lifestyle/repetition pair. */
  .wip-shop-col-label{display:block;font-family:var(--naia-ff-ui);font-size:9.5px;letter-spacing:1.4px;text-transform:uppercase;font-weight:700;color:rgba(40,21,12,0.45);margin-bottom:12px}
  .wip-shop-col-label--buy{color:var(--naia-accent)}
  .wip-shop-col h3{font-family:var(--naia-ff-ui);font-weight:700;font-size:14px;line-height:1.3;margin:0 0 8px;color:var(--naia-ink)}
  .wip-shop-col ul{margin:0 0 10px;padding-left:16px;font-family:var(--naia-ff-ui);font-size:12px;line-height:1.7;color:rgba(40,21,12,0.7)}
  .wip-shop-col > p{font-family:var(--naia-ff-ui);font-size:12.5px;line-height:1.6;color:rgba(40,21,12,0.65);margin:0 0 10px}
  .wip-shop-evidence-label{font-family:var(--naia-ff-ui);font-size:9.5px;letter-spacing:0.6px;text-transform:uppercase;color:rgba(40,21,12,0.4);margin:0 0 8px}
  .wip-shop-col .wip-evidence-row{margin-bottom:12px}
  .wip-shop-why{margin-top:auto;padding-top:10px}
  .wip-shop-why-label{display:block;font-family:var(--naia-ff-ui);font-size:9.5px;letter-spacing:0.6px;text-transform:uppercase;color:rgba(40,21,12,0.4);margin:0 0 4px}
  .wip-shop-why p{font-family:var(--naia-ff-ui);font-size:12.5px;line-height:1.6;color:rgba(40,21,12,0.65);margin:0}

  /* Passport-match + wardrobe-profile — compact, real, inline page content,
     not dialog teasers. One prominent takeaway, then supporting facts as a
     short list — not a wall of equally-weighted paragraphs. Deep per-item
     evidence stays behind "See details". */
  .wip-findings-headline{font-family:var(--naia-ff-ui);font-weight:600;font-size:14.5px;line-height:1.5;color:var(--naia-ink);margin:0 0 10px}
  .wip-findings-list{margin:0 0 12px;padding-left:16px;font-family:var(--naia-ff-ui);font-size:12.5px;line-height:1.7;color:rgba(40,21,12,0.65)}

  /* Quiet trailing methodology link */
  /* Quiet inline methodology — no longer a click-to-open modal. Same
     .wip-section-title as every other heading; body stays understated
     (smaller, muted) rather than reading as another full finding. */
  .wip-method-body{font-family:var(--naia-ff-ui);font-size:12.5px;line-height:1.65;color:rgba(40,21,12,0.6);margin:0 0 10px;max-width:640px}
  .wip-legal{font-family:var(--naia-ff-ui);font-size:9.5px;color:rgba(40,21,12,0.45);margin-top:10px}
  .wip-empty{font-family:var(--naia-ff-ui);font-size:13px;color:rgba(40,21,12,0.6);padding:40px 0}

  .wip-thumb{width:100%;display:flex;align-items:center;justify-content:center;background:var(--naia-muted-bg);border-radius:4px;overflow:hidden;flex-shrink:0}
  .wip-thumb img{width:100%;height:100%;object-fit:contain}
  .wip-thumb-fallback{font-family:var(--naia-ff-ui);font-size:11px;color:rgba(40,21,12,0.4)}

  @media(max-width:700px){
    .wip-header{display:block}
    .wip-status{padding-top:12px}
    .wip-life-row{flex-direction:column}
  }

  .wip-dialog-backdrop{position:fixed;inset:0;background:rgba(40,21,12,0.35);display:flex;align-items:center;justify-content:center;padding:20px;z-index:50}
  .wip-dialog{background:var(--naia-surface);border-radius:10px;max-width:780px;width:100%;max-height:88vh;overflow:auto;box-shadow:0 20px 60px rgba(20,10,5,0.25)}
  /* Scoped to the methodology dialog only — its content is two short
     paragraphs and a note, not the richer grids/lists other dialogs hold,
     so it gets its own narrower, shorter frame rather than the shared one. */
  .wip-dialog--compact{max-width:480px;max-height:none}
  .wip-dialog--compact .wip-dialog-head{padding:16px 20px 10px}
  .wip-dialog--compact .wip-dialog-body{padding:12px 20px 18px}
  .wip-dialog--compact .wip-profile-block{padding:10px 0;border-bottom:1px solid var(--naia-border)}
  .wip-dialog--compact .wip-profile-block:last-child{border-bottom:0}
  /* Scoped to the "compatible pieces" dialog only — the workCombo/
     moodboardLook dialogs reuse the same .wip-match-grid/.wip-match-tile
     classes at their own (unchanged) size, since those hold only 2-3
     tiles forming one reasoned combination, not an open-ended count grid. */
  .wip-dialog--matches{max-width:620px}
  .wip-dialog--matches .wip-match-grid{gap:9px}
  .wip-dialog--matches .wip-match-tile{padding:7px}
  .wip-dialog--matches .wip-match-tile p{font-size:9.5px;margin:6px 0 0}
  .wip-dialog-head{position:sticky;top:0;background:var(--naia-surface);padding:20px 22px 14px;border-bottom:1px solid var(--naia-border);display:flex;justify-content:space-between;gap:14px}
  .wip-dialog-head h2{font-family:var(--naia-ff-display);font-weight:300;font-size:1.4rem;margin:0}
  .wip-dialog-head p{font-family:var(--naia-ff-ui);font-size:11.5px;color:rgba(40,21,12,0.55);margin:6px 0 0}
  .wip-dialog-close{width:28px;height:28px;border-radius:50%;border:1px solid var(--naia-border);background:none;font-size:18px;cursor:pointer;flex-shrink:0}
  .wip-dialog-body{padding:20px 22px 24px}
  .wip-match-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:14px}
  @media(max-width:600px){.wip-match-grid{grid-template-columns:1fr 1fr}}
  .wip-match-tile{border:1px solid var(--naia-border);border-radius:6px;padding:10px;background:var(--naia-muted-bg);text-align:center;cursor:pointer}
  .wip-match-tile p{font-family:var(--naia-ff-ui);font-size:10.5px;margin:8px 0 0}
  .wip-dialog-note{font-family:var(--naia-ff-ui);font-size:10.5px;color:rgba(40,21,12,0.5);line-height:1.6;margin-top:16px}
  .wip-pair{display:grid;grid-template-columns:1fr 1fr;gap:16px;background:var(--naia-muted-bg);padding:18px;border-radius:7px}
  .wip-pair p{font-family:var(--naia-ff-ui);font-size:11px;text-align:center;margin-top:8px}
  .wip-profile-block{padding:14px 0;border-bottom:1px solid var(--naia-border)}
  .wip-profile-block:last-child{border-bottom:0}
  .wip-profile-block h3{font-family:var(--naia-ff-ui);font-size:10.5px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:var(--naia-accent);margin:0 0 8px}
  .wip-profile-block p{font-family:var(--naia-ff-ui);font-size:13px;line-height:1.7;color:rgba(40,21,12,0.72);margin:0 0 6px}
  .wip-profile-block p:last-child{margin-bottom:0}
  .wip-ways-strip{display:flex;gap:8px;margin-top:10px}
  .wip-ways-strip .wip-thumb{width:70px;border-radius:4px}
  .wip-ways-why{font-family:var(--naia-ff-ui);font-size:11.5px;color:rgba(40,21,12,0.6);margin:8px 0 0;max-width:420px}
  .wip-chips{display:flex;flex-wrap:wrap;gap:8px}
  .wip-chip{font-family:var(--naia-ff-ui);font-size:11px;color:rgba(40,21,12,0.65);background:var(--naia-muted-bg);border-radius:20px;padding:5px 12px}
  .wip-combo-text{font-family:var(--naia-ff-ui);font-size:13px;line-height:1.6;margin-top:16px;color:var(--naia-ink)}
  .wip-status-options{display:flex;flex-direction:column;gap:12px}
  .wip-status-choice{padding:14px 16px;text-align:left;background:var(--naia-bg);border:1px solid var(--naia-border);border-radius:5px;cursor:pointer}
  .wip-status-choice:hover{border-color:var(--naia-accent)}
  .wip-status-choice b{display:block;font-family:var(--naia-ff-ui);font-size:13px;font-weight:600}
  .wip-status-choice span{display:block;font-family:var(--naia-ff-ui);font-size:11.5px;color:rgba(40,21,12,0.55);margin-top:3px}

  /* Coverage dialog */
  .wip-coverage-policy{margin:0 0 14px;font-family:var(--naia-ff-ui);font-size:11.5px;font-style:italic;color:rgba(40,21,12,0.55)}
  .wip-coverage-list{display:flex;flex-direction:column;gap:14px;margin-top:14px}
  .wip-coverage-item{display:flex;gap:16px;align-items:flex-start;background:var(--naia-muted-bg);border-radius:7px;padding:14px}
  .wip-coverage-item .wip-thumb{width:100px;flex-shrink:0;border-radius:5px}
  .wip-coverage-state{display:inline-block;font-family:var(--naia-ff-ui);font-size:9px;font-weight:600;letter-spacing:0.4px;text-transform:uppercase;padding:2px 8px;border-radius:20px;margin-bottom:6px}
  .wip-coverage-state--may-depend{background:rgba(107,29,38,0.09);color:var(--naia-accent)}
  .wip-coverage-state--doesnt-match{background:rgba(40,21,12,0.08);color:rgba(40,21,12,0.6)}
  .wip-coverage-item-text h3{font-family:var(--naia-ff-ui);font-size:12.5px;font-weight:600;margin:0 0 5px;color:var(--naia-ink)}
  .wip-coverage-item-text p{font-family:var(--naia-ff-ui);font-size:11.5px;color:rgba(40,21,12,0.65);line-height:1.6;margin:0 0 4px}
  .wip-coverage-rescue{font-style:italic;color:rgba(40,21,12,0.55) !important}
  @media(max-width:600px){.wip-coverage-item{flex-direction:column}}
`;
