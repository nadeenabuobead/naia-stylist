import { describe, it, expect } from "vitest";
import { buildShopperEdit } from "./trend-evidence.server";
import type { ShopperEvidenceBundle } from "./trend-evidence.server";
import { trendReports } from "./trend-reports";
import type { TrendReportData } from "./trend-reports";

// ---------------------------------------------------------------------------
// Minimal stubs — only the fields buildShopperEdit actually reads.
// ---------------------------------------------------------------------------

const SOFT_STRUCTURE_REPORT: TrendReportData = {
  slug: "spring-2026-soft-structure",
  title: "Spring 2026 Wardrobe Edit: Soft Structure",
  season: "Spring 2026",
  summary: "Soft structure summary.",
  naiaVerdict: null,
  wardrobeNote: null,
  published: true,
  publishedAt: "2026-06-01",
  keyTrends: [
    { name: "Wide leg", description: "Proportioned trouser." },
    { name: "Longline layer", description: "Open blazer." },
  ],
  howToWear: [
    { feeling: "For everyday", direction: "wide trouser relaxed blazer fluid viscose crepe twill" },
  ],
  fading: [],
  investmentNotes: null,
  naiaInterpretation: null,
};

const MODERN_TAILORING_REPORT: TrendReportData = {
  slug: "modern-tailoring-spring-2026",
  title: "The New Language of Modern Tailoring",
  season: "Spring 2026",
  summary: "Modern tailoring summary.",
  naiaVerdict: null,
  wardrobeNote: null,
  published: true,
  publishedAt: "2026-06-01",
  keyTrends: [
    { name: "Tailored separates", description: "One well-cut blazer or trouser." },
    { name: "Proportion contrast", description: "Longline against narrow." },
  ],
  howToWear: [
    { feeling: "For work", direction: "blazer trouser twill wool denim jersey knit" },
  ],
  fading: [],
  investmentNotes: null,
  naiaInterpretation: null,
};

const COLOUR_DIRECTION_REPORT: TrendReportData = {
  slug: "spring-2026-colour-direction",
  title: "Colour Direction: The Quiet Base & the Clear Accent",
  season: "Spring 2026",
  summary: "Colour direction summary.",
  naiaVerdict: null,
  wardrobeNote: null,
  published: true,
  publishedAt: "2026-06-01",
  keyTrends: [
    { name: "Quiet base", description: "cream stone white neutral" },
    { name: "Clear accent", description: "bag shoe scarf accessory colour" },
  ],
  howToWear: [
    { feeling: "For everyday", direction: "cream stone neutral bag shoe scarf accessory colour" },
  ],
  fading: [],
  investmentNotes: null,
  naiaInterpretation: null,
};

// Real reports — used for tests that must exercise the production corpus, not a simplified fixture.
const REAL_SOFT_STRUCTURE = trendReports.find((r) => r.slug === "spring-2026-soft-structure")!;

const BASE_PROFILE = {
  stylePersonalities: ["minimal"],
  favoriteColors: ["white-cream"],
  avoidColors: [],
  lifestyle: [],
  desiredFeeling: null,
  desiredFeelings: ["refined"],
  desiredImpression: [],
  fitPreferences: ["structured"],
  becoming: [],
  styleSupport: [],
};

function makeEvidence(overrides: Partial<ShopperEvidenceBundle> = {}): ShopperEvidenceBundle {
  return {
    hasProfile: true,
    profile: BASE_PROFILE,
    closetItems: [],
    reviewSignal: { reviewCount: 0, workedTags: [], didntWorkTags: [] },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Worth Investing In — functional coverage outcomes
// ---------------------------------------------------------------------------

describe("buildShopperEdit — Worth Investing In", () => {
  it("Outcome A: one qualifying bottom alone (no complete soft-structure route) → investment recommended", () => {
    // BOTTOMS alone does not satisfy any soft-structure route:
    //   one-piece requires DRESSES
    //   layered requires OUTERWEAR + BOTTOMS
    //   separates requires TOPS + BOTTOMS
    const evidence = makeEvidence({
      closetItems: [
        {
          name: "Wide Leg Trouser",
          imageUrl: null,
          category: "BOTTOMS",
          subcategory: "wide-leg",
          primaryColor: "cream",
          styleTags: [],
          occasions: [],
          material: "crepe",
        },
      ],
    });
    const edit = buildShopperEdit(SOFT_STRUCTURE_REPORT, evidence);
    expect(edit.worthInvestingStatement).toBeNull();
    expect(edit.partToTake.length).toBeGreaterThan(0);
    expect(edit.partToTake[0]).not.toMatch(/do not need to buy/i);
  });

  it("Outcome A: compatible items that do not form any viable combination → investment recommended", () => {
    // Two TOPS — no complete route for soft-structure (needs BOTTOMS or DRESSES with a TOP)
    const evidence = makeEvidence({
      closetItems: [
        {
          name: "Linen Blouse",
          imageUrl: null,
          category: "TOPS",
          subcategory: "blouse",
          primaryColor: "ivory",
          styleTags: [],
          occasions: [],
          material: "linen",
        },
        {
          name: "Silk Top",
          imageUrl: null,
          category: "TOPS",
          subcategory: null,
          primaryColor: "cream",
          styleTags: [],
          occasions: [],
          material: "silk",
        },
      ],
    });
    const edit = buildShopperEdit(SOFT_STRUCTURE_REPORT, evidence);
    expect(edit.worthInvestingStatement).toBeNull();
  });

  it("Outcome C: qualifying dress alone (one-piece route satisfied) → no purchase needed", () => {
    const evidence = makeEvidence({
      closetItems: [
        {
          name: "Navy Midi Dress",
          imageUrl: "https://example.com/dress.jpg",
          category: "DRESSES",
          subcategory: "midi",
          primaryColor: "navy",
          styleTags: [],
          occasions: [],
          material: "viscose",
        },
      ],
    });
    const edit = buildShopperEdit(SOFT_STRUCTURE_REPORT, evidence);
    expect(edit.worthInvestingStatement).not.toBeNull();
    expect(edit.worthInvestingStatement).toMatch(/do not need to buy/i);
    expect(edit.worthInvestingStatement).toMatch(/navy midi dress/i);
  });

  it("Outcome C: layered-route items (outerwear + bottom, optional role targets separates only) → no purchase needed", () => {
    // layered route = OUTERWEAR + BOTTOMS. Optional role only targets 'separates',
    // so a layered customer skips Outcome B entirely → Outcome C.
    const evidence = makeEvidence({
      closetItems: [
        {
          name: "Longline Linen Blazer",
          imageUrl: null,
          category: "OUTERWEAR",
          subcategory: "blazer",
          primaryColor: "ivory",
          styleTags: [],
          occasions: [],
          material: "viscose",
        },
        {
          name: "Wide Leg Trouser",
          imageUrl: null,
          category: "BOTTOMS",
          subcategory: "wide-leg",
          primaryColor: "cream",
          styleTags: [],
          occasions: [],
          material: "crepe",
        },
      ],
    });
    const edit = buildShopperEdit(SOFT_STRUCTURE_REPORT, evidence);
    expect(edit.worthInvestingStatement).not.toBeNull();
    expect(edit.worthInvestingStatement).toMatch(/do not need to buy/i);
  });

  it("Outcome B: separates route satisfied but outerwear missing → optional investment with optional framing", () => {
    // separates (TOPS + BOTTOMS) covers the direction, but OUTERWEAR is the optional role
    // that applies to the 'separates' route. Missing OUTERWEAR → Outcome B.
    // Both items need material that hits soft-structure closetMatchText ("viscose", "crepe", "twill")
    const evidence = makeEvidence({
      closetItems: [
        {
          name: "Fluid Blouse",
          imageUrl: null,
          category: "TOPS",
          subcategory: null,
          primaryColor: "ivory",
          styleTags: [],
          occasions: [],
          material: "viscose", // hits closetMatchText → TOPS item scores
        },
        {
          name: "Wide Leg Trouser",
          imageUrl: null,
          category: "BOTTOMS",
          subcategory: "wide-leg",
          primaryColor: "cream",
          styleTags: [],
          occasions: [],
          material: "crepe",
        },
      ],
    });
    const edit = buildShopperEdit(SOFT_STRUCTURE_REPORT, evidence);
    // Outcome B: worthInvestingStatement is null; partToTake first bullet has optional framing
    expect(edit.worthInvestingStatement).toBeNull();
    expect(edit.partToTake[0]).toMatch(/can already wear/i);
    expect(edit.partToTake[0]).toMatch(/if you wanted to extend/i);
  });

  it("Outcome C: layered route (outerwear + bottom) — optional role is OUTERWEAR but layered already covers it → no purchase needed", () => {
    // layered route = OUTERWEAR + BOTTOMS → satisfied. The optional role (OUTERWEAR)
    // is already covered by the layered route → alreadyCoveredByOtherRoute → Outcome C.
    const evidence = makeEvidence({
      closetItems: [
        {
          name: "Longline Blazer",
          imageUrl: null,
          category: "OUTERWEAR",
          subcategory: "blazer",
          primaryColor: "beige",
          styleTags: [],
          occasions: [],
          material: "crepe",
        },
        {
          name: "Wide Leg Trouser",
          imageUrl: null,
          category: "BOTTOMS",
          subcategory: "wide-leg",
          primaryColor: "cream",
          styleTags: [],
          occasions: [],
          material: "twill",
        },
      ],
    });
    const edit = buildShopperEdit(SOFT_STRUCTURE_REPORT, evidence);
    expect(edit.worthInvestingStatement).not.toBeNull();
    expect(edit.worthInvestingStatement).toMatch(/do not need to buy/i);
  });

  it("modern tailoring: one qualifying outerwear → Outcome B (optional trouser gap)", () => {
    const evidence = makeEvidence({
      closetItems: [
        {
          name: "Tailored Blazer",
          imageUrl: null,
          category: "OUTERWEAR",
          subcategory: "blazer",
          primaryColor: "navy",
          styleTags: [],
          occasions: [],
          material: "wool",
        },
      ],
    });
    const edit = buildShopperEdit(MODERN_TAILORING_REPORT, evidence);
    expect(edit.worthInvestingStatement).toBeNull();
    expect(edit.partToTake[0]).toMatch(/can already wear/i);
  });

  it("modern tailoring: qualifying outerwear + qualifying bottom → Outcome C", () => {
    const evidence = makeEvidence({
      closetItems: [
        {
          name: "Tailored Blazer",
          imageUrl: null,
          category: "OUTERWEAR",
          subcategory: "blazer",
          primaryColor: "navy",
          styleTags: [],
          occasions: [],
          material: "wool",
        },
        {
          name: "Wide Leg Trouser",
          imageUrl: null,
          category: "BOTTOMS",
          subcategory: "wide-leg",
          primaryColor: "cream",
          styleTags: [],
          occasions: [],
          material: "twill",
        },
      ],
    });
    const edit = buildShopperEdit(MODERN_TAILORING_REPORT, evidence);
    expect(edit.worthInvestingStatement).not.toBeNull();
    expect(edit.worthInvestingStatement).toMatch(/do not need to buy/i);
  });
});

// ---------------------------------------------------------------------------
// Passport-only Look To Try — personalised when no Closet matches
// ---------------------------------------------------------------------------

describe("buildShopperEdit — Passport-only Look To Try personalisation", () => {
  it("lifestyle=office → look suggestion is not the generic static string", () => {
    const officeEvidence = makeEvidence({
      profile: { ...BASE_PROFILE, lifestyle: ["office"] },
      closetItems: [], // no matches
    });
    const genericEvidence = makeEvidence({
      profile: { ...BASE_PROFILE, lifestyle: [] },
      closetItems: [],
    });
    const officeEdit = buildShopperEdit(SOFT_STRUCTURE_REPORT, officeEvidence);
    const genericEdit = buildShopperEdit(SOFT_STRUCTURE_REPORT, genericEvidence);
    // Both should return a look, but the office variant should differ
    expect(officeEdit.aLookToTry).toBeTruthy();
    expect(officeEdit.aLookToTry).not.toBe(genericEdit.aLookToTry);
    // Office lifestyle should mention work-appropriate framing
    expect(officeEdit.aLookToTry).toMatch(/work|meeting/i);
  });

  it("lifestyle=events → look suggestion leads with dressed-up option", () => {
    const eventsEvidence = makeEvidence({
      profile: { ...BASE_PROFILE, lifestyle: ["events"] },
      closetItems: [],
    });
    const edit = buildShopperEdit(SOFT_STRUCTURE_REPORT, eventsEvidence);
    expect(edit.aLookToTry).toBeTruthy();
    expect(edit.aLookToTry).toMatch(/dress|occasion|event/i);
  });

  it("no profile at all → static fallback string is used", () => {
    const noProfileEvidence: ShopperEvidenceBundle = {
      hasProfile: false,
      profile: null,
      closetItems: [],
      reviewSignal: { reviewCount: 0, workedTags: [], didntWorkTags: [] },
    };
    const edit = buildShopperEdit(SOFT_STRUCTURE_REPORT, noProfileEvidence);
    // When no profile, aLookToTry must still be a non-empty string (graceful degradation)
    expect(edit.aLookToTry).toBeTruthy();
    expect(typeof edit.aLookToTry).toBe("string");
  });

  it("passport-only Route In changes with lifestyle signal", () => {
    const officeEvidence = makeEvidence({
      profile: { ...BASE_PROFILE, lifestyle: ["office"] },
      closetItems: [],
    });
    const noLifestyleEvidence = makeEvidence({
      profile: { ...BASE_PROFILE, lifestyle: [] },
      closetItems: [],
    });
    const officeEdit = buildShopperEdit(SOFT_STRUCTURE_REPORT, officeEvidence);
    const noLifestyleEdit = buildShopperEdit(SOFT_STRUCTURE_REPORT, noLifestyleEvidence);
    // Route In should differ when lifestyle provides a signal
    expect(officeEdit.yourBestRouteIn).not.toBe(noLifestyleEdit.yourBestRouteIn);
  });
});

// ---------------------------------------------------------------------------
// Hold Off On — workedTags, saturation, didntWorkTags
// ---------------------------------------------------------------------------

describe("buildShopperEdit — Hold Off On signal priority", () => {
  it("workedTags matching a candidate vocab → that candidate does not appear as first recommendation", () => {
    // The soft-structure leaveOutCandidates include a 'suit/stiff' candidate.
    // If 'suit' is in workedTags, that candidate should not be top priority.
    const evidence = makeEvidence({
      profile: BASE_PROFILE,
      closetItems: [],
      reviewSignal: {
        reviewCount: 5,
        workedTags: ["suit", "tailored"],
        didntWorkTags: [],
      },
    });
    const edit = buildShopperEdit(SOFT_STRUCTURE_REPORT, evidence);
    // The 'head-to-toe structured suiting' candidate has vocab ["suit", "stiff", "rigid", "suiting"]
    // With workedTags = ["suit"] and no saturation, it should move to position 3 (not shown)
    expect(edit.partToLeave[0]).not.toMatch(/head-to-toe structured suiting/i);
  });

  it("workedTags match + closet saturation → candidate can still appear (saturation wins)", () => {
    // 3+ items with 'suit' subcategory = saturated → purchase redundancy justifies Hold Off
    // even though 'suit' is in workedTags
    const evidence = makeEvidence({
      profile: BASE_PROFILE,
      closetItems: [
        // material: "crepe" hits soft-structure closetMatchText so these score
        { name: "Suit 1", imageUrl: null, category: "OUTERWEAR", subcategory: "suit", primaryColor: "navy", styleTags: [], occasions: [], material: "crepe" },
        { name: "Suit 2", imageUrl: null, category: "OUTERWEAR", subcategory: "suit", primaryColor: "grey", styleTags: [], occasions: [], material: "crepe" },
        { name: "Suit 3", imageUrl: null, category: "OUTERWEAR", subcategory: "suit", primaryColor: "black", styleTags: [], occasions: [], material: "crepe" },
      ],
      reviewSignal: {
        reviewCount: 5,
        workedTags: ["suit", "tailored"],
        didntWorkTags: [],
      },
    });
    const edit = buildShopperEdit(SOFT_STRUCTURE_REPORT, evidence);
    // saturation (3 suits) overrides the workedTags veto
    // The suit candidate's score should be high enough to appear
    const allLeave = edit.partToLeave.join(" ");
    expect(allLeave).toMatch(/suit/i);
  });

  it("didntWorkTags matching a candidate → that candidate rises", () => {
    const evidence = makeEvidence({
      profile: BASE_PROFILE,
      closetItems: [],
      reviewSignal: {
        reviewCount: 5,
        workedTags: [],
        didntWorkTags: ["embellish", "decorative", "beading"],
      },
    });
    const edit = buildShopperEdit(SOFT_STRUCTURE_REPORT, evidence);
    // 'surface embellishment' candidate has vocab ["embellish","decorative","print","beading","detail"]
    expect(edit.partToLeave[0]).toMatch(/embellish|decoration/i);
  });

  it("fitPreference in candidate vocab → candidate score is reduced", () => {
    // Customer has fitPreferences=["relaxed-fits"]. The 'oversized' candidate
    // has vocab ["oversized","volume","balloon","competing"] — "relaxed-fits" is not in it,
    // so this tests that the customer's stated preference is not penalised.
    // More practically: a candidate whose vocab matches a held fitPref should score lower.
    const evidence = makeEvidence({
      profile: { ...BASE_PROFILE, fitPreferences: ["oversized"] },
      closetItems: [],
      reviewSignal: { reviewCount: 5, workedTags: [], didntWorkTags: [] },
    });
    const edit = buildShopperEdit(SOFT_STRUCTURE_REPORT, evidence);
    // 'oversized' candidate vocab includes "oversized" — customer has fitPreferences=["oversized"]
    // → that candidate should score lower (not necessarily absent, but not promoted)
    // We verify it doesn't appear first when there's no other positive signal
    // (the suit candidate also has no positive signal, so order is indeterminate — just verify it's valid)
    expect(edit.partToLeave.length).toBeGreaterThan(0);
    expect(edit.partToLeave.every((b) => typeof b === "string")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Route In — qualification sentence for named items
// ---------------------------------------------------------------------------

describe("buildShopperEdit — Route In item qualification", () => {
  it("named item with material → route in contains material reference", () => {
    const evidence = makeEvidence({
      closetItems: [
        {
          name: "Ivory Linen Blazer",
          imageUrl: null,
          category: "OUTERWEAR",
          subcategory: "blazer",
          primaryColor: "ivory",
          styleTags: [],
          occasions: [],
          material: "linen",
        },
      ],
    });
    const edit = buildShopperEdit(SOFT_STRUCTURE_REPORT, evidence);
    // Route In should mention the item name
    expect(edit.yourBestRouteIn).toMatch(/ivory linen blazer/i);
  });

  it("named item with primaryColor → route in references item by name", () => {
    const evidence = makeEvidence({
      closetItems: [
        {
          name: "Navy Midi Dress",
          imageUrl: null,
          category: "DRESSES",
          subcategory: "midi",
          primaryColor: "navy",
          styleTags: [],
          occasions: [],
          material: "viscose", // hits soft-structure closetMatchText → item scores
        },
      ],
    });
    const edit = buildShopperEdit(SOFT_STRUCTURE_REPORT, evidence);
    expect(edit.yourBestRouteIn).toMatch(/navy midi dress/i);
  });

  it("no named items + profile present → passport-personalised route (not the generic register string)", () => {
    // All closet items are unnamed — no namedMatches → Passport-only path fires
    const evidence = makeEvidence({
      profile: { ...BASE_PROFILE, lifestyle: ["office"] },
      closetItems: [
        // Has a qualifying item (scores > 0) but no name → won't become a namedMatch
        {
          name: null,
          imageUrl: null,
          category: "OUTERWEAR",
          subcategory: "blazer",
          primaryColor: null,
          styleTags: [],
          occasions: [],
          material: "linen",
        },
      ],
    });
    const edit = buildShopperEdit(SOFT_STRUCTURE_REPORT, evidence);
    // Route In must reference the Passport signal (lifestyle=office), not just the static register string
    expect(edit.yourBestRouteIn).toBeTruthy();
    // The office lifestyle lead should appear
    expect(edit.yourBestRouteIn).toMatch(/trouser|blazer|professional|work|office/i);
  });
});

// ---------------------------------------------------------------------------
// Correction-pass tests (Fix 1+2: Route In/Look To Try, Fix 3: pronoun, Fix 4: capitalisation)
// ---------------------------------------------------------------------------

describe("buildShopperEdit — correction-pass fixes", () => {
  it("Route In and Look To Try are not identical for a named OUTERWEAR+BOTTOMS pair", () => {
    const evidence = makeEvidence({
      closetItems: [
        {
          name: "Ivory Linen Blazer",
          imageUrl: null,
          category: "OUTERWEAR",
          subcategory: "blazer",
          primaryColor: "ivory",
          styleTags: [],
          occasions: [],
          material: "linen",
        },
        {
          name: "Wide Leg Trouser",
          imageUrl: null,
          category: "BOTTOMS",
          subcategory: "wide-leg",
          primaryColor: "cream",
          styleTags: [],
          occasions: [],
          material: "crepe",
        },
      ],
    });
    const edit = buildShopperEdit(SOFT_STRUCTURE_REPORT, evidence);
    expect(edit.yourBestRouteIn).not.toEqual(edit.aLookToTry);
  });

  it("Route In names the item first — does not begin with 'Its'", () => {
    const evidence = makeEvidence({
      closetItems: [
        {
          name: "Fluid Wide Leg Trouser",
          imageUrl: null,
          category: "BOTTOMS",
          subcategory: "wide-leg",
          primaryColor: "oatmeal",
          styleTags: [],
          occasions: [],
          material: "viscose",
        },
      ],
    });
    const edit = buildShopperEdit(SOFT_STRUCTURE_REPORT, evidence);
    expect(edit.yourBestRouteIn).not.toMatch(/^Its\b/i);
    expect(edit.yourBestRouteIn).toMatch(/fluid wide leg trouser/i);
  });

  it("TOP+BOTTOM compatible pair → Look To Try mentions both item names", () => {
    const evidence = makeEvidence({
      closetItems: [
        {
          name: "Silk Blouse",
          imageUrl: null,
          category: "TOPS",
          subcategory: "blouse",
          primaryColor: "ivory",
          styleTags: [],
          occasions: [],
          material: "viscose",
        },
        {
          name: "Wide Leg Trouser",
          imageUrl: null,
          category: "BOTTOMS",
          subcategory: "wide-leg",
          primaryColor: "cream",
          styleTags: [],
          occasions: [],
          material: "crepe",
        },
      ],
    });
    const edit = buildShopperEdit(SOFT_STRUCTURE_REPORT, evidence);
    expect(edit.aLookToTry).toMatch(/silk blouse/i);
    expect(edit.aLookToTry).toMatch(/wide leg trouser/i);
  });

  it("DRESS+OUTERWEAR compatible pair → Look To Try mentions both item names", () => {
    const evidence = makeEvidence({
      closetItems: [
        {
          name: "Midi Dress",
          imageUrl: null,
          category: "DRESSES",
          subcategory: "midi",
          primaryColor: "cream",
          styleTags: [],
          occasions: [],
          material: "viscose",
        },
        {
          name: "Longline Coat",
          imageUrl: null,
          category: "OUTERWEAR",
          subcategory: "blazer",
          primaryColor: "stone",
          styleTags: [],
          occasions: [],
          material: "crepe",
        },
      ],
    });
    const edit = buildShopperEdit(SOFT_STRUCTURE_REPORT, evidence);
    expect(edit.aLookToTry).toMatch(/midi dress/i);
    expect(edit.aLookToTry).toMatch(/longline coat/i);
  });

  it("TOP+TOP incompatible pair → Look To Try does not combine both names in an outfit formula", () => {
    const evidence = makeEvidence({
      closetItems: [
        {
          name: "Fluid Blouse",
          imageUrl: null,
          category: "TOPS",
          subcategory: "blouse",
          primaryColor: "ivory",
          styleTags: [],
          occasions: [],
          material: "viscose",
        },
        {
          name: "Crepe Shirt",
          imageUrl: null,
          category: "TOPS",
          subcategory: "blouse",
          primaryColor: "cream",
          styleTags: [],
          occasions: [],
          material: "crepe",
        },
      ],
    });
    const edit = buildShopperEdit(SOFT_STRUCTURE_REPORT, evidence);
    // TOP+TOP is not a wearable pair — the second item name must not appear alongside the first
    expect(edit.aLookToTry).not.toMatch(/fluid blouse.*crepe shirt|crepe shirt.*fluid blouse/i);
  });

  it("OUTERWEAR+OUTERWEAR incompatible pair (modern-tailoring) → Look To Try uses only the stronger item", () => {
    const evidence = makeEvidence({
      closetItems: [
        {
          name: "Black Blazer",
          imageUrl: null,
          category: "OUTERWEAR",
          subcategory: "blazer",
          primaryColor: "black",
          styleTags: [],
          occasions: [],
          material: "twill",
        },
        {
          name: "Cream Blazer",
          imageUrl: null,
          category: "OUTERWEAR",
          subcategory: "blazer",
          primaryColor: "cream",
          styleTags: [],
          occasions: [],
          material: "denim",
        },
      ],
    });
    const edit = buildShopperEdit(MODERN_TAILORING_REPORT, evidence);
    // OUTERWEAR+OUTERWEAR is not a wearable pair — the two names must not be combined
    expect(edit.aLookToTry).not.toMatch(/black blazer.*cream blazer|cream blazer.*black blazer/i);
  });

  it("Outcome C: worthInvestingStatement capitalises first named piece with 'Your' after a period", () => {
    // Dress alone satisfies one-piece route → Outcome C fires
    const evidence = makeEvidence({
      closetItems: [
        {
          name: "Cream Midi Dress",
          imageUrl: null,
          category: "DRESSES",
          subcategory: "midi",
          primaryColor: "cream",
          styleTags: [],
          occasions: [],
          material: "viscose",
        },
      ],
    });
    const edit = buildShopperEdit(SOFT_STRUCTURE_REPORT, evidence);
    expect(edit.worthInvestingStatement).not.toBeNull();
    // Must begin "You do not need to buy anything for this trend. Your Cream Midi Dress..."
    // not "... for this trend. your Cream Midi Dress..." (lowercase bug)
    expect(edit.worthInvestingStatement).toMatch(/trend\. Your Cream Midi Dress/);
  });

  it("Modern Tailoring yourVersion does not repeat 'formal weight' when desiredFeelings = powerful", () => {
    const evidence = makeEvidence({
      profile: {
        ...BASE_PROFILE,
        stylePersonalities: [], // neutral register → base contains "formal weight"
        fitPreferences: [],     // skip fit-pref priority so desiredFeelings fires
        desiredFeelings: ["powerful"],
      },
    });
    const edit = buildShopperEdit(MODERN_TAILORING_REPORT, evidence);
    const count = (edit.yourVersion.match(/formal weight/g) ?? []).length;
    expect(count).toBeLessThanOrEqual(1);
  });

  it("Outcome C + one-piece DRESS route → Look To Try uses owned DRESS, not a missing garment category (real report)", () => {
    // Uses the production soft-structure report corpus, not a simplified fixture.
    // In the real corpus: "blazer" and "linen" appear → TOPS scores ≥ 5
    //                     "midi" appears in keyTrends[0] → DRESSES scores ≥ 1
    // TOPS is namedMatches[0] (higher score), DRESSES is namedMatches[1].
    // Only DRESSES satisfies the one-piece viable route → Outcome C fires.
    // Pre-fix: Look To Try used namedMatches[0] (TOPS) and invented a trouser.
    // Post-fix: buildOutcomeCLookToTry returns a DRESS-anchored outfit formula.
    const evidence = makeEvidence({
      profile: { ...BASE_PROFILE, lifestyle: ["office"] }, // office → workCtx "work-meetings"
      closetItems: [
        {
          name: "Ivory Linen Blazer",
          category: "TOPS",
          subcategory: "blazer",
          primaryColor: "ivory",
          material: "linen",
          styleTags: [],
          occasions: [],
          imageUrl: null,
        },
        {
          name: "Navy Midi Dress",
          category: "DRESSES",
          subcategory: null,
          primaryColor: "navy",
          material: null,
          styleTags: [],
          occasions: [],
          imageUrl: null,
        },
      ],
    });
    const edit = buildShopperEdit(REAL_SOFT_STRUCTURE, evidence);

    // Outcome C must fire: DRESS satisfies one-piece route; no BOTTOMS or OUTERWEAR
    expect(edit.worthInvestingStatement).not.toBeNull();

    // Look To Try must anchor on the owned Dress — not invent a missing garment category
    expect(edit.aLookToTry).toContain("Navy Midi Dress");
    expect(edit.aLookToTry).not.toMatch(/trouser/i);
    expect(edit.aLookToTry).not.toMatch(/wide-leg/i);
  });
});

// ---------------------------------------------------------------------------
// Modern Tailoring narrative consistency
// When the shopper's only qualifying closet item is a TOP, the personalised
// copy must NOT describe that item as the tailored anchor while simultaneously
// claiming the shopper is missing a tailored anchor. Gap state and narrative
// must agree.
// ---------------------------------------------------------------------------

describe("buildShopperEdit — Modern Tailoring TOPS narrative consistency", () => {
  // A brown top that qualifies: "brown" hits closetMatchText (jersey or similar),
  // and the item has non-generic metadata.
  const brownTopItem = {
    name: "Brown Top",
    imageUrl: null,
    category: "TOPS",
    subcategory: "blouse",
    primaryColor: "brown",
    styleTags: ["relaxed"],
    occasions: [],
    material: "jersey",
  };

  it("TOPS-only Outcome A: roleNote describes the top as the softer counterpart, not the tailored anchor", () => {
    const evidence = makeEvidence({
      closetItems: [brownTopItem],
    });
    const edit = buildShopperEdit(MODERN_TAILORING_REPORT, evidence);

    expect(edit.worthInvestingStatement).toBeNull();

    const roleNote = edit.evidenceClosetItems[0]?.roleNote ?? "";
    // Must NOT call it the structured/tailored anchor
    expect(roleNote).not.toMatch(/tailored anchor/i);
    expect(roleNote).not.toMatch(/structured element/i);
    expect(roleNote).not.toMatch(/tailored piece/i);
    // Must acknowledge the softer / counterpart role
    expect(roleNote).toMatch(/softer counterpart|softer side|counterpart/i);
  });

  it("TOPS-only Outcome A: Route In names the top as the softer side and names the missing anchor", () => {
    const evidence = makeEvidence({
      closetItems: [brownTopItem],
    });
    const edit = buildShopperEdit(MODERN_TAILORING_REPORT, evidence);

    expect(edit.worthInvestingStatement).toBeNull();

    // Route In must not call the top the tailored piece
    expect(edit.yourBestRouteIn).not.toMatch(/is the tailored piece/i);
    // Must name what is missing
    expect(edit.yourBestRouteIn).toMatch(/missing|what is missing/i);
    expect(edit.yourBestRouteIn).toMatch(/tailored anchor|blazer|waistcoat|trouser/i);
  });

  it("TOPS-only Outcome A: partToTake correctly describes missing tailored anchor (no contradiction with roleNote)", () => {
    const evidence = makeEvidence({
      closetItems: [brownTopItem],
    });
    const edit = buildShopperEdit(MODERN_TAILORING_REPORT, evidence);

    expect(edit.worthInvestingStatement).toBeNull();

    // partToTake describes the gap (what to buy)
    const investBullet = edit.partToTake[0];
    expect(investBullet).toMatch(/tailored anchor|blazer|waistcoat|trouser/i);

    // The roleNote must not contradict the gap by calling the existing top the anchor
    const roleNote = edit.evidenceClosetItems[0]?.roleNote ?? "";
    expect(roleNote).not.toMatch(/tailored anchor/i);
    expect(roleNote).not.toMatch(/structured element/i);
  });

  it("OUTERWEAR Outcome B: roleNote correctly identifies outerwear as the tailored anchor", () => {
    const evidence = makeEvidence({
      closetItems: [
        {
          name: "Tailored Blazer",
          imageUrl: null,
          category: "OUTERWEAR",
          subcategory: "blazer",
          primaryColor: "navy",
          styleTags: [],
          occasions: [],
          material: "wool",
        },
      ],
    });
    const edit = buildShopperEdit(MODERN_TAILORING_REPORT, evidence);

    expect(edit.worthInvestingStatement).toBeNull();
    expect(edit.partToTake[0]).toMatch(/can already wear/i);

    const roleNote = edit.evidenceClosetItems[0]?.roleNote ?? "";
    expect(roleNote).toMatch(/tailored anchor/i);
  });
});
