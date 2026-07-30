import {
  PRODUCT_ELIGIBILITY,
  PROVISIONAL_EVIDENCE,
} from "./signal-contract.js";
import type { ProductFieldEvidence } from "./signal-contract.js";
import { NAIA_CATALOG } from "./generated/naia-catalog.generated.js";
import type {
  GeneratedCatalog,
  GeneratedCatalogProduct,
} from "./naia-catalog.types.js";

export type { GeneratedCatalog, GeneratedCatalogProduct };
export type { EligibilityState, ProductTemplateField } from "./naia-catalog.types.js";

// Re-export the raw catalog for callers that need the source metadata.
export const catalog: GeneratedCatalog = NAIA_CATALOG;

// Provisional evidence entries indexed by product handle.
const provisionalByHandle = new Map<string, ProductFieldEvidence[]>();
for (const entry of PROVISIONAL_EVIDENCE) {
  const existing = provisionalByHandle.get(entry.productHandle);
  if (existing) {
    existing.push(entry);
  } else {
    provisionalByHandle.set(entry.productHandle, [entry]);
  }
}

/**
 * Returns provisional evidence for a given handle, or an empty array if none.
 * Fields are typed as ProductTemplateField (not string).
 */
export function getProvisionalEvidence(
  handle: string,
): readonly ProductFieldEvidence[] {
  return provisionalByHandle.get(handle) ?? [];
}

/**
 * Returns the catalog product matching the given handle, or undefined.
 */
export function getProductByHandle(
  handle: string,
): GeneratedCatalogProduct | undefined {
  return NAIA_CATALOG.products.find((p) => p.handle === handle);
}

/**
 * Returns all 11 catalog products in workbook order.
 */
export function getAllCatalogProducts(): readonly GeneratedCatalogProduct[] {
  return NAIA_CATALOG.products;
}

/**
 * Returns products eligible for recommendation.
 * Eligibility rule (Phase 3B):
 *   - "verified-inactive" is excluded.
 *   - "verified-active" and "unverified" remain in the candidate pool.
 * No numeric scoring or ranking is applied here.
 */
export function getRecommendationEligibleProducts(): readonly GeneratedCatalogProduct[] {
  return NAIA_CATALOG.products.filter(
    (p) => p.eligibility !== "verified-inactive",
  );
}

// Sanity-check: every handle in the generated catalog must be in PRODUCT_ELIGIBILITY.
// This runs once at module load and throws immediately on a mismatch.
for (const product of NAIA_CATALOG.products) {
  if (!(product.handle in PRODUCT_ELIGIBILITY)) {
    throw new Error(
      `naia-catalog: product handle '${product.handle}' missing from PRODUCT_ELIGIBILITY`,
    );
  }
}
