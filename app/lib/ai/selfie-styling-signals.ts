// app/lib/ai/selfie-styling-signals.ts
// Phase 4A8 — Maps SelfieStyleSignals to StyleMe/Passport product-field context.
//
// All signals are SOFT_RANK / EXPLANATION_ONLY — they guide and explain, never
// hard-filter. Explicit customer preferences always take precedence.
// Side-effect-free: no DB queries, no AI calls.

import type { SelfieStyleSignals } from "./selfie-analysis.js";
import { RECOMMENDATION_BEHAVIOURS } from "./signal-contract.js";

// All selfie-derived signals apply at this behaviour level — never higher.
export const SELFIE_SIGNAL_BEHAVIOUR = RECOMMENDATION_BEHAVIOURS.SOFT_RANK;

// ── StyleMe context ───────────────────────────────────────────────────────────
//
// Returns fragments keyed by product template field names, ready to be
// injected into StyleMe recommendation context as SOFT_RANK guidance.
// Consumers must not elevate these values to HARD_FILTER or STRONG_RANK.
// Uses v2 fields where available, falls back to v1 equivalents.

export function buildStyleMeSelfieContext(signals: SelfieStyleSignals): {
  skinToneColourHarmony: string;
  complexionStylingNote: string;
  hairStylingDirection: string;
  hairStylingNote: string;
  colorDirection: string;
  accessoriesDirection: string;
  necklineDirection: string;
  contrastNote: string;
} {
  const necklines = signals.necklinesTop?.length
    ? signals.necklinesTop
    : signals.suggestedNecklines;

  const earringsDesc = signals.earringsTop?.length
    ? signals.earringsTop.join(", ")
    : signals.earringsDirection;

  const glassesDesc = signals.glassesTop?.length
    ? signals.glassesTop.join(", ")
    : signals.glassesFrameDirection;

  const hairParts = [
    signals.hairLengthDirection,
    signals.hairVolumeDirection,
    signals.hairLayers,
  ].filter(Boolean);

  return {
    skinToneColourHarmony: `${signals.colourFamilies.join(", ")} — ${signals.colourExplanation}`,
    complexionStylingNote: signals.styleFormulaNote ?? signals.overallNote,
    hairStylingDirection: hairParts.join("; "),
    hairStylingNote: signals.hairPartingDirection,
    colorDirection: signals.colourFamilies.join(", "),
    accessoriesDirection: [earringsDesc, glassesDesc].filter(Boolean).join("; "),
    necklineDirection: `${necklines.join(", ")} — ${signals.necklineExplanation}`,
    contrastNote: buildContrastNote(signals.contrastLevel),
  };
}

// ── Contrast note ─────────────────────────────────────────────────────────────

const CONTRAST_NOTES: Record<SelfieStyleSignals["contrastLevel"], string> = {
  low:    "low-contrast colouring — tonal, analogous dressing may suit",
  medium: "medium-contrast colouring — balanced colour pairings may work well",
  high:   "high-contrast colouring — strong light/dark combinations may suit",
};

export function buildContrastNote(level: SelfieStyleSignals["contrastLevel"]): string {
  return CONTRAST_NOTES[level];
}

// ── Passport-facing summary builders ─────────────────────────────────────────
//
// Short human-readable sections for the Passport/selfie review UI.
// Used as fallback text when the expanded v2 fields are absent.
// Each returns a plain string suitable for display; no HTML.

export function buildColourDirectionSummary(signals: SelfieStyleSignals): string {
  return [
    signals.colourFamilies.join(", "),
    signals.colourExplanation,
    buildContrastNote(signals.contrastLevel),
  ].join(". ");
}

export function buildNecklineSummary(signals: SelfieStyleSignals): string {
  const necklines = signals.necklinesTop?.length
    ? signals.necklinesTop
    : signals.suggestedNecklines;
  return `${necklines.join(", ")} — ${signals.necklineExplanation}`;
}

export function buildHairDirectionSummary(signals: SelfieStyleSignals): string {
  return [
    signals.hairLengthDirection,
    signals.hairVolumeDirection,
    signals.hairPartingDirection,
    signals.hairLayers,
    signals.hairTextureDirection,
  ].filter(Boolean).join("; ");
}

export function buildAccessoriesSummary(signals: SelfieStyleSignals): string {
  const earrings = signals.earringsTop?.length
    ? signals.earringsTop.join(", ")
    : signals.earringsDirection;
  const glasses = signals.glassesTop?.length
    ? signals.glassesTop.join(", ")
    : signals.glassesFrameDirection;
  const parts = [earrings, glasses].filter(Boolean);
  if (signals.makeupColourDirection && !signals.makeupComplexionFinish) {
    parts.push(signals.makeupColourDirection);
  }
  return parts.join("; ");
}

export function buildNaiaUsageExplanation(): string {
  return (
    "nAia may use these observations as gentle soft-rank guidance when suggesting pieces and pairings. " +
    "Your colour direction may influence which tones nAia surfaces more often near your face. " +
    "Your neckline signals may weight styles that tend to suit your features. " +
    "Your hair, jewellery, and glasses directions may inform accessory and styling suggestions. " +
    "All signals are soft and directional — they will never override your preferences, " +
    "exclude pieces you love, or make certainty claims about fit or appearance. " +
    "You can update or remove this guidance at any time."
  );
}
