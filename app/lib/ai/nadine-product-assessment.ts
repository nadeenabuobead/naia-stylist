// app/lib/ai/nadine-product-assessment.ts
// Phase 4A4 — Deterministic NADINE product-page intelligence engine.
// No external API calls. No Prisma mutations. No randomness.
// Same inputs always produce the same verdict.

import {
  NAIA_VERIFIED_MEDIA_MAP,
  NAIA_COMPONENT_MEDIA_MAP,
  VIRTUAL_TRY_ON_ENABLED,
} from "./naia-product-media.js";
import { getProductByHandle } from "./naia-catalog.js";
import type { TryOnEligibility } from "./naia-product-media.js";
import type {
  AssessmentCaveat,
  AssessmentResult,
  AssessmentSignals,
  AssessmentVerdict,
  ClosetItemSummary,
  CustomerAssessmentProfile,
  ProductComponentView,
  ProductPageError,
  ProductPageIntelligence,
  ProductPageResponse,
  ResolvedProduct,
  TryOnState,
  TryOnStatus,
} from "./nadine-product-assessment.types.js";

// ── GID reverse map (built once at module load) ────────────────────────────────
// Maps "gid://shopify/Product/<numericId>" → V8 handle.
// Used to resolve a Shopify product page context without trusting browser title/handle.

const GID_TO_HANDLE = new Map<string, string>();
for (const [handle, entry] of NAIA_VERIFIED_MEDIA_MAP) {
  if (entry.shopifyProductGid) {
    GID_TO_HANDLE.set(entry.shopifyProductGid, handle);
  }
}

// ── Category compatibility table ──────────────────────────────────────────────
// itemType (catalog) → closet categories that pair well with it.

const ITEM_TYPE_PAIRS: Record<string, string[]> = {
  TOP: ["bottom", "outerwear"],
  BOTTOM: ["top", "outerwear"],
  OUTERWEAR: ["top", "bottom", "dress"],
  DRESS: ["outerwear"],
  SET: ["outerwear"],
};

// ── Product resolution ────────────────────────────────────────────────────────

/**
 * Resolves a Shopify numeric product ID to a verified NADINE product record.
 * Returns null for any ID not in the Phase 4A3 verified map — fails closed.
 * The numeric ID comes from Liquid's {{ product.id }} — never from browser title.
 */
export function resolveProductByGid(shopifyNumericId: string): ResolvedProduct | null {
  if (!shopifyNumericId || !/^\d+$/.test(shopifyNumericId)) return null;

  const fullGid = `gid://shopify/Product/${shopifyNumericId}`;
  const handle = GID_TO_HANDLE.get(fullGid);
  if (!handle) return null;

  const mediaEntry = NAIA_VERIFIED_MEDIA_MAP.get(handle);
  const catalogProduct = getProductByHandle(handle);
  if (!mediaEntry || !catalogProduct) return null;

  const p = catalogProduct.parsed;
  return {
    v8Handle: handle,
    nadinaTitle: p.identity.verifiedTitle,
    shopifyHandle: mediaEntry.shopifyHandle,
    itemType: p.identity.itemType,
    colors: p.identity.colors,
    formalityScore: p.scalars.formalityScore,
    formalityDescription: p.prose.formalityDescription,
    stylingRole: p.prose.stylingRole,
    occasionTags: p.rankings.occasionTags,
    notIdealFor: p.prose.notIdealFor,
    desiredFeelingMatch: p.rankings.desiredFeelingMatch,
    stylePersonalityMatch: p.rankings.stylePersonalityMatch,
    colorDirection: p.prose.colorDirection,
    coverageModesty: p.prose.coverageModesty,
    bodyFitLogic: p.prose.bodyFitLogic,
    avoidPairingWithNadinePieces: p.pairings.avoidPairingWithNadinePieces,
    mediaEligibility: mediaEntry.eligibility,
    hasVerifiedMedia: mediaEntry.eligibility === "ready",
  };
}

// ── Component resolution ──────────────────────────────────────────────────────

/**
 * Returns component views for a product handle (non-empty only for double-top
 * and dress-set). Components are never marked soldSeparately.
 */
export function getProductComponents(v8Handle: string): ProductComponentView[] {
  const views: ProductComponentView[] = [];
  for (const [componentHandle, entry] of NAIA_COMPONENT_MEDIA_MAP) {
    if (entry.parentCatalogHandle !== v8Handle) continue;
    views.push({
      componentHandle,
      componentName: entry.componentName,
      tryOnState: computeComponentTryOnState(entry.eligibility),
      soldSeparately: false,
    });
  }
  return views;
}

function computeComponentTryOnState(eligibility: TryOnEligibility): TryOnState {
  if (VIRTUAL_TRY_ON_ENABLED) return eligibility === "ready" ? "coming-soon" : "needs-testing";
  // Global gate is off — all components are coming-soon or needs-testing, never active.
  if (eligibility === "needs-manual-review") return "needs-testing";
  if (eligibility === "ready") return "coming-soon";
  return "unavailable";
}

// ── Try-on status ─────────────────────────────────────────────────────────────

export function computeTryOnStatus(
  mediaEligibility: TryOnEligibility,
  hasModel: boolean,
): TryOnStatus {
  // Global gate always off in Phase 4A4.
  if (!VIRTUAL_TRY_ON_ENABLED) {
    if (mediaEligibility === "ready") {
      if (!hasModel) {
        return {
          state: "no-model",
          label: "Set up My nAia Model",
          sublabel: "Create your model to unlock virtual try-on",
        };
      }
      return {
        state: "coming-soon",
        label: "Virtual try-on coming in the next step",
        sublabel: "We're preparing this feature",
      };
    }
    if (mediaEligibility === "needs-manual-review") {
      return {
        state: "needs-testing",
        label: "Not available for this piece yet",
        sublabel: "Provider testing in progress",
      };
    }
    return {
      state: "unavailable",
      label: "Not available",
      sublabel: "",
    };
  }
  // VIRTUAL_TRY_ON_ENABLED = true path intentionally left minimal — gated until Phase 4A5.
  return { state: "coming-soon", label: "Coming soon", sublabel: "" };
}

// ── Evidence sufficiency ──────────────────────────────────────────────────────

function countSignalDimensions(profile: CustomerAssessmentProfile): number {
  let count = 0;
  if (profile.stylePersonalities.length > 0) count++;
  if (profile.desiredFeeling) count++;
  if (profile.dressesFor.length > 0) count++;
  if (profile.favoriteColors.length > 0 || profile.avoidColors.length > 0) count++;
  if (profile.fitPreferences.length > 0) count++;
  if (profile.lifestyle) count++;
  return count;
}

// ── Color helpers ─────────────────────────────────────────────────────────────

function normalizeColor(s: string): string {
  return s.toLowerCase().trim();
}

function findColorOverlap(customerColors: string[], productColors: string[]): string[] {
  const conflicts: string[] = [];
  for (const avoid of customerColors) {
    const a = normalizeColor(avoid);
    for (const pc of productColors) {
      if (normalizeColor(pc).includes(a) || a.includes(normalizeColor(pc))) {
        if (!conflicts.includes(avoid)) conflicts.push(avoid);
      }
    }
  }
  return conflicts;
}

// ── notIdealFor heuristic ─────────────────────────────────────────────────────
// Keyword-based; deterministic. Returns a caveat string or null.

function checkNotIdealFor(notIdealFor: string, profile: CustomerAssessmentProfile): string | null {
  const nif = notIdealFor.toLowerCase();

  // Coverage conflict: customer wants full coverage, product is cropped/revealing.
  const wantsCoverage = profile.fitPreferences.some(
    (p) => p.toLowerCase().includes("coverage") || p.toLowerCase().includes("modest"),
  );
  if (wantsCoverage && (nif.includes("coverage") || nif.includes("waist"))) {
    return "Coverage or waist preferences may not align with this piece's cut";
  }

  // Relaxed lifestyle vs structured/formal piece.
  const isRelaxed =
    profile.lifestyle?.toLowerCase() === "casual" ||
    profile.fitPreferences.some(
      (p) => p.toLowerCase().includes("loose") || p.toLowerCase().includes("oversized"),
    );
  if (isRelaxed && (nif.includes("relaxed") || nif.includes("oversized"))) {
    return "Your styling preferences lean relaxed — this piece is more structured";
  }

  // Conservative work context.
  const dressesFors = profile.dressesFor.map((d) => d.toLowerCase());
  const isConservativeWork = dressesFors.some(
    (d) => d.includes("office") || d.includes("work") || d.includes("corporate"),
  );
  if (isConservativeWork && nif.includes("conservative work")) {
    return "This piece may not suit a conservative office environment";
  }

  return null;
}

// ── Closet compatibility ──────────────────────────────────────────────────────

export function computeClosetCompatibility(
  itemType: string,
  closetItems: ClosetItemSummary[],
): ClosetItemSummary[] {
  const compatibleCategories = ITEM_TYPE_PAIRS[itemType] ?? [];
  return closetItems.filter((item) => compatibleCategories.includes(item.category));
}

function hasSimilarItemInCloset(
  itemType: string,
  closetItems: ClosetItemSummary[],
): boolean {
  // Map itemType to a closet category to detect duplication.
  const ownCategory: Record<string, string> = {
    TOP: "top",
    BOTTOM: "bottom",
    OUTERWEAR: "outerwear",
    DRESS: "dress",
    SET: "dress",
  };
  const cat = ownCategory[itemType];
  if (!cat) return false;
  return closetItems.some((item) => item.category === cat);
}

// ── Core assessment engine ────────────────────────────────────────────────────

export function assessProduct(
  product: ResolvedProduct,
  profile: CustomerAssessmentProfile | null,
  closetItems: ClosetItemSummary[],
): AssessmentResult {
  const now = new Date().toISOString();

  // Guests and null profiles always return insufficient-evidence.
  if (!profile) {
    return insufficientResult("Sign in to see a personalised assessment", now);
  }

  const signalCount = countSignalDimensions(profile);
  if (signalCount < 2) {
    return insufficientResult(
      "Complete more of your style profile to get a personalised assessment",
      now,
    );
  }

  let score = 0;
  const positiveEvidence: string[] = [];
  const caveats: AssessmentCaveat[] = [];
  const signals: AssessmentSignals = {
    stylePersonalityOverlap: [],
    desiredFeelingOverlap: [],
    occasionOverlap: [],
    avoidColorConflict: [],
    notIdealForMatched: false,
    duplicateRisk: false,
    wardrobeGapFilled: false,
    closetCompatibilityCount: 0,
    sufficientEvidence: true,
  };

  // ── Style personality ───────────────────────────────────────────────────────
  if (profile.stylePersonalities.length > 0 && product.stylePersonalityMatch.length > 0) {
    const profileSet = new Set(profile.stylePersonalities.map((s) => s.toLowerCase()));
    const overlap = product.stylePersonalityMatch.filter((m) => profileSet.has(m.toLowerCase()));
    signals.stylePersonalityOverlap = overlap;
    if (overlap.length > 0) {
      score += 3;
      positiveEvidence.push("Aligns with your style personality");
    } else {
      score -= 1;
      caveats.push({
        code: "style-direction-mismatch",
        text: "This piece leans in a different style direction from your profile",
      });
    }
  }

  // ── Desired feeling ─────────────────────────────────────────────────────────
  if (profile.desiredFeeling && product.desiredFeelingMatch.length > 0) {
    const wantedFeelings = profile.desiredFeeling
      .toLowerCase()
      .split(/[,;]/)
      .map((s) => s.trim())
      .filter(Boolean);
    const overlap = product.desiredFeelingMatch.filter((m) =>
      wantedFeelings.some(
        (w) => m.toLowerCase().includes(w) || w.includes(m.toLowerCase()),
      ),
    );
    signals.desiredFeelingOverlap = overlap;
    if (overlap.length > 0) {
      score += 2;
      positiveEvidence.push("Supports the feeling you're going for");
    }
  }

  // ── Occasion fit ────────────────────────────────────────────────────────────
  if (profile.dressesFor.length > 0 && product.occasionTags.length > 0) {
    const dressFors = new Set(profile.dressesFor.map((d) => d.toLowerCase()));
    const overlap = product.occasionTags.filter((t) => {
      const tl = t.toLowerCase();
      return (
        dressFors.has(tl) ||
        Array.from(dressFors).some((d) => tl.includes(d) || d.includes(tl))
      );
    });
    signals.occasionOverlap = overlap;
    if (overlap.length > 0) {
      score += 2;
      positiveEvidence.push(`Works for ${overlap.slice(0, 2).join(" and ")} occasions`);
    }
  }

  // ── Avoid-color conflict (strong negative) ──────────────────────────────────
  if (profile.avoidColors.length > 0) {
    const conflict = findColorOverlap(profile.avoidColors, product.colors);
    signals.avoidColorConflict = conflict;
    if (conflict.length > 0) {
      score -= 3;
      caveats.push({
        code: "avoid-color-conflict",
        text: `Contains colours you prefer to avoid: ${conflict.slice(0, 2).join(", ")}`,
      });
    }
  }

  // ── notIdealFor heuristic ───────────────────────────────────────────────────
  if (product.notIdealFor) {
    const caveatText = checkNotIdealFor(product.notIdealFor, profile);
    if (caveatText) {
      signals.notIdealForMatched = true;
      score -= 2;
      caveats.push({ code: "not-ideal-for-lifestyle", text: caveatText });
    }
  }

  // ── Closet compatibility ────────────────────────────────────────────────────
  const compatible = computeClosetCompatibility(product.itemType, closetItems);
  signals.closetCompatibilityCount = compatible.length;
  if (compatible.length > 0) {
    score += Math.min(compatible.length, 2);
    positiveEvidence.push(
      `${compatible.length} piece${compatible.length === 1 ? "" : "s"} in your wardrobe would pair with this`,
    );
  }

  // ── Duplication risk ────────────────────────────────────────────────────────
  if (closetItems.length > 0) {
    const duplicate = hasSimilarItemInCloset(product.itemType, closetItems);
    signals.duplicateRisk = duplicate;
    if (duplicate) {
      score -= 1;
      caveats.push({
        code: "duplicate-risk",
        text: "You may already own something in a similar category",
      });
    }

    // ── Wardrobe gap ──────────────────────────────────────────────────────────
    if (compatible.length > 0 && !duplicate) {
      signals.wardrobeGapFilled = true;
      score += 1;
      positiveEvidence.push("Fills a gap in your current wardrobe");
    }
  }

  // ── Verdict ─────────────────────────────────────────────────────────────────
  const hasStrongNegative =
    signals.avoidColorConflict.length > 0 || (signals.notIdealForMatched && score <= 0);

  let verdict: AssessmentVerdict;
  if (hasStrongNegative || score <= -2) {
    verdict = "not-best-addition";
  } else if (score >= 4 && caveats.length === 0) {
    verdict = "strong-match";
  } else {
    verdict = "good-match-with-caveat";
  }

  const explanation = buildExplanation(verdict, product, positiveEvidence, caveats);

  return {
    verdict,
    explanation,
    positiveEvidence,
    caveats,
    signals,
    schemaVersion: 1,
    assessedAt: now,
  };
}

function insufficientResult(explanation: string, assessedAt: string): AssessmentResult {
  return {
    verdict: "insufficient-evidence",
    explanation,
    positiveEvidence: [],
    caveats: [{ code: "incomplete-profile", text: explanation }],
    signals: {
      stylePersonalityOverlap: [],
      desiredFeelingOverlap: [],
      occasionOverlap: [],
      avoidColorConflict: [],
      notIdealForMatched: false,
      duplicateRisk: false,
      wardrobeGapFilled: false,
      closetCompatibilityCount: 0,
      sufficientEvidence: false,
    },
    schemaVersion: 1,
    assessedAt,
  };
}

function buildExplanation(
  verdict: AssessmentVerdict,
  product: ResolvedProduct,
  positiveEvidence: string[],
  caveats: AssessmentCaveat[],
): string {
  switch (verdict) {
    case "strong-match":
      return `${product.nadinaTitle} aligns closely with your style profile${positiveEvidence.length > 0 ? " — " + positiveEvidence[0].toLowerCase() : ""}.`;
    case "good-match-with-caveat":
      return caveats.length > 0
        ? `${product.nadinaTitle} has real potential for your wardrobe, with one thing to consider.`
        : `${product.nadinaTitle} shows good alignment with your profile.`;
    case "not-best-addition":
      return `Based on your profile, this may not be the strongest addition right now.`;
    case "insufficient-evidence":
      return "Not enough profile information to give a meaningful assessment.";
  }
}

// ── Full page response builder ────────────────────────────────────────────────

export function buildProductPageResponse(
  shopifyNumericId: string,
  profile: CustomerAssessmentProfile | null,
  closetItems: ClosetItemSummary[],
  hasModel: boolean,
): ProductPageResponse {
  const product = resolveProductByGid(shopifyNumericId);
  if (!product) {
    return { resolved: false, reason: "unknown-product" };
  }

  const assessment = assessProduct(product, profile, closetItems);
  const tryOnStatus = computeTryOnStatus(product.mediaEligibility, hasModel);
  const components = getProductComponents(product.v8Handle);

  const response: ProductPageIntelligence = {
    resolved: true,
    v8Handle: product.v8Handle,
    nadinaTitle: product.nadinaTitle,
    stylingRole: product.stylingRole,
    occasionTags: product.occasionTags,
    formalityDescription: product.formalityDescription,
    components,
    assessment: profile ? assessment : null,
    tryOnStatus,
    wardrobeCompatibilityCount: profile
      ? computeClosetCompatibility(product.itemType, closetItems).length
      : null,
    schemaVersion: 1,
  };

  return response;
}
