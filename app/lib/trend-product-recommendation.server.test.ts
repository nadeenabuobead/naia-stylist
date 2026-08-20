import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("~/lib/ai/naia-catalog", () => ({
  getRecommendationEligibleProducts: vi.fn(() => []),
}));

import { getRecommendationEligibleProducts } from "~/lib/ai/naia-catalog";
import { matchNadineProduct } from "./trend-product-recommendation.server";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeReport(slug: string) {
  return {
    slug,
    title: "Test Report",
    season: "Spring 2026",
    summary: "Summary",
    published: true,
    publishedAt: "2026-06-01",
  } as any;
}

function makeProfile(overrides: Partial<{
  stylePersonalities: string[];
  favoriteColors: string[];
  avoidColors: string[];
  lifestyle: string[] | null;
  desiredFeeling: string | null;
  desiredFeelings: string[];
  desiredImpression: string[];
  fitPreferences: string[];
  becoming: string[];
  styleSupport: string[];
}> = {}) {
  return {
    stylePersonalities: ["artsy", "edgy"],
    favoriteColors: [],
    avoidColors: [],
    lifestyle: null,
    desiredFeeling: null,
    desiredFeelings: ["more-confident", "more-elevated"],
    desiredImpression: [],
    fitPreferences: [],
    becoming: [],
    styleSupport: [],
    ...overrides,
  };
}

function makeEvidence(profile: ReturnType<typeof makeProfile> | null = makeProfile()) {
  return {
    hasProfile: profile !== null,
    profile,
    closetItems: [],
    reviewSignal: { reviewCount: 0, workedTags: [], didntWorkTags: [] },
  } as any;
}

function makeEdit(overrides: {
  worthInvestingStatement?: string | null;
  coveredClosetCategories?: string[];
  evidenceClosetItems?: Array<{ name: string; imageUrl: string | null; category: string; roleNote: string }>;
} = {}) {
  return {
    subTitle: "Sub",
    yourVersion: "Your version",
    evidenceStyleDna: null,
    evidencePassportSays: null,
    evidenceClosetItems: [],
    evidenceReviews: null,
    lowDataNotice: null,
    yourBestRouteIn: "Route",
    aLookToTry: "Look",
    theBalanceToProtect: "Balance",
    partToTake: ["Take A", "Take B"],
    worthInvestingStatement: null,
    coveredClosetCategories: [],
    partToLeave: ["Leave A"],
    ...overrides,
  } as any;
}

function makeCatalogProduct(overrides: {
  handle?: string;
  itemType?: string;
  liveUrl?: string | null;
  desiredFeelingMatch?: string[];
  stylePersonalityMatch?: string[];
  colors?: string[];
  stylingRole?: string;
} = {}) {
  return {
    handle: overrides.handle ?? "trench-coat",
    eligibility: "unverified",
    sourceFields: {},
    parsed: {
      identity: {
        verifiedTitle: "Becoming Seen",
        liveUrl: "liveUrl" in overrides ? overrides.liveUrl : "https://naiabynadine.com/products/trench-coat",
        featuredImageUrl: null,
        itemType: overrides.itemType ?? "OUTERWEAR",
        colors: overrides.colors ?? ["Caramel", "beige"],
      },
      rankings: {
        desiredFeelingMatch: overrides.desiredFeelingMatch ?? ["more-confident", "more-elevated"],
        stylePersonalityMatch: overrides.stylePersonalityMatch ?? ["artsy", "edgy"],
        styleTags: [],
        occasionTags: [],
        season: [],
        bodyProportionEffects: [],
        styleMeComfortMatch: [],
        currentEmotionalStateSupport: [],
        practicalSupportMatch: [],
      },
      scalars: { formalityScore: 4.0, stylingEffortLevel: "medium" },
      prose: {
        stylingRole: overrides.stylingRole ?? "Statement outer layer; polished outfit finisher",
        productStyleDescriptors: [],
        formalityDescription: "",
        bodyFitLogic: "",
        coverageModesty: "",
        proportionRule: "",
        notIdealFor: "",
        emotionalSupportLogic: "",
        practicalSupportLogic: "",
        pairingReason: "",
        accessoriesDirection: "",
        shoeDirection: "",
        colorDirection: "",
        skinToneColourHarmony: "",
        complexionStylingNote: "",
        hairStylingDirection: [],
        hairStylingNote: "",
        styleMeExplanation: "",
      },
      pairings: {
        bestPairedWithNadinePieces: null,
        conditionalNadinePairings: null,
        avoidPairingWithNadinePieces: null,
        bestPairedWithGeneral: "",
        avoidPairingWithGeneral: "",
      },
    },
  } as any;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("matchNadineProduct", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getRecommendationEligibleProducts).mockReturnValue([]);
  });

  // ── Outcome C: no recommendation when closet covers the trend ──────────────

  it("returns null when worthInvestingStatement is present (Outcome C)", () => {
    const result = matchNadineProduct(
      makeReport("modern-tailoring-spring-2026"),
      makeEvidence(),
      makeEdit({ worthInvestingStatement: "You do not need to buy anything." }),
    );
    expect(result).toBeNull();
  });

  // ── No profile: cannot personalise ────────────────────────────────────────

  it("returns null when profile is null", () => {
    const result = matchNadineProduct(
      makeReport("modern-tailoring-spring-2026"),
      makeEvidence(null),
      makeEdit(),
    );
    expect(result).toBeNull();
  });

  // ── Colour Direction: no NADINE accessories → always null ─────────────────

  it("returns null for colour-direction (no NADINE accessories)", () => {
    const result = matchNadineProduct(
      makeReport("spring-2026-colour-direction"),
      makeEvidence(),
      makeEdit(),
    );
    expect(result).toBeNull();
  });

  // ── Outcome B: no gap → null ──────────────────────────────────────────────

  it("returns null when shopper already covers all trend gap categories", () => {
    const result = matchNadineProduct(
      makeReport("modern-tailoring-spring-2026"),
      makeEvidence(),
      makeEdit({ coveredClosetCategories: ["OUTERWEAR", "BOTTOMS"] }),
    );
    expect(result).toBeNull();
  });

  // ── Weak product rejected: score below threshold ──────────────────────────

  it("returns null when no product meets the minimum score threshold", () => {
    vi.mocked(getRecommendationEligibleProducts).mockReturnValueOnce([
      makeCatalogProduct({
        desiredFeelingMatch: ["more-feminine"], // no overlap with profile (more-confident/more-elevated)
        stylePersonalityMatch: ["feminine"],    // no overlap with profile (artsy/edgy)
      }),
    ]);
    const result = matchNadineProduct(
      makeReport("modern-tailoring-spring-2026"),
      makeEvidence(),
      makeEdit(),
    );
    expect(result).toBeNull();
  });

  // ── Outcome A: gap + strong match → recommendation returned ──────────────

  it("returns recommendation when gap exists and product scores ≥ threshold", () => {
    vi.mocked(getRecommendationEligibleProducts).mockReturnValueOnce([
      makeCatalogProduct({
        handle: "trench-coat",
        itemType: "OUTERWEAR",
        liveUrl: "https://naiabynadine.com/products/trench-coat",
        desiredFeelingMatch: ["more-confident", "more-elevated"],
        stylePersonalityMatch: ["artsy", "edgy"],
        stylingRole: "Statement outer layer; polished outfit finisher",
      }),
    ]);

    const result = matchNadineProduct(
      makeReport("modern-tailoring-spring-2026"),
      makeEvidence(makeProfile({
        desiredFeelings: ["more-confident", "more-elevated"],
        stylePersonalities: ["artsy"],
      })),
      makeEdit({ coveredClosetCategories: [] }),
    );

    expect(result).not.toBeNull();
    expect(result!.handle).toBe("trench-coat");
    expect(result!.title).toBe("Becoming Seen");
    expect(result!.url).toBe("https://naiabynadine.com/products/trench-coat");
    expect(result!.gapCategory).toBe("OUTERWEAR");
    expect(result!.personalExplanation.length).toBeGreaterThan(0);
  });

  // ── Avoid color conflict drops score ──────────────────────────────────────

  it("returns null when avoid-color conflict drives score below threshold", () => {
    vi.mocked(getRecommendationEligibleProducts).mockReturnValueOnce([
      makeCatalogProduct({
        itemType: "OUTERWEAR",
        colors: ["Caramel", "beige"],
        desiredFeelingMatch: ["more-confident"], // +3 → net: 3 - 5 = -2
        stylePersonalityMatch: [],
      }),
    ]);
    const result = matchNadineProduct(
      makeReport("modern-tailoring-spring-2026"),
      makeEvidence(makeProfile({
        desiredFeelings: ["more-confident"],
        stylePersonalities: [],
        avoidColors: ["caramel"],
      })),
      makeEdit(),
    );
    expect(result).toBeNull();
  });

  // ── Soft structure: DRESS gap filled by DRESS product ─────────────────────

  it("recommends a DRESS product for soft-structure DRESSES gap", () => {
    vi.mocked(getRecommendationEligibleProducts).mockReturnValueOnce([
      makeCatalogProduct({
        handle: "midi-dress",
        itemType: "DRESS",
        liveUrl: null,
        desiredFeelingMatch: ["more-confident", "more-elevated"],
        stylePersonalityMatch: ["artsy"],
        stylingRole: "Fluid midi dress; single-layer soft structure",
      }),
    ]);

    const result = matchNadineProduct(
      makeReport("spring-2026-soft-structure"),
      makeEvidence(makeProfile({
        desiredFeelings: ["more-elevated"],
        stylePersonalities: ["artsy"],
      })),
      makeEdit({ coveredClosetCategories: [] }),
    );

    expect(result).not.toBeNull();
    expect(result!.gapCategory).toBe("DRESSES");
    expect(result!.url).toBeNull();
  });

  // ── Explanation includes closet item name when present ────────────────────

  it("explanation mentions closet item when evidenceClosetItems is populated", () => {
    vi.mocked(getRecommendationEligibleProducts).mockReturnValueOnce([
      makeCatalogProduct({
        desiredFeelingMatch: ["more-confident"],
        stylePersonalityMatch: ["artsy"],
      }),
    ]);

    const result = matchNadineProduct(
      makeReport("modern-tailoring-spring-2026"),
      makeEvidence(makeProfile({
        desiredFeelings: ["more-confident"],
        stylePersonalities: ["artsy"],
      })),
      makeEdit({
        evidenceClosetItems: [
          { name: "Wide-leg Trousers", imageUrl: null, category: "BOTTOMS", roleNote: "trouser anchor" },
        ],
        coveredClosetCategories: [],
      }),
    );

    expect(result).not.toBeNull();
    expect(result!.personalExplanation).toContain("wide-leg trousers");
  });

  // ── Existing sections unaffected by Outcome C ─────────────────────────────

  it("does not call getRecommendationEligibleProducts when Outcome C", () => {
    matchNadineProduct(
      makeReport("modern-tailoring-spring-2026"),
      makeEvidence(),
      makeEdit({ worthInvestingStatement: "You are already covered." }),
    );
    expect(getRecommendationEligibleProducts).not.toHaveBeenCalled();
  });

  // ── SET treated as DRESSES for gap detection ──────────────────────────────

  it("treats SET item type as DRESSES gap", () => {
    vi.mocked(getRecommendationEligibleProducts).mockReturnValueOnce([
      makeCatalogProduct({
        handle: "dress-set",
        itemType: "SET",
        liveUrl: null,
        desiredFeelingMatch: ["more-elevated"],
        stylePersonalityMatch: ["artsy"],
        stylingRole: "Complete soft set; head-to-toe ease",
      }),
    ]);

    const result = matchNadineProduct(
      makeReport("spring-2026-soft-structure"),
      makeEvidence(makeProfile({
        desiredFeelings: ["more-elevated"],
        stylePersonalities: ["artsy"],
      })),
      makeEdit({ coveredClosetCategories: [] }),
    );

    expect(result).not.toBeNull();
    expect(result!.gapCategory).toBe("DRESSES");
  });

  // ── Highest scorer wins when multiple candidates ──────────────────────────

  it("returns highest-scoring candidate when multiple products qualify", () => {
    vi.mocked(getRecommendationEligibleProducts).mockReturnValueOnce([
      makeCatalogProduct({
        handle: "low-scorer",
        itemType: "OUTERWEAR",
        desiredFeelingMatch: ["more-confident"], // +3
        stylePersonalityMatch: [],
      }),
      makeCatalogProduct({
        handle: "high-scorer",
        itemType: "OUTERWEAR",
        desiredFeelingMatch: ["more-confident", "more-elevated"], // +6
        stylePersonalityMatch: ["artsy"],                         // +2 → total 8
      }),
    ]);

    const result = matchNadineProduct(
      makeReport("modern-tailoring-spring-2026"),
      makeEvidence(makeProfile({
        desiredFeelings: ["more-confident", "more-elevated"],
        stylePersonalities: ["artsy"],
      })),
      makeEdit(),
    );

    expect(result!.handle).toBe("high-scorer");
  });

  // ── Unknown slug: no gap categories → null ────────────────────────────────

  it("returns null for an unknown trend slug", () => {
    const result = matchNadineProduct(
      makeReport("future-trend-2027"),
      makeEvidence(),
      makeEdit(),
    );
    expect(result).toBeNull();
  });

  // ── Modern Tailoring TOPS explanation consistency ─────────────────────────

  it("Modern Tailoring + TOPS closet item: explanation names the top as softer side and the product as the anchor", () => {
    const mockProduct = {
      handle: "leather-suede-jacket",
      parsed: {
        identity: {
          itemType: "OUTERWEAR",
          verifiedTitle: "Becoming Clear",
          liveUrl: null,
          featuredImageUrl: null,
          colors: ["brown"],
        },
        rankings: {
          desiredFeelingMatch: ["more-confident"],
          stylePersonalityMatch: [],
        },
        prose: { stylingRole: "Structured statement jacket" },
      },
    } as any;

    vi.mocked(getRecommendationEligibleProducts).mockReturnValue([mockProduct]);

    const evidence = makeEvidence(makeProfile({ desiredFeelings: ["more-confident"] }));
    const edit = makeEdit({
      coveredClosetCategories: ["TOPS"],
      evidenceClosetItems: [
        { name: "Brown Top", imageUrl: null, category: "TOPS", roleNote: "softer counterpart" },
      ],
    });

    const result = matchNadineProduct(
      makeReport("modern-tailoring-spring-2026"),
      evidence,
      edit,
    );

    expect(result).not.toBeNull();
    // Explanation must reference the closet top's role (softer side)
    expect(result!.personalExplanation).toMatch(/brown top/i);
    expect(result!.personalExplanation).toMatch(/softer|expressive/i);
    // Explanation must name the product as adding the anchor
    expect(result!.personalExplanation).toMatch(/Becoming Clear/i);
    expect(result!.personalExplanation).toMatch(/tailored anchor/i);
    // Must NOT say "works with" (the old generic copy)
    expect(result!.personalExplanation).not.toMatch(/works with/i);
  });
});
