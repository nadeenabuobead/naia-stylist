// app/lib/ai/wardrobe-needs.ts
//
// WARDROBE NEEDS — the synthesis layer on top of Wardrobe Intelligence.
//
// Wardrobe Intelligence V1 reads what a wardrobe IS. This layer answers what it
// DOES: where the customer already has enough, where a real opportunity exists,
// and — just as often — that nothing needs buying right now.
//
// Three rules govern everything here.
//
//   1. A count is not a conclusion.
//      "Few pieces" is not a gap and "many pieces" is not sufficiency. A gap
//      exists only where the customer's own stated life asks for a register her
//      wardrobe cannot actually dress her for.
//
//   2. Unknown is not blocked.
//      A garment nAia has not analysed is UNKNOWN. A garment that has been read
//      and contradicts something she told us is BLOCKED. Only BLOCKED pieces may
//      reduce effective depth — otherwise missing analysis would manufacture a
//      gap out of nothing. See classifyUsability().
//
//   3. Generated is not worn.
//      Appearing in a look nAia produced is an nAia-interaction fact. It becomes
//      wear behaviour only through a recorded StyleMeOutcome, and never by
//      inference. See StyleMeReading vs OutcomeReading.
//
// Vocabulary, compatibility scoring and evidence helpers are imported from
// wardrobe-intelligence.ts rather than re-derived, so the two layers cannot
// drift apart on the page.

import {
  FORMALITY_BUCKET,
  FORMALITY_BUCKET_LABEL,
  LIFESTYLE_LABELS,
  lifestyleRegisters,
  TOP_SLOTS,
  BOTTOM_SLOTS,
  ONE_PIECE_SLOTS,
  scorePair,
  STRUCTURED_FITS,
  SOFT_FITS,
  norm,
  ratio,
  countBy,
  topEntries,
  joinList,
  closetColourFamily,
  PASSPORT_COLOUR_FAMILIES,
  ev,
  gradeStrength,
  MIN_WARDROBE_SIZE,
  INTENTION_LABELS,
  classifyUsability,
  layersThatResolve,
  type WardrobeGarment,
  type WardrobePassport,
  type Evidence,
  type EvidenceStrength,
  type BlockState,
  type Usability,
} from "~/lib/ai/wardrobe-intelligence";

// classifyUsability/layersThatResolve/Usability now live in wardrobe-intelligence.ts
// so buildPairings can gate combinations with the same rule — re-exported here so
// every existing consumer of this module is unaffected.
export { classifyUsability, layersThatResolve };
export type { Usability };

// ── Registers ─────────────────────────────────────────────────────────────────

export type RegisterId = "everyday" | "work" | "occasion";

export const REGISTER_IDS: readonly RegisterId[] = ["everyday", "work", "occasion"];

/** Short noun the copy uses: "your everyday dressing". */
/** The register as a bare adjective: "work", not "work dressing". */
const REGISTER_BARE: Readonly<Record<RegisterId, string>> = {
  everyday: "everyday",
  work: "work",
  occasion: "occasion",
};

const REGISTER_NOUN: Readonly<Record<RegisterId, string>> = {
  everyday: "everyday dressing",
  work: "work dressing",
  occasion: "occasion and evening dressing",
};

/** How a register is named inside a depth sentence: "limited depth for X dressing". */
const DEPTH_PHRASE: Readonly<Record<RegisterId, string>> = {
  everyday: "everyday, casual",
  work: "polished, work-ready",
  occasion: "occasion and evening",
};

/** Closet `occasions` tags → register. Only used when formality is unreadable. */
const OCCASION_REGISTER: Readonly<Record<string, RegisterId>> = {
  work: "work", office: "work", business: "work", professional: "work",
  weekend: "everyday", casual: "everyday", everyday: "everyday", daytime: "everyday",
  travel: "everyday", errands: "everyday", home: "everyday",
  evening: "occasion", party: "occasion", formal: "occasion", wedding: "occasion",
  "date night": "occasion", cocktail: "occasion", event: "occasion", celebration: "occasion",
};

/** Passport `dressesFor` tokens → the register that life asks for. */
const DRESSES_FOR_REGISTER: Readonly<Record<string, RegisterId>> = {
  "work-meetings": "work", work: "work", office: "work", "work-days": "work",
  "date-nights": "occasion", dinners: "occasion", events: "occasion",
  "special-occasions": "occasion", parties: "occasion", weddings: "occasion",
  "school-runs": "everyday", weekends: "everyday", "everyday-life": "everyday",
  errands: "everyday", travel: "everyday",
};

/**
 * StyleMe request → register.
 *
 * Both vocabularies are the shipped ones: occasion ids from the StyleMe occasion
 * step, formality ids from its conditional follow-up. The conditional answer is
 * the more specific statement of how dressed-up she wanted to be, so it wins
 * where both exist. An unrecognised id resolves to null — an unreadable request
 * is never bucketed into a register just to have somewhere to put it.
 */
const STYLEME_OCCASION_REGISTER: Readonly<Record<string, RegisterId>> = {
  work: "work",
  dinner: "occasion", date: "occasion", event: "occasion", "night-out": "occasion",
  everyday: "everyday", travel: "everyday", "active-busy-day": "everyday", family: "everyday",
};

const STYLEME_FORMALITY_REGISTER: Readonly<Record<string, RegisterId>> = {
  "formality-relaxed": "everyday",
  "formality-smart": "everyday",
  "formality-polished": "work",
  "formality-occasion": "occasion",
};

export function styleMeSessionRegister(
  occasion: string | null | undefined,
  formalityConditional: string | null | undefined,
): RegisterId | null {
  const formality = norm(formalityConditional ?? null);
  if (formality && STYLEME_FORMALITY_REGISTER[formality]) return STYLEME_FORMALITY_REGISTER[formality];
  const occ = norm(occasion ?? null);
  if (occ && STYLEME_OCCASION_REGISTER[occ]) return STYLEME_OCCASION_REGISTER[occ];
  return null;
}

// ── Thresholds ────────────────────────────────────────────────────────────────
//
// Every threshold below is expressed in COMPLETE LOOKS, not piece counts. A look
// is what the customer actually wears; a piece is only an ingredient. This is
// what lets a four-piece capsule read as well-covered and a twelve-piece pile of
// unwearable-together items read as thin.

/** At or below this many DISTINCT looks a needed register is under-served. */
export const THIN_LOOKS = 2;
/** At or above this many DISTINCT looks, a register has real working depth. */
const DEEP_LOOKS = 4;
/** Usable pieces that make a register redundant rather than simply deep. */
const REDUNDANT_PIECES = 8;
/** A depth cluster must hold at least this many usable pieces to be "enough". */
const ENOUGH_CLUSTER = 5;
/** Raw pieces needed before "you own plenty but few work" is a fair reading. */
const EFFECTIVE_DEPTH_MIN_RAW = 6;
/** Blocked share at which raw depth stops translating into usable depth. */
const EFFECTIVE_DEPTH_BLOCKED_SHARE = 0.5;
/** Outcomes needed before feedback may drive a conclusion. */
const MIN_OUTCOMES_FOR_CLAIM = 3;
/** Generated appearances needed before "nAia repeatedly reaches for" is fair. */
const MIN_APPEARANCES_FOR_REACH = 3;

// ── Inputs ────────────────────────────────────────────────────────────────────

/**
 * One StyleMe session as the needs layer reads it. These are GENERATED looks —
 * proof of what nAia proposed, never proof of what was worn.
 */
export interface StyleMeSessionFact {
  id: string;
  /** Register the session was asked for, when the request made it readable. */
  register: RegisterId | null;
  /** Rev 3 intention answer ids (never re-derived here). */
  intentions: string[];
  /** Closet item ids that appeared in the generated look(s). */
  garmentIds: string[];
}

/** A recorded StyleMeOutcome. This IS wear behaviour, because she reported it. */
export interface OutcomeFact {
  suggestionId: string;
  status: "wore-it" | "changed-something" | "didnt-wear-it";
  register: RegisterId | null;
  garmentIds: string[];
}

export interface WardrobeNeedsInput {
  items: WardrobeGarment[];
  passport: WardrobePassport | null;
  /**
   * null = StyleMe history was not queried. An empty array = it was queried and
   * she has no history. The two must never read the same on the page.
   */
  styleMeSessions: StyleMeSessionFact[] | null;
  /** null = outcomes were not queried; [] = queried, none recorded. */
  outcomes: OutcomeFact[] | null;
}

// ── Outputs ───────────────────────────────────────────────────────────────────

/**
 * A piece that does not meet a stated preference on its own.
 *
 * `rescuedBy` is only populated where the evidence genuinely supports it: a
 * layer she owns, compatible with this piece, that passes the very check this
 * piece fails. Leg coverage can never be rescued this way — a jacket does not
 * lengthen a skirt — so those stay unrescued rather than being given a
 * hopeful-sounding caveat.
 */
export interface BlockedPiece {
  garmentId: string;
  reason: string;
  rescuedBy: string[];
}

export interface RegisterReading {
  register: RegisterId;
  /** Customer-facing register name: "everyday and casual". */
  label: string;

  // ── customer-facing ──
  /** "Strong everyday depth" / "Limited usable occasion depth". */
  depthLabel: string;
  /** What that means for her, in her language. Never a count of internals. */
  depthNote: string;

  // ── internal / diagnostic. Available to tests and debugging; never rendered
  //    as engineering labels on the page. ──
  /** Every piece that reads at this register, before any filter. */
  rawCount: number;
  /** Read, and contradicts nothing she has told nAia. */
  usableCount: number;
  /** Read, and contradicts something she has told nAia. */
  blockedCount: number;
  /**
   * The pieces that contradict a stated dressing preference, each with the
   * reason and whether something she owns can genuinely resolve it. Carried so
   * the page can SHOW them rather than asking her to take a count on trust.
   */
  blockedPieces: BlockedPiece[];
  /** Not analysed yet — counted separately, never treated as blocked. */
  unknownCount: number;
  /** Supported pairs between interchangeability classes. Decides thinness. */
  distinctLooks: number;
  /** Supported pairs across instances. Diagnostics only — never shown. */
  combinations: number;

  /** Her own words say this register matters. */
  needed: boolean;
  needSource: "lifestyle" | "dresses-for" | "none";
  /** What she said, quoted back: "dinners and going out". */
  needPhrase: string | null;
}

export type FindingKind = "enough" | "could-use-more" | "effective-depth" | "repetition";

export interface DepthFinding {
  id: string;
  kind: FindingKind;
  register: RegisterId;
  title: string;
  body: string;
  garmentIds: string[];
  evidence: Evidence[];
  strength: EvidenceStrength;
}

/**
 * "uneven" is alignment WITHOUT coverage: everything she owns sits inside the
 * palette she named, but only part of that palette is actually present. It is
 * deliberately not "alignment", because calling it a strong match would tell
 * her the palette is served when two of the three colours she chose give her
 * nothing to wear.
 */
export type SynthesisKind = "alignment" | "uneven" | "tension" | "unclear";

export interface SynthesisLine {
  id: string;
  kind: SynthesisKind;
  /** What the Passport states, in her words. */
  passportSays: string;
  /** What the Closet demonstrably shows. */
  closetShows: string;
  /** The single sentence nAia is willing to stand behind. */
  reading: string;
  evidence: Evidence[];
  /**
   * Plain name of the specific colour(s) this line is actually about — e.g.
   * "Grey" — when the finding is specific enough to name one. Lets a headline
   * say "Grey appears less often" instead of the vaguer "part of your
   * palette", without changing what was measured.
   */
  thinLabel?: string;
}

export interface PassportSynthesis {
  state: BlockState;
  learningNote?: string;
  lines: SynthesisLine[];
}

export interface StyleMeReading {
  state: BlockState;
  learningNote?: string;
  /** Pieces StyleMe repeatedly reaches for. Generated, not worn. */
  reachedFor: Array<{ garmentId: string; appearances: number; note: string }>;
  /**
   * How often she asked for each kind of dressing, most-asked first. Purely
   * descriptive: a count of readable requests, with no threshold applied and no
   * conclusion attached. `struggles` below is the judgement; this is the fact,
   * and keeping them separate stops the page presenting one finding twice.
   */
  requests: Array<{ register: RegisterId; sessions: number }>;
  /** Registers StyleMe was asked for but could barely fill from the Closet. */
  struggles: Array<{ register: RegisterId; sessions: number; note: string }>;
  /** Intentions the wardrobe can support, from curated garment truth only. */
  strongIntentions: string[];
  thinIntentions: string[];
}

export interface OutcomeReading {
  state: BlockState;
  learningNote?: string;
  totalOutcomes: number;
  keptNote: string | null;
  changedNote: string | null;
}

/**
 * Intentions, kept rigorously in two halves.
 *
 * These are different questions and the page conflated them once already:
 * her strongest Closet capability (feel-put-together, 22 pieces) is only her
 * sixth most-chosen intention (12 of 156 sessions), and the copy read as
 * though her wardrobe had been built for it.
 *
 *   chosen          what SHE asks for   — counted from her StyleMe selections
 *   closetStrengths what her CLOSET does — counted from curated garment ratings
 *
 * Neither is ever derived from the other. `chosen` never reads a garment and
 * `closetStrengths` never reads a session.
 */
/**
 * Intentions that assert something about the customer rather than about a
 * garment. A curated garment rating cannot evidence any of these.
 */
export const IDENTITY_INTENTIONS: ReadonlySet<string> = new Set([
  "feel-like-myself",
  "express-myself",
  "feel-attractive",
  "confidence",
]);

export interface IntentionReading {
  state: BlockState;
  learningNote?: string;
  /** Her own selections, most-chosen first. Customer preference. */
  chosen: Array<{ intention: string; label: string; sessions: number }>;
  /** Curated garment ratings, strongest first. Closet capability. */
  closetStrengths: Array<{ intention: string; label: string; strong: number }>;
}

export interface Headline {
  id: string;
  text: string;
  source: "depth" | "synthesis" | "styleme" | "outcome";
  evidence: Evidence[];
}

export interface WardrobeNeeds {
  state: BlockState;
  learningNote?: string;
  registers: RegisterReading[];
  enough: DepthFinding[];
  couldUseMore: DepthFinding[];
  /** Set when nothing needs buying. An answer, not an empty state. */
  noUrgentNeed: string | null;
  synthesis: PassportSynthesis;
  styleMe: StyleMeReading;
  outcomes: OutcomeReading;
  /** What she asks to feel, and what her Closet can support — kept apart. */
  intentions: IntentionReading;
  headlines: Headline[];
}

// ── Passport reading ──────────────────────────────────────────────────────────

/**
 * The canonical current style answer.
 *
 * Rev 7 replaced the Q3 vocabulary; `stylePersonalities` is retired and a stored
 * value there answered a DIFFERENT question. It is therefore only readable when
 * the customer has no Rev 7 answer at all, and even then it is labelled as the
 * older answer by the caller. It is never blended with styleDirections.
 */
export function currentStyleDirection(passport: WardrobePassport | null): {
  values: string[];
  source: "rev7" | "legacy" | "none";
} {
  if (!passport) return { values: [], source: "none" };
  const directions = passport.styleDirections ?? [];
  if (directions.length > 0) return { values: directions, source: "rev7" };
  const expression = passport.styleExpression ?? [];
  if (expression.length > 0) return { values: expression, source: "rev7" };
  if (passport.stylePersonalities.length > 0) {
    return { values: passport.stylePersonalities, source: "legacy" };
  }
  return { values: [], source: "none" };
}

/** Registers the customer's own words ask for, with the phrase she used. */
function neededRegisters(
  passport: WardrobePassport | null,
): Map<RegisterId, { source: "lifestyle" | "dresses-for"; phrase: string }> {
  const out = new Map<RegisterId, { source: "lifestyle" | "dresses-for"; phrase: string }>();
  if (!passport) return out;

  for (const id of passport.lifestyle) {
    const label = LIFESTYLE_LABELS[id];
    if (!label) continue;
    for (const register of lifestyleRegisters([id])) {
      if (!out.has(register as RegisterId)) {
        out.set(register as RegisterId, { source: "lifestyle", phrase: label });
      }
    }
  }
  for (const raw of passport.dressesFor ?? []) {
    const key = norm(raw)?.replace(/\s+/g, "-") ?? "";
    const register = DRESSES_FOR_REGISTER[key];
    if (register && !out.has(register)) {
      out.set(register, { source: "dresses-for", phrase: raw.toLowerCase() });
    }
  }
  return out;
}

// ── Palette coverage ──────────────────────────────────────────────────────────

/**
 * A loved colour needs more than a token presence before it is a real option.
 * One garment in a colour is a garment, not a choice; below three she cannot
 * build around it. Kept deliberately blunt — the page says "barely
 * represented", never a percentage.
 */
const MIN_FAMILY_PIECES = 3;

/**
 * "white/cream" — a Passport choice covering more than one Closet family.
 * Slashed rather than "or", because these labels are read inside a list:
 * "grey and white/cream" scans; "grey and white or cream" does not.
 */
function joinOr(parts: string[]): string {
  return parts.join("/");
}

export interface PaletteFamilyCoverage {
  /** The Passport token she actually chose: "black", "white-cream"… */
  token: string;
  /** Closet colour families that token covers. */
  families: string[];
  /** How she sees it: "black", "white or cream". */
  label: string;
  count: number;
  covered: boolean;
}

export interface PaletteCoverage {
  /** One row per colour she CHOSE, most-represented first. */
  families: PaletteFamilyCoverage[];
  /** Pieces whose colour nAia can actually read. */
  colourReadable: number;
  /** Read pieces with no readable colour. Never counted as absence. */
  unknown: number;
  /** Readable pieces sitting inside the loved palette. */
  insidePalette: number;
}

/**
 * How well each colour she named is actually represented.
 *
 * Two different questions live here and were previously conflated:
 *   ALIGNMENT — is what she owns inside the palette she likes?
 *   COVERAGE  — is each colour she likes actually present?
 * A wardrobe of 36 black pieces against a stated palette of black, grey and
 * cream scores 100% on the first and fails the second, and reporting only the
 * first tells her the palette is served when it is not.
 *
 * Counted per CHOICE, not per family. "White / Cream" is one option on the
 * Passport, so five cream pieces satisfy it — scoring "white" and "cream"
 * separately would report a gap she never expressed.
 *
 * Unreadable colour is counted as unknown, never as absence: a colour nAia has
 * not read is not a colour she does not own.
 */
export function computePaletteCoverage(
  items: WardrobeGarment[],
  passport: WardrobePassport | null,
): PaletteCoverage {
  const read = items.filter((g) => g.analysisStatus === "ready" || g.intelligenceSource === "curated");
  const readable = read.filter((g) => closetColourFamily(g.primaryColor));
  const unknown = read.length - readable.length;

  const seen = new Set<string>();
  const rows: PaletteFamilyCoverage[] = [];
  const allFamilies = new Set<string>();

  for (const token of passport?.favoriteColors ?? []) {
    const key = norm(token) ?? "";
    const families = PASSPORT_COLOUR_FAMILIES[key] ?? [];
    // An unmappable token is dropped rather than approximated into a family.
    if (families.length === 0 || seen.has(key)) continue;
    seen.add(key);
    for (const f of families) allFamilies.add(f);

    const count = readable.filter((g) => families.includes(closetColourFamily(g.primaryColor)!)).length;
    rows.push({
      token: key,
      families: [...families],
      label: joinOr([...families]),
      count,
      covered: count >= MIN_FAMILY_PIECES,
    });
  }

  rows.sort((a, b) => b.count - a.count);
  const inside = readable.filter((g) => allFamilies.has(closetColourFamily(g.primaryColor)!)).length;
  return { families: rows, colourReadable: readable.length, unknown, insidePalette: inside };
}

// ── Register depth ────────────────────────────────────────────────────────────

/** The register a garment dresses for. Formality first, occasion tags second. */
export function garmentRegister(garment: WardrobeGarment): RegisterId | null {
  const formality = norm(garment.formality);
  if (formality && FORMALITY_BUCKET[formality]) return FORMALITY_BUCKET[formality] as RegisterId;
  for (const occasion of garment.occasions ?? []) {
    const register = OCCASION_REGISTER[norm(occasion) ?? ""];
    if (register) return register;
  }
  return null;
}

/**
 * Is this pair SUPPORTED, or merely not-forbidden?
 *
 * scorePair() returns compatible whenever it can produce any reason at all, and
 * its weakest reason — "They sit at the same level of dress" (weight 2) — fires
 * for any two garments sharing a formality. Counting those as wearable pairs
 * makes every same-register top and bottom compatible by default, which is
 * cross-product counting wearing a compatibility costume.
 *
 * A supported pair needs a reason that says something about the two garments
 * TOGETHER: a shared occasion tag she applied herself (8), structure contrast
 * (7), a real colour relationship (6), silhouette contrast (5), visual-weight
 * contrast (4), or both being wardrobe neutrals (3). Register agreement alone
 * (2 and 1) is not evidence of anything.
 *
 * scorePair itself is untouched — the Wardrobe Heroes and pairing sections are
 * built on its existing behaviour and stay exactly as they are.
 */
const SUBSTANTIVE_REASON_WEIGHT = 3;

export function supportedPair(a: WardrobeGarment, b: WardrobeGarment): boolean {
  const score = scorePair(a, b);
  if (!score.compatible) return false;
  return score.reasons.some((reason) => reason.weight >= SUBSTANTIVE_REASON_WEIGHT);
}

/**
 * The interchangeability class of a garment.
 *
 * Thirteen black relaxed crew tops are not thirteen options — they are one
 * option she owns thirteen times. Depth counted in garment instances rewards
 * buying the same thing repeatedly; depth counted in classes measures what she
 * can actually put on and have it read differently.
 *
 * Two garments share a class when nothing that changes how a look READS differs
 * between them: slot, register, colour band, fit family and silhouette.
 */
export function outfitClassKey(g: WardrobeGarment): string {
  const register = garmentRegister(g) ?? "none";
  const band = g.colourProfile?.wardrobeNeutral
    ? "neutral"
    : (g.colourProfile?.hueFamily ?? norm(g.primaryColor) ?? "unknown");
  const fit = norm(g.fitProfile);
  const fitFamily = fit
    ? STRUCTURED_FITS.has(fit)
      ? "structured"
      : SOFT_FITS.has(fit)
        ? "soft"
        : fit
    : "unknown";
  return `${g.slot}|${register}|${band}|${fitFamily}|${norm(g.silhouette) ?? "unknown"}`;
}

/** One representative per interchangeability class, in wardrobe order. */
function representatives(pool: WardrobeGarment[]): WardrobeGarment[] {
  const seen = new Set<string>();
  const out: WardrobeGarment[] = [];
  for (const g of pool) {
    const key = outfitClassKey(g);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(g);
  }
  return out;
}

/**
 * DISTINCT looks: supported top/bottom pairs between interchangeability
 * classes, plus distinct one-piece classes. This is the number that decides
 * whether a register is thin, and it is deliberately much smaller than the
 * combination count.
 *
 * Shoes and outerwear extend a look but do not create one, so they are not
 * counted — otherwise six pairs of shoes would read as six more ways to dress.
 */
function countDistinctLooks(pool: WardrobeGarment[]): number {
  const classes = representatives(pool);
  const tops = classes.filter((g) => TOP_SLOTS.has(g.slot));
  const bottoms = classes.filter((g) => BOTTOM_SLOTS.has(g.slot));
  const onePieces = classes.filter((g) => ONE_PIECE_SLOTS.has(g.slot));

  let pairs = 0;
  for (const top of tops) {
    for (const bottom of bottoms) {
      if (supportedPair(top, bottom)) pairs++;
    }
  }
  return pairs + onePieces.length;
}

/**
 * Raw supported combinations across instances. Kept for diagnostics and tests
 * only — it is never a customer-facing number and never decides a conclusion.
 */
/**
 * DISTINCT LOOKS — the measure a gap is judged on.
 *
 * Not a count of garments, and not every pairing. The pool is first reduced to
 * one representative per interchangeability class, where a class is
 * `slot | register | colour band | fit family | silhouette` (outfitClassKey).
 * Two tailored straight grey work trousers are one class: owning both does not
 * give you two looks. Distinct looks is then the number of SUPPORTED top-bottom
 * pairs between those representatives, plus one class per one-piece garment.
 *
 * GAP-CLOSURE RULE: a register is reported as needing something only while
 * `needed && distinctLooks <= THIN_LOOKS` (2). So a gap closes when a new piece
 * introduces a class that is not already represented AND that class pairs with
 * what she owns. Another near-copy changes nothing, which is exactly what the
 * repetition finding says.
 */
export interface GapResolvingClass {
  /** "structured" | "soft" — the fit family that adds a new class. */
  fitFamily: string;
  /** A silhouette that, with that fit, lifts distinct looks past the threshold. */
  silhouette: string;
  /** Distinct looks this candidate would produce. */
  distinctLooks: number;
}

/** Silhouettes worth proposing. Drawn from the engine's own vocabulary. */
const CANDIDATE_SILHOUETTES = ["straight", "flared", "a-line", "wide-leg", "fitted", "oversized"] as const;
const CANDIDATE_FITS: Readonly<Record<string, string>> = { structured: "tailored", soft: "relaxed" };

/**
 * Which garment attributes would actually close this register's gap.
 *
 * Derived by SIMULATION against the same rule the finding uses, rather than
 * asserted: a hypothetical piece is added to the usable pool and distinct looks
 * is recomputed. Only candidates that clear THIN_LOOKS are returned, and only
 * those that satisfy her stated dressing preferences — a proposal that
 * contradicts her Passport is not a solution, however many looks it unlocks.
 */
export function gapResolvingClasses(input: {
  pool: WardrobeGarment[];
  passport: WardrobePassport | null;
  slot: string;
  register: RegisterId;
}): GapResolvingClass[] {
  const { pool, passport, slot, register } = input;
  const template = pool.find((g) => g.slot === slot) ?? pool[0];
  if (!template) return [];

  const out: GapResolvingClass[] = [];
  for (const [fitFamily, fitProfile] of Object.entries(CANDIDATE_FITS)) {
    for (const silhouette of CANDIDATE_SILHOUETTES) {
      const candidate: WardrobeGarment = {
        ...template,
        id: `__candidate__${fitFamily}__${silhouette}`,
        name: "candidate",
        slot,
        fitProfile,
        silhouette,
        garmentRelationships: [],
      };
      // A candidate that contradicts a stated preference is not an answer.
      if (classifyUsability(candidate, passport).usability === "blocked") continue;
      const looks = countDistinctLooks([...pool, candidate]);
      if (looks > THIN_LOOKS) out.push({ fitFamily, silhouette, distinctLooks: looks });
    }
  }
  return out.sort((a, b) => b.distinctLooks - a.distinctLooks || a.silhouette.localeCompare(b.silhouette));
}

function countCombinations(pool: WardrobeGarment[]): number {
  const tops = pool.filter((g) => TOP_SLOTS.has(g.slot));
  const bottoms = pool.filter((g) => BOTTOM_SLOTS.has(g.slot));
  const onePieces = pool.filter((g) => ONE_PIECE_SLOTS.has(g.slot));
  let pairs = 0;
  for (const top of tops) {
    for (const bottom of bottoms) {
      if (supportedPair(top, bottom)) pairs++;
    }
  }
  return pairs + onePieces.length;
}

function readRegisters(
  items: WardrobeGarment[],
  passport: WardrobePassport | null,
): RegisterReading[] {
  const needs = neededRegisters(passport);

  return REGISTER_IDS.map((register) => {
    const pool = items.filter((g) => garmentRegister(g) === register);
    const classified = pool.map((g) => ({ g, ...classifyUsability(g, passport) }));
    const usable = classified.filter((c) => c.usability === "usable").map((c) => c.g);
    const blocked = classified.filter((c) => c.usability === "blocked").map((c) => c.g);
    const unknown = classified.filter((c) => c.usability === "unknown").map((c) => c.g);
    const need = needs.get(register);

    const distinctLooks = countDistinctLooks(usable);
    const shortNoun = register === "everyday" ? "everyday" : register === "work" ? "work" : "occasion";

    // ── Customer-facing reading ────────────────────────────────────────────
    //
    // The page says what the evidence MEANS. raw / blocked / unread and the
    // look counts stay on the object for tests and debugging, and none of them
    // is rendered as a number or a label.
    let depthLabel: string;
    let depthNote: string;

    if (usable.length === 0 && unknown.length > 0) {
      depthLabel = "Not enough evidence yet";
      depthNote = `nAia hasn't finished reading the ${
        unknown.length === 1 ? "piece" : "pieces"
      } that would dress you for this, so there's nothing honest to say yet.`;
    } else if (pool.length === 0) {
      depthLabel = "Nothing here yet";
      depthNote = need
        ? `You've told nAia that ${need.phrase} is part of your life, and there's nothing in your Closet that reads this way.`
        : `Nothing in your Closet reads this way — and nothing you've told nAia suggests it needs to.`;
    } else if (blocked.length > 0 && blocked.length >= usable.length) {
      depthLabel = `Your ${shortNoun} wardrobe looks bigger than it really is`;
      depthNote = `You own ${pool.length} ${shortNoun} ${
        pool.length === 1 ? "piece" : "pieces"
      }, but ${blocked.length} of them don't currently meet the way you've told nAia you prefer to dress.`;
    } else if (distinctLooks >= DEEP_LOOKS) {
      depthLabel = `Strong ${shortNoun} depth`;
      depthNote = `You already have plenty of usable combinations here, so more similar pieces are unlikely to add much to your wardrobe.`;
    } else if (distinctLooks <= THIN_LOOKS) {
      depthLabel = `Limited usable ${shortNoun} depth`;
      depthNote =
        usable.length >= REDUNDANT_PIECES
          ? `You own a lot that reads this way, but their combinations tend to repeat the same formula.`
          : `You currently have limited depth for ${DEPTH_PHRASE[register]} dressing.`;
    } else {
      depthLabel = `Workable ${shortNoun} depth`;
      depthNote = `There's enough here to dress you, though not a lot of room to vary it.`;
    }

    return {
      register,
      label: FORMALITY_BUCKET_LABEL[register],
      depthLabel,
      depthNote,
      rawCount: pool.length,
      usableCount: usable.length,
      blockedCount: blocked.length,
      blockedPieces: blocked.map((g) => ({
        garmentId: g.id,
        reason: classifyUsability(g, passport).reason ?? "does not meet a stated preference",
        rescuedBy: layersThatResolve(g, items, passport).map((l) => l.id),
      })),
      unknownCount: unknown.length,
      distinctLooks,
      combinations: countCombinations(usable),
      needed: Boolean(need),
      needSource: need?.source ?? "none",
      needPhrase: need?.phrase ?? null,
    };
  });
}

// ── Depth findings ────────────────────────────────────────────────────────────

/**
 * A depth cluster: a slot at a register, in one colour band. This is the level
 * at which "you already have enough of these" is a true statement — "enough
 * tops" is never true on its own, but "enough neutral everyday tops" can be.
 */
interface Cluster {
  key: string;
  register: RegisterId;
  slot: string;
  band: "neutral" | "colour";
  items: WardrobeGarment[];
}

const SLOT_PLURAL: Readonly<Record<string, string>> = {
  top: "tops", bottom: "bottoms", dress: "dresses", set: "sets",
  outerwear: "outer layers", shoes: "shoes", bag: "bags", accessory: "accessories",
};

function clustersOf(items: WardrobeGarment[], passport: WardrobePassport | null): Cluster[] {
  const map = new Map<string, Cluster>();
  for (const g of items) {
    const register = garmentRegister(g);
    if (!register) continue;
    if (classifyUsability(g, passport).usability !== "usable") continue;
    if (!SLOT_PLURAL[g.slot]) continue;
    const band: "neutral" | "colour" = g.colourProfile?.wardrobeNeutral ? "neutral" : "colour";
    const key = `${register}:${g.slot}:${band}`;
    const existing = map.get(key);
    if (existing) existing.items.push(g);
    else map.set(key, { key, register, slot: g.slot, band, items: [g] });
  }
  return [...map.values()];
}

function describeCluster(c: Cluster): string {
  const slot = SLOT_PLURAL[c.slot] ?? "pieces";
  const band = c.band === "neutral" ? "neutral " : "";
  const register = c.register === "everyday" ? "everyday " : c.register === "work" ? "work " : "occasion ";
  return `${register}${band}${slot}`;
}

function buildFindings(
  items: WardrobeGarment[],
  passport: WardrobePassport | null,
  registers: RegisterReading[],
): { enough: DepthFinding[]; couldUseMore: DepthFinding[] } {
  const enough: DepthFinding[] = [];
  const couldUseMore: DepthFinding[] = [];
  const byId = new Map(registers.map((r) => [r.register, r]));

  // Registers her own words ask for that she cannot actually dress for.
  const thinNeeded = registers.filter((r) => r.needed && r.distinctLooks <= THIN_LOOKS);

  // ── YOU COULD USE MORE OF ────────────────────────────────────────────────
  for (const r of thinNeeded) {
    const blockedPieces = items.filter(
      (g) => garmentRegister(g) === r.register && classifyUsability(g, passport).usability === "blocked",
    );

    // 1. Effective depth — she owns the pieces, but they do not work for her.
    const isEffectiveDepth =
      r.rawCount >= EFFECTIVE_DEPTH_MIN_RAW &&
      ratio(r.blockedCount, r.rawCount) >= EFFECTIVE_DEPTH_BLOCKED_SHARE;

    if (isEffectiveDepth) {
      const reasons = countBy(blockedPieces, (g) => classifyUsability(g, passport).reason);
      const leadReason = topEntries(reasons, 1)[0]?.[0] ?? null;
      couldUseMore.push({
        id: `need-${r.register}-effective`,
        kind: "effective-depth",
        register: r.register,
        title: `Your ${REGISTER_NOUN[r.register]} gap is not quantity`,
        body: `You own ${r.rawCount} pieces that read as ${r.label}, but only ${r.usableCount} currently meet your stated coverage preferences${
          leadReason ? ` — including ${leadReason}` : ""
        }. What's missing isn't more ${REGISTER_NOUN[r.register]}; it's ${REGISTER_NOUN[r.register]} that fits the way you've told nAia you prefer to dress.`,
        garmentIds: blockedPieces.slice(0, 6).map((g) => g.id),
        evidence: [
          ev("passport-signal", "lifestyle / dressingPreferences", `You've told nAia ${r.needPhrase} is part of your life, and stated how you prefer to be covered.`, []),
          ev("garment-fact", "coverage fields", `${r.blockedCount} of ${r.rawCount} ${r.label} pieces contradict a stated dressing preference.`, blockedPieces.map((g) => g.id)),
        ],
        strength: gradeStrength([ev("garment-fact", "coverage fields", "", [])], r.blockedCount),
      });
      continue;
    }

    // 2. Repetition — plenty of usable pieces, but they are near-copies of each
    //    other, so they collapse into one or two outfits. Telling her to buy
    //    more here would be exactly wrong: the opportunity is range, not volume.
    if (r.usableCount >= REDUNDANT_PIECES) {
      couldUseMore.push({
        id: `need-${r.register}-repetition`,
        kind: "repetition",
        register: r.register,
        title: `You have ${REGISTER_BARE[r.register]} pieces, but fewer ways to combine them`,
        body: `You own ${r.usableCount} pieces that work for ${REGISTER_NOUN[r.register]}, but their combinations tend to repeat the same formula. Buying more like them wouldn't widen what you can wear — a piece that contrasts with what you already own would.`,
        // A top-bottom repetition finding is demonstrated by tops, bottoms and
        // one-pieces — not by an outerwear layer, bag or shoes that happen to
        // register-match. Those don't show the thing being claimed.
        garmentIds: items
          .filter((g) =>
            garmentRegister(g) === r.register &&
            classifyUsability(g, passport).usability === "usable" &&
            (TOP_SLOTS.has(g.slot) || BOTTOM_SLOTS.has(g.slot) || ONE_PIECE_SLOTS.has(g.slot)))
          .slice(0, 6)
          .map((g) => g.id),
        evidence: [
          ev("passport-signal", "lifestyle", `You named ${r.needPhrase ?? REGISTER_NOUN[r.register]}.`, []),
          ev("garment-fact", "shape + colour + fit", `${r.usableCount} usable pieces collapse into ${r.distinctLooks} distinct ${r.distinctLooks === 1 ? "look" : "looks"}.`, []),
        ],
        strength: "strong",
      });
      continue;
    }

    // 3. Genuine thinness.
    couldUseMore.push({
      id: `need-${r.register}`,
      kind: "could-use-more",
      register: r.register,
      title: `${capitaliseFirst(REGISTER_NOUN[r.register])} is the thinner side of your wardrobe`,
      body: `You've told nAia that ${r.needPhrase ?? REGISTER_NOUN[r.register]} is part of your life, and there's very little in your Closet that combines into something you could wear for it${
        r.unknownCount > 0 ? `. ${r.unknownCount} more ${r.unknownCount === 1 ? "piece is" : "pieces are"} still being read` : ""
      }.`,
      garmentIds: items
        .filter((g) => garmentRegister(g) === r.register)
        .slice(0, 6)
        .map((g) => g.id),
      evidence: [
        ev("passport-signal", "lifestyle", `You named ${r.needPhrase ?? REGISTER_NOUN[r.register]}.`, []),
        ev("garment-fact", "formality + compatibility", `${r.distinctLooks} distinct looks available at ${r.label}.`, []),
      ],
      strength: r.needSource === "lifestyle" ? "strong" : "moderate",
    });
  }

  // ── YOU HAVE ENOUGH OF ───────────────────────────────────────────────────
  //
  // Sufficiency is a statement about REDUNDANCY, not about combinations: owning
  // five interchangeable neutral everyday tops means a sixth adds nothing,
  // whether or not those five multiply into a large number of pairings. The
  // register must also not be one nAia has just flagged as thin, so the page
  // can never say "you have enough" and "you need more" about the same thing.
  const flaggedThin = new Set(couldUseMore.map((f) => f.register));
  for (const c of clustersOf(items, passport)) {
    if (c.items.length < ENOUGH_CLUSTER) continue;
    if (flaggedThin.has(c.register)) continue;
    const r = byId.get(c.register);
    if (!r || r.distinctLooks < DEEP_LOOKS) continue;

    const description = describeCluster(c);

    enough.push({
      id: `enough-${c.key}`,
      kind: "enough",
      register: c.register,
      title: `You already have enough ${description}`,
      body: `You already have ${c.items.length} ${description} that work well with the rest of your Closet. Another similar one probably wouldn't give you many new options.`,
      garmentIds: c.items.slice(0, 6).map((g) => g.id),
      evidence: [
        ev("garment-fact", "slot + colour + formality", `${c.items.length} usable ${description}.`, c.items.map((g) => g.id)),
        ev("garment-fact", "compatibility graph", `${r.distinctLooks} distinct looks at ${r.label}.`, []),
      ],
      strength: gradeStrength([ev("garment-fact", "slot", "", [])], c.items.length),
    });
  }

  enough.sort((a, b) => b.garmentIds.length - a.garmentIds.length);
  return { enough: enough.slice(0, 3), couldUseMore: couldUseMore.slice(0, 3) };
}

// ── Passport ↔ Closet synthesis ───────────────────────────────────────────────

/**
 * Where what she says and what she owns agree, and where they pull apart.
 *
 * Every line needs BOTH sides evidenced: a Passport statement and a measurable
 * Closet fact. Where only one side exists, nAia says the connection is not clear
 * rather than inventing one. No psychological claim is made from a single field.
 */
function buildSynthesis(
  items: WardrobeGarment[],
  passport: WardrobePassport | null,
): PassportSynthesis {
  if (!passport) {
    return {
      state: "learning",
      learningNote: "Once your Style Passport is complete, nAia can read your Closet against what you've said about yourself.",
      lines: [],
    };
  }

  const lines: SynthesisLine[] = [];
  const read = items.filter((g) => g.analysisStatus === "ready" || g.intelligenceSource === "curated");
  if (read.length < MIN_WARDROBE_SIZE) {
    return {
      state: "learning",
      learningNote: "nAia needs to read a few more pieces before comparing your Closet with your Passport.",
      lines: [],
    };
  }

  // 1. Colour — two separate questions, previously collapsed into one.
  //
  //    ALIGNMENT: is what she owns inside the palette she named?
  //    COVERAGE:  is each colour she named actually there?
  //
  //    A Closet of 36 black pieces against "black, grey, cream" passes the
  //    first perfectly and fails the second completely. Reporting only
  //    alignment told her the palette was served when two thirds of it gave her
  //    nothing to wear.
  if (passport.favoriteColors.length > 0) {
    const palette = computePaletteCoverage(items, passport);
    if (palette.colourReadable >= MIN_WARDROBE_SIZE && palette.families.length > 0) {
      const share = ratio(palette.insidePalette, palette.colourReadable);
      const covered = palette.families.filter((f) => f.covered);
      const thin = palette.families.filter((f) => !f.covered);
      const namesOf = (rows: PaletteFamilyCoverage[]) => joinList(rows.map((f) => f.label));

      const statedEvidence = ev(
        "passport-signal", "favoriteColors",
        `You named ${joinList(passport.favoriteColors.slice(0, 3))}.`, [],
      );
      const coverageEvidence = ev(
        "garment-fact", "primaryColor",
        palette.families.map((f) => `${f.label}: ${f.count}`).join(", ") +
          (palette.unknown > 0 ? ` (${palette.unknown} pieces have no colour nAia can read yet)` : ""),
        [],
      );

      if (share >= 0.6 && thin.length === 0) {
        lines.push({
          id: "synth-colour",
          kind: "alignment",
          passportSays: "the colours you said you love",
          closetShows: `all of them are represented`,
          reading: "The colours you told nAia you love are all well represented in your Closet.",
          evidence: [statedEvidence, coverageEvidence],
        });
      } else if (share >= 0.6 && covered.length > 0) {
        // Inside the palette, but only part of it is actually available.
        lines.push({
          id: "synth-colour",
          kind: "uneven",
          passportSays: "the colours you said you love",
          closetShows: `${namesOf(covered)} well covered, ${namesOf(thin)} barely there`,
          reading: `Your Closet stays closely within the colours you told nAia you like, but some of that palette is barely represented. ${capitaliseFirst(
            namesOf(covered),
          )} ${covered.length === 1 ? "is" : "are"} well covered, while ${namesOf(thin)} ${
            thin.length === 1 ? "appears" : "appear"
          } much less often.`,
          evidence: [statedEvidence, coverageEvidence],
          thinLabel: namesOf(thin),
        });
      } else if (share <= 0.25) {
        lines.push({
          id: "synth-colour",
          kind: "tension",
          passportSays: "the colours you said you love",
          closetShows: `only ${palette.insidePalette} of ${palette.colourReadable} pieces sit in those colours`,
          reading: "The palette you described and the one you own are pulling in different directions. That's worth knowing before the next purchase.",
          evidence: [statedEvidence, coverageEvidence],
        });
      }
    }
  }

  // 2. Neutral appetite — stated preference against measured neutral share.
  const neutralStated = norm(passport.neutralVsColour ?? null);
  const withProfile = read.filter((g) => g.colourProfile !== null);
  if (neutralStated && withProfile.length >= MIN_WARDROBE_SIZE) {
    const neutralShare = ratio(withProfile.filter((g) => g.colourProfile!.wardrobeNeutral).length, withProfile.length);
    const saysNeutral = neutralStated.includes("neutral");
    const saysColour = neutralStated.includes("colour") || neutralStated.includes("color");
    if (saysNeutral && neutralShare >= 0.6) {
      lines.push({
        id: "synth-neutral",
        kind: "alignment",
        passportSays: "you lean neutral",
        closetShows: `${Math.round(neutralShare * 100)}% of what nAia can read is neutral`,
        // States the alignment only — a match between what she said and what she
        // owns, never evidence of intent. Named for the BALANCE it measures, so
        // it cannot be mistaken for the named-colour reading above.
        reading: "Your Closet is strongly neutral, matching the balance you said you prefer.",
        evidence: [ev("garment-fact", "colourProfile", `${Math.round(neutralShare * 100)}% neutral.`, [])],
      });
    } else if (saysColour && neutralShare >= 0.75) {
      lines.push({
        id: "synth-neutral",
        kind: "tension",
        passportSays: "you're drawn to colour",
        closetShows: `${Math.round(neutralShare * 100)}% of what nAia can read is neutral`,
        reading: "You've said you want colour, but the wardrobe you've built is mostly neutral. The appetite is there; the pieces aren't yet.",
        evidence: [ev("garment-fact", "colourProfile", `${Math.round(neutralShare * 100)}% neutral.`, [])],
      });
    }
  }

  // 3. Print appetite — stated against measured pattern share.
  const printStated = norm(passport.printAppetite ?? null);
  if (printStated) {
    const withPattern = read.filter((g) => norm(g.pattern));
    if (withPattern.length >= MIN_WARDROBE_SIZE) {
      const patterned = withPattern.filter((g) => norm(g.pattern) !== "solid");
      const patternShare = ratio(patterned.length, withPattern.length);
      const saysMinimal = printStated.includes("no") || printStated.includes("minimal") || printStated.includes("rarely");
      if (saysMinimal && patternShare <= 0.2) {
        lines.push({
          id: "synth-print",
          kind: "alignment",
          passportSays: "you keep prints to a minimum",
          closetShows: `${patterned.length} of ${withPattern.length} pieces carry a pattern`,
          reading: "Low visual noise across the wardrobe — the plainness is a choice you've actually followed through on.",
          evidence: [ev("garment-fact", "pattern", `${patterned.length} of ${withPattern.length} patterned.`, [])],
        });
      }
    }
  }

  // 4. Style direction — the Rev 7 answer, never the retired one on its own.
  const direction = currentStyleDirection(passport);
  if (direction.source === "legacy") {
    lines.push({
      id: "synth-direction",
      kind: "unclear",
      passportSays: "an earlier answer about your style",
      closetShows: "nAia hasn't been given your current style direction",
      reading: "Your Passport still holds the older style question. Answering the current one would let nAia read your Closet against who you are now, not who you were.",
      evidence: [ev("passport-signal", "styleDirections", "No Rev 7 style direction recorded.", [])],
    });
  }

  if (lines.length === 0) {
    return {
      state: "learning",
      learningNote: "nAia can't yet draw a clear line between what you've said about your style and what your Closet shows. More read pieces — or a fuller Passport — will change that.",
      lines: [],
    };
  }
  return { state: "available", lines: lines.slice(0, 4) };
}

// ── StyleMe evidence (generated, never worn) ──────────────────────────────────

function buildStyleMeReading(
  items: WardrobeGarment[],
  sessions: StyleMeSessionFact[] | null,
  registers: RegisterReading[],
): StyleMeReading {
  if (sessions === null) {
    return {
      state: "learning",
      learningNote: "nAia hasn't read your StyleMe history into this page yet.",
      reachedFor: [], requests: [], struggles: [], strongIntentions: [], thinIntentions: [],
    };
  }
  if (sessions.length === 0) {
    return {
      state: "learning",
      learningNote: "Once you've used StyleMe a few times, nAia can show which pieces it keeps reaching for.",
      reachedFor: [], requests: [], struggles: [], strongIntentions: [], thinIntentions: [],
    };
  }

  const reachedFor = items
    .filter((g) => g.outfitAppearances >= MIN_APPEARANCES_FOR_REACH)
    .sort((a, b) => b.outfitAppearances - a.outfitAppearances)
    .slice(0, 3)
    .map((g) => ({
      garmentId: g.id,
      appearances: g.outfitAppearances,
      // Deliberate wording: "built you", not "you wore".
      note: `nAia has built ${g.outfitAppearances} of your looks around this piece.`,
    }));

  // Registers she asked StyleMe for, where the Closet could barely answer.
  const askedBy = countBy(sessions, (s) => s.register);
  const struggles: StyleMeReading["struggles"] = [];
  for (const [register, count] of askedBy.entries()) {
    const reading = registers.find((r) => r.register === register);
    if (!reading || count < 2) continue;
    if (reading.distinctLooks > THIN_LOOKS) continue;
    struggles.push({
      register: register as RegisterId,
      sessions: count,
      note: `You've asked nAia for ${REGISTER_NOUN[register as RegisterId]} ${describeTimes(count)}, and your Closet gives it very little to work with at that level.`,
    });
  }

  // Intentions the wardrobe supports — curated garment truth only. Derived
  // intention potential is shadow output and must not reach the customer.
  const curated = items.filter((g) => g.intentionsSource === "curated" && g.intentions);
  const strongIntentions: string[] = [];
  const thinIntentions: string[] = [];
  if (curated.length >= MIN_WARDROBE_SIZE) {
    const used = new Set(sessions.flatMap((s) => s.intentions));
    for (const intention of used) {
      const label = INTENTION_LABELS[intention];
      if (!label) continue;
      const supporting = curated.filter((g) => g.intentions![intention] === "strong").length;
      if (supporting >= 3) strongIntentions.push(label);
      else if (supporting === 0) thinIntentions.push(label);
    }
  }

  // Descriptive request counts. Unreadable requests (register null) are left
  // out rather than bucketed somewhere to make the list look complete.
  const requests = [...askedBy.entries()]
    .filter(([register]) => register !== null && register !== "null")
    .map(([register, sessions]) => ({ register: register as RegisterId, sessions }))
    .sort((a, b) => b.sessions - a.sessions);

  const anything = reachedFor.length > 0 || struggles.length > 0 || strongIntentions.length > 0;
  return {
    state: anything ? "available" : "learning",
    learningNote: anything ? undefined : "nAia needs a little more StyleMe history before it can see a pattern worth naming.",
    reachedFor, requests, struggles,
    strongIntentions: strongIntentions.slice(0, 3),
    thinIntentions: thinIntentions.slice(0, 2),
  };
}

/**
 * The two halves, built from two different sources and never mixed.
 *
 * Derived intention potential is Phase 3C V2 shadow output. Only human-reviewed
 * (curated) garment ratings are counted here, so the capability half can never
 * report a number the customer would not stand behind.
 */
function buildIntentionReading(
  items: WardrobeGarment[],
  sessions: StyleMeSessionFact[] | null,
): IntentionReading {
  // No Passport comparison exists for garment intention ratings in this
  // version, so identity claims have no evidence to stand on. Kept as a named
  // flag rather than an inline `false` so that adding one later is a single,
  // visible change — and so the test can state the requirement, not the wording.
  const hasIdentityEvidence = false;
  // ── what she asks for: sessions only ──
  const chosenCounts = new Map<string, number>();
  for (const session of sessions ?? []) {
    for (const intention of session.intentions) {
      chosenCounts.set(intention, (chosenCounts.get(intention) ?? 0) + 1);
    }
  }
  const chosen = [...chosenCounts.entries()]
    .filter(([intention]) => INTENTION_LABELS[intention])
    .map(([intention, count]) => ({ intention, label: INTENTION_LABELS[intention], sessions: count }))
    .sort((a, b) => b.sessions - a.sessions);

  // ── what her Closet supports: curated garment ratings only ──
  const strongCounts = new Map<string, number>();
  for (const garment of items) {
    if (garment.intentionsSource !== "curated" || !garment.intentions) continue;
    for (const [intention, strength] of Object.entries(garment.intentions)) {
      if (strength === "strong") strongCounts.set(intention, (strongCounts.get(intention) ?? 0) + 1);
    }
  }
  const closetStrengths = [...strongCounts.entries()]
    .filter(([intention]) => INTENTION_LABELS[intention])
    // Identity claims need identity evidence.
    //
    // These counts come from a rating held against each GARMENT; nothing in
    // them is compared to this customer. For a capability — "put-together
    // looks", "easy dressing" — that is a complete and honest statement about
    // her Closet. For an intention that asserts something about HER, like
    // looking or feeling like herself, a garment rating is the wrong kind of
    // evidence entirely, and no amount of rewording fixes that. Until a
    // Passport comparison exists to support it, the row is suppressed.
    //
    // The underlying StyleMe intention is untouched: she may still CHOOSE it,
    // and her own choices are reported separately in `chosen`.
    .filter(([intention]) => !IDENTITY_INTENTIONS.has(intention) || hasIdentityEvidence)
    .map(([intention, count]) => ({ intention, label: INTENTION_LABELS[intention], strong: count }))
    .sort((a, b) => b.strong - a.strong);

  const anything = chosen.length > 0 || closetStrengths.length > 0;
  return {
    state: anything ? "available" : "learning",
    learningNote: anything
      ? undefined
      : "Once you've used StyleMe a few times, nAia can show what you most often want from an outfit.",
    chosen,
    closetStrengths,
  };
}

// ── Outcome evidence (this IS wear behaviour — she reported it) ───────────────

function buildOutcomeReading(outcomes: OutcomeFact[] | null): OutcomeReading {
  if (outcomes === null) {
    return {
      state: "learning",
      learningNote: "nAia hasn't read your outfit feedback into this page yet.",
      totalOutcomes: 0, keptNote: null, changedNote: null,
    };
  }
  if (outcomes.length < MIN_OUTCOMES_FOR_CLAIM) {
    return {
      state: "learning",
      learningNote:
        outcomes.length === 0
          ? "Tell nAia what happened after a look — wore it, changed something, didn't wear it — and this becomes the strongest signal it has."
          : `nAia has ${outcomes.length} piece${outcomes.length === 1 ? "" : "s"} of outfit feedback so far. A few more and it can say something reliable.`,
      totalOutcomes: outcomes.length, keptNote: null, changedNote: null,
    };
  }

  const wore = outcomes.filter((o) => o.status === "wore-it").length;
  const changed = outcomes.filter((o) => o.status === "changed-something");

  // Register-level only. A "changed something" outcome tells us the look was
  // altered, not WHICH piece she swapped, so no garment-level claim is made.
  const changedByRegister = countBy(changed, (o) => o.register);
  const worst = topEntries(changedByRegister, 1)[0];

  return {
    state: "available",
    totalOutcomes: outcomes.length,
    // Both lines describe the feedback she gave, in the words of the control
    // she used. "Changed something" records that she changed something; it does
    // NOT record that she went on to wear the result, and must never imply it.
    keptNote:
      wore >= MIN_OUTCOMES_FOR_CLAIM
        ? `You marked ${wore} of nAia's looks as "Wore it".`
        : null,
    changedNote:
      worst && worst[1] >= MIN_OUTCOMES_FOR_CLAIM
        ? `You marked ${worst[1]} of nAia's ${REGISTER_NOUN[worst[0] as RegisterId]} recommendations as "Changed something".`
        : null,
  };
}

// ── Headlines ─────────────────────────────────────────────────────────────────

/**
 * WHAT NAIA KNOWS RIGHT NOW — three to five conclusions, each already evidenced
 * somewhere below on the page. Nothing new is derived here; this is a ranking of
 * findings that already survived their own evidence test.
 */
function buildHeadlines(
  needs: Omit<WardrobeNeeds, "headlines">,
): Headline[] {
  const out: Headline[] = [];

  for (const f of needs.couldUseMore) {
    out.push({ id: f.id, text: f.title + ".", source: "depth", evidence: f.evidence });
  }
  // Only the strongest sufficiency line. "Enough everyday tops" and "enough
  // everyday bottoms" are the same finding wearing two hats, and stacking them
  // makes one conclusion look like two.
  if (needs.enough[0]) {
    out.push({ id: needs.enough[0].id, text: needs.enough[0].title + ".", source: "depth", evidence: needs.enough[0].evidence });
  }
  for (const line of needs.synthesis.lines) {
    if (line.kind === "unclear") continue;
    out.push({ id: line.id, text: line.reading, source: "synthesis", evidence: line.evidence });
  }
  for (const s of needs.styleMe.struggles) {
    out.push({ id: `styleme-${s.register}`, text: s.note, source: "styleme", evidence: [] });
  }
  if (needs.outcomes.changedNote) {
    out.push({ id: "outcome-changed", text: needs.outcomes.changedNote, source: "outcome", evidence: [] });
  }
  if (needs.noUrgentNeed) {
    out.push({ id: "no-urgent-need", text: needs.noUrgentNeed, source: "depth", evidence: [] });
  }

  // Never repeat the same finding twice under two headings.
  const seen = new Set<string>();
  return out.filter((h) => (seen.has(h.id) ? false : (seen.add(h.id), true))).slice(0, 5);
}

// ── Entry point ───────────────────────────────────────────────────────────────

export function computeWardrobeNeeds(input: WardrobeNeedsInput): WardrobeNeeds {
  const { items, passport, styleMeSessions, outcomes } = input;

  const empty: WardrobeNeeds = {
    state: "learning",
    learningNote: `nAia reads your wardrobe as a whole once there are at least ${MIN_WARDROBE_SIZE} pieces in it.`,
    registers: [], enough: [], couldUseMore: [], noUrgentNeed: null,
    synthesis: { state: "learning", learningNote: "Your Passport and Closet are compared once there's enough of a Closet to compare.", lines: [] },
    styleMe: { state: "learning", learningNote: "StyleMe history appears here once you've used it.", reachedFor: [], requests: [], struggles: [], strongIntentions: [], thinIntentions: [] },
    outcomes: buildOutcomeReading(outcomes),
    intentions: buildIntentionReading(items, styleMeSessions),
    headlines: [],
  };
  if (items.length < MIN_WARDROBE_SIZE) return empty;

  const registers = readRegisters(items, passport);
  const { enough, couldUseMore } = buildFindings(items, passport, registers);
  const synthesis = buildSynthesis(items, passport);
  const styleMe = buildStyleMeReading(items, styleMeSessions, registers);
  const outcomeReading = buildOutcomeReading(outcomes);

  // A wardrobe with no evidenced need is a conclusion in its own right. nAia is
  // allowed — and expected — to say that nothing needs buying.
  const anyNeededRegister = registers.some((r) => r.needed);
  const noUrgentNeed =
    couldUseMore.length === 0 && anyNeededRegister
      ? "Nothing in your wardrobe needs buying right now. Every kind of dressing you've told nAia about is already covered by what you own."
      : couldUseMore.length === 0
        ? "Nothing obvious is missing. nAia will have more to say about what you need once your Passport describes the life you're dressing for."
        : null;

  const withoutHeadlines: Omit<WardrobeNeeds, "headlines"> = {
    state: "available",
    registers, enough, couldUseMore, noUrgentNeed,
    synthesis, styleMe, outcomes: outcomeReading,
    intentions: buildIntentionReading(items, styleMeSessions),
  };

  return { ...withoutHeadlines, headlines: buildHeadlines(withoutHeadlines) };
}

// ── Local helpers ─────────────────────────────────────────────────────────────

/**
 * Look counts are INTERNAL.
 *
 * They decide thresholds; they are never rendered. Two reasons. First, the
 * figure is a count of supported combinations between interchangeability
 * classes, which is not a concept a customer should have to hold. Second, any
 * such number invites the wrong question ("is 7 good?") instead of the useful
 * one ("should I buy another?"). The page states the conclusion — see
 * RegisterReading.depthLabel and .depthNote.
 */

/** "once" / "twice" / "5 times" — numerals only where they earn their place. */
function describeTimes(count: number): string {
  if (count === 1) return "once";
  if (count === 2) return "twice";
  return `${count} times`;
}

function capitaliseFirst(s: string): string {
  return s.length === 0 ? s : s[0].toUpperCase() + s.slice(1);
}

export const WARDROBE_NEEDS_VERSION = "1.0.0";
