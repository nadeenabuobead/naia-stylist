// V2-B2 contract tests.
//
// Tests: 12-screen onboarding quiz, COLOUR_FAMILIES, Section 5 placeholder,
// shopping priorities approved list, required-screen contracts,
// mutual exclusion logic, legacy hint detection.
//
// Run: node --test --import tsx/esm app/lib/passport/v2-b2.test.ts

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  quizQuestions,
  getTotalSteps,
  COLOUR_FAMILIES,
  type QuizQuestion,
} from "../onboarding/quiz-data.js";

// ─────────────────────────────────────────────────────────────────────────────
// B2.1 — COLOUR_FAMILIES
// ─────────────────────────────────────────────────────────────────────────────

describe("B2.1 COLOUR_FAMILIES", () => {
  it("has exactly 10 colour families", () => {
    assert.equal(COLOUR_FAMILIES.length, 10);
  });

  it("does not contain 'prints'", () => {
    assert.ok(!COLOUR_FAMILIES.some(c => c.id === "prints"));
  });

  it("does not contain 'colorful'", () => {
    assert.ok(!COLOUR_FAMILIES.some(c => c.id === "colorful"));
  });

  it("every entry has id, hex, and name", () => {
    for (const c of COLOUR_FAMILIES) {
      assert.ok(c.id, `entry missing id: ${JSON.stringify(c)}`);
      assert.ok(c.hex, `entry missing hex: ${c.id}`);
      assert.ok(c.name, `entry missing name: ${c.id}`);
    }
  });

  it("contains canonical ids: black, white-cream, navy, grey, beige-brown", () => {
    const ids = new Set(COLOUR_FAMILIES.map(c => c.id));
    assert.ok(ids.has("black"));
    assert.ok(ids.has("white-cream"));
    assert.ok(ids.has("navy"));
    assert.ok(ids.has("grey"));
    assert.ok(ids.has("beige-brown"));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// B2.2 — 12-screen onboarding quiz
// ─────────────────────────────────────────────────────────────────────────────

describe("B2.2 12-screen quiz", () => {
  it("getTotalSteps() returns 12", () => {
    assert.equal(getTotalSteps(), 12);
  });

  it("quizQuestions array has 12 entries", () => {
    assert.equal(quizQuestions.length, 12);
  });

  it("screen IDs are in the expected order", () => {
    const ids = quizQuestions.map(q => q.id);
    assert.deepEqual(ids, [
      "style-personalities",
      "desired-impression",
      "lifestyle",
      "desired-feelings",
      "becoming",
      "silhouette",
      "wardrobe-disconnection",
      "favorite-colors",
      "style-support",
      "shopping-priorities",
      "trend-appetite",
      "final-notes",
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// B2.3 — Required screens (1, 3, 4; favourite portion of Screen 8)
// ─────────────────────────────────────────────────────────────────────────────

describe("B2.3 required screens", () => {
  it("screen 1 (style-personalities) is required", () => {
    assert.ok(quizQuestions[0].required === true);
  });

  it("screen 2 (desired-impression) is NOT required (skippable)", () => {
    assert.ok(!quizQuestions[1].required);
  });

  it("screen 3 (lifestyle) is required", () => {
    assert.ok(quizQuestions[2].required === true);
  });

  it("screen 4 (desired-feelings) is required", () => {
    assert.ok(quizQuestions[3].required === true);
  });

  it("screen 5 (becoming) is NOT required (skippable)", () => {
    assert.ok(!quizQuestions[4].required);
  });

  it("screen 6 (silhouette) is NOT required (skippable)", () => {
    assert.ok(!quizQuestions[5].required);
  });

  it("screen 7 (wardrobe-disconnection) is NOT required (skippable)", () => {
    assert.ok(!quizQuestions[6].required);
  });

  it("screen 8 (favorite-colors) is required", () => {
    assert.ok(quizQuestions[7].required === true);
  });

  it("screens 9–12 are NOT required", () => {
    for (const q of quizQuestions.slice(8)) {
      assert.ok(!q.required, `screen ${q.id} should not be required`);
    }
  });

  it("exactly 4 screens are marked required", () => {
    assert.equal(quizQuestions.filter(q => q.required).length, 4);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// B2.4 — Screen 8: dual-colour step (favourite + avoid)
// ─────────────────────────────────────────────────────────────────────────────

describe("B2.4 Screen 8 (favourite + avoided colours)", () => {
  const screen8 = quizQuestions.find(q => q.id === "favorite-colors")!;

  it("screen 8 exists with id 'favorite-colors'", () => {
    assert.ok(screen8 !== undefined);
  });

  it("screen 8 has type 'color'", () => {
    assert.equal(screen8.type, "color");
  });

  it("screen 8 has secondaryQuestion for avoid-colors", () => {
    assert.ok(screen8.secondaryQuestion !== undefined);
    assert.equal(screen8.secondaryQuestion!.id, "avoid-colors");
  });

  it("avoid-colors secondary question uses the same 10 COLOUR_FAMILIES", () => {
    const avoidColors = screen8.secondaryQuestion!.colors;
    assert.equal(avoidColors.length, 10);
    const mainIds  = COLOUR_FAMILIES.map(c => c.id).sort();
    const avoidIds = avoidColors.map(c => c.id).sort();
    assert.deepEqual(mainIds, avoidIds);
  });

  it("avoid-colors secondary question is not marked required (no required flag)", () => {
    // secondaryQuestion has no required field — it's always optional
    assert.ok(!(screen8.secondaryQuestion as Record<string, unknown>).required);
  });

  it("favorite-colors maxSelections is 5", () => {
    assert.equal(screen8.maxSelections, 5);
  });

  it("avoid-colors maxSelections is 5", () => {
    assert.equal(screen8.secondaryQuestion!.maxSelections, 5);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// B2.5 — Shopping priorities approved list (6 options, no deferred ones)
// ─────────────────────────────────────────────────────────────────────────────

describe("B2.5 shopping priorities approved options", () => {
  const shoppingQ = quizQuestions.find(q => q.id === "shopping-priorities")!;

  it("shopping-priorities screen exists", () => {
    assert.ok(shoppingQ !== undefined);
  });

  it("has exactly 6 options", () => {
    assert.equal(shoppingQ.options!.length, 6);
  });

  it("contains all 6 approved option IDs", () => {
    const ids = new Set(shoppingQ.options!.map(o => o.id));
    assert.ok(ids.has("versatility"));
    assert.ok(ids.has("comfort"));
    assert.ok(ids.has("price"));
    assert.ok(ids.has("uniqueness"));
    assert.ok(ids.has("occasion-impact"));
    assert.ok(ids.has("trend-relevance"));
  });

  it("does NOT contain deferred option: 'sustainability'", () => {
    assert.ok(!shoppingQ.options!.some(o => o.id === "sustainability"));
  });

  it("does NOT contain deferred option: 'brand'", () => {
    assert.ok(!shoppingQ.options!.some(o => o.id === "brand"));
  });

  it("does NOT contain deferred option: 'quality'", () => {
    assert.ok(!shoppingQ.options!.some(o => o.id === "quality"));
  });

  it("does NOT contain deferred option: 'ethical-sourcing'", () => {
    assert.ok(!shoppingQ.options!.some(o => o.id === "ethical-sourcing"));
  });

  it("maxSelections is 3", () => {
    assert.equal(shoppingQ.maxSelections, 3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// B2.6 — trend-appetite is single type
// ─────────────────────────────────────────────────────────────────────────────

describe("B2.6 trend-appetite (single type)", () => {
  const trendQ = quizQuestions.find(q => q.id === "trend-appetite")!;

  it("trend-appetite screen exists", () => {
    assert.ok(trendQ !== undefined);
  });

  it("has type 'single'", () => {
    assert.equal(trendQ.type, "single");
  });

  it("has 5 options", () => {
    assert.equal(trendQ.options!.length, 5);
  });

  it("is NOT marked required", () => {
    assert.ok(!trendQ.required);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// B2.7 — Lifestyle IDs
// ─────────────────────────────────────────────────────────────────────────────

describe("B2.7 lifestyle option IDs", () => {
  const lifestyleQ = quizQuestions.find(q => q.id === "lifestyle")!;

  it("uses 'always-on-the-go' (not 'on-the-go')", () => {
    const ids = lifestyleQ.options!.map(o => o.id);
    assert.ok(ids.includes("always-on-the-go"), "should have always-on-the-go");
    assert.ok(!ids.includes("on-the-go"), "should not have legacy on-the-go");
  });

  it("retains 'busy-mom'", () => {
    assert.ok(lifestyleQ.options!.some(o => o.id === "busy-mom"));
  });

  it("has exactly 8 options", () => {
    assert.equal(lifestyleQ.options!.length, 8);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// B2.8 — No typicalDay in the onboarding quiz (it's Passport-only)
// ─────────────────────────────────────────────────────────────────────────────

describe("B2.8 typical-day is not in onboarding quiz", () => {
  it("quizQuestions does not contain 'typical-day'", () => {
    assert.ok(!quizQuestions.some(q => q.id === "typical-day"));
  });

  it("quizQuestions does not contain 'structure'", () => {
    assert.ok(!quizQuestions.some(q => q.id === "structure"));
  });

  it("quizQuestions does not contain 'coverage-preferences'", () => {
    assert.ok(!quizQuestions.some(q => q.id === "coverage-preferences"));
  });

  it("quizQuestions does not contain 'neutral-vs-colour'", () => {
    assert.ok(!quizQuestions.some(q => q.id === "neutral-vs-colour"));
  });

  it("quizQuestions does not contain 'colour-intensity'", () => {
    assert.ok(!quizQuestions.some(q => q.id === "colour-intensity"));
  });

  it("quizQuestions does not contain 'print-appetite'", () => {
    assert.ok(!quizQuestions.some(q => q.id === "print-appetite"));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// B2.9 — Legacy hint detection (prints/colorful)
// ─────────────────────────────────────────────────────────────────────────────

describe("B2.9 legacy hint detection", () => {
  const LEGACY_IDS = new Set(["prints", "colorful"]);

  function hasLegacyHint(savedFavColors: string[]): boolean {
    return savedFavColors.some(id => LEGACY_IDS.has(id));
  }

  it("detects legacy hint when favorite-colors contains 'prints'", () => {
    assert.ok(hasLegacyHint(["prints", "black"]));
  });

  it("detects legacy hint when favorite-colors contains 'colorful'", () => {
    assert.ok(hasLegacyHint(["colorful"]));
  });

  it("no legacy hint when favorite-colors has only real colour families", () => {
    assert.ok(!hasLegacyHint(["black", "navy"]));
  });

  it("no legacy hint when favorite-colors is empty", () => {
    assert.ok(!hasLegacyHint([]));
  });

  it("COLOUR_FAMILIES IDs do not overlap with legacy IDs", () => {
    const familyIds = COLOUR_FAMILIES.map(c => c.id);
    for (const id of familyIds) {
      assert.ok(!LEGACY_IDS.has(id), `COLOUR_FAMILIES should not contain legacy id: ${id}`);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// B2.10 — Section 5 placeholder contract
// ─────────────────────────────────────────────────────────────────────────────

describe("B2.10 Section 5 placeholder", () => {
  // Mirrored from passport.tsx
  type SectionId = "identity" | "direction" | "life" | "fit" | "sizes" | "colours" | "wardrobe" | "notes";

  interface SectionDef {
    id:          SectionId;
    subFields:   { draftKey: string }[];
    placeholder?: boolean;
  }

  const SECTIONS: SectionDef[] = [
    { id: "identity",  subFields: [{ draftKey: "style-personalities" }] },
    { id: "direction", subFields: [{ draftKey: "desired-feelings"    }] },
    { id: "life",      subFields: [{ draftKey: "lifestyle"           }] },
    { id: "fit",       subFields: [{ draftKey: "silhouette"          }] },
    { id: "sizes",     subFields: [], placeholder: true                  },
    { id: "colours",   subFields: [{ draftKey: "favorite-colors"     }] },
    { id: "wardrobe",  subFields: [{ draftKey: "wardrobe-disconnection" }] },
  ];

  const sizesSection = SECTIONS.find(s => s.id === "sizes")!;

  it("Section 5 label is 'sizes'", () => {
    assert.equal(sizesSection.id, "sizes");
  });

  it("sizes section has placeholder: true", () => {
    assert.ok(sizesSection.placeholder === true);
  });

  it("sizes section has no subFields", () => {
    assert.equal(sizesSection.subFields.length, 0);
  });

  it("sizes section is excluded from missingSections when placeholder: true", () => {
    function computeMissing(sections: SectionDef[], savedAnswers: Record<string, unknown>): SectionDef[] {
      return sections.filter(s => {
        if (s.placeholder) return false;
        const primary = s.subFields[0];
        if (!primary) return false;
        const v = savedAnswers[primary.draftKey];
        return !Array.isArray(v) || (v as string[]).length === 0;
      });
    }
    const missing = computeMissing(SECTIONS, {});
    assert.ok(!missing.some(s => s.id === "sizes"));
  });

  it("Section 5 is the 5th section (index 4)", () => {
    assert.equal(SECTIONS[4].id, "sizes");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// B2.11 — canProceed: non-required screens always allow Continue
// ─────────────────────────────────────────────────────────────────────────────

describe("B2.11 canProceed for non-required screens", () => {
  // Mirrored from step.$step.tsx
  function canProceed(question: QuizQuestion, multiValue: string[]): boolean {
    if (!question.required) return true;
    if (question.type === "multi" || question.type === "color") return multiValue.length > 0;
    if (question.type === "single") return multiValue.length > 0;
    if (question.type === "text") return multiValue.length > 0; // multiValue holds text chars
    return false;
  }

  it("non-required screen: canProceed is true even with empty selection", () => {
    const q = quizQuestions.find(q => q.id === "becoming")!;
    assert.ok(canProceed(q, []));
  });

  it("required screen (style-personalities): canProceed is false when empty", () => {
    const q = quizQuestions.find(q => q.id === "style-personalities")!;
    assert.ok(!canProceed(q, []));
  });

  it("required screen (style-personalities): canProceed is true with 1 selection", () => {
    const q = quizQuestions.find(q => q.id === "style-personalities")!;
    assert.ok(canProceed(q, ["minimal"]));
  });

  it("required screen (lifestyle): canProceed requires at least 1 selection", () => {
    const q = quizQuestions.find(q => q.id === "lifestyle")!;
    assert.ok(!canProceed(q, []));
    assert.ok(canProceed(q, ["office"]));
  });

  it("required screen (favorite-colors): canProceed requires at least 1 colour", () => {
    const q = quizQuestions.find(q => q.id === "favorite-colors")!;
    assert.ok(!canProceed(q, []));
    assert.ok(canProceed(q, ["black"]));
  });
});
