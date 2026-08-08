// app/lib/ai/nadine-product-assessment.types.ts
// Phase 4A4 — Typed contracts for the NADINE product-page intelligence engine.
// All assessments are deterministic. No external API calls. No Prisma mutations.

// ── Verdict ───────────────────────────────────────────────────────────────────

export type AssessmentVerdict =
  | "strong-match"
  | "good-match-with-caveat"
  | "not-best-addition"
  | "insufficient-evidence";

// ── Signal summary (machine-readable; never exposed raw to storefront) ─────────

export interface AssessmentSignals {
  stylePersonalityOverlap: string[];   // catalog IDs matching customer profile
  desiredFeelingOverlap: string[];     // catalog IDs matching customer's desired feeling
  occasionOverlap: string[];           // occasion tags matching customer's dressesFors
  avoidColorConflict: string[];        // customer avoid-colors found in product palette
  notIdealForMatched: boolean;         // notIdealFor text matched a customer attribute
  duplicateRisk: boolean;              // closet already contains a similar item
  wardrobeGapFilled: boolean;          // product fills a category gap in the closet
  closetCompatibilityCount: number;    // owned items that pair well with this product
  sufficientEvidence: boolean;         // enough profile signals to produce a verdict
}

// ── Display evidence ──────────────────────────────────────────────────────────

export interface AssessmentCaveat {
  code:
    | "avoid-color-conflict"
    | "not-ideal-for-lifestyle"
    | "duplicate-risk"
    | "occasion-mismatch"
    | "style-direction-mismatch"
    | "incomplete-profile";
  text: string; // display-safe; non-clinical; no psychological claims
}

// ── Full assessment result ─────────────────────────────────────────────────────

export interface AssessmentResult {
  verdict: AssessmentVerdict;
  explanation: string;       // 1-2 sentence summary, fashion-led copy
  positiveEvidence: string[]; // display strings
  caveats: AssessmentCaveat[];
  signals: AssessmentSignals;
  schemaVersion: 1;
  assessedAt: string;        // ISO 8601
}

// ── Customer profile (read-only snapshot; never mutated) ──────────────────────

export interface CustomerAssessmentProfile {
  stylePersonalities: string[];
  desiredFeelings: string[];
  lifestyle: string | null;
  dressesFor: string[];
  favoriteColors: string[];
  avoidColors: string[];
  fitPreferences: string[];
  comfortLevel: number | null; // 1-10 fashion-risk scale
}

// ── Closet item summary (subset of ClosetItem; read-only) ─────────────────────

export interface ClosetItemSummary {
  id: string;
  name: string | null;
  category: string; // "top" | "bottom" | "outerwear" | "dress"
  colors: string[];
  styleTags: string[];
  occasions: string[];
}

// ── Try-on state ──────────────────────────────────────────────────────────────

export type TryOnState =
  | "coming-soon"   // eligible media, VIRTUAL_TRY_ON_ENABLED = false
  | "needs-testing" // provider-testing-required eligibility
  | "no-model"      // no My nAia Model set up
  | "unavailable"   // missing or unsuitable media
  | "hidden";       // product not in the verified map (block should not render this)

export interface TryOnStatus {
  state: TryOnState;
  label: string;
  sublabel: string;
}

// ── Component view (for multi-piece products) ─────────────────────────────────

export interface ProductComponentView {
  componentHandle: string;     // e.g. "dress-set/corset"
  componentName: string;       // e.g. "Corset"
  tryOnState: TryOnState;
  soldSeparately: false;       // invariant: always false
}

// ── Internal resolved product (not sent to client) ────────────────────────────

export interface ResolvedProduct {
  v8Handle: string;
  nadinaTitle: string;
  shopifyHandle: string | null;
  itemType: string;            // "TOP" | "BOTTOM" | "OUTERWEAR" | "DRESS" | "SET"
  colors: string[];
  formalityScore: number;
  formalityDescription: string;
  stylingRole: string;
  occasionTags: string[];
  notIdealFor: string;
  desiredFeelingMatch: string[];
  stylePersonalityMatch: string[];
  colorDirection: string;
  coverageModesty: string;
  bodyFitLogic: string;
  avoidPairingWithNadinePieces: string | null;
  mediaEligibility: import("./naia-product-media.js").TryOnEligibility;
  hasVerifiedMedia: boolean;
}

// ── Product page response (sent to storefront JS) ─────────────────────────────

export interface ProductPageIntelligence {
  resolved: true;
  v8Handle: string;
  nadinaTitle: string;
  stylingRole: string;
  occasionTags: string[];
  formalityDescription: string;
  components: ProductComponentView[];
  assessment: AssessmentResult | null;  // null for guests
  tryOnStatus: TryOnStatus;
  wardrobeCompatibilityCount: number | null; // null for guests
  schemaVersion: 1;
}

export interface ProductPageError {
  resolved: false;
  reason: "unknown-product" | "unmapped-product";
}

export type ProductPageResponse = ProductPageIntelligence | ProductPageError;
