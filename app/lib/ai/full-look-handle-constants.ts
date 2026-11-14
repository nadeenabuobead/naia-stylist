// app/lib/ai/full-look-handle-constants.ts
//
// Pure constants, zero dependencies — deliberately its own file so every
// surface that needs them can import without risking a circular
// dependency. full-look-tryon-real.server.ts imports fashn-tryon-
// service.server.ts (for the final-result upload/URL primitives); if the
// handle-prefix constants lived in either of those files, the other
// couldn't import them back without a cycle. entitlement.server.ts and
// fashn-tryon-service.server.ts both import from here instead.
//
// 2026-11-15 — chain length is now PER-OUTFIT, not a fixed global number
// (see FULL_LOOK_MAX_GARMENTS below): a 3-item outfit's final step is its
// own step 3; a 5-item outfit's final step is its own step 5. Naming the
// final step by absolute position ("step{N}") would make "which step is
// final" ambiguous the instant two outfits have different lengths — a
// 3-item outfit's real final step (step3) would be indistinguishable from
// a 5-item outfit's INTERMEDIATE step3. Naming it by ROLE instead
// ("final", never a number) keeps the final step identifiable the same
// way regardless of how many garments any given chain actually has.
// FULL_LOOK_INTERMEDIATE_HANDLE_PREFIXES only ever needs to cover
// positions 1..(FULL_LOOK_MAX_GARMENTS-1) — every possible non-final
// position across every chain length this app will ever create, since no
// chain can exceed FULL_LOOK_MAX_GARMENTS steps.

export const REAL_PRODUCT_HANDLE_PREFIX = "fulllook-real";

// Ceiling on how many real garments one Full-Look chain will ever submit
// to FASHN — a cost/complexity cap, not a FASHN API limit (FASHN's
// tryon-max has no documented limit on sequential calls; see
// full-look-vto-orchestrator.server.ts's own selectFullLookGarments
// comment for the full reasoning). Raising this later only ever requires
// changing this one number — nothing else in this file, or any file that
// imports from it, hardcodes a chain length.
export const FULL_LOOK_MAX_GARMENTS = 5;

// Every non-final step position a chain could ever submit, regardless of
// that chain's own real (shorter-or-equal) length. "This productHandle is
// an INTERMEDIATE full-look step, never a customer-facing result" — a
// completed outfit writes one COMPLETED row per garment, and only the
// FINAL one (see FULL_LOOK_FINAL_STEP_HANDLE_PREFIX) is a real "try-on" by
// any surface's own definition: entitlement.server.ts's quota counting (1
// credit per outfit, not 1 per garment), fashn-tryon-service.server.ts's
// listCustomerVtoPreviews ("Your Try-On Previews"), and StyleMe History's
// display query all exclude these same prefixes.
export const FULL_LOOK_INTERMEDIATE_HANDLE_PREFIXES = Array.from(
  { length: FULL_LOOK_MAX_GARMENTS - 1 },
  (_, i) => `${REAL_PRODUCT_HANDLE_PREFIX}:step${i + 1}:`,
);

// Role-based, not position-based — see this file's header comment for why
// a fixed step number can't identify "the final step" once chain length
// varies per outfit.
export const FULL_LOOK_FINAL_STEP_HANDLE_PREFIX = `${REAL_PRODUCT_HANDLE_PREFIX}:final:`;
