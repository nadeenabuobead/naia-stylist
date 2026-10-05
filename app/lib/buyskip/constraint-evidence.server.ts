// app/lib/buyskip/constraint-evidence.server.ts
// Deterministic hard-requirement checking (Phase 6 of the Buy/Skip product foundation).
//
// This is NOT a Passport resolver. It only checks the small set of explicit
// `dressingPreferences` tokens that map cleanly onto fields the vision model
// already states (sleeve length, neckline coverage, midriff exposure) plus
// `avoidColors` against the detected colour. Anything that would require
// understanding free text (dressingRequirementsNote) or a garment property
// this flow doesn't observe (hemline/leg coverage, sheerness, open backs) is
// explicitly deferred — never guessed.
//
// A "violated" result here is strong enough to veto a BUY verdict in code,
// because it is a direct, literal contradiction between a customer's stated
// hard requirement and the model's own stated observation of the garment —
// not a judgement call.

import type { ProductFacts } from "./product-facts.server";

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

function checkAvoidColors(avoidColors: string[] | null | undefined, facts: ProductFacts): ConstraintCheck | null {
  if (!avoidColors || avoidColors.length === 0) return null;
  const detected = facts.detectedColor.value?.toLowerCase().trim() ?? null;
  if (!detected) {
    return { requirementId: "avoid-colors", label: "Avoid specified colours", state: "unknown", reason: "No detected colour available to check." };
  }
  const violated = avoidColors.some(c => {
    const avoided = c.toLowerCase().trim();
    return avoided.length > 0 && (detected.includes(avoided) || avoided.includes(detected));
  });
  return {
    requirementId: "avoid-colors",
    label: "Avoid specified colours",
    state: violated ? "violated" : "satisfied",
    reason: violated
      ? `Detected colour "${facts.detectedColor.value}" matches an avoided colour.`
      : "Detected colour does not match any avoided colour.",
  };
}

export function checkHardConstraints(
  passport: {
    dressingPreferences?: string[] | null;
    dressingRequirementsNote?: string | null;
    avoidColors?: string[] | null;
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

  const colorCheck = checkAvoidColors(passport.avoidColors, facts);
  if (colorCheck) checks.push(colorCheck);

  const hasFreeTextRequirement = typeof passport.dressingRequirementsNote === "string" && passport.dressingRequirementsNote.trim() !== "";

  return {
    hasHardViolation: checks.some(c => c.state === "violated"),
    checks,
    deferredToResolvedPassport: hasFreeTextRequirement,
  };
}
