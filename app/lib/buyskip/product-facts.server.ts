// app/lib/buyskip/product-facts.server.ts
// Buy/Skip-owned product facts layer (Phase 3 of the Buy/Skip product foundation).
//
// Distinguishes what is actually known about the candidate product from what is
// merely inferred (by the vision model, from the uploaded photo) or genuinely
// unknown. Nothing here invents a fact — every value traces to either the
// customer's own declared input or the vision model's own stated observation.
//
// Scope: facts about the CANDIDATE PRODUCT only. This is deliberately shaped to
// be easy to map into canonical Garment Intelligence later — same field names
// and provenance/confidence shape — but it is not a parallel GI implementation.

export type FactStatus = "known" | "inferred" | "unknown";
export type FactProvenance = "customer-declared" | "vision-model" | "not-provided";

export interface ProductFact<T> {
  value: T | null;
  status: FactStatus;
  provenance: FactProvenance;
}

export type ObservationConfidence = "high" | "medium" | "low" | null;

export interface ProductFacts {
  // Customer-declared (known at submit time, from fixed pill selectors / free text)
  category: ProductFact<string>;
  declaredColor: ProductFact<string[]>;
  brand: ProductFact<string>;
  size: ProductFact<string>;

  // Vision-model-inferred (from the uploaded photo; only populated after the
  // analysis call returns — see mergeVisionFacts)
  itemType: ProductFact<string>;
  detectedColor: ProductFact<string>;
  silhouette: ProductFact<string>;
  fitProfile: ProductFact<string>;
  formality: ProductFact<string>;
  sleeveLength: ProductFact<string>;
  necklineCoverage: ProductFact<string>;
  shoulderCoverage: ProductFact<boolean>;
  midriffExposed: ProductFact<boolean>;
  material: ProductFact<string>;
  pattern: ProductFact<string>;
  observationConfidence: ObservationConfidence;

  // Never collected by this flow — present for contract symmetry with a future
  // scraped/catalogue product source, always "unknown".
  price: ProductFact<number>;
  title: ProductFact<string>;
  description: ProductFact<string>;
}

function known<T>(value: T | null | undefined, provenance: FactProvenance): ProductFact<T> {
  const isEmpty =
    value === null ||
    value === undefined ||
    (typeof value === "string" && value.trim() === "") ||
    (Array.isArray(value) && value.length === 0);
  if (isEmpty) {
    return { value: null, status: "unknown", provenance: "not-provided" };
  }
  return { value: value as T, status: "known", provenance };
}

function inferred<T>(value: T | null | undefined): ProductFact<T> {
  if (value === null || value === undefined || value === "null") {
    return { value: null, status: "unknown", provenance: "vision-model" };
  }
  return { value: value as T, status: "inferred", provenance: "vision-model" };
}

function notProvided<T>(): ProductFact<T> {
  return { value: null, status: "unknown", provenance: "not-provided" };
}

/**
 * Facts available at submit time, before any model call — the customer's own
 * declared input. Nothing here is inferred; everything is either known or
 * explicitly absent.
 */
export function normalizeDeclaredFacts(input: {
  category?: string | null;
  color?: string[] | null;
  brand?: string | null;
  size?: string | null;
}): Pick<ProductFacts, "category" | "declaredColor" | "brand" | "size"> {
  return {
    category: known(input.category?.trim() || null, "customer-declared"),
    declaredColor: known(
      Array.isArray(input.color) ? input.color.filter(c => typeof c === "string" && c.trim()) : null,
      "customer-declared",
    ),
    brand: known(input.brand?.trim() || null, "customer-declared"),
    size: known(input.size?.trim() || null, "customer-declared"),
  };
}

/**
 * Raw shape of the `productSnapshot` block the vision model returns. Kept
 * loose/untyped at the boundary since it is parsed from model JSON — merge
 * is where it gets validated into typed facts.
 */
export interface RawProductSnapshot {
  observedSilhouette?: string | null;
  observedFitProfile?: string | null;
  observedFormality?: string | null;
  observedSleeveLength?: string | null;
  observedNecklineCoverage?: string | null;
  observedShoulderCoverage?: boolean | null;
  observedMidriffExposed?: boolean | null;
  observedMaterial?: string | null;
  observedPattern?: string | null;
  observationConfidence?: string | null;
}

const VALID_CONFIDENCE = new Set(["high", "medium", "low"]);

/**
 * Merges the customer-declared facts with the vision model's own stated
 * observations (itemType, detectedColor, productSnapshot) from a completed
 * analysis response. Every inferred value is traced back to the model's
 * output verbatim — this function does not re-derive or guess anything the
 * model didn't already state.
 */
export function mergeVisionFacts(
  declared: Pick<ProductFacts, "category" | "declaredColor" | "brand" | "size">,
  vision: {
    itemType?: string | null;
    detectedColor?: string | null;
    productSnapshot?: RawProductSnapshot | null;
  },
): ProductFacts {
  const snap = vision.productSnapshot ?? {};
  const confidence: ObservationConfidence = VALID_CONFIDENCE.has(String(snap.observationConfidence ?? "").split(" ")[0])
    ? (String(snap.observationConfidence).split(" ")[0] as ObservationConfidence)
    : null;

  return {
    ...declared,
    itemType: inferred(vision.itemType),
    detectedColor: inferred(vision.detectedColor),
    silhouette: inferred(snap.observedSilhouette),
    fitProfile: inferred(snap.observedFitProfile),
    formality: inferred(snap.observedFormality),
    sleeveLength: inferred(snap.observedSleeveLength),
    necklineCoverage: inferred(snap.observedNecklineCoverage),
    shoulderCoverage: inferred(typeof snap.observedShoulderCoverage === "boolean" ? snap.observedShoulderCoverage : null),
    midriffExposed: inferred(typeof snap.observedMidriffExposed === "boolean" ? snap.observedMidriffExposed : null),
    material: inferred(snap.observedMaterial),
    pattern: inferred(snap.observedPattern),
    observationConfidence: confidence,
    price: notProvided(),
    title: notProvided(),
    description: notProvided(),
  };
}
