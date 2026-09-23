// app/lib/ai/styleme-qa-regression.test.ts
// Systemic StyleMe QA regression tests — 48 cases covering:
//   A. Physical body-need scoring unit tests
//   B. Anchor scoring (autoSelectClosetAnchor)
//   C. Active occasion end-to-end
//   D. Slot/core need satisfaction
//   E. Wording / system-prompt guards
//   F. Real-like QA-fixture analogs (Tests 5, 12, 15, 17, 19)

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  scoreBodyNeedForClosetItem,
  autoSelectClosetAnchor,
} from "./styleme-anchor.server.ts";
import type { AutoSelectItem } from "./styleme-anchor.server.ts";
import {
  coreClothingMeetsBodyNeed,
  coreClothingMeetsLooseNeed,
} from "./styleme-result.server.ts";
import type { ClosetAnchorInput } from "./styleme-recommendation.types.ts";
import {
  SESSION_OCCASION_TO_CLOSET_TOKENS,
} from "./styleme-occasion-tokens.ts";

const ROOT = join(import.meta.dirname ?? __dirname, "../../..");
const RESULT_SRC = readFileSync(join(ROOT, "app/lib/ai/styleme-result.server.ts"), "utf8");

// ── Shared fixtures ───────────────────────────────────────────────────────────

function makeAutoItem(
  id: string,
  overrides: Partial<AutoSelectItem> = {},
): AutoSelectItem {
  return {
    id,
    name: id,
    category: "TOPS",
    subcategory: null,
    colors: ["black"],
    primaryColor: "black",
    pattern: null,
    material: null,
    styleTags: [],
    occasions: ["everyday"],
    imageUrl: null,
    garmentRelationships: [],
    formality: "casual",
    waistShape: null,
    styleMeProfile: null,
    ...overrides,
  };
}

function makeClosetItem(overrides: Partial<ClosetAnchorInput> = {}): ClosetAnchorInput {
  return {
    type: "closet",
    id: "ci-test",
    name: "Test Item",
    category: "TOPS",
    colors: ["black"],
    primaryColor: "black",
    pattern: null,
    material: null,
    styleTags: [],
    occasions: ["everyday"],
    imageUrl: "https://example.com/img.jpg",
    waistShape: null,
    approvedProfile: null,
    ...overrides,
  };
}

// ── A. scoreBodyNeedForClosetItem unit tests ──────────────────────────────────

describe("A. scoreBodyNeedForClosetItem — loose-comfortable", () => {
  it("A1 fitted silhouette → violation", () => {
    const result = scoreBodyNeedForClosetItem("loose-comfortable", {
      fitProfile: null,
      waistShape: null,
      styleTags: [],
      approvedProfile: { silhouetteCharacter: ["fitted"], waistComfort: null, construction: null, fabricBehaviour: [] },
    });
    assert.equal(result.violation, true, "fitted silhouette must be a violation for loose-comfortable");
  });

  it("A2 relaxed silhouette → no violation, positive fitScore", () => {
    const result = scoreBodyNeedForClosetItem("loose-comfortable", {
      fitProfile: null,
      waistShape: null,
      styleTags: [],
      approvedProfile: { silhouetteCharacter: ["relaxed"], waistComfort: null, construction: null, fabricBehaviour: [] },
    });
    assert.equal(result.violation, false);
    assert.ok(result.fitScore !== null && result.fitScore > 0.5, `relaxed → fitScore > 0.5, got ${result.fitScore}`);
  });

  it("A3 oversized + elastic waist → fitScore = 1.0", () => {
    const result = scoreBodyNeedForClosetItem("loose-comfortable", {
      fitProfile: null,
      waistShape: null,
      styleTags: [],
      approvedProfile: { silhouetteCharacter: ["oversized"], waistComfort: "elastic", construction: null, fabricBehaviour: [] },
    });
    assert.equal(result.violation, false);
    assert.equal(result.fitScore, 1.0, "oversized + elastic waist → top fitScore");
  });

  it("A4 soft construction alone ≠ loose — no silhouette → fitScore null", () => {
    const result = scoreBodyNeedForClosetItem("loose-comfortable", {
      fitProfile: null,
      waistShape: null,
      styleTags: [],
      approvedProfile: { silhouetteCharacter: [], waistComfort: null, construction: "soft", fabricBehaviour: [] },
    });
    assert.equal(result.violation, false);
    assert.equal(result.fitScore, null, "soft construction alone must not produce a loose fitScore");
  });

  it("A5 no approved profile, no fitProfile → fitScore null (no guess)", () => {
    const result = scoreBodyNeedForClosetItem("loose-comfortable", {
      fitProfile: null,
      waistShape: null,
      styleTags: [],
    });
    assert.equal(result.violation, false);
    assert.equal(result.fitScore, null, "no evidence → fitScore must be null");
  });
});

describe("A. scoreBodyNeedForClosetItem — less-body-conscious", () => {
  it("A6 fitted silhouette → violation", () => {
    const result = scoreBodyNeedForClosetItem("less-body-conscious", {
      fitProfile: null,
      waistShape: null,
      styleTags: [],
      approvedProfile: { silhouetteCharacter: ["fitted"], waistComfort: null, construction: null, fabricBehaviour: [] },
    });
    assert.equal(result.violation, true, "fitted silhouette is a violation for less-body-conscious");
  });

  it("A7 relaxed silhouette → no violation, fitScore = 1", () => {
    const result = scoreBodyNeedForClosetItem("less-body-conscious", {
      fitProfile: null,
      waistShape: null,
      styleTags: [],
      approvedProfile: { silhouetteCharacter: ["relaxed"], waistComfort: null, construction: null, fabricBehaviour: [] },
    });
    assert.equal(result.violation, false);
    assert.equal(result.fitScore, 1);
  });

  it("A8 neutral silhouette (A-line) → no violation, fitScore = 0.5", () => {
    const result = scoreBodyNeedForClosetItem("less-body-conscious", {
      fitProfile: null,
      waistShape: null,
      styleTags: [],
      approvedProfile: { silhouetteCharacter: ["A-line"], waistComfort: null, construction: null, fabricBehaviour: [] },
    });
    assert.equal(result.violation, false);
    assert.equal(result.fitScore, 0.5, "A-line (neutral silhouette) → 0.5, not cling but not loose");
  });

  it("A9 legacy fitProfile=fitted (no approved profile) → violation", () => {
    const result = scoreBodyNeedForClosetItem("less-body-conscious", {
      fitProfile: "fitted",
      waistShape: null,
      styleTags: [],
    });
    assert.equal(result.violation, true, "legacy fitted fitProfile → violation");
  });
});

describe("A. scoreBodyNeedForClosetItem — waist-definition", () => {
  it("A10 waistShape=belted → fitScore=1, no violation", () => {
    const result = scoreBodyNeedForClosetItem("waist-definition", {
      fitProfile: null,
      waistShape: "belted",
      styleTags: [],
    });
    assert.equal(result.violation, false);
    assert.equal(result.fitScore, 1);
  });

  it("A11 waistShape=tied → fitScore=1", () => {
    const result = scoreBodyNeedForClosetItem("waist-definition", {
      fitProfile: null,
      waistShape: "tied",
      styleTags: [],
    });
    assert.equal(result.fitScore, 1);
  });

  it("A12 waistShape=wrap → fitScore=1", () => {
    const result = scoreBodyNeedForClosetItem("waist-definition", {
      fitProfile: null,
      waistShape: "wrap",
      styleTags: [],
    });
    assert.equal(result.fitScore, 1);
  });

  it("A13 construction=tailored alone → fitScore=null (no explicit waist evidence)", () => {
    const result = scoreBodyNeedForClosetItem("waist-definition", {
      fitProfile: "tailored",
      waistShape: null,
      styleTags: [],
      approvedProfile: { silhouetteCharacter: [], waistComfort: null, construction: "tailored", fabricBehaviour: [] },
    });
    assert.equal(result.fitScore, null, "tailored construction alone must not produce a waist-definition score");
  });

  it("A14 waistShape=body-skimming removed as evidence → fitScore=null", () => {
    const result = scoreBodyNeedForClosetItem("waist-definition", {
      fitProfile: null,
      waistShape: "body-skimming",
      styleTags: [],
    });
    assert.equal(result.fitScore, null, "body-skimming must no longer count as waist-definition evidence");
  });
});

describe("A. scoreBodyNeedForClosetItem — softer-easier-fabrics", () => {
  it("A15 fabricBehaviour=[soft] → fitScore=0.8", () => {
    const result = scoreBodyNeedForClosetItem("softer-easier-fabrics", {
      fitProfile: null,
      waistShape: null,
      styleTags: [],
      approvedProfile: { silhouetteCharacter: [], waistComfort: null, construction: null, fabricBehaviour: ["soft"] },
    });
    assert.equal(result.fitScore, 0.8);
  });

  it("A16 fabricBehaviour=[fluid] → fitScore=0.8", () => {
    const result = scoreBodyNeedForClosetItem("softer-easier-fabrics", {
      fitProfile: null,
      waistShape: null,
      styleTags: [],
      approvedProfile: { silhouetteCharacter: [], waistComfort: null, construction: null, fabricBehaviour: ["fluid"] },
    });
    assert.equal(result.fitScore, 0.8);
  });

  it("A17 fabricBehaviour=[rigid] → fitScore=0.2 (not positive)", () => {
    const result = scoreBodyNeedForClosetItem("softer-easier-fabrics", {
      fitProfile: null,
      waistShape: null,
      styleTags: [],
      approvedProfile: { silhouetteCharacter: [], waistComfort: null, construction: null, fabricBehaviour: ["rigid"] },
    });
    assert.equal(result.fitScore, 0.2, "rigid fabric → 0.2, not soft");
  });

  it("A18 no approved profile → fitScore=null (cannot infer softness)", () => {
    const result = scoreBodyNeedForClosetItem("softer-easier-fabrics", {
      fitProfile: null,
      waistShape: null,
      styleTags: [],
    });
    assert.equal(result.fitScore, null, "no profile → fitScore must be null");
  });

  it("A19 intentionPotential feel-softer alone ≠ fabric softness (fabricBehaviour=[] → fitScore=null)", () => {
    const result = scoreBodyNeedForClosetItem("softer-easier-fabrics", {
      fitProfile: null,
      waistShape: null,
      styleTags: [],
      approvedProfile: {
        silhouetteCharacter: [], waistComfort: null, construction: null, fabricBehaviour: [],
        intentionPotentials: { "feel-softer": "Strong" },
      },
    });
    assert.equal(result.fitScore, null, "feel-softer intention alone must not produce a softer-fabrics score");
  });
});

describe("A. scoreBodyNeedForClosetItem — nothing-tight-waist", () => {
  it("A20 waistComfort=elastic → fitScore=1 (strong positive)", () => {
    const result = scoreBodyNeedForClosetItem("nothing-tight-waist", {
      fitProfile: null,
      waistShape: null,
      styleTags: [],
      approvedProfile: { silhouetteCharacter: [], waistComfort: "elastic", construction: null, fabricBehaviour: [] },
    });
    assert.equal(result.violation, false);
    assert.equal(result.fitScore, 1);
  });

  it("A21 waistComfort=restrictive → fitScore=0.1 (negative signal)", () => {
    const result = scoreBodyNeedForClosetItem("nothing-tight-waist", {
      fitProfile: null,
      waistShape: null,
      styleTags: [],
      approvedProfile: { silhouetteCharacter: [], waistComfort: "restrictive", construction: null, fabricBehaviour: [] },
    });
    assert.equal(result.fitScore, 0.1, "restrictive waistband → near-zero fitScore");
  });
});

// ── B. Anchor scoring ─────────────────────────────────────────────────────────

describe("B. autoSelectClosetAnchor — formality / register", () => {
  it("B1 _OCCASION_MAX_RANK uses canonical 'dinner' (not 'dinner-out') — evening-formality item in range", async () => {
    const dressy = makeAutoItem("dressy", {
      category: "DRESSES",
      occasions: ["dinner"],
      formality: "evening",   // rank 6 — in range for dinner (max 4 + dressy boost 2 = 6)
    });
    const casual = makeAutoItem("casual", {
      category: "TOPS",
      occasions: ["dinner"],
      formality: "casual",
    });
    // With formality-occasion on a dinner occasion, evening-wear IS in range (max 4+2=6)
    const result = await autoSelectClosetAnchor("u1", {
      occasion: "dinner",
      moods: [],
      desiredFeelings: [],
      formalityConditional: "formality-occasion",
    }, async () => [dressy, casual]);
    assert.ok(result !== null);
    assert.equal(result.id, "dressy", "evening-formality item must be in-range for dressy dinner with formality-occasion");
  });

  it("B2 _OCCASION_MAX_RANK uses canonical 'work' — business-casual in range, business-formal out of range", async () => {
    const formal = makeAutoItem("formal", {
      category: "TOPS",
      occasions: ["work"],
      formality: "business-formal",   // rank 4, work max 3 → out of range
    });
    const smart = makeAutoItem("smart", {
      category: "TOPS",
      occasions: ["work"],
      formality: "smart-casual",     // rank 2, work max 3 → in range
    });
    const result = await autoSelectClosetAnchor("u1", {
      occasion: "work",
      moods: [],
      desiredFeelings: [],
    }, async () => [formal, smart]);
    assert.ok(result !== null);
    assert.equal(result.id, "smart", "in-range smart-casual must beat out-of-range business-formal for work");
  });

  it("B3 formality-occasion token fires register bonus (not formality-dressy)", async () => {
    const evening = makeAutoItem("evening", {
      category: "DRESSES",
      occasions: ["dinner"],
      formality: "evening",
    });
    const casual = makeAutoItem("casual", {
      category: "DRESSES",
      occasions: ["dinner"],
      formality: "casual",
    });
    // With wrong token "formality-dressy" (the old bug), no register bonus would fire and
    // casual may beat evening for the same occasion. With the fix, formality-occasion
    // gives evening +0.5 register bonus because rank 6 is in [4,6].
    const result = await autoSelectClosetAnchor("u1", {
      occasion: "dinner",
      moods: [],
      desiredFeelings: [],
      formalityConditional: "formality-occasion",
    }, async () => [casual, evening]);
    // evening (rank 6) is in the [4,6] range → gets +0.5 register bonus → beats casual (rank 1)
    assert.ok(result !== null);
    assert.equal(result.id, "evening", "formality-occasion token must trigger register bonus for evening-formality items");
  });

  it("B4 relaxed vs polished: polished item scores higher with formality-polished signal", async () => {
    const polished = makeAutoItem("polished", {
      category: "TOPS",
      occasions: ["dinner"],
      formality: "business-casual", // rank 3, in [3,4] for formality-polished
    });
    const relaxed = makeAutoItem("relaxed", {
      category: "TOPS",
      occasions: ["dinner"],
      formality: "casual", // rank 1, outside [3,4]
    });
    const result = await autoSelectClosetAnchor("u1", {
      occasion: "dinner",
      moods: [],
      desiredFeelings: [],
      formalityConditional: "formality-polished",
    }, async () => [relaxed, polished]);
    assert.ok(result !== null);
    assert.equal(result.id, "polished", "polished item (in formality-polished range) must beat relaxed for dinner");
  });
});

describe("B. autoSelectClosetAnchor — body need scoring", () => {
  it("B5 less-body-conscious: fitted anchor loses to relaxed within same occasion pool", async () => {
    const fitted = makeAutoItem("fitted", {
      category: "DRESSES",
      occasions: ["everyday"],
      formality: "casual",
      styleMeProfile: {
        profileStatus: "approved",
        intentionPotentials: null,
        occasionFit: null,
        construction: null,
        silhouetteCharacter: ["fitted"],
        waistComfort: null,
      },
    });
    const relaxed = makeAutoItem("relaxed", {
      category: "DRESSES",
      occasions: ["everyday"],
      formality: "casual",
      styleMeProfile: {
        profileStatus: "approved",
        intentionPotentials: null,
        occasionFit: null,
        construction: null,
        silhouetteCharacter: ["relaxed"],
        waistComfort: null,
      },
    });
    const result = await autoSelectClosetAnchor("u1", {
      occasion: "everyday",
      moods: [],
      desiredFeelings: [],
      bodyNeeds: ["less-body-conscious"],
    }, async () => [fitted, relaxed]);
    assert.ok(result !== null);
    assert.equal(result.id, "relaxed", "relaxed must beat fitted when less-body-conscious active");
  });

  it("B6 softer-easier-fabrics: soft fabric anchor scores higher than rigid", async () => {
    const soft = makeAutoItem("soft-top", {
      category: "TOPS",
      occasions: ["everyday"],
      styleMeProfile: {
        profileStatus: "approved",
        intentionPotentials: null,
        occasionFit: null,
        construction: null,
        silhouetteCharacter: null,
        waistComfort: null,
        fabricBehaviour: ["soft"],
      },
    });
    const rigid = makeAutoItem("rigid-top", {
      category: "TOPS",
      occasions: ["everyday"],
      styleMeProfile: {
        profileStatus: "approved",
        intentionPotentials: null,
        occasionFit: null,
        construction: null,
        silhouetteCharacter: null,
        waistComfort: null,
        fabricBehaviour: ["rigid"],
      },
    });
    const result = await autoSelectClosetAnchor("u1", {
      occasion: "everyday",
      moods: [],
      desiredFeelings: [],
      bodyNeeds: ["softer-easier-fabrics"],
    }, async () => [rigid, soft]);
    assert.ok(result !== null);
    assert.equal(result.id, "soft-top", "soft fabric anchor must beat rigid when softer-easier-fabrics active");
  });

  it("B7 waist-definition: only belted/tied/wrap item scores — tailored alone does not", async () => {
    const belted = makeAutoItem("belted-dress", {
      category: "DRESSES",
      occasions: ["everyday"],
      waistShape: "belted",
    });
    const tailored = makeAutoItem("tailored-dress", {
      category: "DRESSES",
      occasions: ["everyday"],
      waistShape: null,
      styleMeProfile: {
        profileStatus: "approved",
        intentionPotentials: null,
        occasionFit: null,
        construction: "tailored",
        silhouetteCharacter: null,
        waistComfort: null,
      },
    });
    const result = await autoSelectClosetAnchor("u1", {
      occasion: "everyday",
      moods: [],
      desiredFeelings: [],
      bodyNeeds: ["waist-definition"],
    }, async () => [tailored, belted]);
    assert.ok(result !== null);
    assert.equal(result.id, "belted-dress", "belted anchor must beat tailored-only when waist-definition active");
  });

  it("B8 occasionFit=No cannot be rescued by body-need bonus", async () => {
    const blockedFitted = makeAutoItem("blocked", {
      category: "DRESSES",
      occasions: ["everyday"],
      styleMeProfile: {
        profileStatus: "approved",
        intentionPotentials: null,
        occasionFit: { everyday: "No" }, // hard exclusion
        construction: null,
        silhouetteCharacter: ["relaxed"],
        waistComfort: null,
      },
    });
    const allowed = makeAutoItem("allowed", {
      category: "TOPS",
      occasions: ["everyday"],
      styleMeProfile: null,
    });
    const result = await autoSelectClosetAnchor("u1", {
      occasion: "everyday",
      moods: [],
      desiredFeelings: [],
      bodyNeeds: ["loose-comfortable"],
    }, async () => [blockedFitted, allowed]);
    // blockedFitted has relaxed silhouette → +1.7 body-need bonus, but occasionFit=No excludes it.
    assert.ok(result !== null);
    assert.equal(result.id, "allowed", "occasionFit=No must exclude item even with high body-need bonus");
  });
});

// ── C. Active occasion ────────────────────────────────────────────────────────

describe("C. Active occasion", () => {
  it("C1 REV3_OCCASION_MAP maps active-busy-day → 'active' (not everyday)", () => {
    const occasionSrc = readFileSync(join(ROOT, "app/routes/style-me/occasion.tsx"), "utf8");
    assert.ok(
      occasionSrc.includes('"active-busy-day": "active"') ||
      occasionSrc.includes("'active-busy-day': 'active'"),
      'REV3_OCCASION_MAP must map active-busy-day → active (not everyday)',
    );
  });

  it("C2 SESSION_OCCASION_TO_CLOSET_TOKENS has active key with gym/athletic/sport tokens", () => {
    const tokens = SESSION_OCCASION_TO_CLOSET_TOKENS["active"];
    assert.ok(Array.isArray(tokens), "active key must exist in SESSION_OCCASION_TO_CLOSET_TOKENS");
    assert.ok(tokens.includes("active"), "active tokens must include 'active'");
    assert.ok(tokens.includes("gym"), "active tokens must include 'gym'");
    assert.ok(tokens.includes("athletic"), "active tokens must include 'athletic'");
    assert.ok(tokens.includes("sport"), "active tokens must include 'sport'");
  });

  it("C3 signal-contract skipForOccasions includes 'active'", () => {
    const contractSrc = readFileSync(join(ROOT, "app/lib/ai/signal-contract.ts"), "utf8");
    assert.ok(
      contractSrc.includes('"active"') && contractSrc.includes("skipForOccasions"),
      "signal-contract.ts must include 'active' in a skipForOccasions array",
    );
    // Verify the specific line
    const lineMatch = contractSrc.match(/skipForOccasions:\s*\[([^\]]+)\]/);
    assert.ok(lineMatch, "skipForOccasions array must be present");
    assert.ok(lineMatch![1].includes('"active"'), 'skipForOccasions must contain "active"');
  });

  it("C4 OCCASION_LABELS in result.tsx maps 'active' → 'Active / busy day'", () => {
    const resultSrc = readFileSync(join(ROOT, "app/routes/style-me/result.tsx"), "utf8");
    assert.ok(
      resultSrc.includes('"active": "Active / busy day"') ||
      resultSrc.includes("'active': 'Active / busy day'"),
      "result.tsx OCCASION_LABELS must map active → 'Active / busy day'",
    );
  });

  it("C5 _OCCASION_MAX_RANK['active'] gives tightest cap (casual only)", async () => {
    // active occasion: max formality = casual (rank 1). A smart-casual item is out of range
    // and must lose to a casual item for the same occasion.
    const smartCasual = makeAutoItem("smart", {
      category: "TOPS",
      occasions: ["active", "gym"],
      formality: "smart-casual", // rank 2 > 1 → out of range for active
    });
    const casual = makeAutoItem("casual-tee", {
      category: "TOPS",
      occasions: ["active"],
      formality: "casual", // rank 1 → in range
    });
    const result = await autoSelectClosetAnchor("u1", {
      occasion: "active",
      moods: [],
      desiredFeelings: [],
    }, async () => [smartCasual, casual]);
    assert.ok(result !== null);
    assert.equal(result.id, "casual-tee", "active occasion max rank=casual: casual item must beat smart-casual");
  });

  it("C6 active occasion does not normalize to 'everyday' in token matching", () => {
    const activeTokens = SESSION_OCCASION_TO_CLOSET_TOKENS["active"] ?? [];
    const everydayTokens = SESSION_OCCASION_TO_CLOSET_TOKENS["everyday"] ?? [];
    for (const tok of activeTokens) {
      assert.ok(!everydayTokens.includes(tok), `token '${tok}' must not appear in both active and everyday`);
    }
  });
});

// ── D. Slot / core need satisfaction ─────────────────────────────────────────

describe("D. coreClothingMeetsLooseNeed", () => {
  it("D1 loose-comfortable: relaxed silhouette item satisfies the need", () => {
    const item = makeClosetItem({
      category: "DRESSES",
      approvedProfile: {
        exactSlot: null, outfitFunction: null, dressRegister: null, fabricBehaviour: [],
        silhouetteCharacter: ["relaxed"], visualWeight: null, construction: null,
        stylingEffort: null, layeringBehaviour: null, waistComfort: null,
        statementLevel: null, occasionFit: null, intentionPotentials: null,
        naturalPairings: null, intentionalMix: null, avoidInStyleMe: null,
      },
    });
    assert.ok(coreClothingMeetsLooseNeed([item], ["loose-comfortable"]), "relaxed silhouette must satisfy loose-comfortable");
  });

  it("D2 loose-comfortable: fitted silhouette item does NOT satisfy", () => {
    const item = makeClosetItem({
      category: "DRESSES",
      approvedProfile: {
        exactSlot: null, outfitFunction: null, dressRegister: null, fabricBehaviour: [],
        silhouetteCharacter: ["fitted"], visualWeight: null, construction: null,
        stylingEffort: null, layeringBehaviour: null, waistComfort: null,
        statementLevel: null, occasionFit: null, intentionPotentials: null,
        naturalPairings: null, intentionalMix: null, avoidInStyleMe: null,
      },
    });
    assert.equal(coreClothingMeetsLooseNeed([item], ["loose-comfortable"]), false, "fitted silhouette must not satisfy loose-comfortable");
  });

  it("D3 less-body-conscious: non-fitted silhouette satisfies", () => {
    const item = makeClosetItem({
      approvedProfile: {
        exactSlot: null, outfitFunction: null, dressRegister: null, fabricBehaviour: [],
        silhouetteCharacter: ["A-line"], visualWeight: null, construction: null,
        stylingEffort: null, layeringBehaviour: null, waistComfort: null,
        statementLevel: null, occasionFit: null, intentionPotentials: null,
        naturalPairings: null, intentionalMix: null, avoidInStyleMe: null,
      },
    });
    assert.ok(coreClothingMeetsLooseNeed([item], ["less-body-conscious"]), "non-fitted silhouette must satisfy less-body-conscious");
  });

  it("D4 less-body-conscious: fitted silhouette does NOT satisfy", () => {
    const item = makeClosetItem({
      approvedProfile: {
        exactSlot: null, outfitFunction: null, dressRegister: null, fabricBehaviour: [],
        silhouetteCharacter: ["fitted"], visualWeight: null, construction: null,
        stylingEffort: null, layeringBehaviour: null, waistComfort: null,
        statementLevel: null, occasionFit: null, intentionPotentials: null,
        naturalPairings: null, intentionalMix: null, avoidInStyleMe: null,
      },
    });
    assert.equal(coreClothingMeetsLooseNeed([item], ["less-body-conscious"]), false, "fitted silhouette must not satisfy less-body-conscious");
  });

  it("D5 neither need active → always returns true", () => {
    const fittedItem = makeClosetItem({
      approvedProfile: {
        exactSlot: null, outfitFunction: null, dressRegister: null, fabricBehaviour: [],
        silhouetteCharacter: ["fitted"], visualWeight: null, construction: null,
        stylingEffort: null, layeringBehaviour: null, waistComfort: null,
        statementLevel: null, occasionFit: null, intentionPotentials: null,
        naturalPairings: null, intentionalMix: null, avoidInStyleMe: null,
      },
    });
    assert.ok(coreClothingMeetsLooseNeed([fittedItem], ["structured-shape"]), "no loose/less-conscious need → always true");
    assert.ok(coreClothingMeetsLooseNeed([fittedItem], []), "empty bodyNeeds → always true");
  });
});

describe("D. coreClothingMeetsBodyNeed", () => {
  it("D6 structured-shape: tailored construction satisfies", () => {
    assert.ok(coreClothingMeetsBodyNeed(["tailored"], ["structured-shape"]));
  });

  it("D7 structured-shape: soft construction does NOT satisfy", () => {
    assert.equal(coreClothingMeetsBodyNeed(["soft"], ["structured-shape"]), false);
  });

  it("D8 no structural need active → always true even with null constructions", () => {
    assert.ok(coreClothingMeetsBodyNeed([null], []));
    assert.ok(coreClothingMeetsBodyNeed([null], ["loose-comfortable"]));
  });
});

// ── E. Wording / system prompt guards ────────────────────────────────────────
// Rules 19-24 are appended inline inside runStyleMeEngine — not in the exported
// STYLEME_WORDING_SYSTEM_PROMPT constant. RESULT_SRC is loaded at module level.

describe("E. System prompt wording guards (source-file checks)", () => {
  it("E1 rule 19 — statement piece guard present", () => {
    assert.ok(
      RESULT_SRC.includes("STATEMENT PIECE") && RESULT_SRC.includes("statement-level: statement"),
      "result.server.ts must contain STATEMENT PIECE rule with statement-level: statement",
    );
  });

  it("E2 rule 20 — coverage precision guard present (midi ≠ full coverage)", () => {
    assert.ok(
      RESULT_SRC.includes("COVERAGE PRECISION") && RESULT_SRC.includes("full leg coverage"),
      "result.server.ts must contain COVERAGE PRECISION rule mentioning 'full leg coverage'",
    );
  });

  it("E3 rule 21 — waist definition guard present (belted/tied/wrap only)", () => {
    assert.ok(
      RESULT_SRC.includes("WAIST DEFINITION") && RESULT_SRC.includes("waistShape: belted"),
      "result.server.ts must contain WAIST DEFINITION rule with waistShape: belted",
    );
  });

  it("E4 rule 22 — physical softness vs feel-softer distinction present", () => {
    assert.ok(
      RESULT_SRC.includes("PHYSICAL SOFTNESS") && RESULT_SRC.includes("feel-softer: None"),
      "result.server.ts must contain PHYSICAL SOFTNESS rule with feel-softer: None guard",
    );
  });

  it("E5 rule 23 — register claims guard present (no colour-based polish)", () => {
    assert.ok(
      RESULT_SRC.includes("REGISTER CLAIMS"),
      "result.server.ts must contain REGISTER CLAIMS rule",
    );
  });

  it("E6 rule 24 — waist comfort vs looseness distinction present", () => {
    assert.ok(
      RESULT_SRC.includes("WAIST COMFORT") && RESULT_SRC.includes("nothing-tight-waist"),
      "result.server.ts must contain WAIST COMFORT vs looseness rule",
    );
  });

  it("E7 feel-softer:None explicitly blocks the claim", () => {
    assert.ok(
      RESULT_SRC.includes("feel-softer: None"),
      "result.server.ts must explicitly mention feel-softer: None as a block",
    );
  });

  it("E8 midi ≠ full leg coverage — language explicitly present", () => {
    assert.ok(
      RESULT_SRC.includes("midi") && RESULT_SRC.includes("full leg coverage"),
      "result.server.ts must explicitly prevent 'full leg coverage' for midi",
    );
  });

  it("E9 waistShape: belted explicitly authorises definition claim", () => {
    assert.ok(
      RESULT_SRC.includes("waistShape: belted"),
      "result.server.ts must mention waistShape: belted as waist definition evidence",
    );
  });

  it("E10 tailored construction alone ≠ waist definition — explicitly stated", () => {
    assert.ok(
      RESULT_SRC.includes("WAIST DEFINITION") &&
      (RESULT_SRC.includes("does NOT automatically define") ||
       RESULT_SRC.includes("does not automatically")),
      "result.server.ts must state tailored does not automatically define the waist",
    );
  });
});

// ── F. Real-like QA-fixture analogs ──────────────────────────────────────────

describe("F. Real-like QA fixture analogs", () => {
  it("F1 Test-5 analog: fitted closet dress loses to relaxed dress when loose-comfortable active + same occasion", async () => {
    const fittedDress = makeAutoItem("fitted-dress", {
      category: "DRESSES",
      occasions: ["everyday"],
      formality: "casual",
      styleMeProfile: {
        profileStatus: "approved",
        intentionPotentials: null,
        occasionFit: null,
        construction: null,
        silhouetteCharacter: ["fitted"],
        waistComfort: null,
      },
    });
    const relaxedDress = makeAutoItem("relaxed-dress", {
      category: "DRESSES",
      occasions: ["everyday"],
      formality: "casual",
      styleMeProfile: {
        profileStatus: "approved",
        intentionPotentials: null,
        occasionFit: null,
        construction: null,
        silhouetteCharacter: ["relaxed"],
        waistComfort: null,
      },
    });
    const result = await autoSelectClosetAnchor("cust", {
      occasion: "everyday",
      moods: [],
      desiredFeelings: [],
      bodyNeeds: ["loose-comfortable"],
    }, async () => [fittedDress, relaxedDress]);
    assert.ok(result !== null);
    assert.equal(result.id, "relaxed-dress", "Test-5 analog: relaxed must beat fitted with loose-comfortable");
  });

  it("F2 Test-12 analog: less-body-conscious + fitted anchor loses to valid relaxed closet item", async () => {
    const fittedTop = makeAutoItem("fitted-top", {
      category: "TOPS",
      occasions: ["everyday"],
      formality: "casual",
      styleMeProfile: {
        profileStatus: "approved",
        intentionPotentials: null,
        occasionFit: null,
        construction: null,
        silhouetteCharacter: ["fitted"],
        waistComfort: null,
      },
    });
    const relaxedTop = makeAutoItem("relaxed-top", {
      category: "TOPS",
      occasions: ["everyday"],
      formality: "casual",
      styleMeProfile: {
        profileStatus: "approved",
        intentionPotentials: null,
        occasionFit: null,
        construction: null,
        silhouetteCharacter: ["oversized"],
        waistComfort: null,
      },
    });
    const result = await autoSelectClosetAnchor("cust", {
      occasion: "everyday",
      moods: [],
      desiredFeelings: [],
      bodyNeeds: ["less-body-conscious"],
    }, async () => [fittedTop, relaxedTop]);
    assert.ok(result !== null);
    assert.equal(result.id, "relaxed-top", "Test-12 analog: relaxed/oversized must beat fitted with less-body-conscious");
  });

  it("F3 Test-15 analog: waist-definition only scores explicit belted evidence, not tailored alone", () => {
    const beltedResult = scoreBodyNeedForClosetItem("waist-definition", {
      fitProfile: null, waistShape: "belted", styleTags: [],
    });
    const tailoredResult = scoreBodyNeedForClosetItem("waist-definition", {
      fitProfile: "tailored", waistShape: null, styleTags: [],
      approvedProfile: { silhouetteCharacter: [], waistComfort: null, construction: "tailored", fabricBehaviour: [] },
    });
    assert.equal(beltedResult.fitScore, 1, "belted must give fitScore=1");
    assert.equal(tailoredResult.fitScore, null, "tailored alone must give fitScore=null");
  });

  it("F4 Test-17 analog: softer-easier-fabrics scores soft/fluid fabric items positively", () => {
    const softResult = scoreBodyNeedForClosetItem("softer-easier-fabrics", {
      fitProfile: null, waistShape: null, styleTags: [],
      approvedProfile: { silhouetteCharacter: [], waistComfort: null, construction: null, fabricBehaviour: ["soft"] },
    });
    const fluidResult = scoreBodyNeedForClosetItem("softer-easier-fabrics", {
      fitProfile: null, waistShape: null, styleTags: [],
      approvedProfile: { silhouetteCharacter: [], waistComfort: null, construction: null, fabricBehaviour: ["fluid"] },
    });
    const stretchResult = scoreBodyNeedForClosetItem("softer-easier-fabrics", {
      fitProfile: null, waistShape: null, styleTags: [],
      approvedProfile: { silhouetteCharacter: [], waistComfort: null, construction: null, fabricBehaviour: ["stretch"] },
    });
    assert.ok(softResult.fitScore !== null && softResult.fitScore > 0.5, "soft fabric → fitScore > 0.5");
    assert.ok(fluidResult.fitScore !== null && fluidResult.fitScore > 0.5, "fluid fabric → fitScore > 0.5");
    assert.ok(stretchResult.fitScore !== null && stretchResult.fitScore > 0.5, "stretch fabric → fitScore > 0.5");
  });

  it("F5 Test-19 analog: hoodie with feel-softer=None does not provide softness score via scoreBodyNeedForClosetItem", () => {
    // The scoring function for softer-easier-fabrics is fabric-based, not intention-based.
    // A hoodie with feel-softer=None and fabricBehaviour=[] → null (no score).
    const result = scoreBodyNeedForClosetItem("softer-easier-fabrics", {
      fitProfile: null, waistShape: null, styleTags: ["cosy"],
      approvedProfile: {
        silhouetteCharacter: ["relaxed"], waistComfort: null, construction: "soft",
        fabricBehaviour: [], // no fabricBehaviour data → null fitScore
        intentionPotentials: { "feel-softer": "None" },
      },
    });
    assert.equal(result.fitScore, null, "feel-softer=None + no fabricBehaviour → fitScore must be null");
  });

  it("F5b Test-19 wording: result.server.ts blocks 'softer' claim when feel-softer:None", () => {
    assert.ok(
      RESULT_SRC.includes("feel-softer: None"),
      "result.server.ts must explicitly block the softer claim when feel-softer:None",
    );
  });
});
