// app/lib/styleme/locked-anchor-outcome.ts
//
// A locked anchor (Wardrobe Intelligence "Style this", or any other pre-selection that
// skips the manual picker's own evaluateAnchorEligibility check at source.tsx's set-anchor
// action) is chosen before the customer has necessarily settled on an occasion. By the time
// occasion is known, the anchor may no longer be eligible for it. This resolves what to do
// about that, given the gate's verdict and who chose the anchor.
//
// Pure and import-free (no server/session/DB types), so it is testable directly with plain
// objects instead of through a mocked request — the same reason occasion-display.ts lives
// here rather than inside the route file that uses it.

import type { AnchorEligibility } from "../ai/styleme-profile-gate.js";

export type LockedAnchorOutcome =
  | { kind: "eligible" }
  | { kind: "stale-auto" }
  | { kind: "incompatible"; message: string };

export function resolveLockedAnchorOutcome(
  eligibility: AnchorEligibility,
  provenance: "AUTO" | "MANUAL" | null,
): LockedAnchorOutcome {
  if (eligibility.eligible) return { kind: "eligible" };
  // Only an explicit "AUTO" stamp is read as nAia's own choice, safe to silently replace.
  if (provenance === "AUTO") return { kind: "stale-auto" };
  // MANUAL, or no stamp at all — the same fail-safe default already used for the New Look
  // reroll gate elsewhere (result.tsx): treat unstamped as deliberately chosen, never
  // substitute silently.
  return {
    kind: "incompatible",
    message: eligibility.message ?? "This piece isn't eligible for this occasion. Choose another piece, or change the occasion.",
  };
}
