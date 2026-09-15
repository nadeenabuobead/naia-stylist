// app/lib/admin/garment-semantics.server.ts
//
// Phase 2B — garment-level styling interpretation (pass 2: live QA refinements).
//
// Translates objective garment observations (ClosetClassification) into a small,
// human-readable styling vocabulary. Pure function — no DB, no async, no side effects.
//
// Phase 2B boundary:
//   GARMENT OBSERVATIONS → GARMENT STYLING INTERPRETATION
//
// NOT wired to StyleMe, T4 ranking, contextual reasoning, or customer feeling.
//
// Rules (all corrections applied):
//   - Input is normalised (trimmed, lowercased) before any comparison
//   - Formality is authoritative for Polish; occasions are fallback only when formality absent
//   - Non-neutral colour alone does NOT trigger Distinctive
//   - Asymmetric silhouette IS a Distinctive construction signal
//   - Understated fires on solid/absent pattern + neutral colour
//   - Sporty fires on ACTIVEWEAR category or matching subcategory/tags
//   - smart-casual always → Smart (no occasion override)
//   - a-line is not a Fluid trigger
//   - leather/suede do not trigger Edgy
//   - Classic subcategory is supporting evidence only, never sufficient alone

import type { ClosetClassification } from "~/lib/admin/closet-intelligence.server";

// ── Types ─────────────────────────────────────────────────────────────────────

export type InterpretationDimension =
  | "Shape"
  | "Polish"
  | "Activity"
  | "Style identity"
  | "Visual character"
  | "Coverage";

export type InterpretationLabel = {
  label: string;
  dimension: InterpretationDimension;
  evidence: string[];
};

export type GarmentInterpretation = {
  /** Ordered: Shape → Polish → Activity → Style identity → Visual character → Coverage */
  labels: InterpretationLabel[];
  /** Deduplicated union of all evidence strings (first-seen order) */
  evidence: string[];
  hasInterpretation: boolean;
};

// ── Vocabulary constants ──────────────────────────────────────────────────────

export const FORBIDDEN_VOCABULARY = [
  "confident", "confidence", "powerful", "power", "assertive",
  "energising", "energizing", "grounded", "empowering",
] as const;

const NEUTRAL_COLORS = new Set([
  "beige", "cream", "ivory", "off-white", "white", "black", "navy",
  "grey", "gray", "camel", "tan", "taupe", "stone", "charcoal", "brown", "nude",
]);

// Subcategory archetypes that add supporting evidence to Classic.
// These are NOT sufficient to trigger Classic alone — personality or tags required.
const CLASSIC_SUBCATEGORIES = new Set([
  "trench coat", "blazer", "button-down shirt", "tailored trousers", "pencil skirt",
  "oxford shirt", "polo", "chino", "suit jacket", "tuxedo",
]);

// Categories where coverage is not a meaningful dimension.
const NO_COVERAGE_CATEGORIES = new Set([
  "SHOES", "BAGS", "ACCESSORIES", "JEWELRY",
]);

// Subcategories that indicate athletic / performance construction.
const ACTIVEWEAR_SUBCATEGORIES = new Set([
  "sports bra", "sports-bra",
  "athletic running shoes", "running shoes", "trainers", "sneakers",
  "leggings", "cycling shorts", "gym shorts", "shorts",
  "performance top", "gym top", "workout top", "tank top",
  "athletic jacket", "track jacket", "windbreaker",
  "swimwear", "swimsuit", "bikini",
  "base layer", "compression top", "compression leggings",
]);

// Tags that explicitly indicate athletic / performance character.
const SPORTY_TAGS = new Set([
  "sporty", "athletic", "performance", "sport", "activewear", "technical",
]);

// ── Input normalisation ───────────────────────────────────────────────────────
// All stored string fields are trimmed + lowercased before comparison so that
// casing inconsistencies in the DB (e.g. "Beige", "SOLID", "Business-Casual")
// never silently defeat a rule.

function norm(s: string | null | undefined): string | null {
  if (s === null || s === undefined) return null;
  const t = s.trim().toLowerCase();
  return t === "" ? null : t;
}

function normArr(arr: string[] | null | undefined): string[] {
  return (arr ?? []).map(s => s.trim().toLowerCase()).filter(Boolean);
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Derive a garment-level styling interpretation from stored classification fields.
 *
 * Pure function — guaranteed no DB access, no async operations, no side effects.
 * Safe to call in loaders or tests without any setup.
 *
 * @param c        ClosetClassification — current live values on ClosetItem
 * @param category ClosetCategory enum value e.g. "OUTERWEAR", "TOPS", "SHOES"
 */
export function interpretGarment(
  c: ClosetClassification,
  category: string,
): GarmentInterpretation {
  // Normalise all string inputs before any comparison.
  const nc: ClosetClassification = {
    ...c,
    fitProfile:           norm(c.fitProfile),
    formality:            norm(c.formality),
    stylePersonality:     norm(c.stylePersonality),
    pattern:              norm(c.pattern),
    primaryColor:         norm(c.primaryColor),
    hemLength:            norm(c.hemLength),
    sleeveLength:         norm(c.sleeveLength),
    necklineCoverage:     norm(c.necklineCoverage),
    waistShape:           norm(c.waistShape),
    silhouette:           norm(c.silhouette),
    topLength:            norm(c.topLength),
    subcategory:          norm(c.subcategory),
    material:             norm(c.material),
    colors:               normArr(c.colors),
    occasions:            normArr(c.occasions),
    seasons:              normArr(c.seasons),
    styleTags:            normArr(c.styleTags),
    garmentRelationships: normArr(c.garmentRelationships),
  };
  const cat = (category ?? "").trim().toUpperCase();

  const dims: Array<InterpretationLabel | null> = [
    deriveShape(nc),
    derivePolish(nc),
    deriveSporty(nc, cat),
    deriveStyleIdentity(nc),
    deriveVisualCharacter(nc),
    deriveCoverage(nc, cat),
  ];

  const labels = dims.filter((d): d is InterpretationLabel => d !== null);

  // Deduplicate evidence strings across all dimensions, preserving first-seen order.
  const seen = new Set<string>();
  const evidence: string[] = [];
  for (const dim of labels) {
    for (const e of dim.evidence) {
      if (!seen.has(e)) {
        seen.add(e);
        evidence.push(e);
      }
    }
  }

  return { labels, evidence, hasInterpretation: labels.length > 0 };
}

// ── Shape ─────────────────────────────────────────────────────────────────────
// One label only. Priority: Structured > Relaxed > Fluid.
// NOTE: a-line silhouette is NOT a Fluid trigger — a-line can be highly structured.

function deriveShape(c: ClosetClassification): InterpretationLabel | null {
  // Structured: tailored/structured fitProfile or matching style tags.
  // Belted waist is added as supporting evidence only — never triggers Structured alone.
  const sEv: string[] = [];
  if (c.fitProfile === "tailored")   sEv.push("tailored fit");
  if (c.fitProfile === "structured") sEv.push("structured fit");
  if (c.styleTags.includes("structured") && !sEv.includes("structured fit")) sEv.push("structured cut");
  if (c.styleTags.includes("tailored")   && !sEv.includes("tailored fit"))   sEv.push("tailored cut");
  if (sEv.length > 0) {
    if (c.waistShape === "belted") sEv.push("belted waist");
    return { label: "Structured", dimension: "Shape", evidence: sEv };
  }

  // Relaxed
  const rEv: string[] = [];
  if (c.fitProfile === "relaxed")   rEv.push("relaxed fit");
  if (c.fitProfile === "loose")     rEv.push("loose fit");
  if (c.fitProfile === "oversized") rEv.push("oversized fit");
  if (c.silhouette === "oversized") rEv.push("oversized silhouette");
  if (c.silhouette === "shift")     rEv.push("shift silhouette");
  if (c.styleTags.includes("relaxed")   && !rEv.some(e => e.includes("relaxed")))   rEv.push("relaxed cut");
  if (c.styleTags.includes("oversized") && !rEv.some(e => e.includes("oversized"))) rEv.push("oversized cut");
  if (rEv.length > 0) return { label: "Relaxed", dimension: "Shape", evidence: rEv };

  // Fluid: flowy fitProfile or explicit flowy tag only.
  const fEv: string[] = [];
  if (c.fitProfile === "flowy")      fEv.push("flowy drape");
  if (c.styleTags.includes("flowy")) fEv.push("flowy style");
  if (fEv.length > 0) return { label: "Fluid", dimension: "Shape", evidence: fEv };

  return null;
}

// ── Polish ────────────────────────────────────────────────────────────────────
//
// RULE: explicit formality is authoritative.
// Occasions are only consulted as fallback when formality is absent.
//
// Mapping:
//   casual          → Casual
//   smart-casual    → Smart  (tailored fit does NOT elevate this)
//   business-casual → Polished
//   business-formal → Polished
//   evening         → Dressy
//   occasion        → Dressy

function derivePolish(c: ClosetClassification): InterpretationLabel | null {
  // Formality present — authoritative, no occasion override.
  if (c.formality) {
    if (c.formality === "evening")          return { label: "Dressy",   dimension: "Polish", evidence: ["evening formality"] };
    if (c.formality === "occasion")         return { label: "Dressy",   dimension: "Polish", evidence: ["occasion formality"] };
    if (c.formality === "business-formal")  return { label: "Polished", dimension: "Polish", evidence: ["business-formal formality"] };
    if (c.formality === "business-casual")  return { label: "Polished", dimension: "Polish", evidence: ["business-casual formality"] };
    if (c.formality === "smart-casual")     return { label: "Smart",    dimension: "Polish", evidence: ["smart-casual formality"] };
    if (c.formality === "casual")           return { label: "Casual",   dimension: "Polish", evidence: ["casual formality"] };
  }

  // Fallback: no explicit formality — use occasions and style tags.
  const dEv: string[] = [];
  for (const o of c.occasions) {
    if (["evening", "date-night", "special-occasion"].includes(o)) dEv.push(o.replace(/-/g, " "));
  }
  if (dEv.length > 0) return { label: "Dressy", dimension: "Polish", evidence: dEv };

  const pEv: string[] = [];
  const polishedTags = ["polished", "elevated", "refined", "sophisticated", "chic", "luxe"];
  for (const t of c.styleTags) {
    if (polishedTags.includes(t)) pEv.push(t);
  }
  if (pEv.length > 0) return { label: "Polished", dimension: "Polish", evidence: pEv };

  const smEv: string[] = [];
  if (c.occasions.includes("work")) smEv.push("work wear");
  if (smEv.length > 0) return { label: "Smart", dimension: "Polish", evidence: smEv };

  const cEv: string[] = [];
  const casualOccasions = ["casual", "weekend", "gym", "beach", "loungewear"];
  for (const o of c.occasions) {
    if (casualOccasions.includes(o) && cEv.length === 0) cEv.push(o);
  }
  if (c.styleTags.includes("casual") && cEv.length === 0) cEv.push("casual");
  if (cEv.length > 0) return { label: "Casual", dimension: "Polish", evidence: cEv };

  return null;
}

// ── Activity (Sporty) ─────────────────────────────────────────────────────────
//
// Fires on ACTIVEWEAR category, athletic/performance subcategories, or explicit sporty tags.
// Does NOT fire on gym occasion alone.

function deriveSporty(c: ClosetClassification, category: string): InterpretationLabel | null {
  const spEv: string[] = [];

  if (category === "ACTIVEWEAR") spEv.push("activewear category");

  if (c.subcategory && ACTIVEWEAR_SUBCATEGORIES.has(c.subcategory)) {
    spEv.push(`${c.subcategory} construction`);
  }

  for (const t of c.styleTags) {
    if (SPORTY_TAGS.has(t) && !spEv.some(e => e.includes(t))) spEv.push(t);
  }

  if (spEv.length > 0) return { label: "Sporty", dimension: "Activity", evidence: spEv };
  return null;
}

// ── Style identity ────────────────────────────────────────────────────────────
//
// Requires personality token OR explicit style tags as primary evidence.
// Subcategory archetypes add supporting evidence but are NOT sufficient to trigger Classic alone.
// leather/suede material does NOT trigger Edgy.

function deriveStyleIdentity(c: ClosetClassification): InterpretationLabel | null {
  // Classic
  const clEv: string[] = [];
  if (c.stylePersonality === "classic-polished") clEv.push("classic-polished styling");
  // "elevated" and "refined" describe polish/refinement, not Classic identity.
  // They live in polishedTags (derivePolish) and must not trigger Classic.
  const classicTags = ["classic", "timeless"];
  for (const t of c.styleTags) {
    if (classicTags.includes(t)) clEv.push(t);
  }
  if (clEv.length > 0) {
    if (c.subcategory && CLASSIC_SUBCATEGORIES.has(c.subcategory)) {
      clEv.push(`${c.subcategory} construction`);
    }
    return { label: "Classic", dimension: "Style identity", evidence: clEv };
  }

  // Minimal
  const mEv: string[] = [];
  if (c.stylePersonality === "minimal-relaxed") mEv.push("minimal-relaxed styling");
  for (const t of c.styleTags) {
    if (["minimal", "clean", "understated"].includes(t)) mEv.push(t);
  }
  if (mEv.length > 0) return { label: "Minimal", dimension: "Style identity", evidence: mEv };

  // Romantic
  const roEv: string[] = [];
  if (c.stylePersonality === "feminine-romantic") roEv.push("feminine-romantic styling");
  for (const t of c.styleTags) {
    if (["feminine", "romantic"].includes(t)) roEv.push(t);
  }
  if (roEv.length > 0) return { label: "Romantic", dimension: "Style identity", evidence: roEv };

  // Edgy: personality or explicit edgy/bold tags ONLY.
  // Material (leather, suede) does NOT trigger Edgy.
  const edEv: string[] = [];
  if (c.stylePersonality === "bold-edgy") edEv.push("bold-edgy styling");
  for (const t of c.styleTags) {
    if (["edgy", "bold"].includes(t)) edEv.push(t);
  }
  if (edEv.length > 0) return { label: "Edgy", dimension: "Style identity", evidence: edEv };

  // Creative
  const crEv: string[] = [];
  if (c.stylePersonality === "creative-expressive") crEv.push("creative-expressive styling");
  for (const t of c.styleTags) {
    if (["artsy", "eclectic", "creative"].includes(t)) crEv.push(t);
  }
  if (crEv.length > 0) return { label: "Creative", dimension: "Style identity", evidence: crEv };

  // Trend-led
  const trEv: string[] = [];
  for (const t of c.styleTags) {
    if (["trendy", "contemporary"].includes(t)) trEv.push(t);
  }
  if (trEv.length > 0) return { label: "Trend-led", dimension: "Style identity", evidence: trEv };

  return null;
}

// ── Visual character ──────────────────────────────────────────────────────────
//
// Precedence: Statement > Distinctive > Understated.
//
// NON-NEUTRAL COLOUR ALONE does NOT trigger Distinctive.
// Colour is irrelevant to the Distinctive decision; it does not support or block it.
//
// Distinctive requires: structural/geometric pattern OR notable construction
// (asymmetric silhouette, asymmetric draping).
//
// Understated: no visible pattern evidence AND neutral colour.
// Pattern null/absent → treated as "no pattern information" → plain appearance assumed.

function deriveVisualCharacter(c: ClosetClassification): InterpretationLabel | null {
  // Statement: expressive / graphic patterns OR explicit statement/bold tags.
  const stPat = new Set([
    "floral", "animal-print", "abstract", "graphic", "paisley", "polka-dot",
    "leopard", "zebra", "tie-dye", "camo", "camouflage",
  ]);
  const stEv: string[] = [];
  if (c.pattern && stPat.has(c.pattern)) stEv.push(`${c.pattern} pattern`);
  for (const t of c.styleTags) {
    if (["statement", "bold"].includes(t)) stEv.push(t);
  }
  if (stEv.length > 0) return { label: "Statement", dimension: "Visual character", evidence: stEv };

  // Distinctive: structural/geometric pattern OR notable construction.
  // Colour alone is NOT sufficient.
  const disPat = new Set(["stripes", "check", "plaid", "houndstooth", "geometric", "tartan"]);
  const diEv: string[] = [];
  if (c.pattern && disPat.has(c.pattern)) diEv.push(`${c.pattern} pattern`);
  if (c.silhouette === "asymmetric") diEv.push("asymmetric silhouette");
  if (c.styleTags.includes("asymmetric") || c.styleTags.includes("asymmetrical")) {
    if (!diEv.some(e => e.includes("asymmetric"))) diEv.push("asymmetric draping");
  }
  if (diEv.length > 0) return { label: "Distinctive", dimension: "Visual character", evidence: diEv };

  // Understated: no visible pattern AND neutral colour.
  // "no visible pattern" includes: null, "solid", "none", "n/a".
  // null/absent pattern means UNKNOWN — not evidence of plainness.
  // Only explicit "solid" (or schema-supported "none"/"n/a") qualifies for Understated.
  const isPlainPattern = c.pattern === "solid" || c.pattern === "none" || c.pattern === "n/a";
  const isNeutralColor = !!c.primaryColor && NEUTRAL_COLORS.has(c.primaryColor);
  if (isPlainPattern && isNeutralColor) {
    return {
      label: "Understated",
      dimension: "Visual character",
      evidence: [`solid neutral ${c.primaryColor}`],
    };
  }

  return null;
}

// ── Coverage ──────────────────────────────────────────────────────────────────
// Skipped for SHOES, BAGS, ACCESSORIES, JEWELRY.
// "n/a" means field not applicable — do not count as a coverage signal.
// Requires ≥2 covered signals for Higher coverage (hem alone is not enough).

function deriveCoverage(c: ClosetClassification, category: string): InterpretationLabel | null {
  if (NO_COVERAGE_CATEGORIES.has(category)) return null;

  const covered: string[] = [];
  const exposed: string[] = [];

  if (c.hemLength && c.hemLength !== "n/a") {
    if (["full", "maxi", "midi"].includes(c.hemLength)) covered.push(`${c.hemLength} length`);
    else if (c.hemLength === "mini") exposed.push("mini length");
  }
  if (c.sleeveLength && c.sleeveLength !== "n/a") {
    if (c.sleeveLength === "full")               covered.push("full sleeves");
    else if (c.sleeveLength === "three-quarter") covered.push("three-quarter sleeves");
    else if (c.sleeveLength === "sleeveless")    exposed.push("sleeveless");
  }
  if (c.necklineCoverage && c.necklineCoverage !== "n/a") {
    if (["high", "crew", "mock", "cowl-high"].includes(c.necklineCoverage)) {
      covered.push(`${c.necklineCoverage} neckline`);
    } else if (["low", "off-shoulder"].includes(c.necklineCoverage)) {
      exposed.push(`${c.necklineCoverage} neckline`);
    }
  }
  if (c.shoulderCoverage === true)  covered.push("shoulder coverage");
  if (c.midriffExposed === true)    exposed.push("midriff exposed");

  if (covered.length >= 2 && exposed.length === 0) {
    return { label: "Higher coverage", dimension: "Coverage", evidence: covered };
  }
  if (exposed.length >= 2 || (c.midriffExposed === true && exposed.length >= 1)) {
    return { label: "Lower coverage", dimension: "Coverage", evidence: exposed };
  }

  return null;
}
