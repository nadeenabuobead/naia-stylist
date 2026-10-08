// app/lib/buyskip/wardrobe-need.server.ts
// Wardrobe-need adapter (Phase 7 foundation, B4 wiring).
//
// Buy/Skip must not recreate Wardrobe Intelligence's gap/need reasoning
// ("you need another work trouser", "you already have enough tops") — it
// reads WI's own already-computed, already-threshold-gated findings via
// wardrobe-utility-evidence.server.ts and translates them into this
// contract's existing four-state vocabulary. getWardrobeNeedEvidence()
// itself is kept as the explicit no-WI-context fallback it always was —
// still always "unavailable", never fabricated — for any caller that has
// no WardrobeIntelligenceBundle at all.

import type { WardrobeUtilityEvidence } from "./wardrobe-utility-evidence.server";

export type WardrobeNeedStatus = "unavailable" | "no-gap" | "fills-gap" | "already-covered";

export interface WardrobeNeedEvidence {
  status: WardrobeNeedStatus;
  reason: string;
}

export function getWardrobeNeedEvidence(): WardrobeNeedEvidence {
  return {
    status: "unavailable",
    reason: "Wardrobe Intelligence is not available for this assessment — wardrobe-level need and gap claims are deferred.",
  };
}

/**
 * Translates an already-computed WardrobeUtilityEvidence (B4) into this
 * contract's existing WardrobeNeedStatus vocabulary. Pure — does no WI
 * lookup of its own, so callers that already computed wardrobeUtility for
 * the richer field never pay for a second match pass.
 */
export function wardrobeNeedFromUtilityEvidence(e: WardrobeUtilityEvidence): WardrobeNeedEvidence {
  if (e.gap.status === "unavailable") {
    return getWardrobeNeedEvidence();
  }
  if (e.gap.status === "fills-gap") {
    return {
      status: "fills-gap",
      reason: e.gap.body ?? "Wardrobe Intelligence flagged this as a real gap in the customer's Closet.",
    };
  }
  if (e.redundancy.status === "already-enough") {
    return {
      status: "already-covered",
      reason: e.redundancy.body ?? "Wardrobe Intelligence already flagged this as well covered in the customer's Closet.",
    };
  }
  return {
    status: "no-gap",
    reason: "Wardrobe Intelligence has no gap or redundancy finding for this category today.",
  };
}
