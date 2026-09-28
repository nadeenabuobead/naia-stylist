// app/lib/ai/wardrobe-copy.ts
//
// PRESENTATION LAYER for Wardrobe Intelligence.
//
// The engine decides WHAT is true. This file decides HOW it is said. Nothing
// here computes, ranks, scores, thresholds or filters on evidence — every
// function takes something the engine already concluded and returns the words
// for it. If a change would require knowing anything about garments, it does
// not belong in this file.
//
// It exists because the engine's vocabulary is precise and the customer's is
// not. "Substantial visual weight", "closet connector", "A-line", "reads
// deliberate" and "wardrobe roles" are all exactly right internally and all
// mean nothing to someone who does not think about clothes for a living.
//
// Rule for every string below: a person with no fashion knowledge should
// understand it on first read, without the sentence sounding written down to.

import type {
  HeroLabel,
  WardrobeTrait,
} from "~/lib/ai/wardrobe-intelligence";
import type { RegisterId, RegisterReading, WardrobeNeeds, SynthesisLine } from "~/lib/ai/wardrobe-needs";

// ── Registers ─────────────────────────────────────────────────────────────────

/** What the customer calls these parts of her life. */
const REGISTER_HEADING: Readonly<Record<RegisterId, string>> = {
  everyday: "Everyday",
  work: "Work",
  occasion: "Dinners & events",
};

export type DepthState =
  | "strong"
  | "limited-variety"
  | "needs-range"
  | "less-than-it-looks"
  | "empty"
  | "learning";

/**
 * The engine's depthLabel is a precise internal statement. This maps it — and
 * only it — onto the customer's words. The state is READ from the engine's
 * conclusion, never recomputed: the same six shapes in, the same six out.
 */
function depthStateOf(depthLabel: string): DepthState {
  if (depthLabel.startsWith("Strong ")) return "strong";
  if (depthLabel.startsWith("Workable ")) return "limited-variety";
  if (depthLabel.startsWith("Limited usable ")) return "needs-range";
  if (depthLabel.includes("looks bigger than it really is")) return "less-than-it-looks";
  if (depthLabel === "Nothing here yet") return "empty";
  return "learning";
}

const DEPTH_STATE_TEXT: Readonly<Record<DepthState, string>> = {
  strong: "Strong",
  "limited-variety": "Covered, with limited variety",
  "needs-range": "Needs more range",
  "less-than-it-looks": "Smaller than it looks",
  empty: "Nothing here yet",
  learning: "Still learning",
};

export interface RegisterDisplay {
  heading: string;
  state: DepthState;
  stateText: string;
  /** One plain sentence. Prefers the engine's own note where it already reads well. */
  plain: string;
  needed: boolean;
}

export function registerDisplay(r: RegisterReading): RegisterDisplay {
  const state = depthStateOf(r.depthLabel);

  // The engine's depthNote is already written for the customer in four of the
  // six states, so it is used as-is rather than paraphrased into something
  // less precise. Only "strong" and "limited-variety" are restated, because
  // their engine wording leans on "usable combinations" and "range".
  const plain =
    state === "strong"
      ? "Plenty of useful options."
      : state === "limited-variety"
        ? "You can dress for this, but there's less room to vary the look."
        : r.depthNote;

  return {
    heading: REGISTER_HEADING[r.register],
    state,
    stateText: DEPTH_STATE_TEXT[state],
    plain,
    needed: r.needed,
  };
}

// ── Heroes ────────────────────────────────────────────────────────────────────

/** Hero labels as a description of what the piece DOES, not what we call it. */
const HERO_LABEL_PLAIN: Readonly<Record<HeroLabel, string>> = {
  "most-versatile": "Most versatile",
  "closet-connector": "Works across relaxed and polished looks",
  "passport-match": "Matches your style",
  "your-favourite": "Your favourite",
  "untapped-hero": "Underused",
};

/**
 * Intention labels re-voiced as GARMENT capability.
 *
 * INTENTION_LABELS is written for the customer's own choice — "feel like
 * yourself" — which is right when she picked it. These same keys are also used
 * to count approved garment ratings, where nothing has been matched to her, so
 * the second-person feeling would be a claim the data cannot make.
 */
const CAPABILITY_LABELS: Readonly<Record<string, string>> = {
  "feel-like-myself":  "looking like yourself",
  "confidence":        "confidence",
  "ground-me":         "feeling grounded",
  "give-structure":    "structure",
  "make-it-easy":      "easy dressing",
  "feel-put-together": "put-together looks",
  "feel-attractive":   "feeling attractive",
  "give-energy":       "energy",
  "feel-softer":       "softer looks",
  "feel-sharper":      "sharper looks",
  "feel-less-exposed": "more coverage",
  "express-myself":    "self-expression",
};

export function capabilityLabel(intention: string, fallback: string): string {
  return CAPABILITY_LABELS[intention] ?? fallback;
}

export function heroLabel(label: HeroLabel, fallback: string): string {
  return HERO_LABEL_PLAIN[label] ?? fallback;
}

// ── Wardrobe DNA character ────────────────────────────────────────────────────

/**
 * Trait labels, keyed on the engine's stable trait id. "Neutral-led" and
 * "Substantial visual weight" are accurate and opaque; these say the same thing
 * in the customer's words. The engine's evidence line sits underneath unchanged.
 */
const TRAIT_LABEL_PLAIN: Readonly<Record<string, string>> = {
  "neutral-led": "Mostly neutral",
  "colour-led": "Mostly colour",
  structured: "Mostly structured shapes",
  relaxed: "Mostly relaxed shapes",
  "register-everyday": "Built mostly for everyday",
  "register-work": "Built mostly for work",
  "register-occasion": "Built mostly for occasions",
  "weight-light": "Mostly light, fine fabrics",
  "weight-substantial": "Mostly heavier, weightier pieces",
};

export function traitLabel(trait: WardrobeTrait): string {
  const known = TRAIT_LABEL_PLAIN[trait.id];
  if (known) return known;
  // "Black-anchored" and friends: say which colour the wardrobe is built around.
  const anchor = /^(.+)-anchored$/i.exec(trait.label);
  if (anchor) return `${anchor[1]} is your main base colour`;
  return trait.label;
}

// ── Pairing explanations ──────────────────────────────────────────────────────

/**
 * Why two pieces work together, without fashion vocabulary.
 *
 * Each rule below rewrites ONE sentence the engine can produce. The evidence is
 * unchanged — the same pairing, the same reason, the same rank — only the words
 * differ. Anything unrecognised is passed through untouched rather than
 * mangled, so a future engine reason degrades to the engine's own wording
 * instead of disappearing.
 */
/** Placeholder the pair rewrites use until the row's garment count is known. */
const PIECE_SUBJECT = "__PIECES__";

const PAIR_REWRITES: ReadonlyArray<[RegExp, (m: RegExpExecArray) => string]> = [
  [
    /^You've tagged these for (.+)\.$/,
    // "both" is filled in by plainPairReason once it knows how many pieces the
    // row actually shows — saying "both" over three images contradicts them.
    (m) => `You've tagged ${PIECE_SUBJECT} for ${m[1]}.`,
  ],
  [
    /^One is tailored and the other relaxed — the structure is what makes it read deliberate\.$/,
    () => "The structured piece balances the softer one, so the outfit still feels put together.",
  ],
  [
    /^Both sit in the same (.+) family\.$/,
    (m) => `Both are ${m[1]} tones, so the colours sit together easily.`,
  ],
  [
    /^The (.+) anchors the (.+)\.$/,
    (m) => `The ${m[1]} is the calmer colour and balances the ${m[2]}.`,
  ],
  [
    /^One of them is a wardrobe neutral, so the pairing stays easy\.$/,
    () => "One of these is an easy colour, which keeps the combination simple.",
  ],
  [
    /^Both are wardrobe neutrals, so nothing competes\.$/,
    // Kept count-agnostic: this can land on a three-piece row.
    () => `The colours here are all easy ones, so nothing competes.`,
  ],
  [
    /^A (.+) shape against an? (.+) one keeps the proportions clear\.$/,
    (m) => `The ${m[1]} piece balances the fuller ${m[2]} one, so the outfit doesn't look bulky.`,
  ],
  [
    /^One carries more visual weight than the other, which stops the pairing flattening\.$/,
    () => "One piece is heavier-looking than the other, which stops the outfit looking flat.",
  ],
  [
    /^They sit at the same level of dress\.$/,
    () => "Both are about equally dressed up, so neither looks out of place next to the other.",
  ],
  [
    /^Their levels of dress sit next to each other\.$/,
    () => "They're dressed up to a similar degree, so they work together comfortably.",
  ],
];

function rewriteOneReason(sentence: string): string {
  for (const [pattern, rewrite] of PAIR_REWRITES) {
    const match = pattern.exec(sentence);
    if (match) return rewrite(match);
  }
  return sentence;
}

/**
 * The engine joins its two strongest reasons into one string separated by a
 * space (see toPairing in wardrobe-intelligence.ts). Each must be rewritten on
 * its own — matching across the join produced sentences that read as one claim
 * and said something the engine never concluded.
 */
/**
 * @param pieceCount how many garments the row shows. The copy must never
 *   contradict the images beside it: "both" over three thumbnails is wrong.
 */
/**
 * Sentences that say nothing specific about THESE pieces.
 *
 * "The colours here are all easy ones" is true of half a neutral wardrobe. Next
 * to a real observation about structure or proportion it is padding, and the
 * feedback asked for it to go wherever structured evidence exists. It survives
 * only when it is the only thing the engine could say.
 */
const GENERIC_PAIR_SENTENCE = /colours here are all easy ones|an easy colour, which keeps/i;

export function plainPairReason(reason: string, pieceCount = 2): string {
  const subject =
    pieceCount <= 2 ? "both of these" : pieceCount === 3 ? "all three of these" : "these pieces";
  const sentences = reason.match(/[^.]+\./g);
  const rewritten = sentences
    ? sentences.map((sentence) => rewriteOneReason(sentence.trim()))
    : [rewriteOneReason(reason.trim())];

  const specific = rewritten.filter((t) => !GENERIC_PAIR_SENTENCE.test(t));
  const kept = specific.length > 0 ? specific : rewritten;

  return kept.join(" ").split(PIECE_SUBJECT).join(subject);
}

// ── Sentence-level rewrites used across several sections ──────────────────────

/**
 * Phrases the engine uses in free text. Applied in order, each at most once per
 * string. Deliberately narrow: these replace known wordings, never guess.
 */
/**
 * Engine prose is written with BOTH apostrophe characters — ASCII ' in most
 * places and the typographic ’ in others. A pattern written with one silently
 * fails against the other, which is exactly how "but it hasn’t appeared in one
 * of your nAia looks yet" survived every rewrite and reached the page.
 *
 * `rx` builds a pattern where every apostrophe matches either character, so a
 * rule can never again depend on which one an engine author happened to type.
 */
function rx(source: string, flags = "g"): RegExp {
  return new RegExp(source.replace(/'/g, "['\u2019]"), flags);
}

const PHRASE_REWRITES: ReadonlyArray<[RegExp, string]> = [
  // Heroes
  [rx("\\bSits comfortably with\\b"), "Pairs easily with"],
  [rx("\\bIts colour behaves as a wardrobe neutral, so it rarely limits what it goes with\\."),
   "Its colour goes with almost anything, so it rarely limits what you can wear it with."],
  [rx("\\bit goes with everything\\b"), "it goes with almost everything"],
  // Rediscover / heroes — Passport alignment
  [rx("\\bmatches your Passport on style personality and colour\\b"),
   "matches the style and colours you described in your Passport"],
  [rx("\\bMatches your Passport on style personality and colour\\b"),
   "Matches the style and colours you described in your Passport"],
  [rx("\\bstyle personality\\b"), "style"],
  // Registers and roles
  [rx("\\bthe wardrobe roles you need are already represented\\b"),
   "you already have the main types of pieces your wardrobe needs"],
  [rx("\\bacross (\\d+) parts of the wardrobe\\b"), "across $1 different parts of your wardrobe"],
  [rx("\\bPieces that cross registers are what let a wardrobe stretch without growing\\."),
   "Pieces that work for more than one kind of day are what let a wardrobe stretch without getting bigger."],
  [rx("\\bcross registers\\b"), "work across different kinds of day"],
  [rx("\\bregisters\\b"), "kinds of day"],
  [rx("\\bstronger in one register\\b"), "stronger for one kind of day"],
  [rx("\\bone register\\b"), "one kind of day"],
  [rx("\\bregister\\b"), "kind of day"],

  // ── nAia's own selection is never written as the customer's failure ──
  //
  // Absence from a generated look is a fact about what nAia chose. Every one of
  // these previously read as though she had neglected the garment.
  [rx("\\bbut it hasn't appeared in one of your nAia looks yet\\b"),
   "but nAia hasn't used it in a generated look yet"],
  [rx("\\bThis hasn't appeared in one of your nAia looks yet\\b"),
   "nAia hasn't used this piece in a generated look yet"],
  [rx("\\bAnother that hasn't reached one of your nAia looks\\b"),
   "nAia hasn't reached for this one either"],
  [rx("\\bAlso absent from your nAia looks so far\\b"), "nAia hasn't used this one yet either"],
  [rx("\\bIt hasn't appeared in a generated or saved look yet\\b"),
   "nAia hasn't used it in a generated or saved look yet"],
  [rx("\\bbut haven't appeared in a saved or generated look yet\\b"),
   "but nAia hasn't used them in a saved or generated look yet"],
  [rx("\\ba piece you simply haven't styled yet\\b"), "a piece nAia simply hasn't used yet"],
  [rx("\\bhasn't appeared in one of your nAia looks\\b"), "hasn't been used by nAia in a look"],
  [rx("\\bhaven't appeared in a saved or generated look\\b"),
   "haven't been used by nAia in a saved or generated look"],

  // ── nAia does not track wear, so it must never describe it ──
  //
  // "That usually means you're wearing it the same way each time" infers how
  // often and how she wears a garment. nAia holds no wear data at all — the
  // transparency footer says so — and the underlying evidence is a partner
  // count in the compatibility graph. The replacement states that fact.
  [rx("\\bThat usually means you're wearing it the same way each time — not that it's the wrong piece\\."),
   "Fewer partners means fewer different outfits nAia can build around it — not that it's the wrong piece."],
  [rx("\\bThat usually means you're wearing it the same way each time\\b"),
   "Fewer partners means fewer different outfits nAia can build around it"],

  // ── capability is not preference ──
  //
  // This observation counts garments whose intentionPotentials rate "strong".
  // That measures what her Closet CAN do, and the wording turned it into what
  // she WANTS. Audited against her real sessions: feel-put-together is her
  // strongest Closet capability (22 pieces) but only her 6th most-selected
  // intention (12 sessions) — she asks to feel like herself 69 times. The
  // sentence now says capability and nothing more.
  [rx("\\bYour wardrobe is built, above all, to help you (.+)\\."),
   "Your Closet is strongest at helping you $1."],

  // ── "pull the same way" means nothing to a customer ──
  //
  // The claim is that a lot of her wardrobe is strong at ONE feeling, leaving
  // others thinner. The count and the evidence are unchanged; only the words.
  [rx("\\bYour strongest pieces pull the same way\\b"),
   "What your Closet is strongest at"],
  [rx("\\b(\\d+) of your pieces read strongest for that\\. It's a clear strength — and it means other moods have fewer pieces behind them\\."),
   "$1 pieces strongly support that, while some other kinds of look have fewer options behind them."],
  [rx("\\b(\\d+) of your pieces read strongest for that\\b"),
   "$1 pieces strongly support that"],

  // "reads as" — accurate internally, opaque to a customer.
  [rx("\\bpieces nAia has assessed read\\b"), "pieces nAia has looked at are"],
  [rx("\\bwith fit data read\\b"), "nAia could read the fit of are"],
  [rx("\\bcarry (light|medium|substantial) visual weight\\b"), "look $1 rather than heavy or flimsy"],
  [rx("\\bsubstantial visual weight\\b"), "a heavier, more solid look"],
  [rx("\\bvisual weight\\b"), "visual heaviness"],
  // A raw combination count reads as analytics, not help.
  [rx("\\bnAia can build \\d+ combinations from what you own without you adding anything\\b"),
   "nAia can already put these together in plenty of different ways without you adding anything"],
  [rx("\\bcan build \\d+ combinations\\b"), "can already put these together in plenty of ways"],
];

/** Plain-language pass for engine free text. Idempotent and lossless. */
export function plainText(text: string): string {
  let out = text;
  for (const [pattern, replacement] of PHRASE_REWRITES) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

// ── Passport ↔ Closet dimensions ──────────────────────────────────────────────

export type MatchState = "strong" | "uneven" | "partial" | "gap" | "unclear";

const MATCH_STATE_TEXT: Readonly<Record<MatchState, string>> = {
  strong: "Strong match",
  // Inside the palette, but not all of it is there. Deliberately not "strong".
  // "Representation", never "coverage": one line below, COVERAGE means how much
  // of the body she wants covered, and the two readings sat next to each other.
  uneven: "Strong alignment, uneven representation",
  partial: "Partial match",
  gap: "Where there's a gap",
  unclear: "Not yet clear",
};

export interface MatchDimension {
  id: string;
  /** "Colour", "Lifestyle", "Style". */
  dimension: string;
  state: MatchState;
  stateText: string;
  reading: string;
}

/** Which dimension a synthesis line belongs to, from its stable engine id. */
const SYNTH_DIMENSION: Readonly<Record<string, string>> = {
  "synth-colour": "Colour",
  "synth-neutral": "Colour balance",
  "synth-print": "Pattern",
  "synth-direction": "Style",
};

export function matchDimension(
  line: { id: string; kind: "alignment" | "uneven" | "tension" | "unclear"; reading: string },
): MatchDimension {
  const state: MatchState =
    line.kind === "alignment" ? "strong"
      : line.kind === "uneven" ? "uneven"
      : line.kind === "tension" ? "gap"
      : "unclear";
  return {
    id: line.id,
    dimension: SYNTH_DIMENSION[line.id] ?? "Style",
    state,
    stateText: MATCH_STATE_TEXT[state],
    reading: plainText(line.reading),
  };
}

/**
 * Lifestyle coverage as one line, derived from register states the page has
 * already shown. This restates nothing new — it is the same conclusion in the
 * one place a customer looks for "does my Closet fit my life?".
 */
export function lifestyleMatch(displays: RegisterDisplay[]): MatchDimension | null {
  const needed = displays.filter((d) => d.needed);
  if (needed.length === 0) return null;

  const strong = needed.filter((d) => d.state === "strong").map((d) => d.heading.toLowerCase());
  const weak = needed
    .filter((d) => d.state === "needs-range" || d.state === "less-than-it-looks" || d.state === "empty")
    .map((d) => d.heading.toLowerCase());

  if (strong.length > 0 && weak.length > 0) {
    return {
      id: "match-lifestyle",
      dimension: "Lifestyle",
      state: "partial",
      stateText: MATCH_STATE_TEXT.partial,
      reading: `${sentenceCase(joinPlain(strong))} ${strong.length === 1 ? "is" : "are"} well covered. ${sentenceCase(joinPlain(weak))} ${weak.length === 1 ? "has" : "have"} less variety.`,
    };
  }
  if (weak.length === 0) {
    return {
      id: "match-lifestyle",
      dimension: "Lifestyle",
      state: "strong",
      stateText: MATCH_STATE_TEXT.strong,
      reading: "Every kind of dressing you told nAia about is covered by what you own.",
    };
  }
  return {
    id: "match-lifestyle",
    dimension: "Lifestyle",
    state: "gap",
    stateText: MATCH_STATE_TEXT.gap,
    reading: `${sentenceCase(joinPlain(weak))} ${weak.length === 1 ? "has" : "have"} less variety than the life you described.`,
  };
}

/**
 * Passport dimensions the ENGINE already compares but the page was not showing.
 *
 * buildPassportView() emits three: colour, structure and register. Colour is
 * covered better by the palette-coverage reading, and register by the lifestyle
 * line, so only `structure` is surfaced here — as Shape, because "structure" is
 * not a word a customer uses about her own clothes.
 */
const COMPARISON_DIMENSION: Readonly<Record<string, string>> = {
  structure: "Shape",
};

export function comparisonDimension(
  c: { id: string; stated: string; observed: string; reading: string; strength: string },
): MatchDimension | null {
  const dimension = COMPARISON_DIMENSION[c.id];
  if (!dimension) return null;
  // The engine grades its own confidence; "strong" evidence is a match, and
  // anything weaker is reported as partial rather than upgraded.
  const state: MatchState = c.strength === "strong" ? "strong" : "partial";

  // The engine's reading is written to sit UNDER a "you said" row — on its own
  // it dangles ("Your Closet strongly reflects that."). The stated half is
  // folded back in so the line stands by itself, which is the only form the
  // page now shows.
  const reading = `${plainText(c.stated).trim()} ${plainText(c.reading).trim()}`;

  return { id: `match-${c.id}`, dimension, state, stateText: MATCH_STATE_TEXT[state], reading };
}

/**
 * How much of her Closet meets the way she told nAia she prefers to be covered.
 *
 * Deliberately silent when nothing is blocked. A zero here means either "she
 * stated no requirements" or "everything passes", and the page cannot tell
 * those apart from register data alone — so it says nothing rather than
 * claiming a match it has not earned.
 */
export function coverageMatch(
  registers: ReadonlyArray<{ blockedCount: number; usableCount: number; heading: string }>,
): MatchDimension | null {
  const blocked = registers.reduce((sum, r) => sum + r.blockedCount, 0);
  if (blocked === 0) return null;

  const readable = registers.reduce((sum, r) => sum + r.blockedCount + r.usableCount, 0);
  if (readable === 0) return null;

  const worst = [...registers].sort((a, b) => b.blockedCount - a.blockedCount)[0];
  const share = blocked / readable;
  const state: MatchState = share >= 0.25 ? "gap" : "partial";

  return {
    id: "match-coverage",
    dimension: "Coverage",
    state,
    stateText: MATCH_STATE_TEXT[state],
    reading: `${blocked} ${blocked === 1 ? "piece doesn't" : "pieces don't"} meet the way you've told nAia you prefer to be covered${
      worst && worst.blockedCount > 0 ? `, mostly in your ${worst.heading.toLowerCase()} pieces` : ""
    }.`,
  };
}

/**
 * Observations that still have something to say once chapter 3 has spoken.
 *
 * THE SPLIT. Chapter 3 is garment intelligence — versatile pieces, pairings,
 * pieces worth reconsidering. Chapter 4 is what nAia has learned about the
 * CUSTOMER — what she asks for, what she reports back. Observations are
 * garment intelligence, so they belong in chapter 3; this decides which of them
 * chapter 3 should still bother showing.
 *
 * Two rules:
 *
 * 1. A garment-led observation whose LEAD piece already appears in "Pieces
 *    worth another look" is dropped. garmentIds[0] is the piece the headline
 *    names — the rest are its partners — so matching on the lead is exact.
 *    Matching on any garment would drop a six-piece observation because one
 *    supporting thumbnail happened to overlap.
 *
 * 2. `contradiction-alignment-unused` is dropped outright. Its entire content
 *    is "this suits you and works with your Closet, but nAia has not generated
 *    it yet" — a fact about nAia's own past output, not about the wardrobe.
 *    There is no advice underneath it to keep.
 */
const SYSTEM_CENTRIC_KINDS: ReadonlySet<string> = new Set(["contradiction-alignment-unused"]);

/** Kinds whose headline is about one specific piece, named by garmentIds[0]. */
const GARMENT_LED_KINDS: ReadonlySet<string> = new Set([
  "contradiction-potential-struggle",
  "contradiction-favourite-isolated",
  "untapped-potential",
]);

export function visibleObservations<T extends { kind: string; garmentIds: string[] }>(
  observations: readonly T[],
  rediscoverIds: ReadonlySet<string>,
  options: { closetStrengthsShown?: boolean } = {},
): T[] {
  return observations.filter((o) => {
    if (SYSTEM_CENTRIC_KINDS.has(o.kind)) return false;
    // "What your Closet supports best" lists the top three capabilities with
    // their counts. The intention-concentration observation says the same thing
    // about one of them and reads as a second, competing claim.
    if (o.kind === "intention-concentration" && options.closetStrengthsShown) return false;
    if (!GARMENT_LED_KINDS.has(o.kind)) return true;
    const lead = o.garmentIds[0];
    return lead === undefined || !rediscoverIds.has(lead);
  });
}

// ── Summary selection ─────────────────────────────────────────────────────────

/**
 * Which underlying conclusion a headline is about.
 *
 * The engine ranks headlines and caps them at five. Several can still be the
 * same conclusion seen from two angles — "enough everyday tops" and "enough
 * everyday bottoms" are one finding wearing two hats, and so are the two
 * palette readings. This groups by subject so the summary shows a customer
 * three or four DIFFERENT things.
 *
 * Selection only. Nothing is re-ranked: the engine's order is preserved and the
 * first headline of each subject wins.
 */
export function headlineTopic(id: string): string {
  if (id.startsWith("enough-")) {
    // enough-<register>:<slot>:<band> — the register is the subject.
    return `enough:${id.slice("enough-".length).split(":")[0]}`;
  }
  if (id.startsWith("need-")) {
    return `need:${id.slice("need-".length).split("-")[0]}`;
  }
  if (id === "synth-colour" || id === "synth-neutral") return "palette";
  if (id.startsWith("synth-")) return id;
  if (id.startsWith("styleme-")) return "styleme";
  return id;
}

/**
 * Short headline for a Passport↔Closet reading. The engine's `reading` is a
 * full sentence — right as an explanation, too long as a heading.
 */
function synthHeadline(line: SynthesisLine): string {
  switch (line.id) {
    case "synth-colour":
      return line.kind === "alignment"
        ? "Your colours match your Passport"
        : line.kind === "uneven"
          ? "Part of your palette is barely there"
          : "Your colours and your Passport differ";
    case "synth-neutral":
      return line.kind === "alignment"
        ? "Your Closet is as neutral as you said you like"
        : "You said colour, but your Closet is mostly neutral";
    case "synth-print":
      return "Your Closet keeps patterns to a minimum, as you said";
    case "synth-direction":
      return "Your style answer is out of date";
    default:
      return line.reading;
  }
}

export interface SummaryEntry {
  id: string;
  headline: string;
  /** One plain sentence. Empty when the headline already says everything. */
  explain: string;
}

/**
 * The page's opening conclusions.
 *
 * Selection and wording only. The engine ranked its headlines and capped them
 * at five; this keeps that order, drops any whose SUBJECT has already been
 * covered, stops at four, and pairs each with the fuller explanation the engine
 * already wrote for it. No finding is created, re-ranked or re-evidenced here.
 */
export function summaryEntries(needs: WardrobeNeeds): SummaryEntry[] {
  const findings = new Map(
    [...needs.couldUseMore, ...needs.enough].map((f) => [f.id, f]),
  );
  const synth = new Map(needs.synthesis.lines.map((l) => [l.id, l]));

  const out: SummaryEntry[] = [];
  const seen = new Set<string>();

  for (const headline of needs.headlines) {
    const topic = headlineTopic(headline.id);
    if (seen.has(topic)) continue;

    const finding = findings.get(headline.id);
    if (finding) {
      // The summary states the conclusion; the deeper section carries the full
      // reasoning. Taking only the first sentence keeps the two from reading as
      // the same paragraph printed twice.
      out.push({ id: headline.id, headline: finding.title, explain: firstSentence(plainText(finding.body)) });
    } else {
      const line = synth.get(headline.id);
      if (line) {
        out.push({ id: headline.id, headline: synthHeadline(line), explain: plainText(line.reading) });
      } else if (headline.id === "no-urgent-need") {
        out.push({
          id: headline.id,
          headline: "Nothing obvious is missing right now",
          explain: plainText(headline.text),
        });
      } else {
        out.push({ id: headline.id, headline: plainText(headline.text), explain: "" });
      }
    }

    seen.add(topic);
    if (out.length >= 4) break;
  }
  return out;
}

/**
 * "Enough everyday neutral tops" and "enough everyday neutral bottoms" are the
 * same finding about two halves of the same outfit, and the engine writes them
 * an identical explanation. Printed as two entries they read as two discoveries.
 * Grouping is presentation only — no finding is dropped, and the garment ids of
 * every member are preserved.
 */
export interface EnoughGroup {
  id: string;
  title: string;
  body: string;
  garmentIds: string[];
  /**
   * The register the group speaks for. Carried through because the page model
   * keys the "you have enough of this" claim on it, so the matching "another
   * one is not a priority" entry can be recognised as the same finding.
   * Members of a group always share a register — they are two halves of one
   * outfit ("tops and bottoms"), never two different kinds of dressing.
   */
  register: string;
}

export function groupEnough(
  findings: ReadonlyArray<{ id: string; title: string; body: string; garmentIds: string[]; register?: string }>,
): EnoughGroup[] {
  const byBody = new Map<string, typeof findings[number][]>();
  for (const f of findings) {
    const key = plainText(f.body);
    byBody.set(key, [...(byBody.get(key) ?? []), f]);
  }

  return [...byBody.entries()].map(([body, group]) => {
    if (group.length === 1) {
      return {
        id: group[0].id,
        title: group[0].title,
        body,
        garmentIds: group[0].garmentIds,
        register: group[0].register ?? "",
      };
    }
    // "You already have enough everyday neutral tops" + "…bottoms"
    //   → "You already have enough everyday neutral tops and bottoms"
    const subjects = group.map((f) => f.title.replace(/^You already have enough /, ""));
    return {
      id: group.map((f) => f.id).join("+"),
      title: `You already have enough ${joinPlain(subjects)}`,
      body,
      garmentIds: group.flatMap((f) => f.garmentIds),
      register: group[0].register ?? "",
    };
  });
}

// ── Small helpers ─────────────────────────────────────────────────────────────

function joinPlain(items: string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** The first sentence of a paragraph, kept whole. */
function firstSentence(text: string): string {
  const match = /^[\s\S]*?[.!?](?=\s|$)/.exec(text.trim());
  return match ? match[0].trim() : text.trim();
}

function sentenceCase(s: string): string {
  return s.length === 0 ? s : s[0].toUpperCase() + s.slice(1);
}

export const WARDROBE_COPY_VERSION = "1.0.0";
