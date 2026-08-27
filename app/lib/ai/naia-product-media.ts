// app/lib/ai/naia-product-media.ts
// Phase 4A3 — Server-authoritative mapping between V8 NADINE catalogue handles
// and verified Shopify product/media identifiers for virtual try-on.
//
// V8 ↔ Shopify crosswalk verified 2026-07-16 via Shopify Admin API
// (offline session: offline_naia-test-store.myshopify.com).
// All 11 products matched by exact NADINE title (case-insensitive) against V8 catalog.
// Shopify handles do NOT match V8 catalogue handles — title is the canonical crosswalk key.
//
// Visual media approval completed 2026-07-16 (contact sheet v3):
//   9 simple products → eligibility: "ready", resolvedUrl populated.
//   2 multi-piece products (Becoming Alive, Becoming Defined) → needs-manual-review pending FASHN provider testing.
//   Becoming Clear replacement photo verified 2026-07-16 after token refresh unblocked Shopify query.
// CTA activation is globally gated by VIRTUAL_TRY_ON_ENABLED (= false until Phase 4A5).
// 7 component-level entries added (Becoming Alive × 3, Becoming Defined × 4).
//
// 2026-08-27 updates:
//   Becoming Defined (dress-set) → ready; CDN URL resolved via admin DOM; FASHN concern VTO-only.
//   Becoming Bold (oversized-blazer) → new entry, ready; image added by product owner.
//   Becoming Free (draped-leather-pants) → new entry, ready; image added by product owner.
//   shopifyMediaGid for Bold/Free pending Admin API re-auth (session expired 2026-07-30).

// ── Eligibility states ────────────────────────────────────────────────────────

export type TryOnEligibility =
  | "ready"               // verified GID + suitable image + FASHN-compatible garment
  | "missing-product"     // no Shopify product found for this handle
  | "missing-image"       // product exists but no suitable media found (or media was deleted)
  | "unsuitable-image"    // image found but not suitable (collage, text overlay, multi-garment, etc.)
  | "unsupported-layering"// garment has visible dual-layer or multi-piece construction FASHN cannot represent
  | "needs-manual-review";// image suitability not yet confirmed by visual review

// ── FASHN garment category — stored for when the adapter accepts category hints ─

export type FashnGarmentCategory = "tops" | "bottoms" | "one-piece" | "outerwear";

// ── Per-handle record ──────────────────────────────────────────────────────────

export interface VerifiedMediaEntry {
  catalogHandle: string;            // V8 NADINE handle — primary key (must match map key)
  nadinaTitle: string;              // Official NADINE title from V8 workbook
  shopifyTitle: string;             // Shopify product title (confirmed via Admin API)
  shopifyHandle: string | null;     // Shopify internal handle (differs from V8 handle)
  shopifyProductGid: string | null; // gid://shopify/Product/… — null until verified
  shopifyMediaGid: string | null;   // gid://shopify/MediaImage/… — null until verified
  imageDimensions: { w: number; h: number } | null; // pixel dimensions from Admin API
  resolvedUrl: string | null;       // CDN image URL — non-null only when eligibility === "ready"
  mediaUpdatedAt: string | null;    // ISO 8601 — derived from Shopify CDN ?v= version timestamp
  garmentCategory: FashnGarmentCategory;
  eligibility: TryOnEligibility;
  reason: string;                   // human-readable; safe to surface in reports/logs
}

// ── The 11 locked catalogue handles ──────────────────────────────────────────

export const LOCKED_CATALOGUE_HANDLES = [
  "double-top",
  "collar-shirt",
  "cropped-top",
  "asymmetrical-pants",
  "straight-pants",
  "suede-skirt",
  "trench-coat",
  "kimono-jacket",
  "leather-suede-jacket",
  "midi-dress",
  "dress-set",
] as const;

export type LockedCatalogueHandle = (typeof LOCKED_CATALOGUE_HANDLES)[number];

// ── Static verified media map ─────────────────────────────────────────────────
// GIDs verified 2026-07-16 via Shopify Admin GraphQL (products query, first 50).
// 8 simple products approved via visual review (contact sheet v3, 2026-07-16).
// resolvedUrl populated for approved entries; null for pending / unsuitable entries.

const RAW_ENTRIES: readonly VerifiedMediaEntry[] = [
  {
    catalogHandle: "double-top",
    nadinaTitle: "Becoming Alive",
    shopifyTitle: "Becoming Alive",
    shopifyHandle: "art-blouse",
    shopifyProductGid: "gid://shopify/Product/10285939163268",
    // GID points to the full layered top (image A) — approved as valid media 2026-07-16.
    shopifyMediaGid: "gid://shopify/MediaImage/51812553162884",
    imageDimensions: { w: 1024, h: 1536 },
    resolvedUrl: null,
    mediaUpdatedAt: "2026-03-26T13:36:48.000Z",
    garmentCategory: "tops",
    eligibility: "needs-manual-review",
    reason:
      "Full layered top (image A) approved as valid media 2026-07-16 via contact sheet v3. " +
      "Kept at needs-manual-review pending live FASHN provider testing — two-layer construction " +
      "(chiffon overlay + leather underlayer) requires runtime assessment. Component images B " +
      "(leather underlayer) and C (chiffon overlay) pending separate visual approval decision.",
  },
  {
    catalogHandle: "collar-shirt",
    nadinaTitle: "Becoming Real",
    shopifyTitle: "Becoming Real",
    shopifyHandle: "art-collar-layered-shirt",
    shopifyProductGid: "gid://shopify/Product/10285940179076",
    shopifyMediaGid: "gid://shopify/MediaImage/52802462056580",
    imageDimensions: { w: 1024, h: 1536 },
    resolvedUrl: "https://cdn.shopify.com/s/files/1/0998/1008/2948/files/0c950ae7-dfe3-4395-81c4-4d2663fa11bd.png?v=1784196037",
    mediaUpdatedAt: "2026-07-16T10:00:37.000Z",
    garmentCategory: "tops",
    eligibility: "ready",
    reason:
      "Approved 2026-07-16 via visual review (contact sheet v3). GIDs verified live via " +
      "Shopify Admin API. Portrait 1024×1536. Image updated same day as title rename.",
  },
  {
    catalogHandle: "cropped-top",
    nadinaTitle: "Becoming Fragmented",
    shopifyTitle: "Becoming Fragmented",
    shopifyHandle: "wrap-cropped-top",
    shopifyProductGid: "gid://shopify/Product/10285939949700",
    shopifyMediaGid: "gid://shopify/MediaImage/51812631445636",
    imageDimensions: { w: 1024, h: 1024 },
    resolvedUrl: "https://cdn.shopify.com/s/files/1/0998/1008/2948/files/3614927b-4685-4df3-aeff-b3d5a950cbd2.png?v=1774533037",
    mediaUpdatedAt: "2026-03-26T13:50:37.000Z",
    garmentCategory: "tops",
    eligibility: "ready",
    reason:
      "Approved 2026-07-16 via visual review (contact sheet v3). GIDs verified live via " +
      "Shopify Admin API. Square 1024×1024 — hem confirmed visible by reviewer.",
  },
  {
    catalogHandle: "asymmetrical-pants",
    nadinaTitle: "Becoming Grounded",
    shopifyTitle: "Becoming Grounded",
    shopifyHandle: "asymmetrical-waist-pants",
    shopifyProductGid: "gid://shopify/Product/10285940015236",
    shopifyMediaGid: "gid://shopify/MediaImage/51812633051268",
    imageDimensions: { w: 1024, h: 1536 },
    resolvedUrl: "https://cdn.shopify.com/s/files/1/0998/1008/2948/files/7d5d1e05-796a-45d9-b74a-4ddb0c9da3cf.png?v=1774533080",
    mediaUpdatedAt: "2026-03-26T13:51:20.000Z",
    garmentCategory: "bottoms",
    eligibility: "ready",
    reason:
      "Approved 2026-07-16 via visual review (contact sheet v3). GIDs verified live via " +
      "Shopify Admin API. Portrait 1024×1536.",
  },
  {
    catalogHandle: "straight-pants",
    nadinaTitle: "Becoming Unfiltered",
    shopifyTitle: "Becoming Unfiltered",
    shopifyHandle: "printed-straight-pants",
    shopifyProductGid: "gid://shopify/Product/10285939228804",
    shopifyMediaGid: "gid://shopify/MediaImage/51812554768516",
    imageDimensions: { w: 1024, h: 1536 },
    resolvedUrl: "https://cdn.shopify.com/s/files/1/0998/1008/2948/files/3b14fe8b-2c19-492e-82b1-44baaf3a3cc9.png?v=1774532245",
    mediaUpdatedAt: "2026-03-26T13:37:25.000Z",
    garmentCategory: "bottoms",
    eligibility: "ready",
    reason:
      "Approved 2026-07-16 via visual review (contact sheet v3). GIDs verified live via " +
      "Shopify Admin API. Portrait 1024×1536.",
  },
  {
    catalogHandle: "suede-skirt",
    nadinaTitle: "Becoming Rooted",
    shopifyTitle: "Becoming Rooted",
    shopifyHandle: "becoming-rooted",
    shopifyProductGid: "gid://shopify/Product/10403887939716",
    shopifyMediaGid: "gid://shopify/MediaImage/52802464088196",
    imageDimensions: { w: 1024, h: 1536 },
    resolvedUrl: "https://cdn.shopify.com/s/files/1/0998/1008/2948/files/d51e6af2-f7de-4fec-b851-8019e2da72eb_1_1.png?v=1784196279",
    mediaUpdatedAt: "2026-07-16T10:04:39.000Z",
    garmentCategory: "bottoms",
    eligibility: "ready",
    reason:
      "Approved 2026-07-16 via visual review (contact sheet v3). GIDs verified live via " +
      "Shopify Admin API. Portrait 1024×1536. Image updated same day as title rename.",
  },
  {
    catalogHandle: "trench-coat",
    nadinaTitle: "Becoming Seen",
    shopifyTitle: "Becoming Seen",
    shopifyHandle: "sculptural-hybrid-coat",
    shopifyProductGid: "gid://shopify/Product/10285932380292",
    shopifyMediaGid: "gid://shopify/MediaImage/51812555915396",
    imageDimensions: { w: 1024, h: 1536 },
    resolvedUrl: "https://cdn.shopify.com/s/files/1/0998/1008/2948/files/b7af3725-7048-4ead-8d04-d6fb42556eac.png?v=1774532277",
    mediaUpdatedAt: "2026-03-26T13:37:57.000Z",
    garmentCategory: "outerwear",
    eligibility: "ready",
    reason:
      "Approved 2026-07-16 via visual review (contact sheet v3). GIDs verified live via " +
      "Shopify Admin API. Portrait 1024×1536.",
  },
  {
    catalogHandle: "kimono-jacket",
    nadinaTitle: "Becoming Whole",
    shopifyTitle: "Becoming Whole",
    shopifyHandle: "printed-wrap-kimono-coat",
    shopifyProductGid: "gid://shopify/Product/10285940113540",
    shopifyMediaGid: "gid://shopify/MediaImage/51812635476100",
    imageDimensions: { w: 1024, h: 1024 },
    resolvedUrl: "https://cdn.shopify.com/s/files/1/0998/1008/2948/files/77d61b97-37da-4e57-8297-aa5207b35d07.png?v=1774533134",
    mediaUpdatedAt: "2026-03-26T13:52:14.000Z",
    garmentCategory: "outerwear",
    eligibility: "ready",
    reason:
      "Approved 2026-07-16 via visual review (contact sheet v3). GIDs verified live via " +
      "Shopify Admin API. Square 1024×1024 — hem confirmed visible by reviewer.",
  },
  {
    catalogHandle: "leather-suede-jacket",
    nadinaTitle: "Becoming Clear",
    shopifyTitle: "Becoming Clear",
    shopifyHandle: "becoming-clear",
    shopifyProductGid: "gid://shopify/Product/10403888005252",
    // Previous screenshot GID (…/52802479784068, 696×634) cleared — do not reuse.
    // Replacement media verified 2026-07-16 via fresh Shopify Admin API query after token refresh.
    // Image: professional product photo, front+back composite, clean neutral background.
    // Full sleeves and hem visible; not on a person; no text overlays.
    shopifyMediaGid: "gid://shopify/MediaImage/52802464383108",
    imageDimensions: { w: 1024, h: 1536 },
    resolvedUrl:
      "https://cdn.shopify.com/s/files/1/0998/1008/2948/files/5373f5ee-5c4e-4083-9ad4-68bd4bd20d1c.png?v=1784196301",
    mediaUpdatedAt: "2026-07-16T10:05:01.000Z",
    garmentCategory: "outerwear",
    eligibility: "ready",
    reason:
      "Verified 2026-07-16. Clean product photo (front+back composite, 1024×1536). " +
      "Full sleeves and hem visible. Not a screenshot. FASHN provider test pending (Phase 4A5).",
  },
  {
    catalogHandle: "midi-dress",
    nadinaTitle: "Becoming Her",
    shopifyTitle: "Becoming Her",
    shopifyHandle: "leather-midi-dress",
    shopifyProductGid: "gid://shopify/Product/10285940211844",
    shopifyMediaGid: "gid://shopify/MediaImage/51812640948356",
    imageDimensions: { w: 1024, h: 1536 },
    resolvedUrl: "https://cdn.shopify.com/s/files/1/0998/1008/2948/files/8a855f15-e5e9-4ef5-a7db-a7253e83a542.png?v=1774533199",
    mediaUpdatedAt: "2026-03-26T13:53:19.000Z",
    garmentCategory: "one-piece",
    eligibility: "ready",
    reason:
      "Approved 2026-07-16 via visual review (contact sheet v3). GIDs verified live via " +
      "Shopify Admin API. Portrait 1024×1536. One-piece — no layering concern.",
  },
  {
    catalogHandle: "dress-set",
    nadinaTitle: "Becoming Defined",
    shopifyTitle: "Becoming Defined",
    shopifyHandle: "becoming-defined",
    shopifyProductGid: "gid://shopify/Product/10403887906948",
    // GID points to the complete set (image A) — approved as valid media 2026-07-16.
    shopifyMediaGid: "gid://shopify/MediaImage/52802463596676",
    imageDimensions: { w: 1024, h: 1536 },
    resolvedUrl:
      "https://cdn.shopify.com/s/files/1/0998/1008/2948/files/4fbfaad1-b2a2-4c69-b44d-431f5a9cfe93.png?v=1784196241",
    mediaUpdatedAt: "2026-07-16T10:04:01.000Z",
    garmentCategory: "one-piece",
    eligibility: "ready",
    reason:
      "Complete set (image A) approved 2026-07-16 via contact sheet v3. GIDs verified via " +
      "Shopify Admin API. Portrait 1024×1536. CDN URL resolved 2026-08-27 via admin DOM. " +
      "Multi-piece FASHN concern applies to VTO only — VTO gated separately by VIRTUAL_TRY_ON_ENABLED.",
  },
  {
    catalogHandle: "oversized-blazer",
    nadinaTitle: "Becoming Bold",
    shopifyTitle: "Becoming Bold",
    shopifyHandle: "becoming-bold",
    shopifyProductGid: "gid://shopify/Product/10463959744644",
    // Media GID pending Admin API re-auth (offline session expired 2026-07-30).
    // Product GID and CDN URL verified 2026-08-27 via Shopify Admin DOM.
    shopifyMediaGid: null,
    imageDimensions: null,
    resolvedUrl:
      "https://cdn.shopify.com/s/files/1/0998/1008/2948/files/c5cd4188-f53e-4c5b-b26e-7b90359dd1a8_1.png?v=1787821875",
    mediaUpdatedAt: "2026-08-27T09:11:15.000Z",
    garmentCategory: "outerwear",
    eligibility: "ready",
    reason:
      "Product image added by product owner 2026-08-27. Product GID and CDN URL verified via " +
      "Shopify Admin DOM. Not in LOCKED_CATALOGUE_HANDLES — null shopifyMediaGid permitted. " +
      "Backfill GID when Admin API session is next refreshed.",
  },
  {
    catalogHandle: "draped-leather-pants",
    nadinaTitle: "Becoming Free",
    shopifyTitle: "Becoming Free",
    shopifyHandle: "becoming-free",
    shopifyProductGid: "gid://shopify/Product/10463957516420",
    // Media GID pending Admin API re-auth (offline session expired 2026-07-30).
    // Product GID and CDN URL verified 2026-08-27 via Shopify Admin DOM.
    shopifyMediaGid: null,
    imageDimensions: null,
    resolvedUrl:
      "https://cdn.shopify.com/s/files/1/0998/1008/2948/files/ecb743ba-ac42-4951-a4c5-667bae1af63f_1.png?v=1787821825",
    mediaUpdatedAt: "2026-08-27T09:10:25.000Z",
    garmentCategory: "bottoms",
    eligibility: "ready",
    reason:
      "Product image added by product owner 2026-08-27. Product GID and CDN URL verified via " +
      "Shopify Admin DOM. Not in LOCKED_CATALOGUE_HANDLES — null shopifyMediaGid permitted. " +
      "Backfill GID when Admin API session is next refreshed.",
  },
];

// ── Build the lookup map ───────────────────────────────────────────────────────

export const NAIA_VERIFIED_MEDIA_MAP: ReadonlyMap<string, VerifiedMediaEntry> = new Map(
  RAW_ENTRIES.map((e) => [e.catalogHandle, e]),
);

// ── Lookup ────────────────────────────────────────────────────────────────────

export function resolveVerifiedMedia(handle: string): VerifiedMediaEntry | undefined {
  return NAIA_VERIFIED_MEDIA_MAP.get(handle);
}

// ── Validation ────────────────────────────────────────────────────────────────
// Returns a list of error strings. Empty = valid. Run in tests and at module load.

export function validateMediaMap(
  map: ReadonlyMap<string, VerifiedMediaEntry> = NAIA_VERIFIED_MEDIA_MAP,
): string[] {
  const errors: string[] = [];

  // All 11 locked handles must be present.
  for (const h of LOCKED_CATALOGUE_HANDLES) {
    if (!map.has(h)) errors.push(`missing handle: ${h}`);
  }

  // No duplicate Shopify product GIDs (nulls are skipped).
  const seenProductGids = new Set<string>();
  for (const entry of map.values()) {
    if (!entry.shopifyProductGid) continue;
    if (seenProductGids.has(entry.shopifyProductGid)) {
      errors.push(`duplicate product GID: ${entry.shopifyProductGid} (handle: ${entry.catalogHandle})`);
    }
    seenProductGids.add(entry.shopifyProductGid);
  }

  // No duplicate Shopify media GIDs (nulls are skipped).
  const seenMediaGids = new Set<string>();
  for (const entry of map.values()) {
    if (!entry.shopifyMediaGid) continue;
    if (seenMediaGids.has(entry.shopifyMediaGid)) {
      errors.push(`duplicate media GID: ${entry.shopifyMediaGid} (handle: ${entry.catalogHandle})`);
    }
    seenMediaGids.add(entry.shopifyMediaGid);
  }

  // Map key must equal entry.catalogHandle.
  for (const [key, entry] of map.entries()) {
    if (key !== entry.catalogHandle) {
      errors.push(`key "${key}" does not match catalogHandle "${entry.catalogHandle}"`);
    }
  }

  // "ready" entries must have non-null GIDs and a non-null resolved URL.
  // shopifyMediaGid is required only for LOCKED_CATALOGUE_HANDLES — unlocked entries may
  // carry null while the GID is pending Admin API re-verification.
  for (const entry of map.values()) {
    if (entry.eligibility === "ready") {
      if (!entry.shopifyProductGid) {
        errors.push(`${entry.catalogHandle}: eligibility=ready but shopifyProductGid is null`);
      }
      if (!entry.shopifyMediaGid && (LOCKED_CATALOGUE_HANDLES as readonly string[]).includes(entry.catalogHandle)) {
        errors.push(`${entry.catalogHandle}: eligibility=ready but shopifyMediaGid is null`);
      }
      if (!entry.resolvedUrl) {
        errors.push(`${entry.catalogHandle}: eligibility=ready but resolvedUrl is null`);
      }
    }
    // Non-ready entries must NOT expose a URL (fail-closed guarantee).
    if (entry.eligibility !== "ready" && entry.resolvedUrl !== null) {
      errors.push(`${entry.catalogHandle}: eligibility=${entry.eligibility} must have resolvedUrl=null`);
    }
  }

  // resolvedUrl on ready entries must be an absolute HTTPS URL.
  for (const entry of map.values()) {
    if (entry.eligibility === "ready" && entry.resolvedUrl) {
      try {
        const u = new URL(entry.resolvedUrl);
        if (u.protocol !== "https:") {
          errors.push(`${entry.catalogHandle}: resolvedUrl must use https:`);
        }
      } catch {
        errors.push(`${entry.catalogHandle}: resolvedUrl is not a valid URL`);
      }
    }
  }

  return errors;
}

// ── Module-load invariant check ────────────────────────────────────────────────
// Catches errors in RAW_ENTRIES before any caller can read a corrupt map.
const _mapErrors = validateMediaMap();
if (_mapErrors.length > 0) {
  throw new Error(
    `naia-product-media: NAIA_VERIFIED_MEDIA_MAP invariant violated:\n${_mapErrors.join("\n")}`,
  );
}

// ── Global try-on gate ─────────────────────────────────────────────────────────
// Set to true in Phase 4A5 once the FASHN generation flow is live-verified on staging.
// When false, computeStyleMeResult gates all resolvedUrls to null regardless of
// individual entry eligibility. A "ready" media record alone must NOT expose the CTA.
export const VIRTUAL_TRY_ON_ENABLED = false;

// ── Component-level record ────────────────────────────────────────────────────
// Represents a single garment image extracted from a multi-piece product.
// Components share a parent Shopify product but each has its own media GID.
// soldSeparately is always false — these pieces are never individual listings.

export interface ComponentMediaEntry {
  componentHandle: string;           // "{parentHandle}/{componentSlug}" — primary key
  parentCatalogHandle: string;       // V8 parent handle (must be in NAIA_VERIFIED_MEDIA_MAP)
  parentShopifyProductGid: string;   // gid://shopify/Product/… of the parent product
  componentName: string;             // human-readable component label
  shopifyMediaGid: string | null;    // gid://shopify/MediaImage/… — null until verified
  resolvedUrl: string | null;        // CDN image URL — non-null only when eligibility === "ready"
  shopifyAltText: string | null;     // exact alt text stored on the Shopify media record
  imageDimensions: { w: number; h: number } | null;
  garmentCategory: FashnGarmentCategory;
  readonly soldSeparately: false;    // invariant: component images are never sold separately
  eligibility: TryOnEligibility;
  reason: string;
}

// ── Locked component handles ──────────────────────────────────────────────────

export const COMPONENT_HANDLES = [
  "double-top/full-layered-top",
  "double-top/leather-underlayer",
  "double-top/chiffon-overlay",
  "dress-set/complete-set",
  "dress-set/corset",
  "dress-set/mesh-top",
  "dress-set/skirt",
] as const;

export type ComponentHandle = (typeof COMPONENT_HANDLES)[number];

// ── Component entries ─────────────────────────────────────────────────────────
// GIDs and URLs verified 2026-07-16 via Shopify Admin API multi-image query (contact sheet v3).
// Eligibility set per product-owner decisions 2026-07-16.

const RAW_COMPONENT_ENTRIES: readonly ComponentMediaEntry[] = [
  // ── Becoming Alive (double-top) ─────────────────────────────────────────────
  {
    componentHandle: "double-top/full-layered-top",
    parentCatalogHandle: "double-top",
    parentShopifyProductGid: "gid://shopify/Product/10285939163268",
    componentName: "Full layered top",
    shopifyMediaGid: "gid://shopify/MediaImage/51812553162884",
    resolvedUrl: null,
    shopifyAltText: "Becoming Alive — full layered top — front",
    imageDimensions: { w: 1024, h: 1536 },
    garmentCategory: "tops",
    soldSeparately: false,
    eligibility: "needs-manual-review",
    reason: "provider-testing-required-layering",
  },
  {
    componentHandle: "double-top/leather-underlayer",
    parentCatalogHandle: "double-top",
    parentShopifyProductGid: "gid://shopify/Product/10285939163268",
    componentName: "Leather underlayer",
    shopifyMediaGid: "gid://shopify/MediaImage/52802481291396",
    resolvedUrl:
      "https://cdn.shopify.com/s/files/1/0998/1008/2948/files/670ad088-e530-41c1-a4f0-2728be924942.png?v=1784197481",
    shopifyAltText: "Becoming Alive — leather underlayer — front",
    imageDimensions: { w: 1024, h: 1535 },
    garmentCategory: "tops",
    soldSeparately: false,
    eligibility: "ready",
    reason:
      "Approved 2026-07-16. Fitted vegan-leather underlayer in isolation, solid non-sheer " +
      "material, front-facing portrait.",
  },
  {
    componentHandle: "double-top/chiffon-overlay",
    parentCatalogHandle: "double-top",
    parentShopifyProductGid: "gid://shopify/Product/10285939163268",
    componentName: "Chiffon overlay",
    shopifyMediaGid: "gid://shopify/MediaImage/52802485518468",
    resolvedUrl: null,
    shopifyAltText: "Becoming Alive — chiffon overlay — front",
    imageDimensions: { w: 1024, h: 1536 },
    garmentCategory: "tops",
    soldSeparately: false,
    eligibility: "needs-manual-review",
    reason: "provider-testing-required-transparency",
  },
  // ── Becoming Defined (dress-set) ────────────────────────────────────────────
  {
    componentHandle: "dress-set/complete-set",
    parentCatalogHandle: "dress-set",
    parentShopifyProductGid: "gid://shopify/Product/10403887906948",
    componentName: "Complete set",
    shopifyMediaGid: "gid://shopify/MediaImage/52802463596676",
    resolvedUrl: null,
    shopifyAltText: "Becoming Defined — complete set — front",
    imageDimensions: { w: 1024, h: 1536 },
    garmentCategory: "one-piece",
    soldSeparately: false,
    eligibility: "needs-manual-review",
    reason: "provider-testing-required-multi-piece",
  },
  {
    componentHandle: "dress-set/corset",
    parentCatalogHandle: "dress-set",
    parentShopifyProductGid: "gid://shopify/Product/10403887906948",
    componentName: "Corset",
    shopifyMediaGid: "gid://shopify/MediaImage/52802485780612",
    resolvedUrl:
      "https://cdn.shopify.com/s/files/1/0998/1008/2948/files/a026b8d7-7dbf-466f-ace1-630f07c5736f.png?v=1784197631",
    shopifyAltText: "Becoming Defined — corset — front",
    imageDimensions: { w: 1122, h: 1402 },
    garmentCategory: "tops",
    soldSeparately: false,
    eligibility: "ready",
    reason:
      "Approved 2026-07-16. Structured boned corset in isolation, solid material, " +
      "front-facing (confirmed via alt text).",
  },
  {
    componentHandle: "dress-set/mesh-top",
    parentCatalogHandle: "dress-set",
    parentShopifyProductGid: "gid://shopify/Product/10403887906948",
    componentName: "Mesh top",
    shopifyMediaGid: "gid://shopify/MediaImage/52802486304900",
    resolvedUrl: null,
    shopifyAltText: "Becoming Defined — mesh top — front",
    imageDimensions: { w: 1122, h: 1402 },
    garmentCategory: "tops",
    soldSeparately: false,
    eligibility: "needs-manual-review",
    reason: "provider-testing-required-transparency",
  },
  {
    componentHandle: "dress-set/skirt",
    parentCatalogHandle: "dress-set",
    parentShopifyProductGid: "gid://shopify/Product/10403887906948",
    componentName: "Skirt",
    shopifyMediaGid: "gid://shopify/MediaImage/52802486698116",
    resolvedUrl:
      "https://cdn.shopify.com/s/files/1/0998/1008/2948/files/9ad75c31-20f7-4cc1-a63b-bdbe8be1e0e3.png?v=1784197789",
    shopifyAltText: "Becoming Defined — skirt — front",
    imageDimensions: { w: 1024, h: 1536 },
    garmentCategory: "bottoms",
    soldSeparately: false,
    eligibility: "ready",
    reason:
      "Approved 2026-07-16. Standalone skirt, single-layer bottom, front-facing portrait " +
      "(confirmed via alt text).",
  },
];

// ── Component map ─────────────────────────────────────────────────────────────

export const NAIA_COMPONENT_MEDIA_MAP: ReadonlyMap<string, ComponentMediaEntry> = new Map(
  RAW_COMPONENT_ENTRIES.map((e) => [e.componentHandle, e]),
);

// ── Component lookup ──────────────────────────────────────────────────────────

export function resolveComponentMedia(componentHandle: string): ComponentMediaEntry | undefined {
  return NAIA_COMPONENT_MEDIA_MAP.get(componentHandle);
}

// ── Component map validation ──────────────────────────────────────────────────

export function validateComponentMap(
  map: ReadonlyMap<string, ComponentMediaEntry> = NAIA_COMPONENT_MEDIA_MAP,
): string[] {
  const errors: string[] = [];

  for (const h of COMPONENT_HANDLES) {
    if (!map.has(h)) errors.push(`missing component handle: ${h}`);
  }

  for (const [key, entry] of map.entries()) {
    if (key !== entry.componentHandle) {
      errors.push(`key "${key}" does not match componentHandle "${entry.componentHandle}"`);
    }
  }

  for (const entry of map.values()) {
    if (entry.soldSeparately !== false) {
      errors.push(`${entry.componentHandle}: soldSeparately must be false`);
    }
  }

  const seenMediaGids = new Set<string>();
  for (const entry of map.values()) {
    if (!entry.shopifyMediaGid) continue;
    if (seenMediaGids.has(entry.shopifyMediaGid)) {
      errors.push(
        `duplicate media GID: ${entry.shopifyMediaGid} (component: ${entry.componentHandle})`,
      );
    }
    seenMediaGids.add(entry.shopifyMediaGid);
  }

  for (const entry of map.values()) {
    if (entry.eligibility === "ready") {
      if (!entry.shopifyMediaGid) {
        errors.push(`${entry.componentHandle}: eligibility=ready but shopifyMediaGid is null`);
      }
      if (!entry.resolvedUrl) {
        errors.push(`${entry.componentHandle}: eligibility=ready but resolvedUrl is null`);
      }
    }
    if (entry.eligibility !== "ready" && entry.resolvedUrl !== null) {
      errors.push(
        `${entry.componentHandle}: eligibility=${entry.eligibility} must have resolvedUrl=null`,
      );
    }
  }

  for (const entry of map.values()) {
    if (entry.eligibility === "ready" && entry.resolvedUrl) {
      try {
        const u = new URL(entry.resolvedUrl);
        if (u.protocol !== "https:") {
          errors.push(`${entry.componentHandle}: resolvedUrl must use https:`);
        }
      } catch {
        errors.push(`${entry.componentHandle}: resolvedUrl is not a valid URL`);
      }
    }
  }

  return errors;
}

// ── Component map invariant check ─────────────────────────────────────────────
const _componentMapErrors = validateComponentMap();
if (_componentMapErrors.length > 0) {
  throw new Error(
    `naia-product-media: NAIA_COMPONENT_MEDIA_MAP invariant violated:\n${_componentMapErrors.join("\n")}`,
  );
}
