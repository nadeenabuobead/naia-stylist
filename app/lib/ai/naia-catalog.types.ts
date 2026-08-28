import type {
  EligibilityState,
  ProductTemplateField,
  DressingMetadata,
} from "./signal-contract.js";

export type { EligibilityState, ProductTemplateField };

export type ProductItemType = "TOP" | "BOTTOM" | "OUTERWEAR" | "DRESS" | "SET";
export type StylingEffortLevel = "low" | "medium" | "high";

export interface CatalogSourceMeta {
  schemaVersion: number;
  sourceWorkbook: string;
  sourceSha256: string;
}

// All 46 raw workbook cell values, keyed by ProductTemplateField camelCase name.
export type CatalogSourceFields = Record<ProductTemplateField, string>;

export interface CatalogIdentityFields {
  verifiedTitle: string;
  liveUrl: string | null;        // null when blank, base-only, or slug ≠ handle
  featuredImageUrl: string | null; // null for all 11 (blank in V8)
  itemType: ProductItemType;
  styleableComponents: string[]; // "none" → []
  colors: string[];              // comma-split; multi-word values preserved
  silhouette: string;
  fit: string;
  fabric: string;
  activePublished: string;       // raw workbook flag; runtime eligibility comes from PRODUCT_ELIGIBILITY
  artStoryDescription: string;
}

export interface CatalogRankingArrays {
  desiredFeelingMatch: string[];
  stylePersonalityMatch: string[];
  styleTags: string[];
  occasionTags: string[];
  season: string[];
  bodyProportionEffects: string[];
  styleMeComfortMatch: string[];
  currentEmotionalStateSupport: string[];
  practicalSupportMatch: string[];
}

export interface CatalogScalars {
  formalityScore: number;        // parsed as float; must be finite
  stylingEffortLevel: StylingEffortLevel;
}

export interface CatalogProse {
  stylingRole: string;
  productStyleDescriptors: string[]; // consistently comma-separated in V8
  formalityDescription: string;
  bodyFitLogic: string;
  coverageModesty: string;
  proportionRule: string;
  notIdealFor: string;
  emotionalSupportLogic: string; // full raw string preserved; backtick-keyed entries detectable
  practicalSupportLogic: string; // full raw string preserved; backtick-keyed entries detectable
  pairingReason: string;
  accessoriesDirection: string;
  shoeDirection: string;
  colorDirection: string;
  skinToneColourHarmony: string;
  complexionStylingNote: string;
  hairStylingDirection: string[]; // consistently token-format in V8 (kebab-case, comma-separated)
  hairStylingNote: string;
  styleMeExplanation: string;
}

export interface CatalogPairings {
  bestPairedWithNadinePieces: string | null;    // "None" (case-insensitive) → null
  conditionalNadinePairings: string | null;      // "None" (case-insensitive) → null
  avoidPairingWithNadinePieces: string | null;   // "None" (case-insensitive) → null
  bestPairedWithGeneral: string;
  avoidPairingWithGeneral: string;
}

export interface CatalogParsed {
  identity: CatalogIdentityFields;
  rankings: CatalogRankingArrays;
  scalars: CatalogScalars;
  prose: CatalogProse;
  pairings: CatalogPairings;
}

export interface GeneratedCatalogProduct {
  handle: string;                  // canonical runtime primary key; trimmed
  eligibility: EligibilityState;
  sourceFields: CatalogSourceFields;
  parsed: CatalogParsed;
  dressingMetadata?: DressingMetadata; // injected at runtime by naia-catalog.ts; absent = fail-closed
}

export interface GeneratedCatalog extends CatalogSourceMeta {
  products: GeneratedCatalogProduct[];
}

/**
 * Live Shopify facts — optional join only.
 * Never included in the generated catalog; resolved at runtime from Shopify API.
 */
export interface LiveShopifyFacts {
  shopifyProductId: string;
  availableForSale: boolean;
  priceAmount: string;
  priceCurrencyCode: string;
  publishedAt: string | null;
}
