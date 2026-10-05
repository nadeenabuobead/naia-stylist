// app/lib/buyskip/wardrobe-need.server.ts
// Wardrobe-need adapter stub (Phase 7 of the Buy/Skip product foundation).
//
// Buy/Skip must not recreate Wardrobe Intelligence's gap/need reasoning
// ("you need another work trouser", "you already have enough tops"). Until
// Buy/Skip has a real adapter into WI output, "need" is reported as an
// explicit unavailable state rather than invented locally. Swap the body of
// getWardrobeNeedEvidence() for a real WI call when that integration lands —
// the shape is deliberately already what a WI-backed result would look like.

export type WardrobeNeedStatus = "unavailable" | "no-gap" | "fills-gap" | "already-covered";

export interface WardrobeNeedEvidence {
  status: WardrobeNeedStatus;
  reason: string;
}

export function getWardrobeNeedEvidence(): WardrobeNeedEvidence {
  return {
    status: "unavailable",
    reason: "Wardrobe Intelligence is not yet wired into Buy/Skip — wardrobe-level need and gap claims are deferred to that integration.",
  };
}
