// app/lib/ai/wardrobe-recommendations.ts
//
// WHAT WOULD ADD THE MOST — the answer to "okay, what kind of piece would
// actually help?"
//
// This layer never decides that something is missing. It reads the gaps the
// needs engine has ALREADY concluded and works out what shape of piece would
// close them. If computeWardrobeNeeds() found no gap, this returns nothing.
//
// ── SPECIFICITY IS EARNED, NEVER ASSUMED ─────────────────────────────────────
//
// The dangerous failure here is fluency: "work needs more range" is easy to
// inflate into "buy white trousers", and the sentence reads well enough that
// nobody checks. So a recommendation climbs a ladder, and stops the moment the
// next rung is unsupported:
//
//   direction  "more range for work dressing"
//              — always available once the engine found the gap
//   slot       "another work bottom would help"
//              — needs slot-level scarcity: one side of an outfit is the actual
//                constraint, measured on usable pieces
//   detailed   "a lighter, more structured work layer, in a colour you love"
//              — every attribute must cite a SOURCE she gave us, and must
//                survive a compatibility check against her real Closet
//
// ── ATTRIBUTES MUST BE CITED, AND MUST PAY THEIR WAY ─────────────────────────
//
// An attribute is only allowed if BOTH hold:
//   1. It comes from something she told nAia (Passport) or something her Closet
//      demonstrably shows. Nothing is inferred from fashion convention, and no
//      attribute is added because it would make the sentence more confident.
//   2. Adding it does not reduce how many of her existing pieces the proposed
//      garment would work with, measured with supportedPair() — the same
//      compatibility rule the rest of Wardrobe Intelligence uses.
//
// An attribute that fails (2) is dropped and the recommendation stays broader.
// Unknown stays unknown.

import {
  computePaletteCoverage,
  garmentRegister,
  classifyUsability,
  gapResolvingClasses,
  outfitClassKey,
  type RegisterId,
  type RegisterReading,
  type DepthFinding,
  type WardrobeNeeds,
} from "~/lib/ai/wardrobe-needs";
import {
  scorePair,
  STRUCTURED_FITS,
  SOFT_FITS,
  PASSPORT_COLOUR_FAMILIES,
  norm,
  ev,
  joinList,
  TOP_SLOTS,
  BOTTOM_SLOTS,
  ONE_PIECE_SLOTS,
  MIN_WARDROBE_SIZE,
  type WardrobeGarment,
  type WardrobePassport,
  type Evidence,
  type EvidenceStrength,
  type BlockState,
} from "~/lib/ai/wardrobe-intelligence";

// ── Output ────────────────────────────────────────────────────────────────────

export type Specificity = "direction" | "slot" | "detailed";

export type AttributeKind = "colour" | "structure" | "coverage" | "register" | "slot";

export interface RecommendationAttribute {
  kind: AttributeKind;
  /** Machine-readable value(s). Stable tokens, for Buy or Skip to match on. */
  values: string[];
  /** Customer-facing phrase: "cream, stone or soft grey". */
  label: string;
  /** Where the attribute came from. Never "inferred". */
  source: "passport" | "closet" | "styleme";
}

/**
 * Structured form of the recommendation.
 *
 * Deliberately separate from the prose so a later Buy or Skip can ask "does
 * this item fill a need Wardrobe Intelligence already identified?" by matching
 * on fields rather than parsing a sentence. Nothing here is displayed directly.
 */
export interface RecommendationCriteria {
  register: RegisterId;
  slot: string | null;
  /** Closet colour families that would work. Empty = no colour constraint. */
  colourFamilies: string[];
  /** "structured" | "soft" | null — the fit family that would add contrast. */
  structure: string | null;
  /**
   * Silhouettes that, with that fit, actually lift this register past the
   * distinct-looks threshold. Derived by simulating a candidate against the
   * same rule the finding uses — never asserted, and never a universal answer:
   * these are the classes THIS Closet is missing, filtered by HER stated
   * dressing preferences.
   */
  resolvingSilhouettes: string[];
  /** Coverage tokens from her stated dressing preferences that must be met. */
  coverage: string[];
}

export interface WardrobeRecommendation {
  id: string;
  register: RegisterId;
  specificity: Specificity;
  /** "A lighter structured work layer" */
  title: string;
  /** Rendered as a single line: "Cream, stone or soft grey · clean shape". */
  attributes: RecommendationAttribute[];
  body: string;
  /** Pieces she already owns that this would newly combine with. */
  unlocksIds: string[];
  criteria: RecommendationCriteria;
  evidence: Evidence[];
  strength: EvidenceStrength;
}

export interface NotAPriority {
  id: string;
  title: string;
  body: string;
}

export interface WardrobeRecommendations {
  state: BlockState;
  learningNote?: string;
  recommendations: WardrobeRecommendation[];
  notAPriority: NotAPriority[];
}

// ── Thresholds ────────────────────────────────────────────────────────────────

/** A proposal must combine with at least this many owned pieces to be worth it. */
const MIN_UNLOCKS = 3;
/** Share of one fit family that makes the opposite family a real contrast. */
const DOMINANT_FIT_SHARE = 0.7;
/** Usable pieces on one side before the other side is the obvious constraint. */
const SLOT_CONSTRAINT_MIN = 2;
const MAX_RECOMMENDATIONS = 3;

// ── Vocabulary ────────────────────────────────────────────────────────────────

const REGISTER_FORMALITY: Readonly<Record<RegisterId, string>> = {
  everyday: "casual",
  work: "business-casual",
  occasion: "evening",
};

const REGISTER_WORD: Readonly<Record<RegisterId, string>> = {
  everyday: "everyday",
  work: "work",
  occasion: "occasion",
};

const SLOT_NOUN: Readonly<Record<string, string>> = {
  top: "top",
  bottom: "bottom",
  dress: "dress",
  outerwear: "layer",
};

const STRUCTURED_FIT = "tailored";
const SOFT_FIT = "relaxed";

const STRUCTURE_LABEL: Readonly<Record<string, string>> = {
  structured: "a cleaner, more structured shape",
  soft: "a softer, easier shape",
};

/**
 * Coverage preferences that describe a garment, in her words as a phrase —
 * and which garments each one can describe.
 *
 * Slot matters. "Keeps her legs covered" is a statement about a bottom or a
 * dress and says nothing about a top; "keeps her arms covered" is the reverse.
 * A single top/dress/outerwear gate dropped every leg-related requirement from
 * bottom recommendations, so a customer who had told nAia she prefers
 * full-length trousers was recommended "a work bottom" with no length at all.
 */
const COVERAGE_RULES: Readonly<
  Record<string, { label: string; slots: readonly string[]; adjective?: string }>
> = {
  "arms-covered":               { label: "sleeves",            slots: ["top", "dress", "outerwear"], adjective: "sleeved" },
  "avoid-sleeveless":           { label: "sleeves",            slots: ["top", "dress", "outerwear"], adjective: "sleeved" },
  "chest-neckline-covered":     { label: "a higher neckline",  slots: ["top", "dress"], adjective: "higher-necked" },
  "prefer-higher-necklines":    { label: "a higher neckline",  slots: ["top", "dress"], adjective: "higher-necked" },
  "longer-tops":                { label: "a longer cut",       slots: ["top"], adjective: "longer" },
  "no-cropped-tops":            { label: "not cropped",        slots: ["top"] },
  "legs-covered":               { label: "full length",        slots: ["bottom", "dress"], adjective: "full-length" },
  "prefer-full-length-trousers":{ label: "full length",        slots: ["bottom"], adjective: "full-length" },
  "looser-fitting":             { label: "an easier fit",      slots: ["top", "bottom", "dress", "outerwear"], adjective: "looser" },
};

// ── Candidate construction ────────────────────────────────────────────────────

/**
 * A stand-in for the piece being recommended, built so it can be run through
 * the real compatibility rule. Every field it carries is one the proposal
 * actually commits to; anything unspecified is left null so scorePair judges it
 * on what is genuinely proposed rather than on invented detail.
 */
function candidateGarment(
  register: RegisterId,
  slot: string,
  opts: { neutral?: boolean; hueFamily?: string | null; fit?: string | null } = {},
): WardrobeGarment {
  return {
    id: "__candidate__",
    name: null,
    category: slot.toUpperCase(),
    subcategory: null,
    imageUrl: null,
    slot,
    primaryColor: null,
    colors: [],
    pattern: "solid",
    material: null,
    silhouette: null,
    fitProfile: opts.fit ?? null,
    formality: REGISTER_FORMALITY[register],
    stylePersonality: null,
    occasions: [],
    seasons: [],
    analysisStatus: "ready",
    visualWeight: null,
    colourProfile:
      opts.neutral === undefined
        ? null
        : { hueFamily: opts.hueFamily ?? null, wardrobeNeutral: opts.neutral, lightDark: null, energyTier: null },
    garmentRelationships: [],
    intentions: null,
    intentionsSource: null,
    intelligenceSource: "derived",
    outfitAppearances: 0,
    savedLookAppearances: 0,
    observedWear: null,
  };
}

/**
 * Owned pieces the candidate would genuinely work with.
 *
 * This uses scorePair().compatible — the hard gates: balanced visual weight, a
 * level of dress within one step, and no colour conflict. It deliberately does
 * NOT use supportedPair().
 *
 * supportedPair additionally demands a reason that says something about the two
 * garments together, and that gate exists to stop thirteen identical tops
 * counting as thirteen options when measuring DEPTH. Applied to a hypothetical
 * piece it asks the wrong question: a proposal that has not yet committed to a
 * colour or a shape can only ever earn the weakest "same level of dress"
 * reason, so every recommendation would be rejected for being insufficiently
 * specific — precisely the specificity this file refuses to invent.
 *
 * So the question here is "would a piece of this kind fit into her wardrobe at
 * all", and an attribute is then only kept if it does not shrink this number.
 */
function unlocks(candidate: WardrobeGarment, pool: WardrobeGarment[]): WardrobeGarment[] {
  return pool.filter((g) => {
    // Only cross-slot pairings make a new outfit; two tops are not a look.
    const candidateTop = TOP_SLOTS.has(candidate.slot);
    const candidateBottom = BOTTOM_SLOTS.has(candidate.slot);
    const gTop = TOP_SLOTS.has(g.slot);
    const gBottom = BOTTOM_SLOTS.has(g.slot);
    const layer = candidate.slot === "outerwear";
    const complementary = layer
      ? gTop || gBottom || ONE_PIECE_SLOTS.has(g.slot)
      : (candidateTop && gBottom) || (candidateBottom && gTop);
    return complementary && scorePair(candidate, g).compatible;
  });
}

// ── Evidence gathering ────────────────────────────────────────────────────────

/**
 * Colour families she loves, ordered so the ones she owns least come first.
 *
 * A thin loved colour REFINES a recommendation that already exists; it never
 * creates one. By the time this runs the gap is already proven, so the only
 * question left is which of her colours would make the piece most useful — and
 * a colour she loves but barely owns adds an option she does not currently
 * have, where another black one would not.
 *
 * `items` is optional so the ordering degrades to her stated order rather than
 * failing when coverage cannot be measured.
 */
function lovedColourFamilies(
  passport: WardrobePassport | null,
  items?: WardrobeGarment[],
): string[] {
  if (!passport || passport.favoriteColors.length === 0) return [];
  const avoided = new Set<string>();
  for (const token of passport.avoidColors) {
    for (const family of PASSPORT_COLOUR_FAMILIES[norm(token) ?? ""] ?? []) avoided.add(family);
  }
  const families: string[] = [];
  for (const token of passport.favoriteColors) {
    for (const family of PASSPORT_COLOUR_FAMILIES[norm(token) ?? ""] ?? []) {
      if (!avoided.has(family) && !families.includes(family)) families.push(family);
    }
  }
  if (!items) return families;

  // Coverage is measured per Passport CHOICE, and one choice can cover several
  // Closet families ("white / cream"), so the count is spread back across them.
  const coverage = computePaletteCoverage(items, passport);
  const countOf = new Map<string, number>();
  for (const row of coverage.families) {
    for (const family of row.families) countOf.set(family, row.count);
  }
  // Least-owned first. Stable for equal counts, so her stated order survives.
  return [...families].sort((a, b) => (countOf.get(a) ?? 0) - (countOf.get(b) ?? 0));
}

/** The fit family her Closet leans on, when it leans hard enough to matter. */
function dominantFit(pool: WardrobeGarment[]): "structured" | "soft" | null {
  const withFit = pool.filter((g) => norm(g.fitProfile));
  if (withFit.length < MIN_WARDROBE_SIZE) return null;
  const structured = withFit.filter((g) => {
    const f = norm(g.fitProfile)!;
    return f === "tailored" || f === "structured";
  }).length;
  const soft = withFit.filter((g) => {
    const f = norm(g.fitProfile)!;
    return f === "relaxed" || f === "loose" || f === "oversized" || f === "flowy";
  }).length;
  if (structured / withFit.length >= DOMINANT_FIT_SHARE) return "structured";
  if (soft / withFit.length >= DOMINANT_FIT_SHARE) return "soft";
  return null;
}

/** Coverage requirements she stated that can actually describe THIS garment. */
function statedCoverage(passport: WardrobePassport | null, slot: string): string[] {
  const prefs = (passport?.dressingPreferences ?? []).filter(
    (p) => COVERAGE_RULES[p]?.slots.includes(slot),
  );
  // Collapse duplicates that mean the same thing on a garment ("sleeves").
  const seenLabels = new Set<string>();
  return prefs.filter((p) => {
    const label = COVERAGE_RULES[p].label;
    if (seenLabels.has(label)) return false;
    seenLabels.add(label);
    return true;
  });
}

// ── Slot selection ────────────────────────────────────────────────────────────

/**
 * Which part of an outfit is actually the constraint at this register.
 *
 * SCARCITY IS NOT NEED. Every branch answers "what capability is missing",
 * never "what does she own least of". The reason for a recommendation is always
 * a gap the needs engine already proved; the slot is only how that gap closes.
 *
 * Returns null when nothing is clearly the bottleneck — the recommendation then
 * stays at "direction" and names no garment type at all.
 */
function constrainedSlot(
  pool: WardrobeGarment[],
  allItems: WardrobeGarment[],
  register: RegisterId,
  gapKind: DepthFinding["kind"],
  passport: WardrobePassport | null,
): string | null {
  const tops = pool.filter((g) => TOP_SLOTS.has(g.slot));
  const bottoms = pool.filter((g) => BOTTOM_SLOTS.has(g.slot));
  const onePieces = pool.filter((g) => ONE_PIECE_SLOTS.has(g.slot));

  // 1. A missing half. She cannot build a complete look at all.
  if (tops.length >= SLOT_CONSTRAINT_MIN && bottoms.length === 0) return "bottom";
  if (bottoms.length >= SLOT_CONSTRAINT_MIN && tops.length === 0) return "top";

  // 2. An effective-depth gap: she owns the pieces and they do not meet what she
  //    told nAia about how she dresses. The missing capability is a piece of the
  //    SAME kind that does meet it, so the slot is wherever her own coverage
  //    requirements are blocking the most pieces. This is her stated preference
  //    deciding the answer, not a count — and it was previously unused, which is
  //    why an entirely diagnosable gap reported "not yet which kind of piece".
  if (gapKind === "effective-depth") {
    const blockedBySlot = new Map<string, number>();
    for (const g of allItems) {
      if (garmentRegister(g) !== register) continue;
      if (classifyUsability(g, passport).usability !== "blocked") continue;
      if (!SLOT_NOUN[g.slot]) continue;
      blockedBySlot.set(g.slot, (blockedBySlot.get(g.slot) ?? 0) + 1);
    }
    const worst = [...blockedBySlot.entries()].sort((a, b) => b[1] - a[1])[0];
    if (worst && worst[1] >= SLOT_CONSTRAINT_MIN) return worst[0];
  }

  // 3. An occasion register with no way to finish a look and no one-piece.
  if (register === "occasion" && onePieces.length === 0 && (tops.length === 0 || bottoms.length === 0)) {
    return "dress";
  }

  // 4. Layering — ONLY where the proven gap is repetition. She owns both halves
  //    and they keep making the same outfit, so a way to change an existing look
  //    is the missing capability. "No outer layer + enough pieces" on its own is
  //    exactly the scarcity reasoning this function must refuse.
  if (gapKind === "repetition" && tops.length > 0 && bottoms.length > 0) {
    const outerAnywhere = allItems.filter((g) => g.slot === "outerwear").length;
    const core = allItems.filter(
      (g) => TOP_SLOTS.has(g.slot) || BOTTOM_SLOTS.has(g.slot) || ONE_PIECE_SLOTS.has(g.slot),
    ).length;
    if (outerAnywhere === 0 && core >= 8) return "outerwear";
  }

  // 5. Variety within a slot, measured in interchangeability classes rather than
  //    piece counts. Five tops that are all the same top is one option, not five;
  //    the side with fewer genuinely different pieces is the bottleneck even when
  //    it holds MORE garments. Counting pieces alone missed this.
  const classesOf = (group: WardrobeGarment[]) => new Set(group.map(outfitClassKey)).size;
  if (tops.length > 0 && bottoms.length > 0) {
    const topClasses = classesOf(tops);
    const bottomClasses = classesOf(bottoms);
    if (topClasses < bottomClasses) return "top";
    if (bottomClasses < topClasses) return "bottom";
  }

  // 6. Both halves present and one is genuinely the limiting side by count.
  if (tops.length > 0 && bottoms.length > 0) {
    if (bottoms.length * 2 <= tops.length) return "bottom";
    if (tops.length * 2 <= bottoms.length) return "top";
  }
  return null;
}

// ── Derivation ────────────────────────────────────────────────────────────────

function buildRecommendation(
  finding: DepthFinding,
  reading: RegisterReading,
  items: WardrobeGarment[],
  passport: WardrobePassport | null,
): WardrobeRecommendation | null {
  const register = finding.register;
  const registerPool = items.filter(
    (g) => garmentRegister(g) === register && classifyUsability(g, passport).usability === "usable",
  );

  /**
   * Who the proposed piece could actually be worn with.
   *
   * The WHOLE usable wardrobe, not just this register. scorePair() already
   * enforces a level-of-dress distance of one step, so a smart-casual top is
   * counted for a work bottom and a casual one is not — the constraint is
   * applied exactly once, by the rule that owns it.
   *
   * Restricting this to the register pool applied that same constraint a second
   * time and starved the count: a customer with two work tops scored 2 against
   * a minimum of 3, and a perfectly diagnosable gap produced no recommendation
   * at all. Measured correctly the same wardrobe scores 4, and the two casual
   * tops scorePair rejects are still rejected.
   */
  const partnerPool = items.filter((g) => classifyUsability(g, passport).usability === "usable");
  const evidence: Evidence[] = [
    ev("passport-signal", "lifestyle", `You've told nAia ${REGISTER_WORD[register]} dressing is part of your life.`, []),
  ];

  // ── Rung 1: direction ────────────────────────────────────────────────────
  let slot = constrainedSlot(registerPool, items, register, finding.kind, passport);
  if (!slot) {
    return {
      id: `rec-${register}`,
      register,
      specificity: "direction",
      title: `More range for ${REGISTER_WORD[register]} dressing`,
      attributes: [],
      body: `nAia can see that ${REGISTER_WORD[register]} dressing is the thinner side of your wardrobe, but not yet which kind of piece would fix it. A few more pieces read, or a little more StyleMe history, and it will be able to say.`,
      unlocksIds: [],
      criteria: { register, slot: null, colourFamilies: [], structure: null, resolvingSilhouettes: [], coverage: [] },
      evidence,
      strength: "emerging",
    };
  }

  // ── Rung 2: slot ─────────────────────────────────────────────────────────
  //
  // For a REPETITION gap the slot has to be one that can actually close it.
  // Distinct looks are top-bottom pairs between classes, so a layer — however
  // useful — cannot lift the number. If the chosen slot has no class that
  // resolves the gap and a structural slot does, prefer the one that works.
  if (finding.kind === "repetition" && gapResolvingClasses({ pool: registerPool, passport, slot, register }).length === 0) {
    const better = ["bottom", "top"].find(
      (candidate) =>
        candidate !== slot &&
        gapResolvingClasses({ pool: registerPool, passport, slot: candidate, register }).length > 0,
    );
    if (better) slot = better;
  }

  // The broad candidate is the baseline every attribute is measured against.
  const broad = candidateGarment(register, slot);
  const broadUnlocks = unlocks(broad, partnerPool.length > 0 ? partnerPool : items);

  // A one-piece IS a complete look. Requiring it to combine with three owned
  // garments asks the wrong question — a dress needs no partner to be wearable,
  // and gating it like a top silently suppressed the single most diagnosable
  // gap there is (an occasion wardrobe blocked by her own coverage rules).
  const selfSufficient = ONE_PIECE_SLOTS.has(slot);
  if (!selfSufficient && broadUnlocks.length < MIN_UNLOCKS) {
    // Adding this would not meaningfully combine with what she owns. Saying so
    // is more useful than recommending something that will sit unworn.
    return null;
  }
  evidence.push(
    ev("garment-fact", "compatibility graph", `A ${SLOT_NOUN[slot] ?? slot} at this level would work with ${broadUnlocks.length} pieces you already own.`, broadUnlocks.map((g) => g.id)),
  );

  // ── Rung 3: attributes, each cited and each tested ───────────────────────
  const attributes: RecommendationAttribute[] = [];
  let colourLead: string | null = null;
  let colourAlternatives: string[] = [];
  const criteria: RecommendationCriteria = {
    register, slot, colourFamilies: [], structure: null, resolvingSilhouettes: [], coverage: [],
  };
  let best = broadUnlocks;

  // ── What would actually CLOSE this gap ───────────────────────────────────
  //
  // A repetition finding is judged on distinct looks, not on partner count, so
  // the attributes proposed for it have to be derived from that same measure.
  // gapResolvingClasses simulates a candidate against the real rule and returns
  // only the classes that lift the register past the threshold — and only those
  // that satisfy her stated dressing preferences.
  //
  // Nothing here is a universal answer. These are the classes THIS Closet is
  // missing; another customer with the same gap can need the opposite.
  if (finding.kind === "repetition") {
    const resolving = gapResolvingClasses({ pool: registerPool, passport, slot, register });
    const leadFamily = resolving[0]?.fitFamily ?? null;
    if (leadFamily) {
      const silhouettes = [...new Set(
        resolving.filter((r) => r.fitFamily === leadFamily).map((r) => r.silhouette),
      )].slice(0, 3);

      // Name only what actually DIFFERS from what she owns. Her work bottoms
      // are already tailored, so "more structured" would describe the problem
      // rather than the answer — the class she is missing is a different
      // SHAPE. The fit family is mentioned only when it is itself the change.
      const ownFits = new Set(
        registerPool.filter((g) => g.slot === slot).map((g) => {
          const f = norm(g.fitProfile);
          return f && STRUCTURED_FITS.has(f) ? "structured" : f && SOFT_FITS.has(f) ? "soft" : "unknown";
        }),
      );
      const fitIsTheChange = !ownFits.has(leadFamily as "structured" | "soft" | "unknown");

      criteria.structure = fitIsTheChange ? leadFamily : null;
      criteria.resolvingSilhouettes = silhouettes;
      attributes.push({
        kind: "structure",
        values: fitIsTheChange ? [leadFamily, ...silhouettes] : silhouettes,
        label: fitIsTheChange
          ? `${STRUCTURE_LABEL[leadFamily] ?? leadFamily}, in ${joinOr(silhouettes)}`
          : `a different shape — ${joinOr(silhouettes)}`,
        source: "closet",
      });
      evidence.push(
        ev(
          "garment-fact",
          "distinct-looks simulation",
          `A ${leadFamily === "soft" ? "looser" : "more structured"} ${SLOT_NOUN[slot] ?? slot} in ${joinOr(silhouettes)} would take ${REGISTER_WORD[register]} from ${reading.distinctLooks} distinct looks to ${resolving[0].distinctLooks}.`,
          [],
        ),
      );
    }
  }

  // Structure — proposed only when contrast demonstrably BUYS something.
  //
  // DIFFERENCE IS NOT IMPROVEMENT. A wardrobe leaning one way is not a reason to
  // recommend the other way: the contrast must open outfit combinations that do
  // not exist today (a strict increase, not merely "no worse"), and it must not
  // contradict a fit preference she has stated.
  const lean = dominantFit(registerPool);
  const statedLooser = (passport?.dressingPreferences ?? []).includes("looser-fitting");
  if (lean) {
    const contrast = lean === "soft" ? "structured" : "soft";
    const conflictsWithPassport = contrast === "structured" && statedLooser;
    const withFit = candidateGarment(register, slot, { fit: contrast === "structured" ? STRUCTURED_FIT : SOFT_FIT });
    const fitUnlocks = unlocks(withFit, partnerPool);
    if (!conflictsWithPassport && fitUnlocks.length > best.length) {
      attributes.push({
        kind: "structure",
        values: [contrast],
        label: STRUCTURE_LABEL[contrast],
        source: "closet",
      });
      criteria.structure = contrast;
      best = fitUnlocks;
      evidence.push(
        ev("garment-fact", "fitProfile", `Most of your ${REGISTER_WORD[register]} pieces already read ${lean === "soft" ? "relaxed" : "tailored"}.`, []),
      );
    }
  }

  // Colour — only from colours she named, never from what "goes with" things.
  const loved = lovedColourFamilies(passport, items);
  if (loved.length > 0) {
    const withColour = candidateGarment(register, slot, {
      neutral: loved.some((f) => ["black", "grey", "beige", "brown", "white", "cream"].includes(f)),
      hueFamily: loved[0],
      fit: criteria.structure === "structured" ? STRUCTURED_FIT : criteria.structure === "soft" ? SOFT_FIT : null,
    });
    const colourUnlocks = unlocks(withColour, partnerPool);
    if (colourUnlocks.length >= best.length) {
      const shown = loved.slice(0, 3);
      // `loved` is ordered least-owned first, so the head is the colour she
      // named that her Closet has least of. The rest are ALTERNATIVES, not
      // extra requirements — listing them flat read as though one garment
      // should somehow be grey and red and burgundy at once.
      const [lead, ...alternatives] = shown;
      colourLead = lead;
      colourAlternatives = alternatives;
      attributes.push({
        kind: "colour",
        values: shown,
        label: lead,
        source: "passport",
      });
      criteria.colourFamilies = shown;
      best = colourUnlocks;
      evidence.push(
        ev("passport-signal", "favoriteColors", `You named ${joinList(shown)} among the colours you love.`, []),
      );
    }
  }

  // Coverage — a hard requirement she stated, so it is never optional.
  const coverage = statedCoverage(passport, slot);
  // The lead requirement becomes an adjective in the name — "a full-length work
  // bottom" rather than "a work bottom" tagged "full length", which read as two
  // equal pieces of metadata when one of them is the garment itself.
  let coverageAdjective: string | null = null;
  if (coverage.length > 0) {
    coverageAdjective = COVERAGE_RULES[coverage[0]].adjective ?? null;
    // Anything the name does not already say stays on the attributes line.
    const remaining = coverageAdjective ? coverage.slice(1) : coverage;
    const labels = remaining.map((c) => COVERAGE_RULES[c].label).slice(0, 2);
    if (labels.length > 0) {
      attributes.push({ kind: "coverage", values: remaining, label: joinList(labels), source: "passport" });
    }
    // The structured payload always carries every stated requirement, whether
    // it ended up in the name or on the line.
    criteria.coverage = coverage;
    evidence.push(
      ev("passport-signal", "dressingPreferences", `You've told nAia how you prefer to be covered.`, []),
    );
  }

  const specificity: Specificity =
    attributes.length > 0 || coverageAdjective !== null ? "detailed" : "slot";
  const noun = SLOT_NOUN[slot] ?? slot;
  const structureWord = criteria.structure === "structured" ? "structured " : criteria.structure === "soft" ? "softer " : "";
  // When the gap is that her own coverage rules rule pieces out, say so in the
  // title: "an occasion dress with more coverage" is the actual answer, where
  // "an occasion dress" reads as though she simply owns too few.
  // "with more coverage" only where the name does not already carry the
  // requirement — never both, which would read "a full-length dress with more
  // coverage".
  const coverageSuffix =
    !coverageAdjective && finding.kind === "effective-depth" && criteria.coverage.length > 0
      ? " with more coverage"
      : "";
  const coveragePrefix = coverageAdjective ? `${coverageAdjective} ` : "";
  const phrase = `${coveragePrefix}${structureWord}${REGISTER_WORD[register]} ${noun}${coverageSuffix}`;
  // "One option to explore" rather than a directive. The engine has evidence
  // for a gap; it does not have evidence that buying is the only answer.
  const title = `One option to explore: ${/^[aeiou]/i.test(phrase) ? "an" : "a"} ${phrase}`;

  // The body explains what it would DO, not what it is. The reason to buy is
  // the combinations it creates, and that number is measured, not asserted.
  const reasonForGap =
    finding.kind === "repetition"
      ? `Your ${REGISTER_WORD[register]} pieces repeat similar combinations.`
      : finding.kind === "effective-depth"
        ? `You own ${REGISTER_WORD[register]} pieces, but fewer of them meet the way you've told nAia you prefer to dress.`
        : `Your ${REGISTER_WORD[register]} dressing is the thinner side of your wardrobe.`;

  // Colour is a preference, never a reason.
  //
  // This used to say a colour "would add the most" because it was the named
  // colour she owned least of. That is an overclaim: underrepresentation can
  // refine a need that already exists, but it cannot create one or prove one.
  // The wardrobe gap is the reason; colour only narrows what to look for.
  const colourNote = colourLead
    ? ` ${capitaliseFirst(colourLead)} is a colour you said you like.${
        colourAlternatives.length > 0
          ? ` ${capitaliseFirst(joinOr(colourAlternatives))} are also within the palette you described.`
          : ""
      }`
    : "";

  return {
    id: `rec-${register}-${slot}`,
    register,
    specificity,
    title,
    attributes,
    body: selfSufficient
      ? `${reasonForGap} A piece like this is a complete look on its own, so it adds an option you can wear without needing anything else to work with it.${colourNote}`
      : `${reasonForGap} A piece like this could pair with ${best.length} ${best.length === 1 ? "piece" : "pieces"} already in your Closet, so it adds ways to dress rather than another version of something you have.${colourNote}`,
    unlocksIds: best.slice(0, 6).map((g) => g.id),
    criteria,
    evidence,
    strength: best.length >= MIN_UNLOCKS * 2 ? "strong" : "moderate",
  };
}

/**
 * What NOT to buy.
 *
 * Only stated where the engine already found real depth, and only against a
 * register it has already called thin — so this is a comparison between two
 * conclusions the page has made, never a new judgement about a category.
 */
function buildNotAPriority(needs: WardrobeNeeds): NotAPriority[] {
  const enough = needs.enough[0];
  if (!enough) return [];
  const thinner = needs.couldUseMore.find((f) => f.register !== enough.register);
  if (!thinner) return [];

  const subject = enough.title.replace(/^You already have enough /, "");
  const thinWord = REGISTER_WORD[thinner.register];
  return [
    {
      id: `not-priority-${enough.register}`,
      title: `Another of your ${subject}`,
      body: `You already have strong depth here. A similar piece would add very little compared with strengthening your ${thinWord} wardrobe.`,
    },
  ];
}

// ── Entry point ───────────────────────────────────────────────────────────────

export function computeWardrobeRecommendations(input: {
  needs: WardrobeNeeds;
  items: WardrobeGarment[];
  passport: WardrobePassport | null;
}): WardrobeRecommendations {
  const { needs, items, passport } = input;

  // No gap, no recommendation. This layer never decides something is missing.
  if (needs.state !== "available" || needs.couldUseMore.length === 0) {
    return {
      state: "learning",
      learningNote:
        needs.state === "available"
          ? "nAia hasn't found a gap worth shopping for, so there's nothing to recommend."
          : "Recommendations appear once nAia can read enough of your wardrobe.",
      recommendations: [],
      notAPriority: [],
    };
  }

  const byRegister = new Map(needs.registers.map((r) => [r.register, r]));
  const recommendations = needs.couldUseMore
    .map((finding) => {
      const reading = byRegister.get(finding.register);
      return reading ? buildRecommendation(finding, reading, items, passport) : null;
    })
    .filter((r): r is WardrobeRecommendation => r !== null)
    .slice(0, MAX_RECOMMENDATIONS);

  if (recommendations.length === 0) {
    return {
      state: "learning",
      learningNote:
        "nAia can see where your wardrobe is thinner, but not yet which kind of piece would genuinely help. It would rather say nothing than guess.",
      recommendations: [],
      notAPriority: buildNotAPriority(needs),
    };
  }

  return { state: "available", recommendations, notAPriority: buildNotAPriority(needs) };
}

// ── Small helpers ─────────────────────────────────────────────────────────────

/** "red or burgundy" — alternatives, never a list of requirements. */
function joinOr(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} or ${parts[parts.length - 1]}`;
}

function capitaliseFirst(s: string): string {
  return s.length === 0 ? s : s[0].toUpperCase() + s.slice(1);
}

export const WARDROBE_RECOMMENDATIONS_VERSION = "1.0.0";
