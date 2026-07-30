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
  return {
    skinToneColourHarmony: `${signals.colourFamilies.join(", ")} — ${signals.colourExplanation}`,
    complexionStylingNote: signals.overallNote,
    hairStylingDirection: `${signals.hairLengthDirection}; ${signals.hairVolumeDirection}`,
    hairStylingNote: signals.hairPartingDirection,
    colorDirection: signals.colourFamilies.join(", "),
    accessoriesDirection: [signals.earringsDirection, signals.glassesFrameDirection]
      .filter(Boolean)
      .join("; "),
    necklineDirection: `${signals.suggestedNecklines.join(", ")} — ${signals.necklineExplanation}`,
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

// ── Passport-facing summary ───────────────────────────────────────────────────
//
// Short human-readable sections for the Passport/selfie review UI.
// Each returns a plain string suitable for display; no HTML.

export function buildColourDirectionSummary(signals: SelfieStyleSignals): string {
  return [
    signals.colourFamilies.join(", "),
    signals.colourExplanation,
    buildContrastNote(signals.contrastLevel),
  ].join(". ");
}

export function buildNecklineSummary(signals: SelfieStyleSignals): string {
  return `${signals.suggestedNecklines.join(", ")} — ${signals.necklineExplanation}`;
}

export function buildHairDirectionSummary(signals: SelfieStyleSignals): string {
  return [
    signals.hairLengthDirection,
    signals.hairVolumeDirection,
    signals.hairPartingDirection,
  ].join("; ");
}

export function buildAccessoriesSummary(signals: SelfieStyleSignals): string {
  const parts = [signals.earringsDirection, signals.glassesFrameDirection].filter(Boolean);
  if (signals.makeupColourDirection) parts.push(signals.makeupColourDirection);
  return parts.join("; ");
}

export function buildNaiaUsageExplanation(): string {
  return (
    "nAia may use these observations as gentle guidance when suggesting pieces and pairings. " +
    "They are soft signals only — they will never override your stated preferences or exclude " +
    "any pieces you love. You can update or remove this guidance at any time."
  );
}
