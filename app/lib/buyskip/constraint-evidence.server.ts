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
// never folded into `hasHardViolation`. Colour-matching semantics themselves
// (substring, no confidence gate) are UNCHANGED from before B2b1 — only
// their authority changed. A real firm "never show me this colour" concept,
// if the product ever wants one, belongs in an explicit signal of its own
// (the architecture already has a name for this: `firmNoColors`, currently
// unwired anywhere) — not a reinterpretation of this field.

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

// B2b1 — deliberately NOT a ConstraintCheck and NOT "violated"/"satisfied".
// Those words belong to hard-constraint authority; this is advisory evidence
// that must never be mistaken for it, in code or in the admin display.
export type ColourPreferenceStatus = "conflict" | "clear" | "unknown";

export interface ColourPreferenceEvidence {
  status: ColourPreferenceStatus;
  detectedColour: string | null;
  avoidColours: string[];
  reason: string;
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

/**
 * B2b1 — advisory colour-preference evidence. Never a ConstraintCheck,
 * never read by applyHardConstraintVeto, never capable of making
 * hasHardViolation true. Matching semantics (case-insensitive, bidirectional
 * substring, no confidence gate) are byte-for-byte unchanged from the old
 * checkAvoidColors — only where the result goes changed in this phase.
 * Recognition quality (substring vs. family semantics, confidence gating,
 * customer-declared-vs-vision precedence) is explicitly deferred to B2b2.
 */
export function checkColourPreference(
  avoidColours: string[] | null | undefined,
  facts: ProductFacts,
): ColourPreferenceEvidence {
  const avoidList = avoidColours ?? [];
  if (avoidList.length === 0) {
    return { status: "unknown", detectedColour: facts.detectedColor.value ?? null, avoidColours: [], reason: "No avoid-colour preferences on file." };
  }
  const detected = facts.detectedColor.value?.toLowerCase().trim() ?? null;
  if (!detected) {
    return { status: "unknown", detectedColour: null, avoidColours: avoidList, reason: "No detected colour available to check." };
  }
  const matches = avoidList.some(c => {
    const avoided = c.toLowerCase().trim();
    return avoided.length > 0 && (detected.includes(avoided) || avoided.includes(detected));
  });
  return {
    status: matches ? "conflict" : "clear",
    detectedColour: facts.detectedColor.value ?? null,
    avoidColours: avoidList,
    reason: matches
      ? `Detected colour "${facts.detectedColor.value}" appears to be a colour this customer usually avoids. Advisory only — does not affect the verdict on its own.`
      : "Detected colour does not match any colour this customer usually avoids.",
  };
}
