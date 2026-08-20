import { getRecommendationEligibleProducts } from "~/lib/ai/naia-catalog";
import type { GeneratedCatalogProduct } from "~/lib/ai/naia-catalog.types";
import type { TrendReportData } from "~/lib/trend-reports";
import type { ShopperEvidenceBundle, ShopperEdit } from "~/lib/trend-evidence.server";
import { resolveVerifiedMedia } from "~/lib/ai/naia-product-media";

export type NadineProductRecommendation = {
  handle: string;
  title: string;
  url: string | null;
  imageUrl: string | null;
  gapCategory: string;
  personalExplanation: string;
};

// Catalog item type → closet category used in gap detection
const ITEM_TYPE_TO_CLOSET_CATEGORY: Record<string, string> = {
  TOP: "TOPS",
  BOTTOM: "BOTTOMS",
  OUTERWEAR: "OUTERWEAR",
  DRESS: "DRESSES",
  SET: "DRESSES",
};

// Categories NADINE products can fill per trend slug.
// Colour Direction excluded: no BAGS/SHOES/ACCESSORIES in the catalog.
const SLUG_GAP_CATEGORIES: Record<string, string[]> = {
  "spring-2026-soft-structure": ["OUTERWEAR", "DRESSES", "BOTTOMS"],
  "modern-tailoring-spring-2026": ["OUTERWEAR", "BOTTOMS"],
  "spring-2026-colour-direction": [],
};

const MIN_SCORE = 2;

function scoreProduct(
  product: GeneratedCatalogProduct,
  evidence: ShopperEvidenceBundle,
): number {
  const profile = evidence.profile;
  if (!profile) return 0;

  let score = 0;

  for (const feeling of profile.desiredFeelings) {
    if (product.parsed.rankings.desiredFeelingMatch.includes(feeling)) score += 3;
  }
  for (const personality of profile.stylePersonalities) {
    if (product.parsed.rankings.stylePersonalityMatch.includes(personality)) score += 2;
  }
  for (const avoidColor of profile.avoidColors) {
    const lc = avoidColor.toLowerCase();
    if (product.parsed.identity.colors.some((c) => c.toLowerCase().includes(lc))) score -= 5;
  }
  for (const favColor of profile.favoriteColors) {
    const lc = favColor.toLowerCase();
    if (product.parsed.identity.colors.some((c) => c.toLowerCase().includes(lc))) score += 2;
  }

  return score;
}

function buildExplanation(
  product: GeneratedCatalogProduct,
  evidence: ShopperEvidenceBundle,
  edit: ShopperEdit,
  report: TrendReportData,
): string {
  // For Modern Tailoring: when closet evidence is a TOP, it is the softer
  // counterpart — not the tailored anchor. Make that role gap explicit.
  if (
    report.slug === "modern-tailoring-spring-2026" &&
    edit.evidenceClosetItems.length > 0 &&
    edit.evidenceClosetItems[0].category === "TOPS"
  ) {
    const topName = edit.evidenceClosetItems[0].name.toLowerCase();
    const productTitle = product.parsed.identity.verifiedTitle;
    return `Your ${topName} already gives you the softer, expressive side of this direction. ${productTitle} adds the tailored anchor that is missing, giving that drape a sharper counterpoint.`;
  }

  const parts: string[] = [];

  const rawRole = product.parsed.prose.stylingRole;
  if (rawRole) parts.push(rawRole.split(";")[0].trim());

  if (edit.evidenceClosetItems.length > 0) {
    parts.push(`Works with your ${edit.evidenceClosetItems[0].name.toLowerCase()}`);
  }

  const profile = evidence.profile;
  if (profile) {
    const matchedPersonalities = product.parsed.rankings.stylePersonalityMatch.filter((p) =>
      profile.stylePersonalities.includes(p),
    );
    if (matchedPersonalities.length > 0) {
      parts.push(`Sits in your ${matchedPersonalities[0].replace(/-/g, " ")} register`);
    } else {
      const matchedFeelings = product.parsed.rankings.desiredFeelingMatch.filter((f) =>
        profile.desiredFeelings.includes(f),
      );
      if (matchedFeelings.length > 0) {
        parts.push(`Speaks to your goal of feeling ${matchedFeelings[0].replace(/^more-/, "")}`);
      }
    }
  }

  return parts.join(". ") + (parts.length > 0 ? "." : "");
}

/**
 * Returns a single NADINE product recommendation for My Trend Edits, or null.
 *
 * Returns null when:
 *   - Outcome C (worthInvestingStatement present — closet already covers the trend)
 *   - No passport profile to personalise against
 *   - No NADINE products fill a genuine gap with sufficient evidence match
 */
export function matchNadineProduct(
  report: TrendReportData,
  evidence: ShopperEvidenceBundle,
  edit: ShopperEdit,
): NadineProductRecommendation | null {
  if (edit.worthInvestingStatement !== null) return null;
  if (!evidence.profile) return null;

  const gapCategories = SLUG_GAP_CATEGORIES[report.slug] ?? [];
  if (gapCategories.length === 0) return null;

  const coveredSet = new Set(edit.coveredClosetCategories);
  const gaps = gapCategories.filter((cat) => !coveredSet.has(cat));
  if (gaps.length === 0) return null;

  const candidates = getRecommendationEligibleProducts()
    .flatMap((product) => {
      const closetCat =
        ITEM_TYPE_TO_CLOSET_CATEGORY[product.parsed.identity.itemType];
      if (!closetCat || !gaps.includes(closetCat)) return [];
      const score = scoreProduct(product, evidence);
      if (score < MIN_SCORE) return [];
      return [{ product, closetCat, score }];
    });

  if (candidates.length === 0) return null;

  candidates.sort((a, b) =>
    b.score !== a.score
      ? b.score - a.score
      : gaps.indexOf(a.closetCat) - gaps.indexOf(b.closetCat),
  );

  const { product, closetCat } = candidates[0];
  const { verifiedTitle, liveUrl } = product.parsed.identity;

  const mediaEntry = resolveVerifiedMedia(product.handle);
  const imageUrl = mediaEntry?.eligibility === "ready" ? (mediaEntry.resolvedUrl ?? null) : null;

  return {
    handle: product.handle,
    title: verifiedTitle,
    url: liveUrl,
    imageUrl,
    gapCategory: closetCat,
    personalExplanation: buildExplanation(product, evidence, edit, report),
  };
}
