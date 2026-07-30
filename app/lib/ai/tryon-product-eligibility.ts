// app/lib/ai/tryon-product-eligibility.ts
//
// Phase 4A5 outcome eligibility — locked 2026-07-17.
//
// Distinct from Phase 4A3 image eligibility (naia-product-media.ts):
//   Image eligibility   → "is this source image suitable to send to the provider?"
//   Outcome eligibility → "does the provider produce a reliable result for this garment?"
//
// Eligibility is per product/component handle, not per provider.
// A component being not-eligible does not affect sibling components.
// Customer-facing UI must never expose internal terminology (blocked, terminated, etc.).

// ── Outcome eligibility ───────────────────────────────────────────────────────

export type TryOnOutcomeEligibility =
  | "accepted"       // live-tested; provider result accepted by product owner; CTA shown
  | "not-eligible"   // live-tested; provider cannot represent this garment reliably; CTA hidden
  | "pending";       // not yet submitted to provider; CTA hidden until tested

export interface TryOnOutcomeRecord {
  handle: string;        // product or component handle — same key space as naia-product-media.ts
  outcome: TryOnOutcomeEligibility;
  lockedAt: string;      // ISO date the outcome was recorded; never shown to customers
  internalNote: string;  // diagnostic context; never shown to customers or included in API responses
}

// ── Phase 4A5 locked outcomes ─────────────────────────────────────────────────
// All four Phase 4A5 components decided 2026-07-17 by product owner after live FASHN testing.
// Handles not listed here are implicitly "pending".

const PHASE_4A5_OUTCOMES: readonly TryOnOutcomeRecord[] = [
  {
    handle: "asymmetrical-pants",
    outcome: "accepted",
    lockedAt: "2026-07-17",
    internalNote:
      "Becoming Grounded. Corrected ghost-shot garment source (brown asymmetrical-waist trousers). " +
      "Phase 4A5 batch 4 FASHN result accepted by product owner. Locked.",
  },
  {
    handle: "suede-skirt",
    outcome: "accepted",
    lockedAt: "2026-07-17",
    internalNote:
      "Becoming Rooted. Ghost/product shot on white background (fitted midi pencil skirt). " +
      "Phase 4A5 batch 5b FASHN result accepted by product owner. Locked.",
  },
  {
    handle: "cropped-top",
    outcome: "not-eligible",
    lockedAt: "2026-07-17",
    internalNote:
      "Becoming Fragmented. Option A (wider frame): result too long, sleeves too long — rejected. " +
      "Option B (tighter crop): result extremely oversized on model — rejected. " +
      "Provider cannot represent this garment construction reliably. Blocked in Phase 4A5.",
  },
  {
    handle: "dress-set/mesh-top",
    outcome: "not-eligible",
    lockedAt: "2026-07-17",
    internalNote:
      "Becoming Defined — mesh top component only. " +
      "Phase 4A5 batch 4: provider invented a fitted underlayer — rejected. " +
      "Phase 4A5 batch 6 authorized retry: provider returned 'terminated' status (no output). " +
      "Provider unreliable for isolated mesh/capelet try-on. Blocked. " +
      "This does not affect dress-set/corset, dress-set/skirt, or dress-set/complete-set eligibility.",
  },
];

// ── Lookup map ────────────────────────────────────────────────────────────────

export const TRYON_OUTCOME_MAP: ReadonlyMap<string, TryOnOutcomeRecord> = new Map(
  PHASE_4A5_OUTCOMES.map((r) => [r.handle, r]),
);

// ── Helpers ───────────────────────────────────────────────────────────────────

export function getTryOnOutcome(handle: string): TryOnOutcomeEligibility {
  return TRYON_OUTCOME_MAP.get(handle)?.outcome ?? "pending";
}

// True only when outcome === "accepted". All other states suppress the CTA.
export function isTryOnEligible(handle: string): boolean {
  return getTryOnOutcome(handle) === "accepted";
}

// ── Customer-facing strings ───────────────────────────────────────────────────
// Used by UI components when the try-on action is suppressed for a specific item.
// Never reference provider names, error codes, or internal status values.

export const TRYON_INELIGIBLE_MESSAGE =
  "Virtual preview is not available for this piece yet.";
