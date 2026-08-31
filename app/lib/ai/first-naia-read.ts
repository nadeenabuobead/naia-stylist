// app/lib/ai/first-naia-read.ts
// Deterministic First nAia Read engine.
// Pure function: no DB, no LLM, no side effects.
// Takes a subset of the customer's OnboardingProfile and returns
// up to 3 evidence-based style observations with uncertainty language.

export type ObservationType =
  | "style-direction"
  | "clothing-relationship"
  | "wardrobe-context"
  | "colour-world";

export interface NaiaFirstReadObservation {
  observationKey: string;
  type: ObservationType;
  evidenceFields: string[];
  evidenceValues: string[];
  /** Structured field→values map used for server-side provenance persistence. */
  fieldValueMap: Record<string, string[]>;
  claim: string;
}

export interface NaiaFirstReadResult {
  observations: NaiaFirstReadObservation[];
}

// Subset of OnboardingProfile that First Read draws on.
// currentGoal, dressingPreferences, fitConcerns are intentionally EXCLUDED —
// they are mutable context or practical boundaries, not style hypotheses.
export interface FirstReadProfile {
  stylePersonalities?: string[];
  silhouette?: string[];
  successfulOutfitGives?: string[];
  lifestyle?: string[];
  favoriteColors?: string[];
  avoidColors?: string[];
}

// ── Constants ─────────────────────────────────────────────────────────────────

export const FIRST_READ_SCHEMA_VERSION = "first-read-v1";
const MAX_OBSERVATIONS = 3;

// IDs that carry no evidence signal — excluded from all observation building.
const GENERIC_EXCLUSIONS = new Set(["not-sure", "not-sure-yet"]);

// ── Label maps ────────────────────────────────────────────────────────────────

// Personality IDs → short descriptive phrase (used inside claim sentences)
const PERSONALITY_LABELS: Readonly<Record<string, string>> = {
  "classic-polished":    "polished and refined",
  "feminine-romantic":   "soft and romantic",
  "minimal-relaxed":     "clean and understated",
  "bold-edgy":           "bold and distinctive",
  "creative-expressive": "creatively expressive",
  // V2 legacy IDs — accepted because existing customers have them stored
  "old-money":           "timeless and classic",
  "artsy":               "creative and artistic",
  "edgy":                "bold and edgy",
  "feminine":            "soft and feminine",
  "corporate-chic":      "polished and professional",
  "effortlessly-chic":   "effortlessly stylish",
  "minimal":             "clean and minimal",
  "trendy":              "fashion-forward",
  "romantic":            "dreamy and romantic",
  "casual-cool":         "relaxed and cool",
};

// Silhouette IDs → short phrase
const SILHOUETTE_LABELS: Readonly<Record<string, string>> = {
  "fitted":              "fitted silhouettes",
  "waist-defined":       "waist-defining shapes",
  "straight-simple":     "clean, straight-cut pieces",
  "relaxed":             "relaxed silhouettes",
  "oversized":           "oversized proportions",
  "loose-flowing":       "loose, flowing shapes",
  "structured-tailored": "structured, tailored pieces",
};

// Successful outfit gives IDs → short phrase
const SOG_LABELS: Readonly<Record<string, string>> = {
  "feel-like-myself":    "feeling completely like yourself",
  "confidence":          "feeling confident",
  "feel-put-together":   "feeling put-together",
  "comfort-ease":        "comfort and ease of movement",
  "sense-of-expression": "a sense of creative expression",
  "feel-attractive":     "feeling attractive",
  "sense-of-power":      "a sense of power",
  "effortlessness":      "effortlessness",
};

// Lifestyle IDs → descriptive phrase
const LIFESTYLE_LABELS: Readonly<Record<string, string>> = {
  "work-office":              "everyday professional settings",
  "everyday-casual":          "relaxed everyday moments",
  "dinners-going-out":        "evenings out",
  "events-special-occasions": "special occasions",
  "family-parenting":         "family life",
  "travel":                   "travel",
  "active-busy-days":         "active, busy days",
};

// Colour IDs → natural language name
const COLOR_LABELS: Readonly<Record<string, string>> = {
  "black":        "black",
  "white-cream":  "white and cream",
  "beige-brown":  "beige and warm neutrals",
  "grey":         "grey",
  "navy":         "navy",
  "red-burgundy": "red and burgundy tones",
  "green":        "green",
  "pink":         "pink",
  "yellow":       "yellow",
  "orange":       "orange",
};

// ── Internal helpers ──────────────────────────────────────────────────────────

function filtered(arr: string[] | undefined): string[] {
  return (arr ?? []).filter(id => !GENERIC_EXCLUSIONS.has(id));
}

function joinLabels(labels: string[]): string {
  if (labels.length === 0) return "";
  if (labels.length === 1) return labels[0];
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return `${labels.slice(0, -1).join(", ")}, and ${labels[labels.length - 1]}`;
}

// observationKey: deterministic stable string encoding schema version, type,
// and field:value pairs so different fields with the same value produce
// different keys (e.g. favoriteColors:black ≠ avoidColors:black).
//
// Format: first-read-v1|{type}|{fieldA:valueA1|fieldA:valueA2|fieldB:valueB1|…}
// Fields are sorted lexicographically; values within each field are deduped and sorted.
function makeKey(type: ObservationType, evidence: Record<string, string[]>): string {
  const pairs: string[] = [];
  for (const field of Object.keys(evidence).sort()) {
    const vals = [...new Set(evidence[field])].filter(v => !GENERIC_EXCLUSIONS.has(v)).sort();
    for (const v of vals) {
      pairs.push(`${field}:${v}`);
    }
  }
  return `${FIRST_READ_SCHEMA_VERSION}|${type}|${pairs.join("|")}`;
}

// ── Observation builders (one per type) ───────────────────────────────────────

function buildStyleDirection(profile: FirstReadProfile): NaiaFirstReadObservation | null {
  const personalities = filtered(profile.stylePersonalities);
  const silhouettes   = filtered(profile.silhouette);

  const personalityDescs = personalities.map(id => PERSONALITY_LABELS[id]).filter(Boolean);
  const silhouetteDescs  = silhouettes.map(id => SILHOUETTE_LABELS[id]).filter(Boolean);

  if (personalityDescs.length === 0 && silhouetteDescs.length === 0) return null;

  let claim: string;
  if (personalityDescs.length > 0 && silhouetteDescs.length > 0) {
    claim = `We're beginning to see a pull toward ${joinLabels(personalityDescs)} style, with ${joinLabels(silhouetteDescs)} feeling natural to you.`;
  } else if (personalityDescs.length > 0) {
    claim = `We're beginning to see a pull toward ${joinLabels(personalityDescs)} style.`;
  } else {
    claim = `You seem to gravitate toward ${joinLabels(silhouetteDescs)}.`;
  }

  const fieldValueMap: Record<string, string[]> = {};
  if (personalities.length > 0) fieldValueMap["stylePersonalities"] = personalities;
  if (silhouettes.length > 0)   fieldValueMap["silhouette"] = silhouettes;

  return {
    observationKey: makeKey("style-direction", fieldValueMap),
    type: "style-direction",
    evidenceFields: ["stylePersonalities", "silhouette"],
    evidenceValues: [...personalities, ...silhouettes],
    fieldValueMap,
    claim,
  };
}

function buildClothingRelationship(profile: FirstReadProfile): NaiaFirstReadObservation | null {
  const sog  = filtered(profile.successfulOutfitGives);
  const descs = sog.map(id => SOG_LABELS[id]).filter(Boolean);
  if (descs.length === 0) return null;

  const claim = `When an outfit really works for you, ${joinLabels(descs)} seem especially important.`;
  const fieldValueMap = { successfulOutfitGives: sog };
  return {
    observationKey: makeKey("clothing-relationship", fieldValueMap),
    type: "clothing-relationship",
    evidenceFields: ["successfulOutfitGives"],
    evidenceValues: sog,
    fieldValueMap,
    claim,
  };
}

function buildWardrobeContext(profile: FirstReadProfile): NaiaFirstReadObservation | null {
  const ls    = filtered(profile.lifestyle);
  const descs = ls.map(id => LIFESTYLE_LABELS[id]).filter(Boolean);
  if (descs.length === 0) return null;

  const claim =
    descs.length === 1
      ? `Your wardrobe needs to work for ${descs[0]}, so clothing that suits that context may matter most.`
      : `Your wardrobe needs to move between ${joinLabels(descs)}, so versatility between these parts of your life may matter.`;

  const fieldValueMap = { lifestyle: ls };
  return {
    observationKey: makeKey("wardrobe-context", fieldValueMap),
    type: "wardrobe-context",
    evidenceFields: ["lifestyle"],
    evidenceValues: ls,
    fieldValueMap,
    claim,
  };
}

function buildColourWorld(profile: FirstReadProfile): NaiaFirstReadObservation | null {
  const favColors   = filtered(profile.favoriteColors);
  const avoidColors = filtered(profile.avoidColors);

  const favLabels   = favColors.map(id => COLOR_LABELS[id]).filter(Boolean);
  const avoidLabels = avoidColors.map(id => COLOR_LABELS[id]).filter(Boolean);

  if (favLabels.length === 0 && avoidLabels.length === 0) return null;

  let claim: string;
  if (favLabels.length > 0 && avoidLabels.length > 0) {
    const avoidVerb = avoidLabels.length === 1 ? "is" : "are";
    claim = `You seem to reach toward ${joinLabels(favLabels)}, while ${joinLabels(avoidLabels)} ${avoidVerb} something you tend to step back from.`;
  } else if (favLabels.length > 0) {
    claim = `You seem to reach for ${joinLabels(favLabels)} most — that palette tells us something about your instincts.`;
  } else {
    const avoidVerb = avoidLabels.length === 1 ? "is" : "are";
    claim = `You seem to know what you step back from — ${joinLabels(avoidLabels)} ${avoidVerb} not where you naturally go.`;
  }

  const fieldValueMap: Record<string, string[]> = {};
  if (favColors.length > 0)   fieldValueMap["favoriteColors"] = favColors;
  if (avoidColors.length > 0) fieldValueMap["avoidColors"] = avoidColors;

  return {
    observationKey: makeKey("colour-world", fieldValueMap),
    type: "colour-world",
    evidenceFields: ["favoriteColors", "avoidColors"],
    evidenceValues: [...favColors, ...avoidColors],
    fieldValueMap,
    claim,
  };
}

// ── Main export ───────────────────────────────────────────────────────────────

// Deterministic priority order: style-direction → clothing-relationship →
// wardrobe-context → colour-world. Returns the first MAX_OBSERVATIONS types
// for which meaningful evidence exists.
export function computeNaiaFirstRead(
  profile: FirstReadProfile | null | undefined,
): NaiaFirstReadResult {
  if (!profile) return { observations: [] };

  const builders = [
    () => buildStyleDirection(profile),
    () => buildClothingRelationship(profile),
    () => buildWardrobeContext(profile),
    () => buildColourWorld(profile),
  ];

  const observations: NaiaFirstReadObservation[] = [];
  for (const build of builders) {
    if (observations.length >= MAX_OBSERVATIONS) break;
    const obs = build();
    if (obs) observations.push(obs);
  }

  return { observations };
}

// ── Garment relationship constants ────────────────────────────────────────────

export const GARMENT_RELATIONSHIP_IDS = new Set([
  "favourite",
  "wear-often",
  "love-style-struggle",
  "like",
  "unsure",
  "rarely-wear",
  "regret",
  "occasion-only",
]);

export const GARMENT_RELATIONSHIP_MAX = 2;

export const GARMENT_RELATIONSHIP_LABELS: Readonly<Record<string, string>> = {
  "favourite":          "One of my favourites",
  "wear-often":         "I wear it a lot",
  "love-style-struggle":"I love it but struggle to style it",
  "like":               "I like it",
  "unsure":             "I'm unsure",
  "rarely-wear":        "I rarely wear it",
  "regret":             "I regret buying it",
  "occasion-only":      "I mainly wear it for specific occasions",
};

// Validates and normalises a submitted garmentRelationships array.
// Returns the clean array or an error string.
export function normalizeGarmentRelationships(
  raw: unknown,
): { ok: true; value: string[] } | { ok: false; error: string } {
  if (!Array.isArray(raw)) return { ok: false, error: "garmentRelationships must be an array" };
  const unique = [...new Set(raw as string[])];
  const invalid = unique.filter(id => !GARMENT_RELATIONSHIP_IDS.has(id));
  if (invalid.length > 0) return { ok: false, error: `Unknown relationship IDs: ${invalid.join(", ")}` };
  if (unique.length > GARMENT_RELATIONSHIP_MAX) {
    return { ok: false, error: `Maximum ${GARMENT_RELATIONSHIP_MAX} relationships per item` };
  }
  return { ok: true, value: unique };
}

// ── Closet Starter readiness ──────────────────────────────────────────────────

const STARTER_THRESHOLD = 6;

// Returns true when the customer has tagged at least STARTER_THRESHOLD items
// with at least one garmentRelationship. Counts ITEMS, not total tags.
export function hasClosetStarterEvidence(
  items: Array<{ garmentRelationships: string[] }>,
): boolean {
  return items.filter(i => i.garmentRelationships.length > 0).length >= STARTER_THRESHOLD;
}
