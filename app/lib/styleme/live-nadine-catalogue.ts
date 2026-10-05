// app/lib/styleme/live-nadine-catalogue.ts
//
// Which NADINE products the engine may AUTO-SELECT as a hero in NADINE + My Closet.
//
// THIS IS NOT THE PDP HANDOFF ALLOWLIST, and the two must never be collapsed into one
// another. They answer different questions:
//
//   LIVE_NADINE_STYLING_HANDLES (here)   "may nAia choose this for her, unprompted?"
//   LOCKED_CATALOGUE_HANDLES (media)     "may she hand this off by tapping its PDP?"
//
// The second is a strict superset. A product can be published and purchasable — so a
// customer tapping "Style this piece" on it must still work — while sitting outside the
// curated set the engine is allowed to merchandise on her behalf. Collapsing them in one
// direction silently breaks "Style this piece" on published PDPs; collapsing them in the
// other hands the engine historical stock nobody curated. nadine-hero-selection.test.ts
// NH-A.4 exists solely to stop that happening.
//
// WHY THIS IS AN EXPLICIT LIST AND NOT DERIVED. Nothing in the generated catalogue
// expresses liveness. `activePublished` reads "☐ Confirmed" — an UNCHECKED box — identically
// on all eleven products; `featuredImageUrl` is null on all eleven; `liveUrl` is set on
// exactly one; `PRODUCT_ELIGIBILITY` is "unverified" for every handle, and is a
// verification axis rather than a merchandising one; and the media table's `eligibility`
// is FASHN try-on readiness, which would gate styling on photo quality. The storefront
// cannot settle it either — it is password-protected, so every product URL returns the
// same "Please Log In" page.
//
// So liveness is a product decision, recorded here by hand, and changed by hand when the
// collection changes. That is a feature: a five-piece collection should not silently
// acquire a sixth because a field changed upstream.
//
// Current collection, approved 2026-10-05:
//   double-top            Becoming Alive     TOP        leather-bodied two-layer top
//   asymmetrical-pants    Becoming Grounded  BOTTOM     asymmetric work trouser
//   oversized-blazer      Becoming Bold      OUTERWEAR  oversized tailored blazer
//   draped-leather-pants  Becoming Free      BOTTOM     draped leather trouser
//   leather-suede-jacket  Becoming Clear     OUTERWEAR  leather/suede bomber
//
// Slot coverage is TOP / BOTTOM / OUTERWEAR only — no dress, set, shoe or bag — so a hero
// can occupy one of three slots, and two pieces compete for each of BOTTOM and OUTERWEAR.
// Occasion coverage is work, everyday, dinner, date-night, girls-night, special-event and
// travel; nothing carries `family` or `active`, so those occasions correctly yield a
// closet-only look rather than a forced recommendation.

import { getAllCatalogProducts } from "../ai/naia-catalog.js";
import type { GeneratedCatalogProduct } from "../ai/naia-catalog.types.js";

export const LIVE_NADINE_STYLING_HANDLES = [
  "double-top",
  "asymmetrical-pants",
  "oversized-blazer",
  "draped-leather-pants",
  "leather-suede-jacket",
] as const;

export type LiveNadineStylingHandle = (typeof LIVE_NADINE_STYLING_HANDLES)[number];

const LIVE: ReadonlySet<string> = new Set<string>(LIVE_NADINE_STYLING_HANDLES);

/** True only for a handle the engine may auto-select. */
export function isLiveNadineStylingHandle(handle: unknown): handle is LiveNadineStylingHandle {
  return typeof handle === "string" && LIVE.has(handle);
}

/**
 * The products the NADINE + My Closet selector may consider.
 *
 * Derived by intersecting the live list with the real catalogue rather than trusting the
 * list alone, so a handle that is renamed or dropped upstream disappears from selection
 * instead of resolving to undefined deeper in the pipeline. NH-A.3 asserts the two agree,
 * which is what turns a silent drift into a failing test.
 */
export function getLiveNadineStylingProducts(): readonly GeneratedCatalogProduct[] {
  return getAllCatalogProducts().filter((p) => LIVE.has(p.handle));
}

// Fail at module load if the approved list and the catalogue disagree. A drift here is a
// data problem that would otherwise surface as a quietly smaller selection pool.
{
  const present = new Set(getAllCatalogProducts().map((p) => p.handle));
  const missing = LIVE_NADINE_STYLING_HANDLES.filter((h) => !present.has(h));
  if (missing.length > 0) {
    throw new Error(
      `live-nadine-catalogue: approved live handle(s) absent from the catalogue: ${missing.join(", ")}`,
    );
  }
}
