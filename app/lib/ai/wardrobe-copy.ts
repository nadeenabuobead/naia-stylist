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
  "closet-connector": "Works with the most",
  "passport-match": "Matches your style",
  "your-favourite": "Your favourite",
  "untapped-hero": "Underused",
};

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
const PAIR_REWRITES: ReadonlyArray<[RegExp, (m: RegExpExecArray) => string]> = [
  [
    /^You've tagged these for (.+)\.$/,
    (m) => `You've tagged both of these for ${m[1]}, so they're meant for the same kind of day.`,
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
    (m) => `The ${m[1]} is the calmer colour and balances the ${m[2]}, so the two are easy to wear together.`,
  ],
  [
    /^One of them is a wardrobe neutral, so the pairing stays easy\.$/,
    () => "One of them is a plain colour that goes with almost anything, which makes this an easy pairing.",
  ],
  [
    /^Both are wardrobe neutrals, so nothing competes\.$/,
    () => "Both are plain colours that go with almost anything, so neither one fights the other.",
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
export function plainPairReason(reason: string): string {
  const sentences = reason.match(/[^.]+\./g);
  if (!sentences) return rewriteOneReason(reason.trim());
  return sentences.map((sentence) => rewriteOneReason(sentence.trim())).join(" ");
}

// ── Sentence-level rewrites used across several sections ──────────────────────

/**
 * Phrases the engine uses in free text. Applied in order, each at most once per
 * string. Deliberately narrow: these replace known wordings, never guess.
 */
const PHRASE_REWRITES: ReadonlyArray<[RegExp, string]> = [
  // Heroes
  [/\bSits comfortably with\b/g, "Pairs easily with"],
  [/\bIts colour behaves as a wardrobe neutral, so it rarely limits what it goes with\./g,
   "Its colour goes with almost anything, so it rarely limits what you can wear it with."],
  [/\bit goes with everything\b/g, "it goes with almost everything"],
  // Rediscover / heroes — Passport alignment
  [/\bmatches your Passport on style personality and colour\b/g,
   "matches the style and colours you described in your Passport"],
  [/\bMatches your Passport on style personality and colour\b/g,
   "Matches the style and colours you described in your Passport"],
  [/\bstyle personality\b/g, "style"],
  // Registers and roles
  [/\bthe wardrobe roles you need are already represented\b/g,
   "you already have the main types of pieces your wardrobe needs"],
  [/\bacross (\d+) parts of the wardrobe\b/g, "across $1 different parts of your wardrobe"],
  [/\bPieces that cross registers are what let a wardrobe stretch without growing\./g,
   "Pieces that work for more than one kind of day are what let a wardrobe stretch without getting bigger."],
  [/\bcross registers\b/g, "work across different kinds of day"],
  [/\bregisters\b/g, "kinds of day"],
  [/\bstronger in one register\b/g, "stronger for one kind of day"],
  [/\bone register\b/g, "one kind of day"],
  [/\bregister\b/g, "kind of day"],
  // "reads as" — accurate internally, opaque to a customer.
  [/\bpieces nAia has assessed read\b/g, "pieces nAia has looked at are"],
  [/\bwith fit data read\b/g, "nAia could read the fit of are"],
  [/\bcarry (light|medium|substantial) visual weight\b/g, "look $1 rather than heavy or flimsy"],
  [/\bsubstantial visual weight\b/g, "a heavier, more solid look"],
  [/\bvisual weight\b/g, "visual heaviness"],
  // A raw combination count reads as analytics, not help.
  [/\bnAia can build \d+ combinations from what you own without you adding anything\b/g,
   "nAia can already put these together in plenty of different ways without you adding anything"],
  [/\bcan build \d+ combinations\b/g, "can already put these together in plenty of ways"],
];

/** Plain-language pass for engine free text. Idempotent and lossless. */
export function plainText(text: string): string {
  let out = text;
  for (const [pattern, replacement] of PHRASE_REWRITES) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

// ── StyleMe activity ──────────────────────────────────────────────────────────

/**
 * Large generated-look counts read as analytics, not as help. Past a point the
 * exact figure adds nothing a customer can act on, so it becomes a statement of
 * frequency. The count itself is untouched in the data.
 *
 * Wording stays firmly on the generated side — "nAia builds", never "you wore".
 */
const OFTEN_THRESHOLD = 15;

export function styleMeReachText(appearances: number): string {
  if (appearances >= OFTEN_THRESHOLD) {
    return "nAia reaches for this piece often when styling you.";
  }
  return `nAia has built ${appearances} of your looks around this piece.`;
}

// ── Passport ↔ Closet dimensions ──────────────────────────────────────────────

export type MatchState = "strong" | "partial" | "gap" | "unclear";

const MATCH_STATE_TEXT: Readonly<Record<MatchState, string>> = {
  strong: "Strong match",
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
  line: { id: string; kind: "alignment" | "tension" | "unclear"; reading: string },
): MatchDimension {
  const state: MatchState =
    line.kind === "alignment" ? "strong" : line.kind === "tension" ? "gap" : "unclear";
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
}

export function groupEnough(
  findings: ReadonlyArray<{ id: string; title: string; body: string; garmentIds: string[] }>,
): EnoughGroup[] {
  const byBody = new Map<string, typeof findings[number][]>();
  for (const f of findings) {
    const key = plainText(f.body);
    byBody.set(key, [...(byBody.get(key) ?? []), f]);
  }

  return [...byBody.entries()].map(([body, group]) => {
    if (group.length === 1) {
      return { id: group[0].id, title: group[0].title, body, garmentIds: group[0].garmentIds };
    }
    // "You already have enough everyday neutral tops" + "…bottoms"
    //   → "You already have enough everyday neutral tops and bottoms"
    const subjects = group.map((f) => f.title.replace(/^You already have enough /, ""));
    return {
      id: group.map((f) => f.id).join("+"),
      title: `You already have enough ${joinPlain(subjects)}`,
      body,
      garmentIds: group.flatMap((f) => f.garmentIds),
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
