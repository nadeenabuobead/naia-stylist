// app/lib/ai/full-look-handle-constants.ts
//
// Pure constants, zero dependencies — deliberately its own file so every
// surface that needs them can import without risking a circular
// dependency. full-look-tryon-real.server.ts imports fashn-tryon-
// service.server.ts (for the final-result upload/URL primitives); if the
// handle-prefix constants lived in either of those files, the other
// couldn't import them back without a cycle. entitlement.server.ts and
// fashn-tryon-service.server.ts both import from here instead.

import { MAX_CHAIN_LENGTH } from "./poc-sequential-full-look-vto.server.js";

export const REAL_PRODUCT_HANDLE_PREFIX = "fulllook-real";

// "This productHandle is an INTERMEDIATE full-look step, never a
// customer-facing result" — a completed outfit writes MAX_CHAIN_LENGTH
// COMPLETED rows (steps 1..N), and only the FINAL step (step N) is a real
// "try-on" by any surface's own definition: entitlement.server.ts's quota
// counting (1 credit per outfit, not 1 per garment), fashn-tryon-
// service.server.ts's listCustomerVtoPreviews ("Your Try-On Previews"),
// and StyleMe History's display query all exclude these same prefixes.
export const FULL_LOOK_INTERMEDIATE_HANDLE_PREFIXES = Array.from(
  { length: MAX_CHAIN_LENGTH - 1 },
  (_, i) => `${REAL_PRODUCT_HANDLE_PREFIX}:step${i + 1}:`,
);

export const FULL_LOOK_FINAL_STEP_HANDLE_PREFIX = `${REAL_PRODUCT_HANDLE_PREFIX}:step${MAX_CHAIN_LENGTH}:`;
