// app/lib/ai/styleme-qa-regression.test.ts
// Systemic StyleMe QA regression tests — 48 cases covering:
//   A. Physical body-need scoring unit tests
//   B. Anchor scoring (autoSelectClosetAnchor)
//   C. Active occasion end-to-end
//   D. Slot/core need satisfaction
//   E. Wording / system-prompt guards
//   F. Real-like QA-fixture analogs (Tests 5, 12, 15, 17, 19)
//   G. Active/busy practicality band (O7-equivalent, narrow Option 2 revision)

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
  evaluateCompleteOutfit,
  isTiedAtT1T4,
  computeIntentionFit,
} from "./styleme-result.server.ts";
import type { CandidateRankKey, OutfitCandidate } from "./styleme-result.server.ts";
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
  it("B1 _OCCASION_MAX_RANK uses canonical 'dinner' (not 'dinner-out') — occasion-formality item in range", async () => {
    // Fixture rank lowered 6 -> 5 in RC-C. The subject of this test is the canonical
    // occasion key, not the ceiling arithmetic: with the canonical "dinner" the ceiling
    // is 5, and with the old misspelling it would be 4 (table miss -> 3, band {1,4}
    // intersected with Dressy -> max 4), so an `occasion`-rank item still proves the key.
    // Rank 6 no longer qualifies because OCCASION_FORMALITY_TARGET["dinner"] is {2,5} —
    // a dinner never reaches `evening`, which the anchor ceiling used to contradict.
    const dressy = makeAutoItem("dressy", {
      category: "DRESSES",
      occasions: ["dinner"],
      formality: "occasion",   // rank 5 — the top of the dinner + Dressy band (4-5)
    });
    const casual = makeAutoItem("casual", {
      category: "TOPS",
      occasions: ["dinner"],
      formality: "casual",
    });
    // With formality-occasion on a dinner occasion, occasion-wear IS in range (ceiling 5)
    const result = await autoSelectClosetAnchor("u1", {
      occasion: "dinner",
      moods: [],
      desiredFeelings: [],
      formalityConditional: "formality-occasion",
    }, async () => [dressy, casual]);
    assert.ok(result !== null);
    assert.equal(result.id, "dressy", "occasion-formality item must be in-range for dressy dinner with formality-occasion");
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
    // Fixture rank lowered 6 -> 5 in RC-C for the same reason as B1. The register bonus
    // range is still FORMALITY_CONDITIONAL_ADJUSTMENTS["formality-occasion"] = [4,6], so
    // a rank-5 item proves the token fires exactly as a rank-6 one did.
    const evening = makeAutoItem("evening", {
      category: "DRESSES",
      occasions: ["dinner"],
      formality: "occasion",
    });
    const casual = makeAutoItem("casual", {
      category: "DRESSES",
      occasions: ["dinner"],
      formality: "casual",
    });
    // With wrong token "formality-dressy" (the old bug), no register bonus would fire and
    // casual may beat evening for the same occasion. With the fix, formality-occasion
    // gives it +0.5 register bonus because rank 5 is in [4,6].
    const result = await autoSelectClosetAnchor("u1", {
      occasion: "dinner",
      moods: [],
      desiredFeelings: [],
      formalityConditional: "formality-occasion",
    }, async () => [casual, evening]);
    // rank 5 is in the [4,6] range → gets +0.5 register bonus → beats casual (rank 1)
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

  // C5 revised (narrow Option 2 band loosening): _OCCASION_MAX_RANK['active'] moved
  // from 1 (casual only) to 2 (casual through smart-casual) — see
  // OCCASION_FORMALITY_TARGET["active"] in styleme-profile-gate.ts for the matching
  // whole-outfit band. Rank 1 and rank 2 are now BOTH top-tier (tier 0) for Active;
  // rank 3+ remains tier 1 (deprioritized), regardless of other signal scores.

  it("C5a active occasion: rank 1 (casual) still beats rank 3 (business-casual) — upper bound still excludes it", async () => {
    const businessCasual = makeAutoItem("business-casual-top", {
      category: "TOPS",
      occasions: ["active", "gym"], // better occasion-token match than the casual item
      formality: "business-casual", // rank 3 > 2 → still out of range for active
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
    }, async () => [businessCasual, casual]);
    assert.ok(result !== null);
    assert.equal(result.id, "casual-tee", "rank 3 must remain out of range for active even with a better token match");
  });

  it("C5b active occasion: rank 2 (smart-casual) also beats rank 3 (business-casual) — rank 2 is top-tier too", async () => {
    const businessCasual = makeAutoItem("business-casual-top", {
      category: "TOPS",
      occasions: ["active", "gym"], // better occasion-token match than the smart-casual item
      formality: "business-casual", // rank 3 → out of range for active
    });
    const smartCasual = makeAutoItem("smart", {
      category: "TOPS",
      occasions: ["active"],
      formality: "smart-casual", // rank 2 → now in range for active
    });
    const result = await autoSelectClosetAnchor("u1", {
      occasion: "active",
      moods: [],
      desiredFeelings: [],
    }, async () => [businessCasual, smartCasual]);
    assert.ok(result !== null);
    assert.equal(result.id, "smart", "rank 2 must be top-tier (in-range) for active, beating rank 3 despite the weaker token match");
  });

  it("C5c active occasion: rank 1 and rank 2 are now in the SAME top tier — the better-matched rank 2 item can win", async () => {
    // Under the old {1,1}/ceiling-1 policy this exact fixture (rank-2 item with a
    // stronger occasion-token match) was forced to lose to the rank-1 item purely by
    // formality tier. Under the loosened {1,2}/ceiling-2 policy, both are tier 0, so
    // the better occasion-token match is free to decide the outcome — proving rank 1
    // no longer automatically dominates rank 2 for active.
    const smartCasual = makeAutoItem("smart", {
      category: "TOPS",
      occasions: ["active", "gym"], // stronger occasion-token match
      formality: "smart-casual", // rank 2 → now in range for active
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
    assert.equal(result.id, "smart", "rank 1 and rank 2 must be equally top-tier for active: the better-matched rank 2 item wins");
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

// ── G. Active/busy practicality band (O7-equivalent end-to-end regression) ───
// Covers the narrow Option 2 revision: OCCASION_FORMALITY_TARGET["active"]
// {1,1}→{1,2} and _OCCASION_MAX_RANK["active"] 1→2. O7 flow:
//   Low-energy → Give me energy → Softer / more flexible fabrics →
//   Active / busy day → nAia chooses.
// No exact outfit is asserted — only tier/eligibility membership (formalityFit →
// formalityFitPriority → isTiedAtT1T4) and that T3/T4 handling is unaffected.

describe("G. Active/busy practicality band", () => {
  const activeSession = {
    occasion: "active", formalityConditional: null as string | null,
    moods: ["low-energy"], desiredFeelings: ["energised"],
    bodyNeeds: ["softer-easier-fabrics"], coverageConditional: null as string | null,
    todayColours: { preferred: [], avoid: [] }, practicalIds: [],
    source: "my-closet" as const,
  };

  const makeItem = (
    id: string,
    category: string,
    opts: Partial<{ occasions: string[]; styleTags: string[]; formality: string | null }> = {},
  ): ClosetAnchorInput => ({
    type: "closet", id, name: id,
    category,
    colors: ["black"], primaryColor: "black",
    pattern: null, material: null,
    styleTags: opts.styleTags ?? [],
    occasions: opts.occasions ?? ["active"],
    imageUrl: "",
    formality: opts.formality ?? null,
  } as ClosetAnchorInput);

  const makeCandidate = (id: "A" | "B" | "C", pieces: Array<{ id: string; slot: string }>): OutfitCandidate => ({
    id,
    pieces: pieces.map((p) => ({ closetId: p.id, slot: p.slot, label: p.id, colors: [] })),
  });

  // Mirrors the production T2 derivation in styleme-result.server.ts
  // (suit.formalityFit === "within-target" ? 1 : suit.formalityFit === "unknown" ? 0 : -1).
  const formalityPriority = (fit: string) =>
    fit === "within-target" ? 1 : fit === "unknown" ? 0 : -1;

  const BASE_KEY: Omit<CandidateRankKey, "formalityFitPriority" | "formalityOvershootAbs"> = {
    occasionTier: 2, knownViolationCount: 0, bodyNeedFitScore: null,
    intentionFit: 0, passportAlignment: 0,
    optionalNonMatchCount: 0, discretionaryPieceCount: 0,
  };

  it("G1 O7: rank-1 casual and rank-2 smart-casual/practical Active candidates are BOTH within-target and model-eligible together", () => {
    const casualTop = makeItem("ct", "TOPS", { formality: "casual" });
    const casualBottom = makeItem("cb", "BOTTOMS", { formality: "casual" });
    const casualShoe = makeItem("cs", "SHOES", { formality: "casual" });
    const candidateCasual = makeCandidate("A", [
      { id: "ct", slot: "top" }, { id: "cb", slot: "bottom" }, { id: "cs", slot: "shoe" },
    ]);

    // Loafers/flats + smart trousers + comfortable knit — practical but one rank up.
    const smartTop = makeItem("st", "TOPS", { formality: "smart-casual" });
    const smartBottom = makeItem("sb", "BOTTOMS", { formality: "smart-casual" });
    const smartShoe = makeItem("ss", "SHOES", { formality: "smart-casual" });
    const candidatePractical = makeCandidate("B", [
      { id: "st", slot: "top" }, { id: "sb", slot: "bottom" }, { id: "ss", slot: "shoe" },
    ]);

    const allItems = [casualTop, casualBottom, casualShoe, smartTop, smartBottom, smartShoe];
    const scoreCasual = evaluateCompleteOutfit(candidateCasual, allItems, activeSession);
    const scorePractical = evaluateCompleteOutfit(candidatePractical, allItems, activeSession);

    assert.strictEqual(scoreCasual.formalityFit, "within-target", "rank-1 Active outfit must be within-target");
    assert.strictEqual(
      scorePractical.formalityFit, "within-target",
      "rank-2 smart-casual/practical Active outfit must ALSO be within-target under the loosened {1,2} band — this is the core fix",
    );

    const keyCasual: CandidateRankKey = {
      ...BASE_KEY,
      formalityFitPriority: formalityPriority(scoreCasual.formalityFit),
      formalityOvershootAbs: Math.abs(scoreCasual.formalityOvershoot),
    };
    const keyPractical: CandidateRankKey = {
      ...BASE_KEY,
      formalityFitPriority: formalityPriority(scorePractical.formalityFit),
      formalityOvershootAbs: Math.abs(scorePractical.formalityOvershoot),
    };
    assert.ok(
      isTiedAtT1T4(keyCasual, keyPractical),
      "rank-1 and rank-2 Active candidates must be tied at T1-T4 (both model-eligible together) under the loosened band — " +
      "not excluded from Claude's eligible set solely because a rank-1 candidate exists",
    );
  });

  it("G2 O7 upper-bound guard: rank-4+/evening Active candidate remains excluded despite the loosening", () => {
    const blazer = makeItem("bl", "OUTERWEAR", { formality: "business-formal" });
    const tailored = makeItem("tt", "BOTTOMS", { formality: "business-formal" });
    const dressShoe = makeItem("ds", "SHOES", { formality: "evening" });
    const candidateFormal = makeCandidate("C", [
      { id: "bl", slot: "outerwear" }, { id: "tt", slot: "bottom" }, { id: "ds", slot: "shoe" },
    ]);

    const casualTop = makeItem("ct2", "TOPS", { formality: "casual" });
    const casualShoe = makeItem("cs2", "SHOES", { formality: "casual" });
    const candidateCasual = makeCandidate("A", [
      { id: "ct2", slot: "top" }, { id: "cs2", slot: "shoe" },
    ]);

    const allItems = [blazer, tailored, dressShoe, casualTop, casualShoe];
    const scoreFormal = evaluateCompleteOutfit(candidateFormal, allItems, activeSession);
    const scoreCasual = evaluateCompleteOutfit(candidateCasual, allItems, activeSession);

    assert.strictEqual(
      scoreFormal.formalityFit, "overdressed",
      "rank-4+/evening Active candidate must remain overdressed even under the loosened {1,2} band",
    );
    assert.ok(scoreFormal.formalityOvershoot >= 2, "formal/evening overshoot must still be large, not softened by the loosening");

    const keyFormal: CandidateRankKey = {
      ...BASE_KEY,
      formalityFitPriority: formalityPriority(scoreFormal.formalityFit),
      formalityOvershootAbs: Math.abs(scoreFormal.formalityOvershoot),
    };
    const keyCasual: CandidateRankKey = {
      ...BASE_KEY,
      formalityFitPriority: formalityPriority(scoreCasual.formalityFit),
      formalityOvershootAbs: Math.abs(scoreCasual.formalityOvershoot),
    };
    assert.ok(
      !isTiedAtT1T4(keyFormal, keyCasual),
      "formal/evening candidate must NOT be tied with a casual candidate — the loosening must not make formal/evening Active outfits normal candidates",
    );
  });

  it("G3 T3/T4 non-regression: softer-easier-fabrics slot-bonus scoring and give-energy intention fit are unaffected by the Active formality-band change", () => {
    // softer-easier-fabrics: same fabric-based scoring exercised by A15-A19, untouched
    // by this patch (scoreBodyNeedForClosetItem takes no occasion/formality input).
    const soft = scoreBodyNeedForClosetItem("softer-easier-fabrics", {
      fitProfile: null, waistShape: null, styleTags: [],
      approvedProfile: {
        exactSlot: null, outfitFunction: null, dressRegister: null,
        fabricBehaviour: ["soft"], silhouetteCharacter: [], visualWeight: null,
        construction: null, stylingEffort: null, layeringBehaviour: null,
        waistComfort: null, statementLevel: null, occasionFit: null,
        intentionPotentials: null, naturalPairings: null, intentionalMix: null,
        avoidInStyleMe: null,
      },
    });
    assert.ok(soft.fitScore !== null && soft.fitScore > 0.5, "softer-easier-fabrics scoring must be unchanged: soft fabric → fitScore > 0.5");

    // give-energy: computeIntentionFit/computeEnergyFit take no occasion parameter at
    // all — they cannot be affected by OCCASION_FORMALITY_TARGET/_OCCASION_MAX_RANK.
    // Exercising it here confirms it still runs end-to-end against an Active-shaped
    // candidate set without error and produces a score in the defined [0,3] range.
    const candidateA = makeCandidate("A", [{ id: "ct", slot: "top" }, { id: "cs", slot: "shoe" }]);
    const casualTop = makeItem("ct", "TOPS", { formality: "casual" });
    const casualShoe = makeItem("cs", "SHOES", { formality: "casual" });
    const energyFit = computeIntentionFit(["give-energy"], candidateA, candidateA, [casualTop, casualShoe], undefined);
    assert.ok(
      Number.isFinite(energyFit) && energyFit >= 0 && energyFit <= 3,
      `give-energy intentionFit must remain a well-formed score in [0,3], got ${energyFit}`,
    );
  });
});
