// app/lib/styleme/session-vocabulary.test.ts
//
// Copy-refinement contract for the StyleMe questionnaire (2026-09).
//
// The point of these tests: the customer-facing wording was softened so the
// questionnaire stops implying the customer is struggling or trying to fix
// themselves. NONE of the stable internal signals moved. These tests pin that
// separation so a future copy edit can never silently become a taxonomy change.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  STYLEME_STATE_OPTIONS,
  STYLEME_INTENTION_OPTIONS,
  STYLEME_FIT_COMFORT_OPTIONS,
  STYLEME_STATE_LABELS,
  STYLEME_INTENTION_LABELS,
  STYLEME_FIT_COMFORT_LABELS,
  STYLEME_POSITIVE_STATE_IDS,
  STYLEME_FIT_COMFORT_EXCLUSIVE_ID,
} from "./session-vocabulary.js";
import {
  ANSWER_REGISTRY,
  SESSION_QUESTION_IDS as SQ,
  BODY_NEED_NORMALIZATION_MAP,
  CANONICAL_REV3_BODY_NEED_IDS,
  REV3_BODY_NEED_TO_LEGACY_ENGINE,
} from "../ai/signal-contract.js";
import { INTENTION_IDS } from "../admin/styleme-garment-profile.vocab.js";
import {
  NAIA_STATE_LABELS,
  NAIA_INTENTION_LABELS,
  NAIA_BODY_NEED_LABELS,
} from "../ai/styleme-result.server.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const srcOf = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

// ─────────────────────────────────────────────────────────────────────────────
// 1. Revised Step 2 display labels map to the SAME existing intention IDs
// ─────────────────────────────────────────────────────────────────────────────

describe("SMV.1 — Intention labels map to the canonical 16 intention IDs", () => {
  const REVISED_LABEL_TO_ID: Record<string, string> = {
    "Help me feel like myself":   "feel-like-myself",
    "Help me feel confident":  "confidence",
    "Ground me":                  "ground-me",
    "Give me structure":          "give-structure",
    "Make things feel easy":      "make-it-easy",
    "Help me feel put together":  "feel-put-together",
    "Make me feel attractive":    "feel-attractive",
    "Bring some energy":          "give-energy",
    "Help me feel softer":        "feel-softer",
    "Help me feel sharper":       "feel-sharper",
    "Help me feel less exposed":  "feel-less-exposed",
    "Let me express myself":      "express-myself",
    // 2026-09 taxonomy expansion (12 → 16).
    "Help me feel elevated":      "feel-elevated",
    "Let me stand out":           "stand-out",
    "Make it feel fun":           "feel-fun",
    "Help me feel powerful":      "feel-powerful",
  };

  for (const [label, id] of Object.entries(REVISED_LABEL_TO_ID)) {
    it(`"${label}" resolves to the existing ID "${id}"`, () => {
      const option = STYLEME_INTENTION_OPTIONS.find((o) => o.label === label);
      assert.ok(option, `no intention option carries the label "${label}"`);
      assert.equal(option!.id, id);
    });
  }

  it("the intention ID set is byte-identical to the approved garment taxonomy", () => {
    assert.deepEqual(
      [...STYLEME_INTENTION_OPTIONS.map((o) => o.id)].sort(),
      [...INTENTION_IDS].sort(),
      "Step 2 IDs must equal INTENTION_IDS in styleme-garment-profile.vocab.ts",
    );
  });

  it("no State ID or near-miss spelling leaked into the intention set", () => {
    const FORBIDDEN = ["feel-energised", "feel-confident", "feel-calm", "feel-social", "have-fun", "powerful", "elevated"];
    for (const id of FORBIDDEN) {
      assert.equal(
        STYLEME_INTENTION_OPTIONS.some((o) => o.id === id),
        false,
        `"${id}" is not a valid intention ID`,
      );
    }
  });

  it("every intention ID is registered as an INTENTIONS answer", () => {
    for (const option of STYLEME_INTENTION_OPTIONS) {
      const entry = ANSWER_REGISTRY.find((m) => m.id === option.id && m.questionId === SQ.INTENTIONS);
      assert.ok(entry, `ANSWER_REGISTRY must register intention "${option.id}"`);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Revised Step 3 labels map to the SAME existing physical/body-need IDs
// ─────────────────────────────────────────────────────────────────────────────

describe("SMV.2 — revised Fit / Comfort labels map to the existing body-need IDs", () => {
  const REVISED_LABEL_TO_ID: Record<string, string> = {
    "More room around my waist":            "nothing-tight-waist",
    "A little more ease through the body":  "less-body-conscious",
    "More coverage":                        "more-coverage",
    "Soft / easy fabrics":                  "softer-easier-fabrics",
    "Loose and comfortable":                "loose-comfortable",
    "Keep some shape":                      "still-want-shape",
    "Waist definition":                     "waist-definition",
    "More structure / definition":          "structured-shape",
    "No specific preference":               "nothing-specific",
  };

  for (const [label, id] of Object.entries(REVISED_LABEL_TO_ID)) {
    it(`"${label}" resolves to the existing ID "${id}"`, () => {
      const option = STYLEME_FIT_COMFORT_OPTIONS.find((o) => o.label === label);
      assert.ok(option, `no fit/comfort option carries the label "${label}"`);
      assert.equal(option!.id, id);
    });
  }

  it("the 8 scoring IDs still equal CANONICAL_REV3_BODY_NEED_IDS", () => {
    const scoringIds = STYLEME_FIT_COMFORT_OPTIONS
      .map((o) => o.id)
      .filter((id) => id !== STYLEME_FIT_COMFORT_EXCLUSIVE_ID);
    assert.deepEqual([...scoringIds].sort(), [...CANONICAL_REV3_BODY_NEED_IDS].sort());
  });

  it("the QA-tested normalization targets are unchanged by the copy edit", () => {
    assert.equal(BODY_NEED_NORMALIZATION_MAP["nothing-tight-waist"], "soft-and-forgiving-around-waist");
    assert.equal(BODY_NEED_NORMALIZATION_MAP["less-body-conscious"], "relaxed");
    assert.equal(BODY_NEED_NORMALIZATION_MAP["loose-comfortable"], "relaxed");
    assert.equal(REV3_BODY_NEED_TO_LEGACY_ENGINE["nothing-tight-waist"], "soft-and-forgiving-around-waist");
    assert.equal(REV3_BODY_NEED_TO_LEGACY_ENGINE["less-body-conscious"], "relaxed");
    assert.equal(REV3_BODY_NEED_TO_LEGACY_ENGINE["loose-comfortable"], "relaxed");
  });

  it("waist-definition stays a distinct explicit physical request", () => {
    assert.ok(STYLEME_FIT_COMFORT_OPTIONS.some((o) => o.id === "waist-definition"));
    assert.equal(BODY_NEED_NORMALIZATION_MAP["waist-definition"], undefined,
      "waist-definition must not be collapsed into another signal");
  });

  it("physical 'Soft / easy fabrics' is a different signal from the emotional 'feel-softer' intention", () => {
    assert.ok(STYLEME_FIT_COMFORT_OPTIONS.some((o) => o.id === "softer-easier-fabrics"));
    assert.ok(STYLEME_INTENTION_OPTIONS.some((o) => o.id === "feel-softer"));
    assert.equal(
      STYLEME_FIT_COMFORT_OPTIONS.some((o) => o.id === "feel-softer"),
      false,
      "the emotional intention must never appear as a body need",
    );
  });

  it("give-structure (intention) stays distinct from structured-shape (body need)", () => {
    assert.ok(STYLEME_INTENTION_OPTIONS.some((o) => o.id === "give-structure"));
    assert.ok(STYLEME_FIT_COMFORT_OPTIONS.some((o) => o.id === "structured-shape"));
    assert.equal(STYLEME_FIT_COMFORT_OPTIONS.some((o) => o.id === "give-structure"), false);
    assert.equal(STYLEME_INTENTION_OPTIONS.some((o) => o.id === "structured-shape"), false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. New State labels map to stable new State IDs
// ─────────────────────────────────────────────────────────────────────────────

describe("SMV.3 — new positive States have stable IDs", () => {
  const NEW_STATE_LABEL_TO_ID: Record<string, string> = {
    "I feel confident":         "feel-confident",
    "I feel energised":         "feel-energised",
    "I feel calm":              "feel-calm",
    "I feel excited / social":  "feel-social",
  };

  for (const [label, id] of Object.entries(NEW_STATE_LABEL_TO_ID)) {
    it(`"${label}" resolves to the State ID "${id}"`, () => {
      const option = STYLEME_STATE_OPTIONS.find((o) => o.label === label);
      assert.ok(option, `no State option carries the label "${label}"`);
      assert.equal(option!.id, id);
    });
  }

  it("STYLEME_POSITIVE_STATE_IDS lists exactly the four additions", () => {
    assert.deepEqual([...STYLEME_POSITIVE_STATE_IDS].sort(), Object.values(NEW_STATE_LABEL_TO_ID).sort());
  });

  it("all ten original State IDs survive unchanged", () => {
    const ORIGINAL = [
      "feel-good", "stressed-overloaded", "low-energy", "not-feeling-like-myself",
      "physically-uncomfortable", "self-conscious", "going-through-change",
      "want-reset", "nothing-in-particular", "other",
    ];
    for (const id of ORIGINAL) {
      assert.ok(STYLEME_STATE_OPTIONS.some((o) => o.id === id), `State "${id}" must survive`);
    }
  });

  it("State IDs are unique", () => {
    const ids = STYLEME_STATE_OPTIONS.map((o) => o.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  it("the screen leads with positive and neutral States", () => {
    const firstSix = STYLEME_STATE_OPTIONS.slice(0, 6).map((o) => o.id);
    assert.deepEqual(firstSix, [
      "feel-good", "feel-confident", "feel-energised", "feel-calm", "feel-social", "nothing-in-particular",
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4-6. State values must not masquerade as explicit intentions
// ─────────────────────────────────────────────────────────────────────────────

describe("SMV.4 — State and Intention remain distinct dimensions", () => {
  it("no State ID is also an intention ID", () => {
    const intentionIds = new Set<string>(STYLEME_INTENTION_OPTIONS.map((o) => o.id));
    for (const option of STYLEME_STATE_OPTIONS) {
      assert.equal(intentionIds.has(option.id), false, `"${option.id}" cannot be both a State and an Intention`);
    }
  });

  it("every State carries zero ranking weight and activates no product fields", () => {
    for (const option of STYLEME_STATE_OPTIONS) {
      const entry = ANSWER_REGISTRY.find((m) => m.id === option.id && m.questionId === SQ.STATE);
      assert.ok(entry, `ANSWER_REGISTRY must register State "${option.id}"`);
      assert.equal(entry!.rankingWeight, "none");
      assert.deepEqual(entry!.activatedFields, []);
    }
  });

  it("SMV.5 — 'I feel energised' does not mean the customer selected give-energy", () => {
    const state = STYLEME_STATE_OPTIONS.find((o) => o.label === "I feel energised")!;
    assert.equal(state.id, "feel-energised");
    assert.notEqual(state.id, "give-energy");
    assert.equal(
      ANSWER_REGISTRY.some((m) => m.id === "feel-energised" && m.questionId === SQ.INTENTIONS),
      false,
      "feel-energised must not be registered as an intention answer",
    );
    // The result route's intention translation is keyed by intention ID only.
    const resultSrc = srcOf("app/routes/style-me/result.tsx");
    assert.ok(!resultSrc.includes('"feel-energised"'), "state IDs must never appear in the intention translation");
  });

  it("SMV.6 — 'I feel confident' does not mean the customer selected confidence", () => {
    const state = STYLEME_STATE_OPTIONS.find((o) => o.label === "I feel confident")!;
    assert.equal(state.id, "feel-confident");
    assert.notEqual(state.id, "confidence");
    assert.equal(
      ANSWER_REGISTRY.some((m) => m.id === "feel-confident" && m.questionId === SQ.INTENTIONS),
      false,
      "feel-confident must not be registered as an intention answer",
    );
    const resultSrc = srcOf("app/routes/style-me/result.tsx");
    assert.ok(!resultSrc.includes('"feel-confident"'), "state IDs must never appear in the intention translation");
  });

  it("'I feel calm' does not become the feel-softer intention", () => {
    const state = STYLEME_STATE_OPTIONS.find((o) => o.label === "I feel calm")!;
    assert.equal(state.id, "feel-calm");
    assert.notEqual(state.id, "feel-softer");
    assert.equal(
      ANSWER_REGISTRY.some((m) => m.id === "feel-calm" && m.questionId === SQ.INTENTIONS),
      false,
    );
  });

  it("State is never translated into a body need", () => {
    for (const option of STYLEME_STATE_OPTIONS) {
      assert.equal(BODY_NEED_NORMALIZATION_MAP[option.id], undefined,
        `State "${option.id}" must not normalise to a body-need signal`);
      assert.equal(CANONICAL_REV3_BODY_NEED_IDS.has(option.id), false);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. Saved session / result surfaces show labels, never raw IDs
// ─────────────────────────────────────────────────────────────────────────────

describe("SMV.7 — session summary and model prompt use the customer-facing labels", () => {
  it("the result page resolves State and Intention through the shared vocabulary", () => {
    const src = srcOf("app/routes/style-me/result.tsx");
    assert.ok(src.includes("const REV3_STATE_LABELS = STYLEME_STATE_LABELS"));
    assert.ok(src.includes("const REV3_INTENTION_LABELS = STYLEME_INTENTION_LABELS"));
  });

  it("every State ID renders a human-readable label on the result page", () => {
    for (const option of STYLEME_STATE_OPTIONS) {
      const label = STYLEME_STATE_LABELS[option.id];
      assert.ok(label && label.length > 0, `State "${option.id}" must have a label`);
      assert.notEqual(label, option.id, `State "${option.id}" must not render as its raw ID`);
      assert.match(label, /^[A-Z]/, `State label for "${option.id}" must read as prose, not a kebab-case ID`);
    }
  });

  it("every Intention ID renders a human-readable label on the result page", () => {
    for (const option of STYLEME_INTENTION_OPTIONS) {
      const label = STYLEME_INTENTION_LABELS[option.id];
      assert.ok(label && label.length > 0, `Intention "${option.id}" must have a label`);
      assert.notEqual(label, option.id, `Intention "${option.id}" must not render as its raw ID`);
    }
  });

  it("the model prompt reads the same State/Intention wording the customer read", () => {
    for (const option of STYLEME_STATE_OPTIONS) {
      if (option.id === "other") continue; // prompt-only suffix points at the free-text note
      assert.equal(NAIA_STATE_LABELS[option.id], option.label);
    }
    for (const option of STYLEME_INTENTION_OPTIONS) {
      assert.equal(NAIA_INTENTION_LABELS[option.id], option.label);
    }
  });

  it("the model prompt reads the same Fit / Comfort wording, minus nothing-specific", () => {
    for (const option of STYLEME_FIT_COMFORT_OPTIONS) {
      if (option.id === STYLEME_FIT_COMFORT_EXCLUSIVE_ID) {
        assert.equal(NAIA_BODY_NEED_LABELS[option.id], undefined,
          "nothing-specific signals the absence of a requirement and must carry no prompt label");
        continue;
      }
      assert.equal(NAIA_BODY_NEED_LABELS[option.id], option.label);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8-9. No behaviour is keyed off display strings; no garment retagging needed
// ─────────────────────────────────────────────────────────────────────────────

describe("SMV.8 — no scoring path parses a display label", () => {
  const ENGINE_FILES = [
    "app/lib/ai/styleme-anchor.server.ts",
    "app/lib/ai/styleme-recommendation.ts",
    "app/lib/ai/styleme-profile-gate.ts",
    "app/lib/admin/styleme-garment-profile.server.ts",
  ];

  const REVISED_LABELS = [
    ...Object.values(STYLEME_FIT_COMFORT_LABELS),
    "Help me feel confident",
    "Bring some energy",
  ];

  for (const file of ENGINE_FILES) {
    it(`${file} branches on IDs, never on revised display copy`, () => {
      const src = srcOf(file);
      for (const label of REVISED_LABELS) {
        // "More coverage" and "Loose and comfortable" are unchanged labels that may
        // legitimately appear in prose comments; assert they are not used in a comparison.
        assert.ok(
          !src.includes(`=== "${label}"`) && !src.includes(`includes("${label}")`),
          `${file} must not compare against the display string "${label}"`,
        );
      }
    });
  }

  it("the Fit / Comfort screen derives its exclusive ID from the vocabulary", () => {
    const src = srcOf("app/routes/style-me/physical-need.tsx");
    assert.ok(src.includes("const EXCLUSIVE_ID = STYLEME_FIT_COMFORT_EXCLUSIVE_ID"));
  });
});

describe("SMV.9 — the copy refinement requires no garment-profile migration", () => {
  it("Step 2 IDs are unchanged, so approved intentionPotentials keys still validate", () => {
    // styleme-garment-profile.server.ts rejects any key not in INTENTION_IDS and
    // requires a rating for every one of them. Equality here proves that every
    // approved GarmentStyleMeProfile record remains valid after the copy change.
    assert.deepEqual(
      [...STYLEME_INTENTION_OPTIONS.map((o) => o.id)].sort(),
      [...INTENTION_IDS].sort(),
    );
    assert.equal(INTENTION_IDS.length, 16);
  });

  it("Step 3 IDs are unchanged, so no stored StylingSession.bodyNeeds value is orphaned", () => {
    const scoringIds = STYLEME_FIT_COMFORT_OPTIONS
      .map((o) => o.id)
      .filter((id) => id !== STYLEME_FIT_COMFORT_EXCLUSIVE_ID);
    assert.deepEqual([...scoringIds].sort(), [...CANONICAL_REV3_BODY_NEED_IDS].sort());
  });

  it("the new States are additive only — no stored State value changed meaning", () => {
    const ORIGINAL = [
      "feel-good", "stressed-overloaded", "low-energy", "not-feeling-like-myself",
      "physically-uncomfortable", "self-conscious", "going-through-change",
      "want-reset", "nothing-in-particular", "other",
    ];
    const current = STYLEME_STATE_OPTIONS.map((o) => o.id);
    for (const id of ORIGINAL) assert.ok(current.includes(id));
    assert.equal(current.length, ORIGINAL.length + STYLEME_POSITIVE_STATE_IDS.length);
  });
});
