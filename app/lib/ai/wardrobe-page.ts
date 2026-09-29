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

import type { WardrobeIntelligence, WardrobeObservation } from "~/lib/ai/wardrobe-intelligence";
import type { WardrobeNeeds, DepthFinding, RegisterId } from "~/lib/ai/wardrobe-needs";
import type { WardrobeRecommendations } from "~/lib/ai/wardrobe-recommendations";
import { changeLines, type WardrobeChange } from "~/lib/ai/wardrobe-snapshot";
import {
  registerDisplay,
  summaryEntries,
  lifestyleMatch,
  matchDimension,
  comparisonDimension,
  coverageMatch,
  heroLabel,
  capabilityLabel,
  plainPairReason,
  plainText,
  groupEnough,
} from "~/lib/ai/wardrobe-copy";

// ── Contract ──────────────────────────────────────────────────────────────────

/** The six homes, in reading order. */
export type SectionId = "now" | "works" | "range" | "do" | "possibilities" | "learning";

export const SECTION_ORDER: readonly SectionId[] = [
  "now", "works", "range", "do", "possibilities", "learning",
];

export const SECTION_TITLES: Readonly<Record<SectionId, string>> = {
  now: "Your wardrobe right now",
  works: "What already works",
  range: "Where your wardrobe has less range",
  do: "What to do about it",
  // Deliberately not "what you haven't tried": nAia knows what it has
  // generated, never what she has worn outside the product.
  possibilities: "Possibilities to try",
  learning: "How nAia understands your style",
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
  | { kind: "reveal"; label: string; hideLabel: string; garmentIds: string[] }
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
  "depth-enough": "works",
  "closet-capability": "works",
  garment: "works",
  "depth-gap": "range",
  register: "range",
  recommendation: "do",
  "not-a-priority": "do",
  "buy-verdict": "do",
  pairings: "possibilities",
  untapped: "possibilities",
  "palette-representation": "learning",
  passport: "learning",
  "intentions-chosen": "learning",
  "styleme-dress-level": "learning",
  "outcome-feedback": "learning",
  dna: "now",
  "what-changed": "now",
  explore: "do",
  "do-pairing": "do",
  coverage: "learning",
  "worth-trying": "possibilities",
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
}

// ── Builder ───────────────────────────────────────────────────────────────────

export function buildWardrobePage(input: WardrobePageInput): WardrobePage {
  const { intelligence, needs, recommendations, closetCount } = input;
  const confidence: ClosetConfidence = input.confidence ?? "unknown";
  const ready = intelligence.ready && needs.state === "available";

  const sections = new Map<SectionId, PageBlock[]>();
  for (const id of SECTION_ORDER) sections.set(id, []);
  const add = (id: SectionId, block: PageBlock | null) => {
    if (block && block.entries.length > 0) sections.get(id)!.push(block);
  };

  // ── 1 · Your wardrobe right now ────────────────────────────────────────────
  // The read, and at most three takeaways. Takeaways are POINTERS by
  // construction — their full explanation lives in the section that owns them.
  const findingById = new Map<string, DepthFinding>(
    [...needs.couldUseMore, ...needs.enough].map((f) => [f.id, f]),
  );

  // Built once in section 2 and read again in section 5, so a piece cannot be
  // recomputed into both.
  const garmentSplitRef: { value: { works: PageBlock | null; possibilities: PageBlock | null } | null } = { value: null };

  const nowBlocks: PageBlock[] = [];

  // What moved since last time. First thing in the page when it exists, and
  // absent entirely when it does not — an empty "nothing changed" block teaches
  // the customer to skip this section.
  if (ready && input.change) {
    const lines = changeLines(input.change);
    if (lines.length > 0) {
      nowBlocks.push({
        id: "what-changed",
        label: "What changed since you last looked",
        kind: "change",
        entries: lines.map((text, i) => ({
          id: `change-${i}`,
          claim: `what-changed:${i}`,
          role: "full" as EntryRole,
          body: text,
          garmentIds: [],
        })),
      });
    }
  }

  if (ready) {
    const takeaways: PageEntry[] = summaryEntries(needs)
      .slice(0, 3)
      .map((entry, i) => {
        const finding = findingById.get(entry.id);
        const claim = finding
          ? needs.enough.some((f) => f.id === finding.id)
            ? claims.enough(finding.register)
            : claims.gap(finding.register)
          : entry.id === "no-urgent-need"
            ? "buy-verdict"
            : `summary:${entry.id}`;
        return {
          id: `takeaway-${i}`,
          claim,
          // Always a pointer: the takeaway names the finding, the owning
          // section explains it. This is what stops the opening summary
          // reproducing three full explanations.
          role: "pointer" as EntryRole,
          title: entry.headline,
          garmentIds: [],
        };
      });
    if (takeaways.length > 0) {
      nowBlocks.push({
        id: "takeaways",
        label: "Three things that stand out",
        kind: "takeaways",
        // Framed as a preview, because each headline is repeated verbatim as
        // the title of the entry that explains it further down. Unlabelled,
        // the reader meets the same sentence twice and it reads as padding.
        note: "Each of these is explained below.",
        entries: takeaways,
      });
    }
  }
  // What the Closet is made of. Descriptive only — the CONCLUSIONS about the
  // palette live in the learning section, so the two never restate each other.
  if (ready) {
    const { dna } = intelligence;
    const cells: PageEntry[] = [];
    if (dna.palette.length > 0) {
      cells.push({
        id: "dna-palette", claim: "dna:palette", role: "full",
        title: "Your main colours", garmentIds: [],
        meta: { palette: dna.palette.slice(0, 5) },
      });
    }
    if (dna.shapes.length > 0) {
      cells.push({
        id: "dna-shapes", claim: "dna:shapes", role: "full",
        // Not "shapes you come back to": nAia knows what she OWNS, and says so
        // in its own footer. Coming back to something is wear behaviour, and
        // wear behaviour is not captured.
        title: "Silhouettes that appear most in your Closet", garmentIds: [],
        meta: { shapes: dna.shapes, reading: dna.shapesReading ?? undefined },
      });
    }
    // The three traits — mostly neutral, built for everyday, black-anchored —
    // are the opening read broken into three labelled statistics. Printed under
    // it they say the same thing a second time, in the register the feedback
    // asked us to move away from. The sentence is the better version, so the
    // traits are shown only when there is no reading to carry them.
    if (dna.traits.length > 0 && !intelligence.snapshotReading) {
      cells.push({
        id: "dna-traits", claim: "dna:traits", role: "full",
        title: "Overall character", garmentIds: [],
        meta: { traits: dna.traits },
      });
    }
    if (cells.length > 0) {
      nowBlocks.push({ id: "dna", label: "What your Closet is made of", kind: "dna", entries: cells });
    }
  }

  for (const b of nowBlocks) add("now", b);

  // ── 2 · What already works ─────────────────────────────────────────────────
  if (ready) {
    // Per-garment entries. A piece gets ONE entry carrying everything known
    // about it — its hero label, its rediscovery note, and any contradiction
    // observation about it — so no garment is featured twice.
    const garmentSplit = splitGarmentEntries(buildGarmentBlock(input));
    garmentSplitRef.value = garmentSplit;
    add("works", garmentSplit.works);

    // "You have enough of X" and "another X is not a priority" are the same
    // claim. They are merged here, with the shopping consequence kept.
    const enoughGroups = groupEnough(needs.enough);
    const notAPriorityByRegister = new Map(
      recommendations.notAPriority.map((n) => [n.id.replace(/^not-priority-/, ""), n]),
    );
    const enoughEntries: PageEntry[] = enoughGroups.map((finding) => {
      const consequence = notAPriorityByRegister.get(finding.register);
      return {
        id: finding.id,
        claim: claims.enough(finding.register as RegisterId),
        role: "full" as EntryRole,
        title: finding.title,
        body: mergeEnough(plainText(finding.body), consequence ? plainText(consequence.body) : null),
        garmentIds: finding.garmentIds,
      };
    });
    add("works", {
      id: "enough",
      label: "You have plenty of",
      kind: "findings",
      entries: enoughEntries,
    });

    // Closet capability — reviewed garment ratings, named as such.
    const strengths = needs.intentions.closetStrengths.slice(0, 3);
    if (strengths.length > 0) {
      add("works", {
        id: "capability",
        label: "What your Closet can help with",
        kind: "capability",
        entries: [
          {
            id: "closet-capability",
            claim: "closet-capability",
            role: "full",
            // Says where the numbers come from without implying a person sat
            // down with this particular wardrobe. They are approved garment
            // profiles — a reviewed rating held against each piece — and
            // claiming a personal styling review would describe a service that
            // is not being delivered.
            // These counts come from an approved rating held against each
            // GARMENT. Nothing in them is matched against this customer's
            // Passport, so they cannot say she will feel anything — only what
            // her pieces are rated as able to support.
            // No internal vocabulary: say what was actually looked at. And no
            // claim about how she will feel — these ratings are held against
            // the GARMENT and never compared to her Passport.
            body:
              "These counts show how many of your pieces could help with each type of look. " +
              "They're based on the pieces themselves — not your Style Passport or what you " +
              "usually ask nAia for.",
            garmentIds: [],
            meta: { strengths: strengths.map((c) => ({ ...c, label: capabilityLabel(c.intention, c.label) })) },
          },
        ],
      });
    }
  }

  // ── 3 · Where your wardrobe has less range ─────────────────────────────────
  if (ready) {
    const registers = needs.registers
      .filter((r) => r.rawCount > 0 || r.needed)
      .map((r) => ({ key: r.register, ...registerDisplay(r) }));
    // A register with its own gap finding keeps its verdict but loses its note:
    // the finding directly below says the same thing in more detail, and the
    // two sat one block apart saying "they mostly make the same outfit" twice.
    const explainedByGap = new Set(needs.couldUseMore.map((f) => f.register));
    add("range", {
      id: "registers",
      label: "What you can dress for",
      kind: "registers",
      entries: registers.map((r) => ({
        id: `register-${r.key}`,
        claim: claims.register(r.key as RegisterId),
        role: "full" as EntryRole,
        title: r.heading,
        body: explainedByGap.has(r.key as RegisterId) ? undefined : r.plain,
        garmentIds: [],
        meta: { state: r.state, stateText: r.stateText, needed: r.needed },
      })),
    });

    add("range", {
      id: "gaps",
      // No label: it duplicated the section title directly above it.
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
  }

  // ── 4 · What to do about it ────────────────────────────────────────────────
  // Pairings whose register matches a gap live here, right under the register
  // they answer, instead of behind a jump to a general list further down —
  // the answer to "explore X combinations" should be visible in context.
  const gapRegisterPairings = new Set<string>();
  if (ready) {
    // Using what she owns comes FIRST. The purchase is secondary, and stays
    // secondary in the reading order, not just in tone.
    const gapRegisters = needs.couldUseMore.map((f) => f.register);
    if (gapRegisters.length > 0) {
      const gapRegisterSet = new Set(gapRegisters);
      const matchingPairings = intelligence.pairings.state !== "learning"
        ? intelligence.pairings.pairings.filter((p) => p.register !== null && gapRegisterSet.has(p.register as RegisterId))
        : [];
      matchingPairings.forEach((p) => gapRegisterPairings.add(p.id));

      add("do", {
        id: "use-what-you-own",
        label: "Start with what you already own",
        kind: "pointer-action",
        entries: gapRegisters.map((r) => {
          const found = matchingPairings.some((p) => p.register === r);
          return {
            id: `explore-${r}`,
            claim: `explore:${r}`,
            role: "full" as EntryRole,
            title: `Explore ${REGISTER_WORD[r] ?? r} combinations you already own`,
            body: found
              ? "A combination nAia can support from your Closet is shown below."
              : "There isn't a combination in your Closet for this yet.",
            garmentIds: [],
          };
        }),
      });

      if (matchingPairings.length > 0) {
        add("do", {
          id: "do-pairings",
          // No label: it would repeat "Start with what you already own" above.
          kind: "pairings",
          entries: matchingPairings.map((pair) => ({
            id: pair.id,
            claim: `do-pairing:${pair.id}`,
            role: "full" as EntryRole,
            body: plainPairReason(pair.reason, pair.garmentIds.length),
            garmentIds: pair.garmentIds,
          })),
        });
      }
    }
    add("do", buildVerdictBlock(needs, recommendations, confidence));
    add("do", {
      id: "recommendations",
      label: "What to look for",
      kind: "recommendations",
      entries: recommendations.recommendations.map((rec) => ({
        id: rec.id,
        claim: claims.recommendation(rec.register),
        role: "full" as EntryRole,
        title: rec.title,
        // The proposal opens by restating the gap ("your work pieces repeat
        // similar combinations"), which the section above has just explained
        // in full. What to BUY is the new information; keep that.
        body: dropGapRestatement(rec.body),
        garmentIds: rec.unlocksIds,
        meta: { attributes: rec.attributes },
      })),
    });
  }

  // ── 5 · Possibilities to try ───────────────────────────────────────────────
  if (ready) {
    add("possibilities", garmentSplitRef.value?.possibilities ?? null);
    const { pairings } = intelligence;
    // A combination already shown under "Start with what you already own"
    // is not repeated here — this section is for the other, exploratory ones.
    const remainingPairings = pairings.state !== "learning"
      ? pairings.pairings.filter((p) => !gapRegisterPairings.has(p.id))
      : [];
    if (remainingPairings.length > 0) {
      add("possibilities", {
        id: "pairings",
        label: "Combinations to try with pieces in your Closet",
        kind: "pairings",
        entries: remainingPairings.map((pair) => ({
          id: pair.id,
          claim: `pairings:${pair.id}`,
          role: "full" as EntryRole,
          body: plainPairReason(pair.reason, pair.garmentIds.length),
          garmentIds: pair.garmentIds,
        })),
      });
    }
  }

  // ── 6 · How nAia is learning you ───────────────────────────────────────────
  if (ready) {
    add("learning", buildPassportBlock(input));
    add("learning", buildBehaviourBlock(needs));
  }

  // ── Resolve ────────────────────────────────────────────────────────────────
  const resolved = resolveClaims(sections);

  return {
    closetCount,
    reading: intelligence.snapshotReading ?? null,
    ready,
    readyNote: intelligence.ready ? undefined : (intelligence.readyNote ?? undefined),
    basis: basisLine(closetCount, confidence),
    confidence,
    sections: pruneRepetition(SECTION_ORDER.map((id) => ({
      id,
      title: SECTION_TITLES[id],
      sub: id === "learning"
        ? "Your Style Passport is what you told nAia. Your Closet is what you own."
        : undefined,
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
      if (entries.length > 0) keptBlocks.push({ ...block, entries });
    }
    out.set(sectionId, keptBlocks);
  }
  return out;
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
      e.body = hero.label === "passport-match" && hero.reasons[0]
        ? plainText(hero.reasons[0])
        : plainText(hero.headline);
      if (hero.reasons[0]) e.meta = { ...e.meta, reason: plainText(hero.reasons[0]) };
    }
  }

  for (const piece of opportunities.rediscover) {
    const e = touch(piece.garmentId);
    e.title = e.title ?? piece.name;
    e.meta = { ...e.meta, rediscover: plainText(piece.body) };
    if (piece.worksWithIds.length > 0) {
      e.garmentIds = piece.worksWithIds;
      // The count belongs in the label only when the entry has not already
      // given it. Stated twice in adjacent lines it reads as filler; stated
      // nowhere, the button looks like it might be showing a sample.
      const n = piece.worksWithIds.length;
      const alreadyStated = new RegExp(`\\b${n}\\b`).test(plainText(piece.body));
      e.action = {
        kind: "reveal",
        label: alreadyStated
          ? "See matching pieces"
          : `See ${n} matching ${n === 1 ? "piece" : "pieces"}`,
        hideLabel: "Hide",
        garmentIds: piece.worksWithIds,
      };
    }
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
  const works = block.entries.filter(hasLabel);
  const rest = block.entries.filter((e) => !hasLabel(e));
  return {
    works: works.length > 0 ? { ...block, entries: works } : null,
    possibilities: rest.length > 0
      ? {
          id: "worth-trying",
          label: "Pieces worth another look",
          kind: "garments",
          // Re-keyed to the family owned by THIS section. Left on the `garment`
          // family they were demoted to pointers — which stripped the garment
          // ids and the reveal action, and left the cards with nothing to open.
          entries: rest.map((e) => ({ ...e, claim: e.claim.replace(/^garment:/, "worth-trying:") })),
        }
      : null,
  };
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

function buildPassportBlock(input: WardrobePageInput): PageBlock | null {
  const { intelligence, needs } = input;
  const { passportView } = intelligence;

  const registers = needs.registers
    .filter((r) => r.rawCount > 0 || r.needed)
    .map((r) => ({
      key: r.register,
      blockedCount: r.blockedCount,
      usableCount: r.usableCount,
      blockedPieces: r.blockedPieces ?? [],
      ...registerDisplay(r),
    }));

  const raw = [
    ...(lifestyleMatch(registers) ? [lifestyleMatch(registers)!] : []),
    ...(needs.synthesis.state === "available" ? needs.synthesis.lines.map(matchDimension) : []),
    ...(passportView.state !== "learning"
      ? passportView.comparisons.map(comparisonDimension).filter((m): m is NonNullable<typeof m> => m !== null)
      : []),
    ...(coverageMatch(registers) ? [coverageMatch(registers)!] : []),
  ];

  // Every piece that does not meet a stated preference, named, with the reason
  // and whether something she owns genuinely resolves it.
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
  const rescued = blockedDetail.filter((b) => b.layers.length > 0);

  const seen = new Set<string>();
  const entries: PageEntry[] = [];
  for (const m of raw) {
    if (seen.has(m.dimension)) continue;
    seen.add(m.dimension);
    const isCoverage = m.dimension.toLowerCase() === "coverage";
    entries.push({
      id: m.id,
      claim: isCoverage ? "coverage" : passportClaim(m.dimension),
      role: "full",
      title: m.dimension,
      // Says what it means for HER: on their own, and what she owns that helps.
      body: isCoverage && blockedDetail.length > 0
        ? `${capitalise(numberWord(blockedDetail.length))} ${blockedDetail.length === 1 ? "piece" : "pieces"} may not meet your coverage preferences when worn alone.${
            rescued.length > 0
              ? ` nAia found a potential layering option in your Closet for ${rescued.length === 1 ? "one of them" : `${numberWord(rescued.length)} of them`}.`
              : ""
          }`
        : m.reading,
      garmentIds: isCoverage ? blockedDetail.map((b) => b.garmentId) : [],
      action: isCoverage && blockedDetail.length > 0
        ? {
            kind: "reveal" as const,
            label: `See ${blockedDetail.length === 1 ? "the piece" : `all ${blockedDetail.length} pieces`}`,
            hideLabel: "Hide",
            garmentIds: blockedDetail.map((b) => b.garmentId),
          }
        : undefined,
      meta: {
        state: m.state,
        stateText: m.stateText,
        ...(isCoverage ? { blockedDetail } : {}),
      },
    });
  }

  return { id: "passport", label: "What you told nAia, next to what you own", kind: "matches", entries };
}

/** How each register is named inside a sentence. */
const REGISTER_WORD: Readonly<Record<string, string>> = {
  everyday: "everyday dressing",
  work: "work",
  occasion: "occasion dressing",
};

const DRESS_LEVEL_PHRASE: Readonly<Record<string, string>> = {
  everyday: "on the more everyday, relaxed side",
  work: "on the more polished, work-ready side",
  occasion: "on the dressier, occasion side",
};

function buildBehaviourBlock(needs: WardrobeNeeds): PageBlock | null {
  const entries: PageEntry[] = [];
  const top = needs.styleMe.requests[0] ?? null;

  if (top) {
    const total = needs.styleMe.requests.reduce((sum, r) => sum + r.sessions, 0);
    entries.push({
      id: "dress-level",
      claim: "styleme-dress-level",
      role: "full",
      title: "How you usually want your looks to feel",
      body: `${top.sessions} of the ${total} StyleMe requests nAia could classify were ${DRESS_LEVEL_PHRASE[top.register]}.`,
      garmentIds: [],
    });
  }

  const chosen = needs.intentions.chosen.slice(0, 4);
  if (chosen.length > 0) {
    const dominates = chosen.length > 1 && chosen[0].sessions >= chosen[1].sessions * 2;
    const rest = chosen.slice(1, 4).map((c) => c.label);
    entries.push({
      id: "intentions-chosen",
      claim: "intentions-chosen",
      role: "full",
      title: "What you most often ask to feel",
      body:
        `${capitalise(chosen[0].label)} is ${dominates ? "by far " : ""}what you choose most often` +
        (rest.length > 0 ? `, followed by ${joinWithAnd(rest)}` : "") + ".",
      garmentIds: [],
    });
  }

  const feedback = [needs.outcomes.keptNote, needs.outcomes.changedNote].filter(Boolean).join(" ");
  if (feedback !== "") {
    entries.push({
      id: "outcome-feedback",
      claim: "outcome-feedback",
      role: "full",
      title: "What your feedback is teaching nAia",
      body: feedback,
      garmentIds: [],
    });
  }

  return { id: "behaviour", label: "What your choices show", kind: "history", entries };
}

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
      if (block.note) out.push(block.note);
      for (const entry of block.entries) {
        if (entry.title) out.push(entry.title);
        if (entry.body) out.push(entry.body);
        const meta = entry.meta ?? {};
        for (const key of ["reason", "rediscover", "note", "noteHead", "stateText"]) {
          const v = meta[key];
          if (typeof v === "string" && v !== "") out.push(v);
        }
        if (entry.action) out.push(entry.action.label);
      }
    }
  }
  return out;
}
