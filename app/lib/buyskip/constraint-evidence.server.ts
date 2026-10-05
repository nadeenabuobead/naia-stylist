// app/lib/buyskip/constraint-evidence.server.ts
// Deterministic hard-requirement checking (Phase 6 of the Buy/Skip product foundation).
//
// This is NOT a Passport resolver. It only checks the small set of explicit
// `dressingPreferences` tokens that map cleanly onto fields the vision model
// already states (sleeve length, neckline coverage, midriff exposure).
// Anything that would require understanding free text
// (dressingRequirementsNote) or a garment property this flow doesn't observe
// (hemline/leg coverage, sheerness, open backs) is explicitly deferred —
// never guessed.
//
// A "violated" result here is strong enough to veto a BUY verdict in code,
// because it is a direct, literal contradiction between a customer's stated
// hard requirement and the model's own stated observation of the garment —
// not a judgement call.
//
// B2b1 — avoidColors is NOT a hard requirement and does not belong in this
// aggregation. The actual Passport wording is "Are there any colours you
// usually avoid?" — explicitly habitual, not absolute (see the B2b recon);
// StyleMe already treats the same field as a soft ranking penalty, never an
// exclusion. checkColourPreference (below) produces separate, non-veto
// advisory evidence — see decision-evidence.server.ts's
// `colourPreferenceEvidence`, assembled alongside `constraintEvidence` but
// never folded into `hasHardViolation`. This is a FROZEN product-policy
// decision — B2b2 changes recognition quality only, never authority. A real
// firm "never show me this colour" concept, if the product ever wants one,
// belongs in an explicit signal of its own (the architecture already has a
// name for this: `firmNoColors`, currently unwired anywhere) — not a
// reinterpretation of this field.
//
// B2b2 — checkColourPreference now:
//   - trusts customer-declared candidate colour as primary evidence (it was
//     ignored entirely before this phase);
//   - gates vision-only evidence on observation confidence (high/medium
//     eligible, low/missing never determine a status — they were previously
//     ungated, the one confirmed B0 defect this phase closes);
//   - records declared-vs-vision disagreement instead of silently letting
//     vision win, as every prior phase did;
//   - resolves colour text through the frozen B2a colour-family utility
//     (app/lib/ai/colour-family.ts) instead of local substring matching —
//     resolveCanonicalColourFamilies for avoidColors (closed-vocabulary
//     Passport option IDs — see app/lib/onboarding/quiz-data.ts's
//     COLOUR_FAMILIES, e.g. "red-burgundy", "white-cream") and
//     resolveFreeTextColourFamilies for both declared candidate colour (a
//     DIFFERENT, finer vocabulary — see buyskip._index.tsx's COLORS pill
//     list, e.g. "Red", "Gold") and vision-detected colour (genuine AI
//     free text, including real multi-colour strings like
//     "BEIGE / BURGUNDY / MULTI-PRINT").
// This is the first production consumer of colour-family.ts — see
// app/lib/ai/colour-family.consumer-boundary.test.ts for the enforced,
// deliberately narrow import boundary.

import type { ProductFacts } from "./product-facts.server";
import {
  resolveCanonicalColourFamilies,
  resolveFreeTextColourFamilies,
  colourFamiliesOverlap,
  type ColourFamilyResolution,
  type HueFamily,
  type PassportFamily,
} from "../ai/colour-family";

export type ConstraintCheckState = "violated" | "satisfied" | "unknown";

export interface ConstraintCheck {
  requirementId: string;
  label: string;
  state: ConstraintCheckState;
  reason: string;
}

export interface ConstraintEvidence {
  hasHardViolation: boolean;
  checks: ConstraintCheck[];
  /** true when a free-text dressing requirement exists that this layer cannot evaluate */
  deferredToResolvedPassport: boolean;
}

// Deliberately NOT a ConstraintCheck and NOT "violated"/"satisfied". Those
// words belong to hard-constraint authority; this is advisory evidence that
// must never be mistaken for it, in code or in the admin display.
export type ColourPreferenceStatus = "conflict" | "clear" | "unknown";
export type ColourEvidenceSource = "customer-declared" | "vision" | "none";

export interface ColourPreferenceEvidence {
  status: ColourPreferenceStatus;
  /** Which evidence source actually determined `status`. */
  determinedBy: ColourEvidenceSource;
  avoidColours: string[];
  avoidFamilies: ColourFamilyResolution;
  /** Raw customer-declared candidate colour values, exactly as submitted. */
  declaredColours: string[];
  declaredFamilies: ColourFamilyResolution;
  detectedColour: string | null;
  /** null when vision produced nothing resolvable at all (no colour, or the free-text resolver found zero recognised words). */
  detectedFamilies: ColourFamilyResolution | null;
  /** Raw tier from ProductFacts — "high" | "medium" | "low" | null. */
  observationConfidence: string | null;
  /** True only when confidence is high/medium AND a resolvable colour was detected. Low or missing confidence is never usable, regardless of what the model wrote. */
  visionUsable: boolean;
  /** True when declared and vision are BOTH usable and resolve to non-overlapping families — recorded, never used to flip status away from the declared-evidence result. */
  disagreement: boolean;
  reason: string;
}

// Display-only ordering (matches colour-family.ts's own fixed order) so
// admin/debug output is stable — this reorders already-resolved family
// names, it does not duplicate colour-family.ts's token->family maps.
const HUE_DISPLAY_ORDER: readonly HueFamily[] = ["red", "pink", "orange", "yellow", "green", "blue", "purple", "grey", "brown"];
const PASSPORT_DISPLAY_ORDER: readonly PassportFamily[] = ["black", "white-cream", "beige-brown", "grey", "navy", "red-burgundy"];
const KNOWN_PASSPORT_FAMILY_LABELS: ReadonlySet<PassportFamily> = new Set(PASSPORT_DISPLAY_ORDER);

/**
 * Passport's avoidColors are ALREADY canonical family-ID strings (e.g.
 * "red-burgundy", "white-cream", "beige-brown" — see quiz-data.ts's
 * COLOUR_FAMILIES). colour-family.ts's PASSPORT_COLOUR_FAMILY_MAP is built
 * as an ALIAS->family lookup ("burgundy"->"red-burgundy"), not a
 * family->itself lookup — resolving the family label directly against it
 * returns unknown for 3 of the 6 PassportFamily labels (confirmed:
 * "red-burgundy", "white-cream", "beige-brown" all resolve unknown;
 * "grey"/"navy" happen to self-map already; "black" resolves isNeutral-only
 * with zero passportFamilies). This is not a B2a bug — those maps were
 * built to match a GARMENT colour word to a Passport family, a different
 * job. But it IS a real, disclosed regression risk versus B2b1: B2b1's old
 * substring match accidentally caught "burgundy" inside "red-burgundy",
 * "cream" inside "white-cream", and "black" inside "off-black" as literal
 * substrings — pure family-matching without this shim would silently lose
 * those three. This function treats a Passport avoid-colour value that IS
 * LITERALLY one of the six known family labels as resolving to that family
 * directly, in addition to whatever colour-family.ts's maps already find —
 * purely additive, local to Buy/Skip, touches no B2a export or logic.
 * "metallics" and the other 6 non-compound Passport IDs need no shim: they
 * either already self-map via hueFamily (blue/green/pink/purple/yellow/
 * orange) or — for "metallics" specifically — have no hue-family meaning at
 * all (it names a finish/material, not a hue) and are correctly left
 * unknown, never fabricated into gold/silver/grey/yellow or any other guess.
 */
function resolveAvoidColourFamily(raw: string): ColourFamilyResolution {
  const base = resolveCanonicalColourFamilies(raw);
  const normalized = raw.trim().toLowerCase();
  if (!KNOWN_PASSPORT_FAMILY_LABELS.has(normalized as PassportFamily)) return base;
  if (base.passportFamilies.includes(normalized as PassportFamily)) return base;
  return {
    hueFamilies: base.hueFamilies,
    isNeutral: base.isNeutral,
    passportFamilies: [...base.passportFamilies, normalized as PassportFamily],
    unknown: false,
  };
}

function unionForDisplay(resolutions: ColourFamilyResolution[]): ColourFamilyResolution {
  const hue = new Set<HueFamily>();
  const passport = new Set<PassportFamily>();
  let isNeutral = false;
  let anyRecognised = false;
  for (const r of resolutions) {
    if (r.unknown) continue;
    anyRecognised = true;
    if (r.isNeutral) isNeutral = true;
    for (const f of r.hueFamilies) hue.add(f);
    for (const f of r.passportFamilies) passport.add(f);
  }
  return {
    hueFamilies: HUE_DISPLAY_ORDER.filter((f) => hue.has(f)),
    isNeutral,
    passportFamilies: PASSPORT_DISPLAY_ORDER.filter((f) => passport.has(f)),
    unknown: !anyRecognised,
  };
}

interface DressingRequirementMapping {
  id: string;
  label: string;
  evaluate: (facts: ProductFacts) => ConstraintCheckState;
}

function sleevelessOrBareArms(facts: ProductFacts): ConstraintCheckState {
  const sleeve = facts.sleeveLength.value?.toLowerCase() ?? null;
  const shoulder = facts.shoulderCoverage.value;
  if (facts.observationConfidence === "low" || (sleeve === null && shoulder === null)) return "unknown";
  if (sleeve === "sleeveless" || shoulder === false) return "violated";
  return "satisfied";
}

function lowNeckline(facts: ProductFacts): ConstraintCheckState {
  const neckline = facts.necklineCoverage.value?.toLowerCase() ?? null;
  if (facts.observationConfidence === "low" || neckline === null) return "unknown";
  if (neckline === "low" || neckline === "off-shoulder") return "violated";
  return "satisfied";
}

function midriffExposed(facts: ProductFacts): ConstraintCheckState {
  const exposed = facts.midriffExposed.value;
  if (facts.observationConfidence === "low" || exposed === null) return "unknown";
  return exposed === true ? "violated" : "satisfied";
}

function modestyComposite(facts: ProductFacts): ConstraintCheckState {
  // Broader modesty requirements: violated if ANY of arms/neckline/midriff is
  // violated, satisfied only if ALL checked, unknown if nothing is checkable.
  const results = [sleevelessOrBareArms(facts), lowNeckline(facts), midriffExposed(facts)];
  if (results.includes("violated")) return "violated";
  if (results.every(r => r === "unknown")) return "unknown";
  return "satisfied";
}

// Only the subset of dressing-preferences option IDs (app/lib/onboarding/quiz-data.ts)
// that map onto a field the vision model actually states. Every other option ID
// (legs-covered, avoid-shorts, prefer-full-length-trousers, avoid-sheer,
// avoid-open-back, longer-tops, looser-fitting, prefer-higher-necklines as a soft
// preference) has no corresponding observed field in this flow and is
// intentionally left unmapped — reported as "unknown" via the fallback below,
// never guessed.
const HARD_REQUIREMENT_MAP: DressingRequirementMapping[] = [
  { id: "arms-covered",           label: "Keep arms covered",            evaluate: sleevelessOrBareArms },
  { id: "avoid-sleeveless",       label: "Avoid sleeveless styles",       evaluate: sleevelessOrBareArms },
  { id: "chest-neckline-covered", label: "Keep chest / neckline covered", evaluate: lowNeckline },
  { id: "no-cropped-tops",        label: "Avoid cropped tops",            evaluate: midriffExposed },
  { id: "dresses-modestly",       label: "Dress modestly",                evaluate: modestyComposite },
  { id: "wears-hijab",            label: "Wears hijab",                   evaluate: modestyComposite },
  { id: "usually-wears-abayas",   label: "Wears abayas",                  evaluate: modestyComposite },
  { id: "kanduras-thobes",        label: "Wears kanduras / thobes",       evaluate: modestyComposite },
];

export function checkHardConstraints(
  passport: {
    dressingPreferences?: string[] | null;
    dressingRequirementsNote?: string | null;
  },
  facts: ProductFacts,
): ConstraintEvidence {
  const checks: ConstraintCheck[] = [];

  const declaredIds = new Set((passport.dressingPreferences ?? []).filter(id => id !== "no-dressing-requirements"));
  for (const mapping of HARD_REQUIREMENT_MAP) {
    if (!declaredIds.has(mapping.id)) continue;
    const state = mapping.evaluate(facts);
    checks.push({
      requirementId: mapping.id,
      label: mapping.label,
      state,
      reason:
        state === "unknown"
          ? "Vision model did not report enough detail to check this requirement."
          : state === "violated"
            ? `Observed garment construction conflicts with "${mapping.label}".`
            : `Observed garment construction is consistent with "${mapping.label}".`,
    });
  }

  const hasFreeTextRequirement = typeof passport.dressingRequirementsNote === "string" && passport.dressingRequirementsNote.trim() !== "";

  return {
    hasHardViolation: checks.some(c => c.state === "violated"),
    checks,
    deferredToResolvedPassport: hasFreeTextRequirement,
  };
}

// Exact-string equality first, family overlap second. Needed because
// colourFamiliesOverlap is deliberately family-only (by B2a design — two
// colours being the literal same word doesn't guarantee they share a
// recognised family, e.g. "black" has no hue/passport family entry at all
// in the canonical maps, only isNeutral=true). Without this, an identical
// declared/avoid word with no family entry would be missed entirely — a
// real regression this fix closes, not a hypothetical one.
function colourMatches(rawA: string, resolutionA: ColourFamilyResolution, rawB: string, resolutionB: ColourFamilyResolution): boolean {
  if (rawA.trim().toLowerCase() === rawB.trim().toLowerCase()) return true;
  return colourFamiliesOverlap(resolutionA, resolutionB);
}

function buildResult(args: {
  status: ColourPreferenceStatus;
  determinedBy: ColourEvidenceSource;
  avoidColours: string[];
  avoidFamilies: ColourFamilyResolution;
  declaredColours: string[];
  declaredFamilies: ColourFamilyResolution;
  detectedColour: string | null;
  detectedFamilies: ColourFamilyResolution | null;
  observationConfidence: string | null;
  visionUsable: boolean;
  disagreement: boolean;
  reason: string;
}): ColourPreferenceEvidence {
  return { ...args };
}

/**
 * Advisory colour-preference evidence. Never a ConstraintCheck, never read
 * by applyHardConstraintVeto, never capable of making hasHardViolation
 * true — that authority decision is frozen (B2b1) and out of scope here.
 *
 * Evidence hierarchy (B2b2):
 *   1. Usable customer-declared candidate colour is primary. If ANY declared
 *      value resolves to a recognised family, it alone determines status —
 *      vision can never override it, confident or not.
 *   2. Vision is fallback/supplementary: consulted only when declared is
 *      absent or fully unresolvable, AND only when confidence is high or
 *      medium. Low or missing confidence never determines a status.
 *   3. When both declared and (confidence-usable) vision are present but
 *      resolve to non-overlapping families, the disagreement is recorded —
 *      never used to override the declared-evidence result.
 *   4. No avoidColours on file, or neither source usable -> "unknown".
 *      Empty avoidColours deliberately preserves B2b1's existing contract
 *      (status "unknown", determinedBy "none") rather than inventing a new
 *      meaning for an unrelated case.
 */
export function checkColourPreference(
  avoidColours: string[] | null | undefined,
  facts: ProductFacts,
): ColourPreferenceEvidence {
  const avoidList = avoidColours ?? [];
  const declaredList = Array.isArray(facts.declaredColor.value) ? facts.declaredColor.value : [];
  const detectedRaw = facts.detectedColor.value ?? null;
  const confidence = facts.observationConfidence ?? null;

  if (avoidList.length === 0) {
    return buildResult({
      status: "unknown", determinedBy: "none",
      avoidColours: [], avoidFamilies: unionForDisplay([]),
      declaredColours: declaredList, declaredFamilies: unionForDisplay(declaredList.map(resolveFreeTextColourFamilies)),
      detectedColour: detectedRaw, detectedFamilies: detectedRaw ? resolveFreeTextColourFamilies(detectedRaw) : null,
      observationConfidence: confidence, visionUsable: false, disagreement: false,
      reason: "No avoid-colour preferences on file.",
    });
  }

  // avoidColors are closed-vocabulary Passport option IDs (quiz-data.ts's
  // COLOUR_FAMILIES, e.g. "red-burgundy") — exact canonical resolution,
  // plus the local self-mapping shim above for the 3 compound family labels
  // colour-family.ts's own maps don't self-resolve.
  const avoidPairs = avoidList.map((raw) => ({ raw, resolution: resolveAvoidColourFamily(raw) }));
  const avoidFamilies = unionForDisplay(avoidPairs.map((p) => p.resolution));

  // Candidate declared colour is a different, finer free-text-style
  // vocabulary (buyskip._index.tsx's COLORS pills, e.g. "Red", "Gold") —
  // resolved the same way vision free text is, deliberately not assumed
  // to share Passport's exact tokens.
  const declaredPairs = declaredList.map((raw) => ({ raw, resolution: resolveFreeTextColourFamilies(raw) }));
  const declaredFamilies = unionForDisplay(declaredPairs.map((p) => p.resolution));
  // "Usable" means either a recognised family OR an exact-string match is
  // even possible against at least one avoid colour — colourMatches (not
  // just resolution.unknown) is the real usability test, since an exact
  // match can succeed even when colour-family.ts recognises no family at
  // all (see colourMatches's own comment).
  const declaredUsablePairs = declaredPairs.filter((d) => !d.resolution.unknown || avoidPairs.some((a) => colourMatches(d.raw, d.resolution, a.raw, a.resolution)));
  const declaredUsable = declaredUsablePairs.length > 0;

  const confidenceEligible = confidence === "high" || confidence === "medium";
  const detectedResolution = detectedRaw ? resolveFreeTextColourFamilies(detectedRaw) : null;
  const detectedUsableForAvoid = detectedRaw !== null && detectedResolution !== null &&
    (!detectedResolution.unknown || avoidPairs.some((a) => colourMatches(detectedRaw, detectedResolution, a.raw, a.resolution)));
  const visionUsable = confidenceEligible && detectedUsableForAvoid;

  const disagreement =
    declaredUsable && visionUsable && detectedRaw !== null && detectedResolution !== null &&
    !declaredUsablePairs.some((d) => colourMatches(d.raw, d.resolution, detectedRaw, detectedResolution));

  if (declaredUsable) {
    const conflict = declaredUsablePairs.some((d) => avoidPairs.some((a) => colourMatches(d.raw, d.resolution, a.raw, a.resolution)));
    return buildResult({
      status: conflict ? "conflict" : "clear",
      determinedBy: "customer-declared",
      avoidColours: avoidList, avoidFamilies,
      declaredColours: declaredList, declaredFamilies,
      detectedColour: detectedRaw, detectedFamilies: detectedResolution,
      observationConfidence: confidence, visionUsable, disagreement,
      reason: conflict
        ? `Declared colour (${declaredList.join(", ")}) appears to be a colour this customer usually avoids. Advisory only — does not affect the verdict on its own.${disagreement ? " The vision model's own colour read disagreed; declared evidence takes precedence." : ""}`
        : `Declared colour (${declaredList.join(", ")}) does not match any colour this customer usually avoids.${disagreement ? " The vision model's own colour read disagreed; declared evidence takes precedence." : ""}`,
    });
  }

  if (visionUsable) {
    const conflict = avoidPairs.some((a) => colourMatches(detectedRaw!, detectedResolution!, a.raw, a.resolution));
    return buildResult({
      status: conflict ? "conflict" : "clear",
      determinedBy: "vision",
      avoidColours: avoidList, avoidFamilies,
      declaredColours: declaredList, declaredFamilies,
      detectedColour: detectedRaw, detectedFamilies: detectedResolution,
      observationConfidence: confidence, visionUsable, disagreement: false,
      reason: conflict
        ? `Detected colour "${detectedRaw}" appears to be a colour this customer usually avoids. Advisory only — does not affect the verdict on its own.`
        : "Detected colour does not match any colour this customer usually avoids.",
    });
  }

  return buildResult({
    status: "unknown",
    determinedBy: "none",
    avoidColours: avoidList, avoidFamilies,
    declaredColours: declaredList, declaredFamilies,
    detectedColour: detectedRaw, detectedFamilies: detectedResolution,
    observationConfidence: confidence, visionUsable, disagreement: false,
    reason: declaredList.length > 0
      ? "Declared colour could not be resolved to a recognised colour family, and vision evidence is unavailable or too uncertain to use."
      : "No usable declared colour, and vision evidence is unavailable or too uncertain to use.",
  });
}
