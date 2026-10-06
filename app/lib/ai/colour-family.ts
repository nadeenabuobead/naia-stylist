// app/lib/ai/colour-family.ts
//
// B2a — neutral, low-level colour-family semantics. Answers exactly one
// question: "what canonical colour family/families does this text
// represent?" It never answers whether that constitutes a conflict, a
// veto, a score penalty, or an exclusion — those are each feature's own
// policy decision (Buy/Skip, StyleMe, NADINE each already answer this
// question differently; see the B2 recon). This file has ZERO production
// consumers as of B2a — see colour-family.no-consumers.test.ts.
//
// Mirrors, rather than imports, the canonical constants in
// app/lib/admin/garment-intelligence-v1.server.ts (NEUTRAL_COLORS lines
// 36-43, COLOUR_FAMILY_MAP lines 49-85, PASSPORT_COLOUR_FAMILY_MAP lines
// 244-256). That file is Lane A's Garment Intelligence territory (Phase
// 3C, shadow/admin-only by its own header) and is NOT edited here — see
// the B2a report for why. colour-family.parity.test.ts extracts the real
// source text mechanically (the same technique the B2 recon used to prove
// its diagnostic was byte-identical) and asserts zero drift for every
// currently enumerated entry; it fails loudly, not silently, if either
// file changes out from under the other. Migrating GI's own private copy
// to import from this file instead is a later, coordinated cleanup, not
// part of B2a.

export type HueFamily =
  | "red" | "pink" | "orange" | "yellow"
  | "green" | "blue" | "purple"
  | "grey" | "brown";

export type PassportFamily =
  | "black" | "white-cream" | "beige-brown" | "grey" | "navy" | "red-burgundy";

/**
 * What a piece of colour text resolves to. Three independent axes — a
 * colour can be neutral AND carry a hue family AND carry a Passport family
 * at once (navy is hueFamily="blue", isNeutral=true, passportFamily="navy").
 * `unknown` is true only when NONE of the other three axes found anything
 * — it is not the same as "recognised, but has no hue family" (khaki is
 * recognised as neutral with zero hue/passport families; that is not
 * `unknown`).
 */
export interface ColourFamilyResolution {
  /** Deterministically ordered (fixed hue order below), de-duplicated. Empty when none recognised. */
  hueFamilies: HueFamily[];
  /** True when the input is, or contains, a token from the canonical neutral set. */
  isNeutral: boolean;
  /** Deterministically ordered, de-duplicated. Empty when none recognised. */
  passportFamilies: PassportFamily[];
  /** True only when nothing at all was recognised — no hue family, no passport family, not neutral. */
  unknown: boolean;
}

const HUE_FAMILY_ORDER: readonly HueFamily[] = ["red", "pink", "orange", "yellow", "green", "blue", "purple", "grey", "brown"];
const PASSPORT_FAMILY_ORDER: readonly PassportFamily[] = ["black", "white-cream", "beige-brown", "grey", "navy", "red-burgundy"];

// ── Verbatim mirror of garment-intelligence-v1.server.ts — see file header ──

const NEUTRAL_COLORS: ReadonlySet<string> = new Set([
  "black", "white", "grey", "gray", "beige", "cream", "ivory", "off-white",
  "navy", "stone", "charcoal", "taupe", "tan", "camel", "brown", "nude", "silver", "khaki",
  "dark grey", "dark gray", "off-black",
  "dark brown", "charcoal grey", "charcoal gray",
]);

const COLOUR_FAMILY_MAP: Readonly<Record<string, HueFamily>> = {
  red: "red", crimson: "red", cherry: "red", rose: "red",
  raspberry: "red", burgundy: "red", wine: "red", maroon: "red",
  pink: "pink", blush: "pink", coral: "pink", salmon: "pink",
  fuchsia: "pink", magenta: "pink",
  orange: "orange", rust: "orange", terracotta: "orange",
  amber: "orange", peach: "orange", apricot: "orange", copper: "orange",
  yellow: "yellow", mustard: "yellow", gold: "yellow", lemon: "yellow",
  green: "green", olive: "green", sage: "green",
  emerald: "green", mint: "green", forest: "green", hunter: "green", jade: "green",
  blue: "blue", cobalt: "blue", teal: "blue", turquoise: "blue",
  denim: "blue", indigo: "blue", periwinkle: "blue", navy: "blue",
  purple: "purple", violet: "purple", lilac: "purple", lavender: "purple",
  plum: "purple", mauve: "purple", mulberry: "purple",
  grey: "grey", gray: "grey", charcoal: "grey", silver: "grey", taupe: "grey",
  brown: "brown", tan: "brown", camel: "brown",
  "dark blue": "blue", "dark brown": "brown", "dark green": "green",
  "dark grey": "grey", "dark gray": "grey", "dark red": "red",
  "dark purple": "purple", "dark orange": "orange", "dark navy": "blue",
  "off-black": "grey",
  "charcoal grey": "grey", "charcoal gray": "grey",
  "light blue": "blue", "light pink": "pink",
  "light grey": "grey", "light gray": "grey", "light green": "green",
  "medium blue": "blue", "sky blue": "blue", "chambray": "blue",
  "cornflower blue": "blue", "powder blue": "blue",
};

const PASSPORT_COLOUR_FAMILY_MAP: Readonly<Record<string, PassportFamily>> = {
  "off-black": "black",
  "white": "white-cream", "cream": "white-cream", "ivory": "white-cream", "off-white": "white-cream",
  "beige": "beige-brown", "camel": "beige-brown", "tan": "beige-brown",
  "brown": "beige-brown", "dark brown": "beige-brown",
  "stone": "beige-brown", "taupe": "beige-brown", "nude": "beige-brown",
  "grey": "grey", "gray": "grey", "charcoal": "grey",
  "charcoal grey": "grey", "charcoal gray": "grey",
  "silver": "grey", "dark grey": "grey", "dark gray": "grey",
  "navy": "navy", "dark navy": "navy",
  "red": "red-burgundy", "burgundy": "red-burgundy", "wine": "red-burgundy",
  "maroon": "red-burgundy", "dark red": "red-burgundy",
};

// Exposed read-only, for the parity test only — not for feature consumers
// to branch on membership directly (use the resolver functions below).
export const _MIRRORED_SOURCE_FOR_PARITY_TEST_ONLY = {
  NEUTRAL_COLORS,
  COLOUR_FAMILY_MAP,
  PASSPORT_COLOUR_FAMILY_MAP,
};

// ── Normalization — mechanical and predictable; never strips modifier words ──
//
// Lowercase, trim, collapse repeated internal whitespace. That is all. The
// compound fallback (resolveFreeTextColourFamilies) is where hyphens/
// slashes/commas/conjunctions become token separators — never here, so
// that resolveCanonicalColourFamilies("off-black") still looks up the
// single literal key "off-black" and never accidentally fragments it.
function normalizeWhole(input: string): string {
  return input.trim().toLowerCase().replace(/\s+/g, " ");
}

function emptyResolution(): ColourFamilyResolution {
  return { hueFamilies: [], isNeutral: false, passportFamilies: [], unknown: true };
}

function isBlankOrUnrecognisedSentinel(raw: string): boolean {
  const t = raw.trim().toLowerCase();
  return t === "" || t === "n/a" || t === "unknown" || t === "null" || t === "undefined";
}

function orderedHueFamilies(found: ReadonlySet<HueFamily>): HueFamily[] {
  return HUE_FAMILY_ORDER.filter((f) => found.has(f));
}
function orderedPassportFamilies(found: ReadonlySet<PassportFamily>): PassportFamily[] {
  return PASSPORT_FAMILY_ORDER.filter((f) => found.has(f));
}

/**
 * Exact canonical resolution — a single, whole-string lookup against the
 * same three maps Garment Intelligence already uses, with no tokenizing
 * and no compound fallback. This is the function that must reproduce GI's
 * existing single-coarse-token behavior exactly (see
 * colour-family.parity.test.ts) — it is the right choice for any input
 * that is already reviewed/structured Closet-style colour data, not
 * free-form AI prose.
 */
export function resolveCanonicalColourFamilies(input: string | null | undefined): ColourFamilyResolution {
  if (input === null || input === undefined) return emptyResolution();
  if (isBlankOrUnrecognisedSentinel(input)) return emptyResolution();

  const token = normalizeWhole(input);
  const isNeutral = NEUTRAL_COLORS.has(token);
  const hueFamily = COLOUR_FAMILY_MAP[token];
  const passportFamily = PASSPORT_COLOUR_FAMILY_MAP[token];

  const hueFamilies = hueFamily ? [hueFamily] : [];
  const passportFamilies = passportFamily ? [passportFamily] : [];
  const unknown = !isNeutral && hueFamilies.length === 0 && passportFamilies.length === 0;

  return { hueFamilies, isNeutral, passportFamilies, unknown };
}

// Separators a free-text phrase may use between colour words: whitespace,
// hyphen, slash, comma. Conjunction WORDS (not characters) are filtered
// after splitting, so "navy with cream" and "navy-with-cream" both yield
// the token "with" to be dropped, never silently merged into a colour word.
const TOKEN_SEPARATOR = /[\s\-/,]+/;
const CONJUNCTION_WORDS: ReadonlySet<string> = new Set(["and", "with", "or"]);

function tokenize(normalized: string): string[] {
  return normalized
    .split(TOKEN_SEPARATOR)
    .map((t) => t.trim())
    .filter((t) => t.length > 0 && !CONJUNCTION_WORDS.has(t));
}

/**
 * Free-text resolution — required because Buy/Skip's vision-detected
 * colour (and similar external-candidate sources) is genuine AI prose,
 * not closed Closet vocabulary: "chocolate brown", "deep navy", "soft
 * burgundy" are all real, plausible model output with no corresponding
 * single key in the canonical maps.
 *
 * Algorithm (deliberately in this order):
 *   1. Try resolveCanonicalColourFamilies on the WHOLE normalized string
 *      first. This is what correctly handles compound tokens the maps
 *      already enumerate as a single key ("off-black", "dark blue",
 *      "sky blue", "charcoal grey") — they must resolve directly, never
 *      get fragmented into their component words.
 *   2. Only if that leaves the input fully unexplained (unknown=true),
 *      tokenize on whitespace/hyphen/slash/comma/conjunction and look up
 *      each WHOLE WORD (never a substring of a word) against the same
 *      three maps. A pure modifier word ("chocolate", "deep", "soft")
 *      simply fails every lookup and contributes nothing — no special
 *      modifier list is needed, and nothing is ever inferred from a
 *      fragment of a word.
 *   3. Union every axis found across every token, deterministically
 *      ordered and de-duplicated. A phrase can legitimately resolve to
 *      more than one hue family ("red and blue" -> ["red","blue"]); this
 *      function never collapses that to one arbitrary choice.
 */
export function resolveFreeTextColourFamilies(input: string | null | undefined): ColourFamilyResolution {
  if (input === null || input === undefined) return emptyResolution();
  if (isBlankOrUnrecognisedSentinel(input)) return emptyResolution();

  const whole = resolveCanonicalColourFamilies(input);
  if (!whole.unknown) return whole;

  const normalized = normalizeWhole(input);
  const words = tokenize(normalized);

  const hue = new Set<HueFamily>();
  const passport = new Set<PassportFamily>();
  let isNeutral = false;
  let anyRecognised = false;

  for (const word of words) {
    const r = resolveCanonicalColourFamilies(word);
    if (r.unknown) continue;
    anyRecognised = true;
    if (r.isNeutral) isNeutral = true;
    for (const f of r.hueFamilies) hue.add(f);
    for (const f of r.passportFamilies) passport.add(f);
  }

  return {
    hueFamilies: orderedHueFamilies(hue),
    isNeutral,
    passportFamilies: orderedPassportFamilies(passport),
    unknown: !anyRecognised,
  };
}

/**
 * Pure set-overlap fact: do these two resolutions share at least one
 * recognised family (hue or Passport)? Nothing else — not a conflict, not
 * a veto, not a score, not an exclusion. Deliberately NOT named with any
 * of those words so a future caller can't mistake "these share a family"
 * for "this should be rejected" — that remains each feature's own wrapper
 * (isAvoidColourConflictForBuySkip, scoreAvoidColourForStyleMe,
 * assessColourForNadineProduct — none of which exist yet; B2a exposes no
 * consumer).
 *
 * `isNeutral` is deliberately NOT part of this check: two colours both
 * being neutral (e.g. black and white) does not mean they share a family
 * — neutrality is an independent axis, exactly as it already is in the
 * canonical two-axis colour model (navy is hueFamily="blue" AND
 * isNeutral=true at once; the axes don't collapse into each other).
 */
export function colourFamiliesOverlap(a: ColourFamilyResolution, b: ColourFamilyResolution): boolean {
  if (a.unknown || b.unknown) return false;
  if (a.hueFamilies.some((f) => b.hueFamilies.includes(f))) return true;
  if (a.passportFamilies.some((f) => b.passportFamilies.includes(f))) return true;
  return false;
}
