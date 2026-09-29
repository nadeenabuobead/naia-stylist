// app/lib/ai/wardrobe-page.ts
//
// THE PAGE MODEL for Wardrobe Intelligence.
//
// The engine decides what is true. The needs layer decides what it means. This
// module decides WHERE EACH CONCLUSION LIVES, and it exists because the page had
// started saying the same thing four times.
//
// The earlier deduplication worked on `kind` and on garment id, which is why it
// kept failing: "your work dressing repeats one formula" reached the page as a
// headline, a depth finding and a purchase rationale — three different kinds,
// three different objects, one claim. Here every entry declares the CLAIM it
// makes, each claim has exactly one owning section, and anything that turns up
// elsewhere is reduced to a pointer or dropped.
//
// Fact → Meaning → Action. A claim is explained once, in the section where the
// customer can act on it.
//
// This module is presentation only. It never recomputes a finding, never invents
// a number, and never decides something is missing.

import type { WardrobeIntelligence, WardrobeObservation, WardrobePairing } from "~/lib/ai/wardrobe-intelligence";
import type { WardrobeNeeds, RegisterId, RegisterReading } from "~/lib/ai/wardrobe-needs";
import type { WardrobeRecommendations, RecommendationAttribute } from "~/lib/ai/wardrobe-recommendations";
import { changeLines, type WardrobeChange } from "~/lib/ai/wardrobe-snapshot";
import {
  registerDisplay,
  lifestyleMatch,
  matchDimension,
  comparisonDimension,
  heroLabel,
  capabilityLabel,
  plainPairReason,
  plainText,
  groupEnough,
} from "~/lib/ai/wardrobe-copy";

// ── Contract ──────────────────────────────────────────────────────────────────

/**
 * The four moments after the hero (which renders separately, outside this
 * list — see `WardrobePage.reading`/`basis`). Content-locked: nothing is
 * added here without reopening that lock.
 */
export type SectionId = "wear" | "attention" | "shop" | "profile";

export const SECTION_ORDER: readonly SectionId[] = [
  "wear", "attention", "shop", "profile",
];

export const SECTION_TITLES: Readonly<Record<SectionId, string>> = {
  wear: "Wear what you already own",
  attention: "What deserves your attention",
  shop: "Shop smarter",
  profile: "Your wardrobe profile",
};

/**
 * A claim is the MEANING of an entry, not its shape. Two entries carrying the
 * same claim are the same finding however differently they are worded.
 */
export type ClaimKey = string;

/** `full` explains the claim. `pointer` refers to it in one line. */
export type EntryRole = "full" | "pointer";

/**
 * Only actions the product can honour today. `reveal` shows pieces already in
 * the payload; `link` goes to a route that keeps the garment context. Anything
 * that would drop the selected piece is not an action and is not offered.
 */
export type PageAction =
  // `detail` is a short plain-language explanation shown alongside any
  // garments when opened — used for "Why this?" on a recommendation, where
  // there is prose to show rather than (or alongside) a garment strip.
  | { kind: "reveal"; label: string; hideLabel: string; garmentIds: string[]; detail?: string }
  | { kind: "link"; label: string; to: string }
  /** Moves to evidence already on this page. Cannot lose context. */
  | { kind: "jump"; label: string; to: string };

export interface PageEntry {
  id: string;
  claim: ClaimKey;
  role: EntryRole;
  title?: string;
  body?: string;
  /** Evidence the customer can see. Never longer than the claim it supports. */
  garmentIds: string[];
  action?: PageAction;
  /** Renderer hints. Never rendered as text. */
  variant?: string;
  meta?: Record<string, unknown>;
}

export interface PageBlock {
  id: string;
  /** Small uppercase label above the block. */
  label?: string;
  kind: string;
  entries: PageEntry[];
  note?: string;
  /**
   * When set, `entries` is collapsed behind a toggle keyed on the block's own
   * id, closed by default — for background/provenance detail (counts,
   * per-dimension breakdown) that a customer can open, not something the main
   * journey depends on.
   */
  disclosure?: { label: string; hideLabel: string };
  /**
   * The useful conclusion, shown even while `entries` is collapsed — under
   * the block's own `label` as its heading. Collapsing detail must never hide
   * the one sentence a customer actually came for, only the
   * provenance/counts/breakdown behind it.
   */
  summary?: string;
  /** Renderer hints for block-level layout data. Never rendered as text. */
  meta?: Record<string, unknown>;
}

export interface PageSection {
  id: SectionId;
  title: string;
  sub?: string;
  blocks: PageBlock[];
}

export interface WardrobePage {
  /** Pieces in the Closet — the denominator, shown in the status line. */
  closetCount: number;
  /** The one-sentence read of the wardrobe. Null until nAia can see enough. */
  reading: string | null;
  /** What moved since last time. Empty when nothing did. */
  changeLines: string[];
  /** Whether there is enough in the Closet to say anything at all. */
  ready: boolean;
  /** Shown when there is not. */
  readyNote?: string;
  /**
   * Stated near the top, always. Conclusions about spending have to show what
   * they are based on.
   */
  basis: string;
  /**
   * How much of the wardrobe nAia is looking at, when she has been told.
   * Drives how firmly shopping advice may be worded.
   */
  confidence: ClosetConfidence;
  sections: PageSection[];
}

/**
 * Whether the uploaded Closet is most of what she wears. Until she says,
 * nAia does not get to assume either way.
 */
export type ClosetConfidence = "mostly" | "still-adding" | "unknown";

// ── Claim ownership ───────────────────────────────────────────────────────────
//
// The single source of truth for where a conclusion is explained. Changing an
// owner moves the full explanation and everything else follows.

const CLAIM_OWNER: Readonly<Record<string, SectionId>> = {
  garment: "wear",
  explore: "wear",
  "do-pairing": "wear",
  pairings: "wear",
  untapped: "wear",
  "worth-trying": "wear",
  "depth-gap": "attention",
  // Coverage is an actionable limitation ("N pieces may not meet your
  // preferences"), not background provenance — it sits with the work-variety
  // finding, not in the profile.
  coverage: "attention",
  recommendation: "shop",
  "not-a-priority": "shop",
  "low-priority": "shop",
  "buy-verdict": "shop",
  "depth-enough": "shop",
  "closet-capability": "profile",
  "hero-note": "profile",
  "palette-representation": "profile",
  passport: "profile",
  "intentions-chosen": "profile",
  "styleme-dress-level": "profile",
  "outcome-feedback": "profile",
  dna: "profile",
};

/** The family of a claim — everything before the first colon. */
export function claimFamily(claim: ClaimKey): string {
  const i = claim.indexOf(":");
  return i === -1 ? claim : claim.slice(0, i);
}

export function ownerOf(claim: ClaimKey): SectionId | null {
  return CLAIM_OWNER[claimFamily(claim)] ?? null;
}

// ── Claim keys ────────────────────────────────────────────────────────────────

export const claims = {
  enough: (register: RegisterId) => `depth-enough:${register}`,
  gap: (register: RegisterId) => `depth-gap:${register}`,
  register: (register: RegisterId) => `register:${register}`,
  garment: (id: string) => `garment:${id}`,
  recommendation: (register: RegisterId) => `recommendation:${register}`,
  passport: (dimension: string) => `passport:${dimension.toLowerCase()}`,
} as const;

/**
 * Which claim a Passport comparison line carries. Colour representation is the
 * one that kept being re-explained in three places, so it gets its own family
 * and is never merged into the generic passport dimension family.
 */
function passportClaim(dimension: string): ClaimKey {
  const d = dimension.toLowerCase();
  // Exact match only. "Colour balance" is neutral-versus-colour, a different
  // finding with a different action, and a prefix test would silently merge the
  // two into one — deduplicating away real information rather than repetition.
  if (d === "colour" || d === "color") return "palette-representation";
  return claims.passport(d);
}

// ── Observations ──────────────────────────────────────────────────────────────

/**
 * Observations that describe the SYSTEM rather than the wardrobe. "nAia hasn't
 * used this piece in a look yet" tells the customer about nAia's behaviour and
 * reads as an apology; it is not shown.
 */
const SYSTEM_CENTRIC_KINDS: ReadonlySet<string> = new Set(["contradiction-alignment-unused"]);

/** Observations that are really about one garment, and belong to its entry. */
const GARMENT_LED_KINDS: ReadonlySet<string> = new Set([
  "contradiction-potential-struggle",
  "contradiction-favourite-isolated",
]);

function observationClaim(o: WardrobeObservation): ClaimKey | null {
  if (SYSTEM_CENTRIC_KINDS.has(o.kind)) return null;
  if (GARMENT_LED_KINDS.has(o.kind)) {
    const lead = o.garmentIds[0];
    return lead === undefined ? null : claims.garment(lead);
  }
  if (o.kind === "untapped-potential") return "untapped";
  if (o.kind === "intention-concentration") return "closet-capability";
  return `observation:${o.kind}`;
}

// ── Input ─────────────────────────────────────────────────────────────────────

export interface WardrobePageInput {
  intelligence: WardrobeIntelligence;
  needs: WardrobeNeeds;
  recommendations: WardrobeRecommendations;
  /** Total pieces in the Closet — the denominator shown at the top. */
  closetCount: number;
  confidence?: ClosetConfidence;
  /** Set when StyleMe can genuinely receive a preselected garment. */
  styleMeGarmentHref?: (garmentId: string) => string;
  /** What moved since nAia last read the wardrobe. Null when nothing did. */
  change?: WardrobeChange | null;
  /**
   * Display name for a garment the page knows only by id. Without it, a piece
   * that appears solely in an observation has no title and would be dropped —
   * which is deleting a finding, not deduplicating one.
   */
  garmentName?: (garmentId: string) => string | null;
  /**
   * The customer's own Passport lifestyle tokens, verbatim. Presentation only
   * — used to label an already-valid combination in her own life's terms
   * (e.g. surfacing a genuinely gym-tagged combination as its own "For active
   * / gym days" card instead of a generic one), never to compute a new depth
   * verdict. Defaults to empty, in which case only the three engine registers
   * are shown, unlabelled by lifestyle specifics.
   */
  lifestyle?: readonly string[];
}

// ── Builder ───────────────────────────────────────────────────────────────────

export function buildWardrobePage(input: WardrobePageInput): WardrobePage {
  const { intelligence, needs, recommendations, closetCount } = input;
  const confidence: ClosetConfidence = input.confidence ?? "unknown";
  const ready = intelligence.ready && needs.state === "available";

  const sections = new Map<SectionId, PageBlock[]>();
  for (const id of SECTION_ORDER) sections.set(id, []);
  const add = (id: SectionId, block: PageBlock | null) => {
    if (block && hasVisibleContent(block)) sections.get(id)!.push(block);
  };

  // Built once, below, and read again for the "profile" section, so a piece
  // cannot be recomputed into both.
  const garmentSplitRef: { value: { works: PageBlock | null; possibilities: PageBlock | null } | null } = { value: null };

  // What moved since last time. Rendered by the route directly above the five
  // moments (see WardrobePage.changeLines) — content-locked, so it is a fact
  // stated once, not a section of its own. Absent entirely when nothing moved.
  const changeLinesOut: string[] = ready && input.change ? changeLines(input.change) : [];

  // "You have enough of X" and "another X is not a priority" are the same
  // claim, and content-lock puts the merged result exclusively in Shop
  // Smarter's "Low priority right now" — never as its own "works" chapter.
  // Computed here, at top level, because both the enough-cluster's true
  // membership and the register it names are needed again below.
  const enoughGroups = groupEnough(
    needs.enough.map((f) => {
      // Not evidence[0] — a blind index made "See all N" show whatever
      // evidence happened to be first, not the true full membership. The
      // full list lives under this specific field name; find it by name.
      const membership = f.evidence.find((ev) => ev.field === "slot + colour + formality");
      return { ...f, fullGarmentIds: cleanPartnerIds(membership?.garmentIds ?? f.garmentIds, []) };
    }),
  );
  const notAPriorityByRegister = new Map(
    recommendations.notAPriority.map((n) => [n.id.replace(/^not-priority-/, ""), n]),
  );

  // ── Wear what you already own ──────────────────────────────────────────────
  if (ready) {
    // Per-garment entries. A piece gets ONE entry carrying everything known
    // about it — its hero label, its rediscovery note, and any contradiction
    // observation about it — so no garment is featured twice. The hero-only
    // cards (most-versatile, closet-connector, passport-match, your-favourite)
    // are not shown as a standalone block in the five-moment page — content
    // lock names no such section. Most-versatile's own evidence is folded
    // into the Work combination below instead; the rest stay computed (for
    // possibilities/rediscover) but their standalone cards are not rendered.
    const garmentSplit = splitGarmentEntries(buildGarmentBlock(input));
    garmentSplitRef.value = garmentSplit;
  }

  // ── What deserves your attention ───────────────────────────────────────────
  // The register-state list ("What you can dress for": Strong / Needs more
  // range / Covered) is content-locked away as its own chapter — which
  // register is thin is shown by the work-variety finding itself, and by
  // which combinations exist in "Wear what you already own". The work-variety
  // finding is this page's ONE home for that reasoning; nothing else restates
  // it, including the shopping section below.
  if (ready) {
    add("attention", {
      id: "gaps",
      kind: "findings",
      entries: needs.couldUseMore.map((finding) => ({
        id: finding.id,
        claim: claims.gap(finding.register),
        role: "full" as EntryRole,
        title: finding.title,
        body: plainText(finding.body),
        garmentIds: finding.garmentIds,
      })),
    });
    // Coverage: an actionable limitation, so it sits beside the other thing
    // that deserves attention, not in the profile as background provenance.
    add("attention", buildCoverageBlock(input));
  }

  // ── Wear what you already own (combinations) ───────────────────────────────
  // Ways to get dressed lives here, driven by what she told nAia is part of
  // her life (Passport lifestyle -> register need), never by what she happens
  // to own. A life area she named still appears with nothing in it, saying so
  // plainly — it is not hidden for lack of inventory. Owning pieces for a life
  // area she never named does not promote it into this section on its own.
  // `registerIsRelevant` is the single place that decision is made, so a
  // future explicit signal beyond Passport.lifestyle can extend it later
  // without redesigning anything below it.
  const registerIsRelevant = (r: RegisterReading): boolean => r.needed;
  const waysToGetDressedPairingIds = new Set<string>();

  if (ready) {
    const relevantRegisters = needs.registers.filter(registerIsRelevant);
    const lifestyle = input.lifestyle ?? [];

    // A combination already tagged for an activity her Passport specifically
    // names (today: fitness/gym) is presented under that life area, not
    // buried under whichever generic register it happens to formality-bucket
    // into. This is a PRESENTATION pull-out only: the pairing itself, its
    // gating and its evidence are the engine's, untouched; this card carries
    // no enough/gap/depth verdict of its own, and never appears unless a real
    // pairing already exists for it — nothing is invented for a declared
    // lifestyle with no supported combination.
    //
    // `LIFESTYLE_PRESENTATION` is the one place a lifestyle token is tied to a
    // presentation rule, so a future explicit cross-feature signal (a second
    // activity, or evidence from outside Passport.lifestyle entirely) extends
    // this table without touching anything below it.
    const gymDeclared = lifestyle.some((id) => LIFESTYLE_PRESENTATION.gym.tokens.has(id));
    const bestByRegister = intelligence.pairings.state !== "learning" ? (intelligence.pairings.bestByRegister ?? {}) : {};

    // The best EVERYDAY-bucketed candidate can itself be gym-tagged (activewear
    // formality-buckets to "everyday"), so picking "the top candidate" for a
    // generic register card is not enough on its own — a presentation-level
    // exclusion has to be able to skip past it to the next genuinely generic
    // one. `bestByRegister` carries a short ranked list for exactly this.
    const bestGenericFor = (register: RegisterId): WardrobePairing | undefined =>
      (bestByRegister[register as "everyday" | "work" | "occasion"] ?? [])
        .find((p) => !LIFESTYLE_PRESENTATION.gym.matchesPairing(p));

    const anyGymPairing = (["everyday", "work", "occasion"] as const)
      .flatMap((r) => bestByRegister[r] ?? [])
      .find((p) => LIFESTYLE_PRESENTATION.gym.matchesPairing(p));
    // The customer-facing lifestyle label and the engine's internal register
    // are not the same thing. A pairing whose own evidence is specifically
    // gym-tagged is never shown as a generic register combination — not even
    // "For everyday" — regardless of whether fitness/gym happens to be
    // declared (bestGenericFor already skips it above). Declaration only
    // decides whether it ALSO gets its own labelled card here; left
    // undeclared, it is simply absent from this section and falls through to
    // "Possibilities to try" instead, where no life-area claim is made about it.
    const gymPairing = gymDeclared ? anyGymPairing : undefined;

    // Most-versatile is real, useful evidence ("pairs easily with 8 other
    // pieces") that content-lock does not give its own card — it folds into
    // whichever combination already features that garment, as a line inside
    // that combination's own "Why this works" detail.
    const mostVersatile = intelligence.heroes.state !== "learning"
      ? intelligence.heroes.heroes.find((h) => h.label === "most-versatile")
      : undefined;
    const mostVersatileCount = mostVersatile
      ? cleanPartnerIds(
          mostVersatile.evidence?.find((ev) => ev.field.includes("compatibility graph"))?.garmentIds ?? [],
          [mostVersatile.garmentId],
        ).length
      : 0;
    const mostVersatileNote = (garmentIds: readonly string[]): string | null =>
      mostVersatile && mostVersatileCount > 0 && garmentIds.includes(mostVersatile.garmentId)
        ? `This piece is also one of your most versatile — it pairs with ${mostVersatileCount} others in your Closet.`
        : null;
    const whyThisWorks = (pair: WardrobePairing): PageAction => ({
      kind: "reveal",
      label: "Why this works",
      hideLabel: "Show less",
      garmentIds: [],
      detail: [plainPairReason(pair.reason, pair.garmentIds.length), mostVersatileNote(pair.garmentIds)]
        .filter((s): s is string => s !== null)
        .join(" "),
    });

    if (relevantRegisters.length > 0 || gymPairing) {
      const registerEntries: PageEntry[] = relevantRegisters.map((r) => {
        const best = bestGenericFor(r.register);
        const title = REGISTER_LIFE_HEADING[r.register] ?? `For ${REGISTER_WORD[r.register] ?? r.register}`;
        // Passport need is why this is shown at all; the Closet fact decides
        // what's said. Zero pieces is not hidden — it's named. A register
        // with real depth but no selected example says exactly that, never
        // that the Closet cannot make one — that would be a claim the data
        // doesn't support.
        if (r.rawCount === 0) {
          return {
            id: `explore-${r.register}`, claim: `explore:${r.register}`, role: "full" as EntryRole,
            title, body: "Your Closet doesn't have anything for this part of your life yet.", garmentIds: [],
          };
        }
        if (!best) {
          return {
            id: `explore-${r.register}`, claim: `explore:${r.register}`, role: "full" as EntryRole,
            title, body: NO_EXAMPLE_SELECTED[r.register] ?? "nAia hasn't selected an example to show here yet.", garmentIds: [],
          };
        }
        waysToGetDressedPairingIds.add(best.id);
        return {
          id: `explore-${r.register}`,
          claim: `explore:${r.register}`,
          role: "full" as EntryRole,
          title,
          body: combinationExplanation(best, COMBO_LIFE_PHRASE[r.register] ?? REGISTER_WORD[r.register] ?? r.register, input.garmentName),
          garmentIds: best.garmentIds,
          action: whyThisWorks(best),
          // Presentation-only pointer to the SAME garment the "Why this
          // works" sentence already names — no new claim, count or logic;
          // it just lets the visual layer anchor its mark to the right photo
          // instead of restating the fact in a fresh sentence.
          meta: mostVersatileNote(best.garmentIds) ? { mostVersatileGarmentId: mostVersatile!.garmentId } : undefined,
        };
      });
      // Only ever added alongside a real pairing — never a bare "nothing
      // found" card, unlike the three registers above.
      if (gymPairing) {
        waysToGetDressedPairingIds.add(gymPairing.id);
        registerEntries.push({
          id: "explore-gym",
          claim: "explore:gym",
          role: "full" as EntryRole,
          title: LIFESTYLE_PRESENTATION.gym.heading,
          body: combinationExplanation(gymPairing, "the gym", input.garmentName),
          garmentIds: gymPairing.garmentIds,
          action: whyThisWorks(gymPairing),
        });
      }

      add("wear", {
        id: "ways-to-get-dressed",
        label: "Ways to get dressed with what you own",
        // Own kind: the outfit itself — images and the styling explanation —
        // lives directly on each entry, not in a separate block underneath.
        kind: "lifestyle-combos",
        entries: registerEntries,
      });
    }

  }

  // ── Shop smarter ────────────────────────────────────────────────────────────
  if (ready) {
    // "Do you need to buy anything?" is gone as its own verdict — when there
    // IS something to consider, "Worth considering" says it with specifics,
    // which makes a separate yes/no verdict redundant. When there is
    // nothing, that conclusion is still worth stating, hedged exactly as the
    // old verdict was by how much of the Closet she's told nAia she's added.
    if (recommendations.recommendations.length === 0) {
      add("shop", {
        id: "worth-considering",
        label: "Worth considering",
        kind: "recommendations",
        entries: [{
          id: "nothing-to-add",
          claim: "buy-verdict",
          role: "full" as EntryRole,
          title: "Nothing obvious is missing right now.",
          body: hedge(needs.noUrgentNeed ? plainText(needs.noUrgentNeed) : undefined, confidence),
          garmentIds: [],
        }],
      });
    } else {
      add("shop", {
        id: "worth-considering",
        label: "Worth considering",
        kind: "recommendations",
        entries: recommendations.recommendations.map((rec) => {
          // A structure attribute of "a different shape — A-line, fitted or
          // flared" names shapes the engine has not narrowed to one specific
          // garment — showing it as its own chip reads as exposed
          // classification. There is nothing more specific to name (the
          // engine itself is undecided between those shapes), so the honest
          // version is a plain instruction, never a garment type ("bottom",
          // "trousers") the evidence hasn't actually resolved.
          const shapeOnly = rec.attributes.find(
            (a) => a.kind === "structure" && /^a different shape/i.test(a.label),
          );
          const title = shapeOnly ? naturalShapeTitle(rec) : rec.title;
          const visibleAttributes = shapeOnly ? rec.attributes.filter((a) => a !== shapeOnly) : rec.attributes;
          const why = whyThisDetail(rec, shapeOnly);
          const colour = rec.attributes.find((a) => a.kind === "colour");
          // Content-locked: "It could work with N pieces already in your
          // Closet. Grey is one colour you like that appears less often." —
          // no gap restatement (that stays exclusively in "What deserves your
          // attention"), no attribute dump.
          const body = [
            `It could work with ${rec.unlocksIds.length} ${rec.unlocksIds.length === 1 ? "piece" : "pieces"} already in your Closet.`,
            colour ? `${capitalise(colour.label)} is one colour you like that appears less often.` : null,
          ].filter((s): s is string => s !== null).join(" ");
          return {
            id: rec.id,
            claim: claims.recommendation(rec.register),
            role: "full" as EntryRole,
            title,
            body: hedge(body, confidence),
            garmentIds: rec.unlocksIds,
            action: why
              ? { kind: "reveal" as const, label: "Why this?", hideLabel: "Show less", garmentIds: [], detail: why }
              : undefined,
            meta: { attributes: visibleAttributes },
          };
        }),
      });
    }

    // Low priority — self-explanatory: names the piece, then the reason
    // (the real count) in the same breath, so it never needs its own
    // paragraph to make sense. The same 8 tops that justify this are shown
    // once, here — never also as a separate "You have plenty of" chapter.
    if (recommendations.notAPriority.length > 0) {
      add("shop", {
        id: "low-priority",
        label: "Low priority right now",
        kind: "findings",
        entries: recommendations.notAPriority.map((n) => {
          const enoughFinding = enoughGroups.find((f) => `not-priority-${f.register}` === n.id);
          const count = enoughFinding ? cleanPartnerIds(enoughFinding.fullGarmentIds, []).length : null;
          const subject = singularizeLast(n.title.replace(/^Another of your /, ""));
          return {
            id: n.id,
            claim: "low-priority",
            role: "full" as EntryRole,
            title: `Another similar ${subject}`,
            body: count !== null
              ? `You already have ${count}, so another similar one probably won't add much.`
              : n.body,
            garmentIds: enoughFinding ? cleanPartnerIds(enoughFinding.garmentIds, []).slice(0, 6) : [],
          };
        }),
      });
    }
  }

  // ── Piece worth rediscovering + grouped blazers (feeds "wear") ─────────────
  // Content-locked: the generic "Combinations to try" list of leftover
  // pairings is gone as its own chapter, absorbed into "Wear what you
  // already own" above — `waysToGetDressedPairingIds` is what keeps a
  // combination already shown there from ever being suggested twice.
  if (ready) {
    add("wear", garmentSplitRef.value?.possibilities ?? null);
  }

  // ── Your wardrobe profile ───────────────────────────────────────────────────
  // One compact, mostly-collapsed moment: colours, silhouettes, StyleMe
  // history, wear behaviour, all always visible in one line each; the
  // Passport comparison, capability counts and any remaining provenance sit
  // behind a single "See how nAia knows this" reveal. Content-locked:
  // replaces four separate chapters ("What your Closet is made of", "How
  // nAia is learning you", "What your Closet can help with") with one.
  if (ready) {
    add("profile", buildProfileBlock(input));
  }

  // ── Resolve ────────────────────────────────────────────────────────────────
  const resolved = resolveClaims(sections);

  // The hero reading is content-locked to the lifestyle conclusion — the
  // same sentence the Passport comparison already computes — not the old
  // trait-based sentence, and it never mentions colour (grey belongs to the
  // profile, not the hero).
  const registerDisplays = needs.state === "available"
    ? needs.registers.filter((r) => r.rawCount > 0 || r.needed).map((r) => registerDisplay(r))
    : [];
  const heroLifestyle = lifestyleMatch(registerDisplays);

  return {
    closetCount,
    reading: heroLifestyle?.reading ?? intelligence.snapshotReading ?? null,
    changeLines: changeLinesOut,
    ready,
    readyNote: intelligence.ready ? undefined : (intelligence.readyNote ?? undefined),
    basis: basisLine(closetCount, confidence),
    confidence,
    sections: pruneRepetition(SECTION_ORDER.map((id) => ({
      id,
      title: SECTION_TITLES[id],
      blocks: resolved.get(id) ?? [],
    })).filter((s) => s.blocks.length > 0)),
  };
}

// ── Claim resolution ──────────────────────────────────────────────────────────

/**
 * One home per claim.
 *
 * A `full` entry survives only in the section that owns its claim. Everywhere
 * else it becomes a pointer if it has a title to point with, and is dropped if
 * it does not — a pointer with no words is just noise.
 *
 * A claim with no registered owner keeps its first `full` and loses the rest, so
 * a new finding can never silently print twice while its owner is being decided.
 */
function resolveClaims(sections: Map<SectionId, PageBlock[]>): Map<SectionId, PageBlock[]> {
  const fullSeen = new Set<ClaimKey>();
  const out = new Map<SectionId, PageBlock[]>();

  for (const sectionId of SECTION_ORDER) {
    const blocks = sections.get(sectionId) ?? [];
    const keptBlocks: PageBlock[] = [];

    for (const block of blocks) {
      const entries: PageEntry[] = [];
      for (const entry of block.entries) {
        if (entry.role !== "full") { entries.push(entry); continue; }

        const owner = ownerOf(entry.claim);
        const ownedHere = owner === null ? !fullSeen.has(entry.claim) : owner === sectionId;

        if (ownedHere && !fullSeen.has(entry.claim)) {
          fullSeen.add(entry.claim);
          entries.push(entry);
        } else if (entry.title) {
          entries.push({ ...entry, role: "pointer", body: undefined, garmentIds: [], action: undefined });
        }
      }
      // A block whose only content is its always-visible `summary` (detail
      // collapsed to nothing, or never had any) still belongs on the page —
      // this mirrors the same allowance in `add()` above.
      if (entries.length > 0 || hasVisibleContent({ ...block, entries: [] })) keptBlocks.push({ ...block, entries });
    }
    out.set(sectionId, keptBlocks);
  }
  return out;
}

/**
 * Whether a block has anything to show even with zero (or fully-collapsed)
 * `entries` — a `summary` sentence, or the profile's always-visible
 * `summaryLines`. The single place that decides a block survives on content
 * alone, so a new always-visible field never needs its own bespoke check at
 * every call site.
 */
function hasVisibleContent(block: PageBlock): boolean {
  if (block.entries.length > 0 || block.summary) return true;
  const lines = (block.meta as Record<string, unknown> | undefined)?.summaryLines;
  return Array.isArray(lines) && lines.length > 0;
}

// ── Blocks ────────────────────────────────────────────────────────────────────

/**
 * One entry per garment, merging everything the page knows about it.
 *
 * The cream tank was a hero AND a separate "you find this difficult" note, so it
 * was featured twice. Here the two are one entry, stated without telling her she
 * is wrong about her own clothes: she marked it difficult, and these are the
 * partners nAia can actually support.
 */
function buildGarmentBlock(input: WardrobePageInput): PageBlock | null {
  const { intelligence, styleMeGarmentHref } = input;
  const { heroes, opportunities, observations } = intelligence;

  const entries = new Map<string, PageEntry>();
  const order: string[] = [];
  const touch = (id: string): PageEntry => {
    let e = entries.get(id);
    if (!e) {
      e = { id: `garment-${id}`, claim: claims.garment(id), role: "full", garmentIds: [], meta: { garmentId: id } };
      entries.set(id, e);
      order.push(id);
    }
    return e;
  };

  if (heroes.state !== "learning") {
    for (const hero of heroes.heroes) {
      const e = touch(hero.garmentId);
      e.title = hero.name;
      e.meta = { ...e.meta, label: heroLabel(hero.label, hero.labelText), heroLabel: hero.label };
      // The engine already computes WHICH Passport dimensions matched. Its
      // headline is the vague version of the same claim, and the specific one
      // was being pruned as a repeat — so the reader got "closest to what you
      // told nAia you want" with nothing behind it. Lead with the evidence.
      //
      // "Closet connector" already states its finding in its own hero label
      // ("Works across relaxed and polished looks" — see HERO_LABELS). Both
      // its generic headline ("It connects parts of your wardrobe that don't
      // otherwise meet.") and its first reason ("It works with both the
      // relaxed and the polished side of your wardrobe.") just restate that
      // same label in different words — the rediscover text below carries the
      // actual evidence (the match count and Passport alignment).
      const isConnector = hero.label === "closet-connector";
      e.body = hero.label === "passport-match" && hero.reasons[0]
        ? plainText(hero.reasons[0])
        : isConnector
          ? undefined
          : plainText(hero.headline);
      if (hero.reasons[0] && !isConnector) e.meta = { ...e.meta, reason: plainText(hero.reasons[0]) };
      // The hero's own evidence already names its partners (e.g. "most
      // versatile" cites the exact compatibility-graph ids) — a card that
      // SAYS "pairs easily with 8 other pieces" needs a way to actually see
      // them. Only rediscover pieces got this before; a hero with no
      // rediscover note had a claim and no visible proof of it. Left in place
      // for the rediscover loop below to overwrite when a piece is both.
      //
      // NOT evidence[0] — passport-match and your-favourite heroes lead with
      // self-referential evidence (garmentIds: [this garment's own id], e.g.
      // "Aligns on colour and shape") and carry the actual partner list
      // second. Reading [0] blindly made the trench and the bag each reveal
      // themselves as their own only match. The compatibility-graph entry is
      // the one true partner list for every hero type; find it by name.
      const partnerEvidence = hero.evidence?.find((ev) => ev.field.includes("compatibility graph"));
      const partnerIds = cleanPartnerIds(partnerEvidence?.garmentIds ?? [], [hero.garmentId]);
      if (partnerIds.length > 0) {
        e.garmentIds = partnerIds;
        e.action = {
          kind: "reveal",
          label: "See matching pieces",
          hideLabel: "Show less",
          garmentIds: partnerIds,
        };
      }
    }
  }

  for (const piece of opportunities.rediscover) {
    const e = touch(piece.garmentId);
    e.title = e.title ?? piece.name;
    // Self-excluded and deduplicated before anything downstream counts or
    // renders it — the engine's own list is already clean, but the count in
    // the sentence and the count on the button must always agree with
    // whatever is actually revealed, not with a number computed earlier.
    const cleanIds = cleanPartnerIds(piece.worksWithIds, [piece.garmentId]);
    e.meta = {
      ...e.meta,
      rediscover: namedMatchExamples(plainText(piece.body), cleanIds, input.garmentName),
    };
    if (cleanIds.length > 0) {
      e.garmentIds = cleanIds;
      // The count belongs in the label only when the entry has not already
      // given it. Stated twice in adjacent lines it reads as filler; stated
      // nowhere, the button looks like it might be showing a sample.
      const n = cleanIds.length;
      const alreadyStated = new RegExp(`\\b${n}\\b`).test(plainText(piece.body));
      e.action = {
        kind: "reveal",
        label: alreadyStated
          ? "See matching pieces"
          : `See ${n} matching ${n === 1 ? "piece" : "pieces"}`,
        hideLabel: "Show less",
        garmentIds: cleanIds,
      };
    }
    // cleanIds.length === 0: no genuine partners survive — no action, ever.
  }

  for (const o of observations) {
    const claim = observationClaim(o);
    if (claim === null || !claim.startsWith("garment:")) continue;
    const id = claim.slice("garment:".length);
    const e = touch(id);
    e.title = e.title ?? input.garmentName?.(id) ?? undefined;
    e.meta = {
      ...e.meta,
      note: plainText(o.observation),
      // The headline labels the entry the way a hero label does. Printed as a
      // second sentence it simply restated the observation underneath it.
      label: (e.meta?.label as string | undefined) ?? plainText(o.headline),
    };
  }

  // (b) Within one entry, the rediscovery note and the contradiction
  // observation make the SAME claim — "you find this hard, and here is how much
  // of your Closet works with it" — in two paragraphs. Merging the entry is not
  // enough on its own; the duplicate has to go too. The rediscovery text wins
  // because it carries the partner count, so the more specific statement is the
  // one kept.
  for (const id of order) {
    const e = entries.get(id)!;
    const meta = e.meta ?? {};
    if (typeof meta.rediscover === "string" && typeof meta.note === "string") {
      const { note, noteHead, ...rest } = meta as Record<string, unknown>;
      e.meta = rest;
    }
  }

  // A link is only offered when it genuinely carries the piece through.
  if (styleMeGarmentHref) {
    for (const id of order) {
      const e = entries.get(id)!;
      if (!e.action) e.action = { kind: "link", label: "Style this piece", to: styleMeGarmentHref(id) };
    }
  }

  const list = order.map((id) => entries.get(id)!).filter((e) => e.title !== undefined);
  if (list.length === 0) return null;
  return { id: "garments", label: "The pieces doing the most work", kind: "garments", entries: list };
}

/**
 * "What already works" should read as a list of strengths.
 *
 * A piece that is only here because she finds it difficult is not a strength —
 * it is something to try, so it belongs in "Possibilities to try". A piece with
 * a hero label stays: the label IS the positive finding, and its difficulty is
 * then useful context rather than the headline.
 */
function splitGarmentEntries(block: PageBlock | null): { works: PageBlock | null; possibilities: PageBlock | null } {
  if (block === null) return { works: null, possibilities: null };
  const hasLabel = (e: PageEntry) => typeof (e.meta as Record<string, unknown> | undefined)?.heroLabel === "string";
  const hasRediscover = (e: PageEntry) => typeof (e.meta as Record<string, unknown> | undefined)?.rediscover === "string";
  // A garment can be both a hero AND the dynamic rediscover pick (Cream Tank
  // is exactly this: closet-connector AND the top rediscover candidate) —
  // its rediscover content is what "Wear what you already own" actually
  // shows, so a hero label alone must never send it to the dropped "works"
  // list. Only a hero with NO rediscover content of its own (most-versatile,
  // typically) belongs there.
  const works = block.entries.filter((e) => hasLabel(e) && !hasRediscover(e));
  const rest = block.entries.filter((e) => !hasLabel(e) || hasRediscover(e));
  return {
    works: works.length > 0 ? { ...block, entries: works } : null,
    // `garment:*` and this block both resolve to "wear" now, so the claim
    // never needs re-keying to be owned correctly here — keeping it as
    // `garment:<id>` is also what lets every other lookup on the page find
    // this SAME entry by the SAME claim, wherever it ends up rendering.
    possibilities: rest.length > 0
      ? { id: "worth-trying", label: "Pieces worth another look", kind: "garments", entries: groupIdenticalMatches(rest) }
      : null,
  };
}

/**
 * Two "difficult to style" pieces that resolve to the exact same matching
 * garments are not two findings — they are one finding shown twice. Grouping
 * is keyed ONLY on the already-resolved `garmentIds` set (sorted, compared as
 * a set), so it can never diverge from — and never touches — the matching
 * logic that produced it. A customer whose two pieces resolve to different
 * matches keeps two separate cards, unchanged.
 */
function groupIdenticalMatches(entries: PageEntry[]): PageEntry[] {
  const ownId = (e: PageEntry): string => String((e.meta as Record<string, unknown> | undefined)?.garmentId ?? "");
  // Each entry's own id is stripped from its own set before the sets are
  // compared — grouping must reflect what the two garments actually share,
  // never an artifact of one accidentally listing itself or a duplicate id.
  const cleanedIds = (e: PageEntry): string[] => cleanPartnerIds(e.garmentIds, [ownId(e)]);
  const matchKey = (e: PageEntry): string | null => {
    const ids = cleanedIds(e);
    return ids.length > 0 ? [...ids].sort().join(",") : null;
  };

  const order: string[] = [];
  const buckets = new Map<string, PageEntry[]>();
  entries.forEach((e, i) => {
    const key = matchKey(e) ?? `solo:${i}`;
    if (!buckets.has(key)) { buckets.set(key, []); order.push(key); }
    buckets.get(key)!.push(e);
  });

  return order.flatMap((key) => {
    const group = buckets.get(key)!;
    if (group.length < 2) return group;

    const members = group.map((e) => ({
      garmentId: ownId(e),
      title: e.title ?? "",
    }));
    // The shared set excludes every member's own id, so neither blazer can
    // ever appear as a "match" for the group they're both in.
    const memberIds = new Set(members.map((m) => m.garmentId));
    const sharedIds = cleanPartnerIds(cleanedIds(group[0]), [...memberIds]);
    // "You marked THIS as difficult to style" was true of only one garment
    // when reused verbatim for the group — the copy has to say what's
    // actually true of both.
    const body = groupedRediscoverBody(members.map((m) => m.title), sharedIds.length);

    return [{
      id: `group-${group.map((e) => e.id).join("-")}`,
      claim: group[0].claim,
      role: "full" as EntryRole,
      title: groupHeading(members.map((m) => m.title)),
      body,
      garmentIds: sharedIds,
      action: sharedIds.length > 0
        ? { kind: "reveal", label: "See matching pieces", hideLabel: "Show less", garmentIds: sharedIds }
        : undefined,
      meta: { members },
    }];
  });
}

/**
 * "nAia found 8 potential matching pieces" names a count with nothing behind
 * it. The engine already resolved exactly which pieces those are — naming a
 * few of them (real garment names, already on the page) turns the count into
 * evidence the customer can recognise, without inventing anything: it is the
 * same partner list the "See matching pieces" reveal already shows.
 */
function namedMatchExamples(
  body: string,
  partnerIds: readonly string[],
  garmentName: ((id: string) => string | null) | undefined,
): string {
  if (!garmentName) return body;
  const names = partnerIds
    .slice(0, 3)
    .map((id) => garmentName(id))
    .filter((n): n is string => typeof n === "string" && n.trim() !== "");
  if (names.length === 0) return body;
  const list = joinWithAnd(names.map((n) => n.toLowerCase()));
  return body.replace(/\b\d+ potential matching pieces?\b\.?/i, (m) => {
    const count = m.match(/\d+/)?.[0] ?? "";
    return `${count} potential matches, including ${list}.`;
  });
}

/**
 * Deterministic, from the garment names already on the page — never a new
 * category claim. When every title ends in the same word (e.g. two
 * "... Blazer" pieces), names it: "TWO BLAZERS WORTH ANOTHER LOOK". When the
 * names don't agree on a shared word, falls back to a plain count so nothing
 * is invented.
 */
/**
 * "You marked both your Beige Tailored Blazer and Beige Oversized Blazer as
 * difficult to style — the same 6 pieces work with either." The locked
 * grouped wording — never the singular "You marked this..." reused from one
 * member, which was true of only one of the two garments.
 */
function groupedRediscoverBody(titles: string[], sharedCount: number): string {
  const both = titles.length === 2 ? "both" : "all";
  const either = titles.length === 2 ? "either" : "any of them";
  return `You marked ${both} your ${joinWithAnd(titles)} as difficult to style — the same ${sharedCount} ${
    sharedCount === 1 ? "piece works" : "pieces work"
  } with ${either}.`;
}

/**
 * Excludes every id in `selfIds` and removes duplicates, preserving order.
 * The single place every partner/membership list passes through before it
 * reaches a count, a sentence, or a reveal action — so a garment can never
 * appear as its own match, and a count can never disagree with what's
 * actually shown.
 */
export function cleanPartnerIds(ids: readonly string[], selfIds: readonly string[]): string[] {
  const exclude = new Set(selfIds);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (exclude.has(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function groupHeading(titles: string[]): string {
  const lastWords = titles.map((t) => t.trim().split(/\s+/).pop()?.toLowerCase() ?? "");
  const shared = lastWords.every((w) => w && w === lastWords[0]) ? lastWords[0] : null;
  const count = titles.length;
  const countWord = count === 2 ? "TWO" : String(count);
  if (shared) {
    const plural = shared.endsWith("s") ? shared : `${shared}s`;
    return `${countWord} ${plural.toUpperCase()} WORTH ANOTHER LOOK`;
  }
  return `${countWord} PIECES WORTH ANOTHER LOOK`;
}

function buildVerdictBlock(
  needs: WardrobeNeeds,
  recommendations: WardrobeRecommendations,
  confidence: ClosetConfidence,
): PageBlock | null {
  const gaps = needs.couldUseMore;
  const entries: PageEntry[] = [];

  if (gaps.length === 0) {
    entries.push({
      id: "verdict",
      claim: "buy-verdict",
      role: "full",
      title: "Nothing obvious is missing right now.",
      body: hedge(needs.noUrgentNeed ? plainText(needs.noUrgentNeed) : undefined, confidence),
      garmentIds: [],
    });
  } else {
    // Names the area and closes the question for everything else. It points at
    // the gap rather than re-explaining it — that explanation lives in the
    // section about range.
    const areas = joinWithAnd(gaps.map((g) => REGISTER_WORD[g.register] ?? g.register));
    entries.push({
      id: "verdict",
      claim: "buy-verdict",
      role: "full",
      // Buying language is earned. Until she has said the Closet is most of
      // what she wears, nAia is looking at an unknown fraction of a wardrobe
      // and a confident "yes, buy" is not supported by that.
      title:
        confidence === "mostly"
          ? (gaps.length === 1
              ? "Yes — one part of your wardrobe would benefit."
              : `Yes — ${gaps.length === 2 ? "two" : String(gaps.length)} parts of your wardrobe would benefit.`)
          : (gaps.length === 1
              ? `${capitalise(REGISTER_WORD[gaps[0].register] ?? gaps[0].register)} is the main area worth exploring.`
              : "A couple of areas are worth exploring."),
      body: hedge(
        `${capitalise(areas)} ${gaps.length === 1 ? "is" : "are"} where it would help. ` +
        "Everything else you own already covers the kinds of dressing you described.",
        confidence,
      ),
      garmentIds: [],
    });
  }

  // "Another of your everyday neutral tops" is deliberately NOT repeated here.
  // Reduced to a bare title under a shopping verdict it read like something to
  // buy, which is the opposite of what it means, and the advice already has a
  // complete home in "You have plenty of" — fact, evidence and the
  // don't-buy-another guidance together.

  return { id: "verdict", label: "Do you need to buy anything?", kind: "verdict", entries };
}

/**
 * How firmly shopping advice may be worded.
 *
 * nAia is reading what has been uploaded, which is not necessarily everything
 * owned. Until she has been told otherwise she says so.
 */
function hedge(base: string | undefined, confidence: ClosetConfidence): string {
  const suffix =
    confidence === "mostly"
      ? ""
      : confidence === "still-adding"
        ? " You've told nAia you're still adding pieces, so treat this as a first read rather than a final answer."
        : " This is based on what's in your Closet so far — if you own more than you've added, it could change.";
  return `${base ?? ""}${suffix}`.trim();
}

/**
 * Removes a leading article and a trailing plural "s"/"es" from the last
 * word — enough for the clothing vocabulary this copy actually uses
 * ("tops"→"top", "dresses"→"dress", "sets"→"set"). Never applied to a
 * garment's real name, only to a category description already written by
 * this codebase.
 */
function singularizeLast(phrase: string): string {
  const words = phrase.trim().split(/\s+/);
  const last = words.pop() ?? "";
  const singular = last.endsWith("es") ? last.slice(0, -2) : last.endsWith("s") ? last.slice(0, -1) : last;
  return [...words, singular].join(" ");
}

/**
 * The wardrobe profile: colours, silhouettes, StyleMe history and wear
 * behaviour, always visible at one line each; the Passport comparison,
 * capability counts and remaining provenance behind one reveal. Replaces
 * four separate chapters — content-locked to never repeat a conclusion the
 * hero or another moment already made (the Lifestyle/Passport comparison in
 * particular: Moment 1 already states it, so it appears here only inside the
 * reveal, as the evidence behind that reading, never as a second headline).
 */
function buildProfileBlock(input: WardrobePageInput): PageBlock | null {
  const { intelligence, needs } = input;
  const { passportView, dna } = intelligence;

  const summaryLines: string[] = [];

  if (dna.palette.length > 0) {
    const thin = needs.synthesis.state === "available"
      ? needs.synthesis.lines.find((l) => l.id === "synth-colour" && l.kind === "uneven")
      : undefined;
    summaryLines.push(
      thin?.thinLabel
        ? `Mostly colours you like; ${thin.thinLabel.toLowerCase()} appears less often.`
        : "Mostly colours you like.",
    );
  }
  if (dna.shapes.length > 0) {
    summaryLines.push(dna.shapesReading ?? "Straight shapes recur most in your Closet.");
  }
  const topRequest = needs.styleMe.state === "available" ? needs.styleMe.requests[0] : undefined;
  if (topRequest) {
    summaryLines.push(
      `You most often ask for ${DRESS_LEVEL_SHORT[topRequest.register] ?? DRESS_LEVEL_PHRASE[topRequest.register]} looks.`,
    );
  }
  // "Wore it" is genuine self-reported wear evidence, not nothing — the
  // wording says what nAia does know, not only what it does not.
  summaryLines.push(
    "Wear behaviour: still learning. nAia knows about looks you tell it you wore, but it doesn't automatically track everything you wear.",
  );

  // ── Everything else: behind one reveal ────────────────────────────────────
  const registers = needs.registers
    .filter((r) => r.rawCount > 0 || r.needed)
    .map((r) => registerDisplay(r));
  const lifestyle = lifestyleMatch(registers);

  const raw = [
    ...(needs.synthesis.state === "available" ? needs.synthesis.lines.map(matchDimension) : []),
    ...(passportView.state !== "learning"
      ? passportView.comparisons.map(comparisonDimension).filter((m): m is NonNullable<typeof m> => m !== null)
      : []),
  ];
  const seen = new Set<string>();
  const entries: PageEntry[] = [];
  // The Lifestyle reading is the hero's own sentence — shown here as the
  // evidence behind it, never as a second, unlabelled headline.
  if (lifestyle) {
    entries.push({
      id: "match-lifestyle", claim: passportClaim("lifestyle"), role: "full",
      title: "Lifestyle", body: lifestyle.reading, garmentIds: [],
      meta: { state: lifestyle.state, stateText: lifestyle.stateText },
    });
  }
  for (const m of raw) {
    if (seen.has(m.dimension)) continue;
    seen.add(m.dimension);
    entries.push({
      id: m.id, claim: passportClaim(m.dimension), role: "full",
      title: m.dimension, body: m.reading, garmentIds: [],
      meta: { state: m.state, stateText: m.stateText },
    });
  }

  if (needs.styleMe.state === "available") {
    if (topRequest) {
      const total = needs.styleMe.requests.reduce((sum, r) => sum + r.sessions, 0);
      entries.push({
        id: "dress-level", claim: "styleme-dress-level", role: "full",
        title: "How you usually want your looks to feel",
        body: `${topRequest.sessions} of the ${total} StyleMe requests nAia could classify were ${DRESS_LEVEL_PHRASE[topRequest.register]}.`,
        garmentIds: [],
      });
    }
    const chosen = needs.intentions.chosen.slice(0, 4);
    if (chosen.length > 0) {
      const dominates = chosen.length > 1 && chosen[0].sessions >= chosen[1].sessions * 2;
      const rest = chosen.slice(1, 4).map((c) => c.label);
      entries.push({
        id: "intentions-chosen", claim: "intentions-chosen", role: "full",
        title: "What you most often ask to feel",
        body: `${capitalise(chosen[0].label)} is ${dominates ? "by far " : ""}what you choose most often` +
          (rest.length > 0 ? `, followed by ${joinWithAnd(rest)}` : "") + ".",
        garmentIds: [],
      });
    }
    const feedback = [needs.outcomes.keptNote, needs.outcomes.changedNote].filter(Boolean).join(" ");
    if (feedback !== "") {
      entries.push({
        id: "outcome-feedback", claim: "outcome-feedback", role: "full",
        title: "What your feedback is teaching nAia", body: feedback, garmentIds: [],
      });
    }
  }

  // Capability — reviewed garment ratings, named as such. Deeply secondary:
  // available only inside this reveal, never its own visible summary line.
  const strengths = needs.intentions.closetStrengths.slice(0, 3);
  if (strengths.length > 0) {
    entries.push({
      id: "closet-capability", claim: "closet-capability", role: "full",
      body: "These counts estimate the kinds of looks your pieces could help with. " +
        "They aren't complete outfits or a match against your personal requirements.",
      garmentIds: [],
      meta: { strengths: strengths.map((c) => ({ ...c, label: capabilityLabel(c.intention, c.label) })) },
    });
  }

  // Passport-match and your-favourite heroes (the trench, the bag) have no
  // named slot in "Wear what you already own" — most-versatile is the only
  // hero content-lock folds in there — but the evidence is real, so it
  // survives here rather than disappearing. A distinct claim family (not
  // `garment:*`, which "Wear what you already own" owns) because the SAME
  // family cannot have two different owning sections.
  if (intelligence.heroes.state !== "learning") {
    for (const hero of intelligence.heroes.heroes) {
      if (hero.label !== "passport-match" && hero.label !== "your-favourite") continue;
      const partnerEvidence = hero.evidence?.find((ev) => ev.field.includes("compatibility graph"));
      const partnerIds = cleanPartnerIds(partnerEvidence?.garmentIds ?? [], [hero.garmentId]);
      entries.push({
        id: `hero-${hero.garmentId}`,
        claim: `hero-note:${hero.garmentId}`,
        role: "full",
        title: hero.name,
        body: plainText(hero.headline),
        garmentIds: partnerIds,
        action: partnerIds.length > 0
          ? { kind: "reveal", label: "See matching pieces", hideLabel: "Show less", garmentIds: partnerIds }
          : undefined,
        meta: { garmentId: hero.garmentId },
      });
    }
  }

  if (summaryLines.length === 0 && entries.length === 0) return null;

  return {
    id: "profile",
    label: "Your wardrobe profile",
    kind: "profile",
    meta: {
      summaryLines,
      palette: dna.palette.slice(0, 5),
      shapes: dna.shapes,
    },
    disclosure: entries.length > 0 ? { label: "See how nAia knows this", hideLabel: "Show less" } : undefined,
    entries,
  };
}

const ATTRIBUTE_SOURCE_WORD: Readonly<Record<string, string>> = {
  passport: "what you told nAia",
  closet: "what's already in your Closet",
  styleme: "what you've asked nAia for before",
};

/**
 * Plain-language "why this?" content for a recommendation — composed from the
 * SAME already-humanized attribute labels shown on the card, not raw
 * `evidence[].detail` strings (which are written for audit, not for a
 * customer, and keep their own internal vocabulary deliberately).
 */
function whyThisDetail(
  rec: { body: string; attributes: readonly RecommendationAttribute[] },
  shapeOnly: RecommendationAttribute | undefined,
): string | undefined {
  if (rec.attributes.length === 0) return undefined;
  if (shapeOnly) {
    // "This comes from a different shape — A-line, fitted or flared" just
    // repeated the (now-hidden) attribute label. The wardrobe-limitation
    // reasoning ("your work pieces repeat similar combinations") has exactly
    // one home — "What deserves your attention" — and is never restated
    // here, however tempting a lead-in it would make.
    const colour = rec.attributes.find((a) => a.kind === "colour");
    const parts = [
      "A different cut could give you more ways to combine what you already own.",
      colour ? `${capitalise(colour.label)} is one of the colours you selected in your Passport.` : null,
    ].filter((p): p is string => p !== null);
    return parts.join(" ");
  }
  const sources = [...new Set(rec.attributes.map((a) => ATTRIBUTE_SOURCE_WORD[a.source] ?? a.source))];
  return `This comes from ${joinWithAnd(rec.attributes.map((a) => a.label))} — drawn from ${joinWithAnd(sources)}.`;
}

/**
 * The engine resolves a slot and a register, never a specific garment noun
 * (a full-length "bottom" might be trousers or a skirt) — so the honest,
 * non-invented title folds the ambiguous shape into a plain instruction,
 * register-prefixed, instead of naming a garment type nothing has resolved.
 * "full-length work bottom" becomes "For work, look for a full-length piece
 * in a shape that's different from the ones you already own."
 */
function naturalShapeTitle(rec: { title: string; register: string }): string {
  const bare = rec.title.replace(/^One option to explore:\s*/i, "").replace(/^(a|an)\s+/i, "");
  const registerWord = REGISTER_WORD[rec.register] ?? rec.register;
  // `bare` is "{coverage adjective? }{register} {noun}" — the adjective, if
  // any, is everything before the register word; the noun after it names a
  // garment type nothing has actually resolved, so it's dropped for "piece".
  const [beforeRegister] = bare.split(new RegExp(`\\b${registerWord}\\b`, "i"));
  const adjective = beforeRegister?.trim();
  const prefix = adjective ? `${adjective} ` : "";
  return `For ${registerWord}, look for a ${prefix}piece in a shape that's different from the ones you already own.`;
}

/**
 * Every piece that does not meet a stated coverage preference, named, with
 * the reason and whether something she owns genuinely resolves it. Moved out
 * of the Passport-comparison list: this is an actionable limitation, not
 * provenance. Collapsed by default — the summary sentence is always visible,
 * the per-piece detail is the customer's choice to open.
 */
function buildCoverageBlock(input: WardrobePageInput): PageBlock | null {
  const { needs } = input;
  const registers = needs.registers.filter((r) => r.rawCount > 0 || r.needed);

  const blocked = registers.flatMap((r) => r.blockedPieces ?? []);
  const seenBlocked = new Set<string>();
  const blockedDetail = blocked
    .filter((b) => (seenBlocked.has(b.garmentId) ? false : (seenBlocked.add(b.garmentId), true)))
    .map((b) => ({
      garmentId: b.garmentId,
      name: input.garmentName?.(b.garmentId) ?? "This piece",
      reason: b.reason,
      layers: b.rescuedBy.map((id) => input.garmentName?.(id) ?? "a layer you own"),
      layerIds: b.rescuedBy,
    }));
  if (blockedDetail.length === 0) return null;
  const rescued = blockedDetail.filter((b) => b.layers.length > 0);

  return {
    id: "coverage",
    label: "Coverage",
    kind: "coverage",
    entries: [
      {
        id: "coverage-detail",
        claim: "coverage",
        role: "full",
        body: `${capitalise(numberWord(blockedDetail.length))} ${blockedDetail.length === 1 ? "piece" : "pieces"} may not meet your coverage preferences when worn alone.${
          rescued.length > 0
            ? ` nAia found a potential layering option in your Closet for ${rescued.length === 1 ? "one of them" : `${numberWord(rescued.length)} of them`}.`
            : ""
        }`,
        garmentIds: blockedDetail.map((b) => b.garmentId),
        action: {
          kind: "reveal",
          label: `See ${blockedDetail.length === 1 ? "the piece" : `all ${blockedDetail.length} pieces`}`,
          hideLabel: "Show less",
          garmentIds: blockedDetail.map((b) => b.garmentId),
        },
        meta: { blockedDetail },
      },
    ],
  };
}

/** How each register is named inside a sentence. */
const REGISTER_WORD: Readonly<Record<string, string>> = {
  everyday: "everyday dressing",
  work: "work",
  occasion: "occasion dressing",
};

/** The "Ways to get dressed" card heading for each engine register. */
const REGISTER_LIFE_HEADING: Readonly<Record<string, string>> = {
  everyday: "For everyday",
  work: "For work",
  occasion: "For dinners & events",
};

/**
 * Lifestyle tokens tied to a presentation rule — pulling an already-valid,
 * already-tagged combination out from under a generic register heading and
 * into her own words for it, when her Passport specifically names that life
 * area. Never a new depth/gap/enough computation: `matchesPairing` only reads
 * a pairing's existing `reason` text for the SAME shared-occasion evidence
 * `scorePair` already produces (see wardrobe-intelligence.ts).
 *
 * This is the one place such a rule lives, so a future life area — or a
 * future signal beyond Passport.lifestyle entirely — extends this table
 * without touching the "Ways to get dressed" logic that reads it.
 */
const LIFESTYLE_PRESENTATION: Readonly<Record<string, {
  tokens: ReadonlySet<string>;
  heading: string;
  matchesPairing: (pair: WardrobePairing) => boolean;
}>> = {
  gym: {
    tokens: new Set(["fitness-gym"]),
    heading: "For active / gym days",
    matchesPairing: (pair) => /\btagged these for gym\b/i.test(pair.reason),
  },
};

/** How a register is named inside "Try your X for {phrase}." */
const COMBO_LIFE_PHRASE: Readonly<Record<string, string>> = {
  everyday: "everyday",
  work: "work",
  occasion: "dinners and events",
};

/**
 * A register with genuine depth (a "Plenty of options" verdict) but no
 * selected example is never the same claim as "the Closet cannot make one" —
 * that would assert something the data does not support. Register-specific
 * only so the wording never reads as though it applies to a different card.
 */
const NO_EXAMPLE_SELECTED: Readonly<Record<string, string>> = {
  everyday: "nAia hasn't selected an everyday example to show here yet.",
  work: "nAia hasn't selected a work example to show here yet.",
  occasion: "nAia hasn't selected an occasion example to show here yet.",
};

/**
 * The outfit named in her own words — real garment names, the engine's own
 * evidence, nothing invented. "Try your {first} with {rest} for {phrase}."
 * followed by the engine's own plain-language reason for why they work
 * (structure contrast, colour, shared occasion — whichever it actually found).
 */
function combinationExplanation(
  pair: WardrobePairing,
  lifePhrase: string,
  garmentName: ((id: string) => string | null) | undefined,
): string {
  const names = pair.garmentIds
    .map((id) => garmentName?.(id))
    .filter((n): n is string => typeof n === "string" && n.trim() !== "");
  const reason = plainPairReason(pair.reason, pair.garmentIds.length);
  if (names.length === 0) return reason;

  const [first, ...rest] = names;
  const lead = rest.length > 0
    ? `Try your ${first.toLowerCase()} with ${joinWithAnd(rest.map((n) => n.toLowerCase()))} for ${lifePhrase}.`
    : `Try your ${first.toLowerCase()} for ${lifePhrase}.`;
  return `${lead} ${reason}`;
}

const DRESS_LEVEL_PHRASE: Readonly<Record<string, string>> = {
  everyday: "on the more everyday, relaxed side",
  work: "on the more polished, work-ready side",
  occasion: "on the dressier, occasion side",
};

/** Short form of the same fact, for the always-visible summary line. */
const DRESS_LEVEL_SHORT: Readonly<Record<string, string>> = {
  everyday: "relaxed, everyday",
  work: "polished, work-ready",
  occasion: "dressier, occasion",
};

// ── Repetition control ────────────────────────────────────────────────────────
//
// Merging blocks is not enough on its own. Inside a single garment entry the
// hero reason and the rediscovery note routinely state the same fact in two
// sentences — "Pairs easily with 9 other pieces" and "9 pieces you own work
// with it" — and the Passport-match sentence was printed against four separate
// garments. So sentences carry FACT SIGNATURES, and a sentence whose facts have
// all been stated already is dropped.
//
// Scope matters. A partner count is only a repeat within the same entry, since
// two different pieces may each work with six things. Boilerplate like the
// Passport-match sentence is a repeat across the whole page.

const ENTRY_FACTS: ReadonlyArray<{ re: RegExp; sig: (m: RegExpMatchArray) => string }> = [
  { re: /\b(\d+)\s+(?:other\s+)?pieces?\b/i, sig: (m) => `partners:${m[1]}` },
  { re: /one of your favourites|marked this as one of your favourites/i, sig: () => "favourite" },
  { re: /difficult to style|struggle to style|hard to style/i, sig: () => "difficulty" },
  { re: /fewer (?:natural )?partners|fewer ways to wear/i, sig: () => "isolated" },
];

const PAGE_FACTS: ReadonlyArray<{ re: RegExp; sig: () => string }> = [
  { re: /matches the style and colours you described in your Passport/i, sig: () => "passport-match" },
];

function splitSentences(text: string): string[] {
  return text.match(/[^.!?]+[.!?]+(?:\s|$)|[^.!?]+$/g)?.map((t) => t.trim()).filter(Boolean) ?? [];
}

function signaturesOf(sentence: string, patterns: ReadonlyArray<{ re: RegExp; sig: (m: never) => string }>): string[] {
  const out: string[] = [];
  for (const p of patterns) {
    const m = sentence.match(p.re);
    if (m) out.push(p.sig(m as never));
  }
  return out;
}

/**
 * Drops sentences whose facts are already on the record. Returns "" when every
 * sentence was a repeat; the caller decides what that means, because the answer
 * differs by field. A supporting line that says nothing new should disappear
 * entirely — that is the whole point — while an entry's main body has to keep
 * something, since an entry with no words is worse than one that echoes.
 */
function pruneSentences(text: string, entryLedger: Set<string>, pageLedger: Set<string>): string {
  const sentences = splitSentences(text);
  if (sentences.length === 0) return text;

  const kept: string[] = [];
  for (const sentence of sentences) {
    const entrySigs = signaturesOf(sentence, ENTRY_FACTS);
    const pageSigs = signaturesOf(sentence, PAGE_FACTS);
    const sigs = [...entrySigs, ...pageSigs];
    const repeat = sigs.length > 0 && sigs.every((s) => entryLedger.has(s) || pageLedger.has(s));
    if (repeat) continue;
    for (const s of entrySigs) entryLedger.add(s);
    for (const s of pageSigs) pageLedger.add(s);
    kept.push(sentence);
  }
  return kept.join(" ");
}

/** Reading-order pass. Runs last, so it sees the page exactly as printed. */
function pruneRepetition(sections: PageSection[]): PageSection[] {
  const pageLedger = new Set<string>();
  const META_TEXT_KEYS = ["reason", "rediscover", "note"] as const;

  for (const section of sections) {
    for (const block of section.blocks) {
      for (const entry of block.entries) {
        const entryLedger = new Set<string>();
        if (entry.body) {
          const pruned = pruneSentences(entry.body, entryLedger, pageLedger);
          // The body is the entry's voice — it keeps its first sentence even
          // when that sentence is a repeat, rather than leaving a silent entry.
          entry.body = pruned === "" ? splitSentences(entry.body)[0] ?? entry.body : pruned;
        }
        const meta = entry.meta as Record<string, unknown> | undefined;
        if (!meta) continue;
        for (const key of META_TEXT_KEYS) {
          const value = meta[key];
          if (typeof value !== "string" || value === "") continue;
          const pruned = pruneSentences(value, entryLedger, pageLedger);
          // A supporting line with nothing new to say is removed outright.
          if (pruned === "") delete meta[key];
          else meta[key] = pruned;
        }
      }
    }
  }
  return sections;
}

// ── Small helpers ─────────────────────────────────────────────────────────────

/**
 * "You have enough of this" and "another one is not a priority" are the same
 * claim, and the engine words the advice in both. Appended verbatim they read
 * as the conclusion stated twice, so the second is only added when the first
 * does not already say don't-buy-another.
 */
const ALREADY_ADVISES = /unlikely to materially expand|would add very little|another similar piece|strengthening your/i;

/**
 * Removes a leading sentence that only repeats the gap. Never removes the whole
 * body — if the proposal is nothing but a restatement, it is left alone and the
 * repetition is visible rather than the entry being silently emptied.
 */
const GAP_RESTATEMENT = /repeats? (?:one formula|similar combinations)|mostly make the same outfit|repeat similar combinations/i;

export function dropGapRestatement(body: string): string {
  const sentences = body.match(/[^.!?]+[.!?]+(?:\s|$)|[^.!?]+$/g)?.map((t) => t.trim()).filter(Boolean) ?? [];
  if (sentences.length <= 1) return body;
  if (!GAP_RESTATEMENT.test(sentences[0])) return body;
  return sentences.slice(1).join(" ");
}

export function mergeEnough(findingBody: string, consequenceBody: string | null): string {
  if (consequenceBody === null) return findingBody;
  if (ALREADY_ADVISES.test(findingBody)) return findingBody;
  return `${findingBody} ${consequenceBody}`;
}

function basisLine(count: number, confidence: ClosetConfidence): string {
  const base = `Based on the ${count} ${count === 1 ? "piece" : "pieces"} you've added to your Closet.`;
  if (confidence === "mostly") return `${base} You've told nAia this is most of what you wear.`;
  if (confidence === "still-adding") return `${base} You've told nAia you're still adding pieces.`;
  return base;
}

function joinWithAnd(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/** Small numbers read better as words in a sentence. */
function numberWord(n: number): string {
  return ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"][n] ?? String(n);
}

function capitalise(text: string): string {
  return text.length === 0 ? text : text[0].toUpperCase() + text.slice(1);
}

// ── Audit ─────────────────────────────────────────────────────────────────────

export interface ClaimLocation {
  claim: ClaimKey;
  section: SectionId;
  block: string;
  entry: string;
  role: EntryRole;
}

/**
 * Every claim and where it appears. This is the one-home-per-claim proof, and
 * the acceptance evidence is generated from it rather than read by eye.
 */
export function auditClaims(page: WardrobePage): ClaimLocation[] {
  const out: ClaimLocation[] = [];
  for (const section of page.sections) {
    for (const block of section.blocks) {
      for (const entry of block.entries) {
        out.push({
          claim: entry.claim,
          section: section.id,
          block: block.id,
          entry: entry.id,
          role: entry.role,
        });
      }
    }
  }
  return out;
}

/** Claims explained more than once. Must always be empty. */
export function duplicateClaims(page: WardrobePage): ClaimKey[] {
  const counts = new Map<ClaimKey, number>();
  for (const loc of auditClaims(page)) {
    if (loc.role !== "full") continue;
    counts.set(loc.claim, (counts.get(loc.claim) ?? 0) + 1);
  }
  return [...counts.entries()].filter(([, n]) => n > 1).map(([c]) => c);
}

/** Visible copy, for the before/after reduction measurement. */
export function visibleCopy(page: WardrobePage): string[] {
  const out: string[] = [page.basis];
  if (page.reading) out.push(page.reading);
  if (page.readyNote) out.push(page.readyNote);
  for (const section of page.sections) {
    out.push(section.title);
    if (section.sub) out.push(section.sub);
    for (const block of section.blocks) {
      if (block.label) out.push(block.label);
      if (block.summary) out.push(block.summary);
      if (block.note) out.push(block.note);
      if (block.disclosure) out.push(block.disclosure.label);
      for (const entry of block.entries) {
        if (entry.title) out.push(entry.title);
        if (entry.body) out.push(entry.body);
        const meta = entry.meta ?? {};
        for (const key of ["reason", "rediscover", "note", "noteHead", "stateText"]) {
          const v = meta[key];
          if (typeof v === "string" && v !== "") out.push(v);
        }
        if (entry.action) {
          out.push(entry.action.label);
          if (entry.action.kind === "reveal" && entry.action.detail) out.push(entry.action.detail);
        }
      }
    }
  }
  return out;
}
