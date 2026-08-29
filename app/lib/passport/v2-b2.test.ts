// V2-B2 contract tests — updated for Passport Rev 6 (2026-08-29).
//
// Tests: Rev 6 8-screen onboarding quiz, COLOUR_FAMILIES, Section 5,
// optional-screen contracts (Rev 6: no required screens), legacy hint detection,
// and backward-compat assertions about removed first-onboarding screens.
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
// B2.2 — Rev 6 onboarding quiz (8 screens)
// ─────────────────────────────────────────────────────────────────────────────

describe("B2.2 Rev 6 8-screen quiz", () => {
  it("getTotalSteps() returns 8", () => {
    assert.equal(getTotalSteps(), 8);
  });

  it("quizQuestions array has 8 entries", () => {
    assert.equal(quizQuestions.length, 8);
  });

  it("screen IDs are in the Rev 6 approved order", () => {
    const ids = quizQuestions.map(q => q.id);
    assert.deepEqual(ids, [
      "current-goal",
      "style-personalities",
      "successful-outfit-gives",
      "lifestyle",
      "favorite-colors",
      "silhouette",
      "fit-concerns",
      "dressing-preferences",
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// B2.3 — Rev 6: all screens are optional (no required screens)
// Previously (V2-B2), style-personalities/lifestyle/desired-feelings/favorite-colors
// were required. Rev 6 removes the required concept entirely from first onboarding.
// ─────────────────────────────────────────────────────────────────────────────

describe("B2.3 Rev 6 optional screens (no screen marked required)", () => {
  it("no screen has required: true", () => {
    assert.equal(quizQuestions.filter(q => q.required).length, 0);
  });

  for (let i = 0; i < 8; i++) {
    const label = ["current-goal", "style-personalities", "successful-outfit-gives",
      "lifestyle", "favorite-colors", "silhouette", "fit-concerns", "dressing-preferences"][i];
    it(`screen ${i + 1} (${label}) is optional`, () => {
      assert.ok(!quizQuestions[i].required, `${label} must not be marked required`);
    });
  }
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
// B2.5 — shopping-priorities removed from first onboarding in Rev 6
// It is now a Passport-only question (editable in Profile but not asked during
// first onboarding). Legacy stored shoppingPriorities values are preserved in DB.
// ─────────────────────────────────────────────────────────────────────────────

describe("B2.5 shopping-priorities NOT in Rev 6 first onboarding", () => {
  it("shopping-priorities is NOT in quizQuestions", () => {
    assert.ok(!quizQuestions.some(q => q.id === "shopping-priorities"),
      "shopping-priorities must be absent from the onboarding quiz since Rev 6");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// B2.6 — trend-appetite removed from first onboarding in Rev 6
// It is now a Passport-only question. Legacy stored trendAppetite is preserved.
// ─────────────────────────────────────────────────────────────────────────────

describe("B2.6 trend-appetite NOT in Rev 6 first onboarding", () => {
  it("trend-appetite is NOT in quizQuestions", () => {
    assert.ok(!quizQuestions.some(q => q.id === "trend-appetite"),
      "trend-appetite must be absent from the onboarding quiz since Rev 6");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// B2.7 — Lifestyle IDs (Rev 6 V3 IDs)
// ─────────────────────────────────────────────────────────────────────────────

describe("B2.7 lifestyle option IDs (Rev 6 V3)", () => {
  const lifestyleQ = quizQuestions.find(q => q.id === "lifestyle")!;

  it("has exactly 7 options (V3 — removed always-on-the-go / busy-mom)", () => {
    assert.equal(lifestyleQ.options!.length, 7);
  });

  it("uses V3 IDs: work-office, everyday-casual, dinners-going-out", () => {
    const ids = lifestyleQ.options!.map(o => o.id);
    assert.ok(ids.includes("work-office"), "work-office missing");
    assert.ok(ids.includes("everyday-casual"), "everyday-casual missing");
    assert.ok(ids.includes("dinners-going-out"), "dinners-going-out missing");
  });

  it("uses V3 IDs: events-special-occasions, family-parenting, travel, active-busy-days", () => {
    const ids = lifestyleQ.options!.map(o => o.id);
    assert.ok(ids.includes("events-special-occasions"), "events-special-occasions missing");
    assert.ok(ids.includes("family-parenting"), "family-parenting missing");
    assert.ok(ids.includes("travel"), "travel missing");
    assert.ok(ids.includes("active-busy-days"), "active-busy-days missing");
  });

  it("does NOT contain removed V2 IDs: always-on-the-go, busy-mom, on-the-go", () => {
    const ids = lifestyleQ.options!.map(o => o.id);
    assert.ok(!ids.includes("always-on-the-go"), "always-on-the-go should be absent");
    assert.ok(!ids.includes("busy-mom"), "busy-mom should be absent");
    assert.ok(!ids.includes("on-the-go"), "on-the-go should be absent");
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

describe("B2.10 Section 5 (V2-C activated: optional body-area pickers)", () => {
  // Mirrored from passport.tsx (updated for V2-C)
  type SectionId = "identity" | "direction" | "life" | "fit" | "sizes" | "colours" | "wardrobe" | "notes";

  interface SectionDef {
    id:          SectionId;
    subFields:   { draftKey: string }[];
    placeholder?: boolean;
    optional?:   boolean;
  }

  const SECTIONS: SectionDef[] = [
    { id: "identity",  subFields: [{ draftKey: "style-personalities" }] },
    { id: "direction", subFields: [{ draftKey: "desired-feelings"    }] },
    { id: "life",      subFields: [{ draftKey: "lifestyle"           }] },
    { id: "fit",       subFields: [{ draftKey: "silhouette"          }] },
    { id: "sizes",     subFields: [{ draftKey: "body-focus-areas" }, { draftKey: "body-avoid-areas" }], optional: true },
    { id: "colours",   subFields: [{ draftKey: "favorite-colors"     }] },
    { id: "wardrobe",  subFields: [{ draftKey: "wardrobe-disconnection" }] },
  ];

  const sizesSection = SECTIONS.find(s => s.id === "sizes")!;

  it("Section 5 id is 'sizes'", () => {
    assert.equal(sizesSection.id, "sizes");
  });

  it("sizes section has optional: true (V2-C activated; no longer a placeholder)", () => {
    assert.ok(sizesSection.optional === true);
    assert.ok(sizesSection.placeholder !== true);
  });

  it("sizes section has 2 subFields (body-focus-areas, body-avoid-areas)", () => {
    assert.equal(sizesSection.subFields.length, 2);
    assert.equal(sizesSection.subFields[0].draftKey, "body-focus-areas");
    assert.equal(sizesSection.subFields[1].draftKey, "body-avoid-areas");
  });

  it("sizes section is excluded from missingSections when optional: true", () => {
    function computeMissing(sections: SectionDef[], savedAnswers: Record<string, unknown>): SectionDef[] {
      return sections.filter(s => {
        if (s.placeholder || s.optional) return false;
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
// B2.11 — canProceed: Rev 6 all screens are optional → always can proceed
// ─────────────────────────────────────────────────────────────────────────────

describe("B2.11 canProceed — Rev 6 all screens optional", () => {
  // Mirrored from step.$step.tsx
  function canProceed(question: QuizQuestion, multiValue: string[]): boolean {
    if (!question.required) return true;
    if (question.type === "multi" || question.type === "color") return multiValue.length > 0;
    if (question.type === "single") return multiValue.length > 0;
    if (question.type === "text") return multiValue.length > 0;
    return false;
  }

  it("style-personalities: canProceed is true even with empty selection (optional in Rev 6)", () => {
    const q = quizQuestions.find(q => q.id === "style-personalities")!;
    assert.ok(canProceed(q, []), "style-personalities is optional in Rev 6 — must allow empty");
  });

  it("lifestyle: canProceed is true even with empty selection (optional in Rev 6)", () => {
    const q = quizQuestions.find(q => q.id === "lifestyle")!;
    assert.ok(canProceed(q, []), "lifestyle is optional in Rev 6 — must allow empty");
  });

  it("favorite-colors: canProceed is true even with empty selection (optional in Rev 6)", () => {
    const q = quizQuestions.find(q => q.id === "favorite-colors")!;
    assert.ok(canProceed(q, []), "favorite-colors is optional in Rev 6 — must allow empty");
  });

  it("dressing-preferences: canProceed is true even with empty selection (optional in Rev 6)", () => {
    const q = quizQuestions.find(q => q.id === "dressing-preferences")!;
    assert.ok(canProceed(q, []), "dressing-preferences is optional");
  });

  it("all 8 Rev 6 screens: canProceed with empty selection", () => {
    for (const q of quizQuestions) {
      assert.ok(canProceed(q, []), `${q.id} must allow empty (optional screen)`);
    }
  });
});
