// app/lib/ai/tryon-entry-point.ts
//
// Phase 4A7 — Virtual try-on entry points and request context.
//
// Five entry points share a single My nAia Model experience:
//   1. StyleMe results → "Try this piece on"  (single NADINE garment)
//   2. StyleMe results → "Try the complete look"  (full outfit from StyleMe recommendation)
//   3. NADINE product page → "Try It On Me"  (single eligible NADINE product or component)
//   4. NADINE + Closet combination  (NADINE garment styled with a customer closet item)
//   5. Complete-look preview  (full outfit with optional closet shoes/bag)
//
// All entry points gate on:
//   a. VIRTUAL_TRY_ON_ENABLED === true (global gate, stays false until staging review)
//   b. isTryOnEligible(handle) === true per tryon-product-eligibility.ts
//   c. Customer has My nAia Model set up with full-body photo + virtual try-on consent

// ── Entry point ───────────────────────────────────────────────────────────────

export type TryOnEntryPoint =
  | "styleme-single-piece"    // "Try this piece on" — one garment from a StyleMe recommendation
  | "styleme-complete-look"   // "Try the complete look" — full StyleMe outfit
  | "product-page"            // "Try It On Me" on an eligible NADINE product or component page
  | "closet-combination"      // NADINE garment + one customer closet clothing item
  | "complete-look-preview";  // Full look: NADINE garment(s) + optional closet shoes + optional bag

// ── Garment sources ───────────────────────────────────────────────────────────

// A NADINE garment referenced by catalog handle (product or component).
export interface NadineGarment {
  handle: string;            // product handle or component handle (e.g. "dress-set/corset")
  resolvedUrl: string;       // server-verified CDN URL for the garment image
}

// A customer closet item referenced by DB ID and Cloudinary public ID.
// The server generates a time-limited signed URL before the provider call.
// closetItemId is the DB record ID; publicId is the Cloudinary asset reference.
export interface ClosetGarment {
  closetItemId: string;      // DB primary key
  publicId: string;          // Cloudinary public ID — server fetches the signed URL
  category: "clothing" | "shoes" | "bags";
}

// ── Try-on request context ────────────────────────────────────────────────────
// Captures everything needed to route and validate a try-on request before
// the My nAia Model check and any provider call.

export type TryOnRequestContext =
  | {
      entryPoint: "styleme-single-piece" | "product-page";
      primaryGarment: NadineGarment;
    }
  | {
      entryPoint: "styleme-complete-look";
      // All garments in the StyleMe recommendation, in display order.
      // Only eligible handles are included; ineligible components are silently omitted.
      garments: NadineGarment[];
    }
  | {
      entryPoint: "closet-combination";
      primaryGarment: NadineGarment;
      closetItem: ClosetGarment; // must have eligible === "ready-for-try-on"
    }
  | {
      entryPoint: "complete-look-preview";
      garments: NadineGarment[];
      closetShoes?: ClosetGarment;
      closetBag?: ClosetGarment;
    };

// ── CTA label per entry point ─────────────────────────────────────────────────

export const TRYON_CTA_LABEL: Record<TryOnEntryPoint, string> = {
  "styleme-single-piece":   "Try this piece on",
  "styleme-complete-look":  "Try the complete look",
  "product-page":           "Try It On Me",
  "closet-combination":     "Try it with this piece",
  "complete-look-preview":  "Preview the full look",
};

// ── Eligibility gate ──────────────────────────────────────────────────────────
// Before rendering any CTA, the route loader checks:
//   1. VIRTUAL_TRY_ON_ENABLED (global gate)
//   2. All NADINE garments in the context are TryOn-eligible (per tryon-product-eligibility.ts)
//   3. Any closet items have eligible === "ready-for-try-on" (per closet-eligibility.ts)
//   4. Customer My nAia Model readiness (hasFullBodyPhoto + virtualTryOnConsent)
//
// Step 1 blocks all entry points globally.
// Steps 2–3 are per-item — an ineligible item suppresses its own CTA, not unrelated items.
// Step 4 is resolved after the customer initiates the flow (not before showing the CTA).

// Reasons a CTA is hidden — never exposed to customers as error text.
export type TryOnGateReason =
  | "feature-disabled"      // VIRTUAL_TRY_ON_ENABLED === false
  | "garment-not-eligible"  // handle outcome === "not-eligible" or "pending"
  | "closet-item-not-ready" // closet item not yet ready-for-try-on
  | "model-not-set-up";     // customer has no full-body photo or consent

export interface TryOnGateResult {
  allowed: boolean;
  reason?: TryOnGateReason; // present only when allowed === false
}

// ── Shared My nAia Model experience ──────────────────────────────────────────
// All entry points share a single setup flow and model record.
// The entry point is preserved through the setup flow so the user returns
// to the correct context (StyleMe result, product page, etc.) after completing setup.

export interface NaiaModelSetupReturn {
  returnTo: TryOnEntryPoint;
  returnHandle?: string;    // for product-page and single-piece flows
  returnSlug?: string;      // for StyleMe result flows (recommendation slug or session ID)
}
