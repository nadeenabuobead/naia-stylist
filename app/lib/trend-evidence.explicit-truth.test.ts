// app/lib/trend-evidence.explicit-truth.test.ts
//
// Personalised Trend Edit V1 closeout — explicit-truth precedence tests.
// No mocks: exercises the real, exported buildShopperEdit() against the real
// published "spring-2026-colour-direction" report content, controlling only
// the customer evidence bundle. Proves, through the actual public API (never
// an internal helper), that:
//   - an explicit Passport favourite-colour preference is respected and
//     drives a real difference in output (not decorative);
//   - an explicit Passport avoid-colour conflict is NOT silently overridden —
//     it suppresses the positive claim and the customer-facing copy changes
//     to reflect that, rather than the conflict being dropped/ignored;
//   - Closet evidence is only ever used where real (no closet -> no
//     fabricated evidenceClosetItems), and its absence degrades safely
//     (no crash, no empty-array substitute presented as real signal).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildShopperEdit, type ShopperEvidenceBundle } from "./trend-evidence.server";
import { trendReports } from "./trend-reports";

const COLOUR_REPORT = trendReports.find((r) => r.slug === "spring-2026-colour-direction");
if (!COLOUR_REPORT) throw new Error("fixture report 'spring-2026-colour-direction' not found in trend-reports.ts");

function evidenceWith(overrides: Partial<ShopperEvidenceBundle["profile"]>): ShopperEvidenceBundle {
  return {
    hasProfile: true,
    profile: {
      stylePersonalities: ["clean-polished"],
      favoriteColors: [],
      avoidColors: [],
      lifestyle: null,
      desiredFeeling: null,
      desiredFeelings: [],
      desiredImpression: [],
      fitPreferences: [],
      becoming: [],
      styleSupport: [],
      ...overrides,
    },
    closetItems: [],
    reviewSignal: { reviewCount: 0, workedTags: [], didntWorkTags: [] },
  };
}

describe("§TREND-EDIT-V1 — explicit Passport truth precedence (buildShopperEdit, real report content)", () => {
  it("3. an explicit favourite-colour preference is respected — drives a real, specific output difference", () => {
    // "white-cream" (terms: white, cream) genuinely appears in this report's own
    // keyTrends text ("Soft white, cream, stone, espresso... or black") — the
    // match is against real editorial content, not a contrived fixture.
    const evidence = evidenceWith({ favoriteColors: ["white-cream"], avoidColors: [] });
    const edit = buildShopperEdit(COLOUR_REPORT!, evidence);
    assert.ok(
      edit.partToTake.some((b) => b.toLowerCase().includes("soft white")),
      "favourite colour 'white-cream' matches real report text and surfaces the colour-specific bullet — not decorative",
    );
  });

  it("4. an explicit avoid-colour conflict is NOT silently overridden — it suppresses the positive claim the same preference would otherwise produce", () => {
    // Same colour id in both lists — avoidColors must win per the documented contract.
    const conflicted = evidenceWith({ favoriteColors: ["white-cream"], avoidColors: ["white-cream"] });
    const edit = buildShopperEdit(COLOUR_REPORT!, conflicted);
    assert.ok(
      !edit.partToTake.some((b) => b.toLowerCase().includes("soft white")),
      "the avoided colour must not surface as a positive claim despite also being a stated favourite",
    );

    // Control: identical profile minus the avoidColors conflict — proves the
    // suppression above is caused by the conflict, not by some unrelated gate.
    const unconflicted = evidenceWith({ favoriteColors: ["white-cream"], avoidColors: [] });
    const controlEdit = buildShopperEdit(COLOUR_REPORT!, unconflicted);
    assert.notDeepEqual(
      edit.partToTake,
      controlEdit.partToTake,
      "the conflict must visibly change customer-facing copy, not just a silently-dropped internal flag",
    );
  });

  it("5. Closet evidence is used only where real — a real, matching closet item produces a named evidence card", () => {
    // category must be one this report actually matches against (TOPS/BAGS/SHOES/
    // ACCESSORIES) and the colour must appear in the report's own text — "white"
    // appears in keyTrends[0] ("Soft white, cream, stone...").
    const evidence: ShopperEvidenceBundle = {
      ...evidenceWith({}),
      closetItems: [{
        name: "White Tote",
        imageUrl: "https://example.com/white-tote.jpg",
        category: "BAGS",
        subcategory: "tote",
        primaryColor: "white",
        styleTags: [],
        occasions: [],
        material: null,
      }],
    };
    const edit = buildShopperEdit(COLOUR_REPORT!, evidence);
    assert.ok(
      edit.evidenceClosetItems.some((i) => i.name === "White Tote"),
      "a real, trend-relevant closet item surfaces as named evidence",
    );
  });

  it("6. no Closet data degrades safely — empty closet never fabricates evidence, never crashes", () => {
    const evidence = evidenceWith({});
    assert.doesNotThrow(() => buildShopperEdit(COLOUR_REPORT!, evidence));
    const edit = buildShopperEdit(COLOUR_REPORT!, evidence);
    assert.deepEqual(edit.evidenceClosetItems, [], "no closet items -> no fabricated evidence cards");
  });
});
