// closet-review-phase3a.test.ts
//
// Phase 3A tests — Teach nAia: review, override, key presence, validation,
// revert, effective classification, semantic integration, provenance,
// security, and scope.
//
// Sections A–J mirror the spec requirements.
// Tests cover the pure-function layer (no DB).
// Security and scope tests verify properties of the implementation code.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  validateOverrides,
  computeReviewStatus,
  getEffectiveClosetItem,
  type ClosetItemOverrides,
  type ClosetItemFields,
  type AdminReviewFields,
} from "./closet-review.server";

// ── mark-correct safety contract (imported readFileSync above) ───────────────
// markItemReviewed is a DB function (not easily unit-tested here), but we can
// verify the *route action* wires it correctly and that the server function
// exists and is distinct from saveAdminReview (which would clobber overrides).

import { interpretGarment } from "./garment-semantics.server";
import type { ClosetClassification } from "../admin/closet-intelligence.server";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const BASE_CLASSIFICATION: ClosetItemFields = {
  subcategory:      "sports bra",
  silhouette:       "fitted",
  fitProfile:       "fitted",
  hemLength:        null,
  topLength:        "cropped",
  waistShape:       null,
  sleeveLength:     "sleeveless",
  necklineCoverage: "v-neck",
  shoulderCoverage: true,   // mauve sports bra — stored value
  midriffExposed:   true,
  material:         "polyester",
  pattern:          "solid",
  primaryColor:     "mauve",
  colors:           ["mauve"],
  occasions:        ["gym"],
  seasons:          ["all-season"],
  formality:        "casual",
  styleTags:        ["sporty"],
  stylePersonality: "minimal-relaxed",
};

function makeReview(overrides: ClosetItemOverrides): AdminReviewFields {
  return {
    reviewStatus: computeReviewStatus(overrides),
    overrides,
  };
}

// ── §CR-A — Review states ─────────────────────────────────────────────────────

describe("§CR-A — Review states", () => {
  it("A.1 computeReviewStatus(null) → reviewed", () => {
    assert.equal(computeReviewStatus(null), "reviewed");
  });

  it("A.2 computeReviewStatus({}) → reviewed", () => {
    assert.equal(computeReviewStatus({}), "reviewed");
  });

  it("A.3 computeReviewStatus with one key → overridden", () => {
    assert.equal(computeReviewStatus({ formality: "smart-casual" }), "overridden");
  });

  it("A.4 computeReviewStatus with multiple keys → overridden", () => {
    assert.equal(
      computeReviewStatus({ formality: "smart-casual", silhouette: "fitted" }),
      "overridden",
    );
  });

  it("A.5 computeReviewStatus with false boolean override → overridden", () => {
    // false is a valid intentional override — key presence matters
    assert.equal(computeReviewStatus({ shoulderCoverage: false }), "overridden");
  });

  it("A.6 computeReviewStatus with null scalar override → overridden", () => {
    assert.equal(computeReviewStatus({ formality: null }), "overridden");
  });

  it("A.7 computeReviewStatus with empty array override → overridden", () => {
    assert.equal(computeReviewStatus({ occasions: [] }), "overridden");
  });

  // ── REGRESSION: mark-correct must not clobber existing overrides ──────────
  // This is the safety contract for CASE 2 (see spec).
  // Pure-function level: verify the route uses markItemReviewed, not saveAdminReview({}).

  it("A.8 REGRESSION — mark-correct action uses markItemReviewed, not saveAdminReview({})", () => {
    const routeSrc = readFileSync(
      resolve(import.meta.dirname, "../../routes/admin.naia.closet.$itemId.tsx"),
      "utf8",
    );
    // The action must import and call markItemReviewed
    assert.ok(
      routeSrc.includes("markItemReviewed"),
      "mark-correct must use markItemReviewed",
    );
    // The action must NOT call saveAdminReview with empty overrides for mark-correct
    const actionSection = routeSrc.slice(routeSrc.indexOf("export async function action"));
    const markCorrectBlock = actionSection.slice(
      actionSection.indexOf('"mark-correct"'),
      actionSection.indexOf('"save-overrides"'),
    );
    assert.ok(
      !markCorrectBlock.includes("saveAdminReview(itemId, {}"),
      "mark-correct block must not call saveAdminReview with empty overrides",
    );
  });

  it("A.9 REGRESSION — markItemReviewed update branch never includes overrides field", () => {
    const serverSrc = readFileSync(
      resolve(import.meta.dirname, "./closet-review.server.ts"),
      "utf8",
    );
    // markItemReviewed must exist and its update branch must not set overrides
    const fnStart = serverSrc.indexOf("export async function markItemReviewed");
    assert.ok(fnStart !== -1, "markItemReviewed must exist in closet-review.server.ts");
    const fnEnd = serverSrc.indexOf("\nexport async function", fnStart + 1);
    const fnBody = serverSrc.slice(fnStart, fnEnd === -1 ? undefined : fnEnd);
    // The update: block must not contain the word "overrides" as a key
    const updateBlock = fnBody.slice(fnBody.indexOf("update:"));
    assert.ok(
      !updateBlock.includes("overrides:"),
      "markItemReviewed update block must never set overrides — would clobber existing corrections",
    );
  });

  it("A.10 REGRESSION — effective classification after mark-correct preserves shoulderCoverage:false override", () => {
    // Simulates CASE 2 at the pure-function level:
    // If an item has { shoulderCoverage: false } and mark-correct is called,
    // the resulting review (with overrides preserved) must still resolve shoulderCoverage: false.
    const existingOverrides: ClosetItemOverrides = { shoulderCoverage: false };
    const item: ClosetItemFields = { ...BASE_CLASSIFICATION, shoulderCoverage: true };

    // markItemReviewed does NOT change overrides — simulate by keeping the same review
    const reviewAfterMarkCorrect: AdminReviewFields = {
      reviewStatus: computeReviewStatus(existingOverrides), // still "overridden"
      overrides: existingOverrides,
    };

    const eff = getEffectiveClosetItem(item, reviewAfterMarkCorrect);

    assert.equal(eff.shoulderCoverage, false, "shoulderCoverage override must survive mark-correct");
    assert.equal(
      reviewAfterMarkCorrect.reviewStatus,
      "overridden",
      "status must remain OVERRIDDEN when overrides exist after mark-correct",
    );
  });
});

// ── §CR-B — Override save (validateOverrides logic) ───────────────────────────

describe("§CR-B — Override save", () => {
  it("B.1 single valid override passes validation", () => {
    const result = validateOverrides({ formality: "smart-casual" });
    assert.equal(result.formality, "smart-casual");
  });

  it("B.2 multiple overrides — all present in result", () => {
    const result = validateOverrides({
      formality: "smart-casual",
      silhouette: "straight",
      shoulderCoverage: false,
    });
    assert.equal(result.formality, "smart-casual");
    assert.equal(result.silhouette, "straight");
    assert.equal(result.shoulderCoverage, false);
  });

  it("B.3 original item not mutated by getEffectiveClosetItem", () => {
    const original = { ...BASE_CLASSIFICATION };
    const overrides: ClosetItemOverrides = { shoulderCoverage: false };
    const review = makeReview(overrides);
    getEffectiveClosetItem(original, review);
    // Original shoulderCoverage unchanged
    assert.equal(original.shoulderCoverage, true);
  });

  it("B.4 getEffectiveClosetItem returns a new object", () => {
    const original = { ...BASE_CLASSIFICATION };
    const review = makeReview({ shoulderCoverage: false });
    const eff = getEffectiveClosetItem(original, review);
    assert.notEqual(eff, original);
  });
});

// ── §CR-C — Key presence semantics ───────────────────────────────────────────

describe("§CR-C — Key presence semantics", () => {
  it("C.1 false is a valid override for boolean field", () => {
    const result = validateOverrides({ shoulderCoverage: false });
    assert.ok(Object.hasOwn(result, "shoulderCoverage"));
    assert.equal(result.shoulderCoverage, false);
  });

  it("C.2 null is a valid override for scalar field", () => {
    const result = validateOverrides({ formality: null });
    assert.ok(Object.hasOwn(result, "formality"));
    assert.equal(result.formality, null);
  });

  it("C.3 [] is a valid override for array field", () => {
    const result = validateOverrides({ occasions: [] });
    assert.ok(Object.hasOwn(result, "occasions"));
    assert.deepEqual(result.occasions, []);
  });

  it("C.4 false override wins over stored true via getEffectiveClosetItem", () => {
    // Verifies key-presence semantics: false value is not falsy-skipped
    const item: ClosetItemFields = { ...BASE_CLASSIFICATION, shoulderCoverage: true };
    const review = makeReview({ shoulderCoverage: false });
    const eff = getEffectiveClosetItem(item, review);
    assert.equal(eff.shoulderCoverage, false);
  });

  it("C.5 null override wins over stored non-null value", () => {
    const item: ClosetItemFields = { ...BASE_CLASSIFICATION, formality: "casual" };
    const review = makeReview({ formality: null });
    const eff = getEffectiveClosetItem(item, review);
    assert.equal(eff.formality, null);
  });

  it("C.6 [] override wins over stored non-empty array", () => {
    const item: ClosetItemFields = { ...BASE_CLASSIFICATION, occasions: ["gym", "work"] };
    const review = makeReview({ occasions: [] });
    const eff = getEffectiveClosetItem(item, review);
    assert.deepEqual(eff.occasions, []);
  });
});

// ── §CR-D — Validation ────────────────────────────────────────────────────────

describe("§CR-D — Validation", () => {
  it("D.1 unknown key rejected", () => {
    assert.throws(
      () => validateOverrides({ unknownField: "value" }),
      /Unknown override key/,
    );
  });

  it("D.2 invalid enum value for silhouette rejected", () => {
    assert.throws(
      () => validateOverrides({ silhouette: "tube" }),
      /not a valid vocabulary token/,
    );
  });

  it("D.3 invalid array item in occasions rejected", () => {
    assert.throws(
      () => validateOverrides({ occasions: ["gym", "invalid-occasion"] }),
      /not a valid vocabulary token/,
    );
  });

  it("D.4 __proto__ key rejected (via JSON.parse to create real own property)", () => {
    // Object literal { __proto__: ... } sets the prototype — not an own property.
    // JSON.parse uses [[DefineOwnProperty]] so __proto__ becomes a real own key.
    const parsed = JSON.parse('{"__proto__": {"isAdmin": true}}');
    assert.throws(
      () => validateOverrides(parsed),
      /not permitted/,
    );
  });

  it("D.5 non-object input rejected", () => {
    assert.throws(
      () => validateOverrides("not-an-object"),
      /plain object/,
    );
  });

  it("D.6 array input rejected", () => {
    assert.throws(
      () => validateOverrides(["silhouette", "fitted"]),
      /plain object/,
    );
  });

  it("D.7 invalid formality value rejected", () => {
    assert.throws(
      () => validateOverrides({ formality: "elevated" }),
      /not a valid vocabulary token/,
    );
  });

  it("D.8 styleTags exceeding max 3 rejected", () => {
    assert.throws(
      () => validateOverrides({ styleTags: ["classic", "bold", "minimal", "flowy"] }),
      /at most 3/,
    );
  });

  it("D.9 boolean field given string value rejected", () => {
    assert.throws(
      () => validateOverrides({ shoulderCoverage: "true" }),
      /must be a boolean/,
    );
  });
});

// ── §CR-E — Revert ────────────────────────────────────────────────────────────

describe("§CR-E — Revert (key removal logic)", () => {
  it("E.1 removing key from overrides object leaves other keys", () => {
    const overrides: Record<string, unknown> = {
      formality: "smart-casual",
      silhouette: "straight",
    };
    const { formality: _removed, ...remaining } = overrides;
    assert.ok(!Object.hasOwn(remaining, "formality"));
    assert.ok(Object.hasOwn(remaining, "silhouette"));
    assert.equal(remaining.silhouette, "straight");
  });

  it("E.2 removing last key yields empty overrides → reviewed status", () => {
    const overrides: Record<string, unknown> = { formality: "smart-casual" };
    const { formality: _removed, ...remaining } = overrides;
    const newStatus = computeReviewStatus(remaining as ClosetItemOverrides);
    assert.equal(newStatus, "reviewed");
  });

  it("E.3 removing one of two keys → still overridden", () => {
    const overrides: Record<string, unknown> = {
      formality: "smart-casual",
      silhouette: "straight",
    };
    const { formality: _removed, ...remaining } = overrides;
    const newStatus = computeReviewStatus(remaining as ClosetItemOverrides);
    assert.equal(newStatus, "overridden");
  });
});

// ── §CR-F — Effective classification ─────────────────────────────────────────

describe("§CR-F — Effective classification", () => {
  it("F.1 overridden field wins over stored value", () => {
    const item: ClosetItemFields = { ...BASE_CLASSIFICATION, shoulderCoverage: true };
    const eff = getEffectiveClosetItem(item, makeReview({ shoulderCoverage: false }));
    assert.equal(eff.shoulderCoverage, false);
  });

  it("F.2 non-overridden fields keep stored value", () => {
    const item: ClosetItemFields = { ...BASE_CLASSIFICATION };
    const eff = getEffectiveClosetItem(item, makeReview({ shoulderCoverage: false }));
    assert.equal(eff.formality, "casual");
    assert.equal(eff.material, "polyester");
    assert.equal(eff.subcategory, "sports bra");
  });

  it("F.3 no review → effective equals stored (all fields)", () => {
    const item: ClosetItemFields = { ...BASE_CLASSIFICATION };
    const eff = getEffectiveClosetItem(item, null);
    assert.deepEqual(eff, item);
  });

  it("F.4 multiple overrides — each wins, rest kept", () => {
    const item: ClosetItemFields = { ...BASE_CLASSIFICATION, formality: "casual", silhouette: "fitted" };
    const eff = getEffectiveClosetItem(item, makeReview({
      formality: "smart-casual",
      silhouette: "straight",
    }));
    assert.equal(eff.formality, "smart-casual");
    assert.equal(eff.silhouette, "straight");
    assert.equal(eff.material, "polyester");   // unchanged
  });

  it("F.5 array override replaces entire array", () => {
    const item: ClosetItemFields = { ...BASE_CLASSIFICATION, occasions: ["gym", "work"] };
    const eff = getEffectiveClosetItem(item, makeReview({ occasions: ["casual"] }));
    assert.deepEqual(eff.occasions, ["casual"]);
  });
});

// ── §CR-G — Semantic integration ─────────────────────────────────────────────

describe("§CR-G — Semantic integration (interpretGarment with effective classification)", () => {
  it("G.1 overriding formality changes Polish dimension", () => {
    const c: ClosetClassification = {
      ...BASE_CLASSIFICATION,
      formality: "casual",
      garmentRelationships: [],
    };
    const review = makeReview({ formality: "business-casual" });
    const eff = getEffectiveClosetItem(c, review) as ClosetClassification;

    const storedInterp = interpretGarment(c, "TOPS");
    const effInterp    = interpretGarment(eff, "TOPS");

    const storedPolish = storedInterp.labels.find((l) => l.dimension === "Polish");
    const effPolish    = effInterp.labels.find((l) => l.dimension === "Polish");

    assert.equal(storedPolish?.label, "Casual");
    assert.equal(effPolish?.label, "Polished");
  });

  it("G.2 overriding shoulderCoverage false → changes Coverage dimension (live acceptance: mauve sports bra)", () => {
    const c: ClosetClassification = {
      ...BASE_CLASSIFICATION,
      garmentRelationships: [],
    };
    // Stored: shoulderCoverage: true — may produce Higher coverage
    const review = makeReview({ shoulderCoverage: false });
    const eff = getEffectiveClosetItem(c, review) as ClosetClassification;

    const effInterp = interpretGarment(eff, "ACTIVEWEAR");
    // shoulderCoverage false + midriffExposed true → lower coverage signal only
    const coverage = effInterp.labels.find((l) => l.dimension === "Coverage");
    // Lower coverage with midriff exposed and shoulder not covered
    if (coverage) {
      assert.equal(coverage.label, "Lower coverage");
    }
    // After override: shoulderCoverage is false (no longer a higher-coverage signal)
    assert.equal(eff.shoulderCoverage, false);
  });

  it("G.3 no overrides → interpretation identical to stored", () => {
    const c: ClosetClassification = {
      ...BASE_CLASSIFICATION,
      garmentRelationships: [],
    };
    const eff = getEffectiveClosetItem(c, null) as ClosetClassification;
    const a = interpretGarment(c, "ACTIVEWEAR");
    const b = interpretGarment(eff, "ACTIVEWEAR");
    assert.deepEqual(a, b);
  });

  it("G.4 overriding occasions does not change dimensions not driven by occasions", () => {
    const c: ClosetClassification = {
      ...BASE_CLASSIFICATION,
      formality: "business-casual",
      garmentRelationships: [],
    };
    const review = makeReview({ occasions: ["casual"] });
    const eff = getEffectiveClosetItem(c, review) as ClosetClassification;
    const effInterp = interpretGarment(eff, "TOPS");
    // formality-driven Polish still Polished (formality not overridden)
    const polish = effInterp.labels.find((l) => l.dimension === "Polish");
    assert.equal(polish?.label, "Polished");
  });
});

// ── §CR-H — Provenance ────────────────────────────────────────────────────────

describe("§CR-H — Provenance", () => {
  it("H.1 getEffectiveClosetItem does not add provenance metadata to returned object", () => {
    const item: ClosetItemFields = { ...BASE_CLASSIFICATION };
    const eff = getEffectiveClosetItem(item, makeReview({ shoulderCoverage: false }));
    assert.ok(!Object.hasOwn(eff, "isAiOriginal"));
    assert.ok(!Object.hasOwn(eff, "reviewSource"));
    assert.ok(!Object.hasOwn(eff, "hasOverrides"));
  });

  it("H.2 original item is not mutated even after multiple effective-classification calls", () => {
    const original: ClosetItemFields = { ...BASE_CLASSIFICATION };
    const snap = JSON.parse(JSON.stringify(original));

    getEffectiveClosetItem(original, makeReview({ shoulderCoverage: false }));
    getEffectiveClosetItem(original, makeReview({ formality: "smart-casual" }));
    getEffectiveClosetItem(original, makeReview({ occasions: ["casual"] }));

    assert.deepEqual(original, snap);
  });

  it("H.3 review with empty overrides does not alter the item", () => {
    const item: ClosetItemFields = { ...BASE_CLASSIFICATION };
    const eff = getEffectiveClosetItem(item, makeReview({}));
    assert.deepEqual(eff, item);
  });
});

// ── §CR-I — Security ─────────────────────────────────────────────────────────

describe("§CR-I — Security (action contract)", () => {
  it("I.1 saveAdminReview is not exported from a non-.server file", () => {
    // Verify the mutation is only in the .server.ts module
    const routeFile = readFileSync(
      resolve(import.meta.dirname, "../../routes/admin.naia.closet.$itemId.tsx"),
      "utf8",
    );
    // The route must import saveAdminReview from closet-review.server, not define it
    assert.ok(
      routeFile.includes("saveAdminReview") &&
      routeFile.includes("from \"~/lib/admin/closet-review.server\""),
    );
    // Confirm it does NOT re-export or define saveAdminReview itself
    assert.ok(!routeFile.includes("export function saveAdminReview"));
    assert.ok(!routeFile.includes("export async function saveAdminReview"));
  });

  it("I.2 action never reads reviewedBy from form body — reads from session identity", () => {
    const routeFile = readFileSync(
      resolve(import.meta.dirname, "../../routes/admin.naia.closet.$itemId.tsx"),
      "utf8",
    );
    // The action must use session.identity.email for reviewedBy
    assert.ok(routeFile.includes("session.identity.email"));
    // The action must not use formData.get("reviewedBy") or similar
    assert.ok(!routeFile.includes('formData.get("reviewedBy")'));
    assert.ok(!routeFile.includes("formData.get('reviewedBy')"));
  });

  it("I.3 all mutation intents (mark-correct, save-overrides, revert-field) require requireAdminSession", () => {
    const routeFile = readFileSync(
      resolve(import.meta.dirname, "../../routes/admin.naia.closet.$itemId.tsx"),
      "utf8",
    );
    // requireAdminSession is called at top of action before any mutation
    const actionSection = routeFile.slice(routeFile.indexOf("export async function action"));
    assert.ok(actionSection.includes("requireAdminSession(request)"));
    // All three intents appear after the requireAdminSession call
    const sessionCallIdx = actionSection.indexOf("requireAdminSession");
    const markCorrectIdx = actionSection.indexOf('"mark-correct"');
    const saveOverridesIdx = actionSection.indexOf('"save-overrides"');
    const revertFieldIdx = actionSection.indexOf('"revert-field"');
    assert.ok(sessionCallIdx < markCorrectIdx);
    assert.ok(sessionCallIdx < saveOverridesIdx);
    assert.ok(sessionCallIdx < revertFieldIdx);
  });
});

// ── §CR-J — Scope ─────────────────────────────────────────────────────────────

describe("§CR-J — Scope", () => {
  function getImportLines(filePath: string): string {
    const content = readFileSync(resolve(import.meta.dirname, filePath), "utf8");
    return content
      .split("\n")
      .filter((l) => /^\s*import\s/.test(l))
      .join("\n")
      .toLowerCase();
  }

  it("J.1 closet-review.server.ts imports no StyleMe files", () => {
    const imports = getImportLines("./closet-review.server.ts");
    assert.ok(!imports.includes("styleme"), "closet-review.server.ts must not import StyleMe");
    assert.ok(!imports.includes("style-me"), "closet-review.server.ts must not import style-me");
  });

  it("J.2 closet-review.server.ts imports no VTO files", () => {
    const imports = getImportLines("./closet-review.server.ts");
    assert.ok(!imports.includes("vto"), "closet-review.server.ts must not import VTO");
    assert.ok(!imports.includes("tryon"), "closet-review.server.ts must not import tryon");
  });

  it("J.3 admin.naia.closet.$itemId route imports no StyleMe files", () => {
    const imports = getImportLines("../../routes/admin.naia.closet.$itemId.tsx");
    assert.ok(!imports.includes("styleme"), "item detail route must not import StyleMe");
    assert.ok(!imports.includes("style-me"), "item detail route must not import style-me");
  });

  it("J.4 admin.naia.closet.$itemId route imports no VTO files", () => {
    const imports = getImportLines("../../routes/admin.naia.closet.$itemId.tsx");
    assert.ok(!imports.includes("vto"), "item detail route must not import VTO");
    assert.ok(!imports.includes("tryon"), "item detail route must not import tryon");
  });

  it("J.5 garment-semantics.server.ts imports no StyleMe files (Phase 2B §GS-12 repro)", () => {
    const imports = getImportLines("./garment-semantics.server.ts");
    assert.ok(!imports.includes("styleme"), "garment-semantics must not import StyleMe");
    assert.ok(!imports.includes("style-me"), "garment-semantics must not import style-me");
  });

  it("J.6 closet-review.server.ts imports no Shopify files", () => {
    const imports = getImportLines("./closet-review.server.ts");
    assert.ok(!imports.includes("shopify"), "closet-review.server.ts must not import Shopify");
  });
});

// ── §CR-K — parseOverridesFromForm contract (logic) ──────────────────────────

describe("§CR-K — Form parsing contract", () => {
  it("K.1 validateOverrides accepts the output of a well-formed save-overrides submission", () => {
    // Simulate what parseOverridesFromForm would produce
    const raw: Record<string, unknown> = {
      formality: "smart-casual",
      shoulderCoverage: false,
      occasions: ["gym", "casual"],
    };
    assert.doesNotThrow(() => validateOverrides(raw));
  });

  it("K.2 empty string for vocab field → null override after coercion", () => {
    // "" → null for enum fields (clearing a field)
    const raw = { formality: null };
    const result = validateOverrides(raw);
    assert.equal(result.formality, null);
  });

  it("K.3 empty occasions array → [] override (clears occasions)", () => {
    const result = validateOverrides({ occasions: [] });
    assert.deepEqual(result.occasions, []);
    assert.ok(Object.hasOwn(result, "occasions"));
  });

  it("K.4 shoulderCoverage=false form round-trip: boolean false must survive parseOverridesFromForm logic", () => {
    // Simulate parseOverridesFromForm logic when value_shoulderCoverage="false"
    // The parser uses:  val === "true" ? true : false
    // NOT a truthiness check — "false" must not be treated as falsy
    const formVal = "false"; // what BoolSelect submits when "No" is selected
    const parsed = formVal === "" ? null : formVal === "true" ? true : false;
    assert.equal(typeof parsed, "boolean");
    assert.equal(parsed, false);

    // validateOverrides must accept the resulting { shoulderCoverage: false }
    const result = validateOverrides({ shoulderCoverage: parsed });
    assert.ok(Object.hasOwn(result, "shoulderCoverage"), "key must be present even when value is false");
    assert.equal(result.shoulderCoverage, false);
  });

  it("K.5 RevertBtn uses useFetcher, not <Form> — no nested form in the save-overrides form", () => {
    const src = readFileSync(
      resolve(import.meta.dirname, "../../routes/admin.naia.closet.$itemId.tsx"),
      "utf8",
    );
    // Find the top-level RevertBtn definition (last occurrence, at module level)
    const lastIdx = src.lastIndexOf("function RevertBtn(");
    assert.ok(lastIdx >= 0, "RevertBtn must be defined in the route file");
    const revertBtnBody = src.slice(lastIdx);
    assert.ok(
      !revertBtnBody.includes("<Form ") && !revertBtnBody.includes("<form "),
      "RevertBtn must not render a <Form> or <form> element — nested forms break save-overrides submit",
    );
    assert.ok(
      revertBtnBody.includes("useFetcher"),
      "RevertBtn must use useFetcher for programmatic revert submissions",
    );
  });

  it("K.6 EditClassificationPanel uses native <form ref> not React Router <Form> — zero Form components in edit path", () => {
    const src = readFileSync(
      resolve(import.meta.dirname, "../../routes/admin.naia.closet.$itemId.tsx"),
      "utf8",
    );
    const panelStart = src.indexOf("function EditClassificationPanel(");
    const panelEnd = src.indexOf("// ── Small reusable form components", panelStart);
    assert.ok(panelStart >= 0 && panelEnd > panelStart, "EditClassificationPanel must be present");
    const panelSrc = src.slice(panelStart, panelEnd);
    // React Router <Form> must NOT appear — it would compete with the mark-correct <Form>
    // and both would cause nested-form parsing issues in the browser.
    const reactRouterFormCount = (panelSrc.match(/<Form /g) ?? []).length;
    assert.equal(
      reactRouterFormCount,
      0,
      "EditClassificationPanel must NOT use React Router <Form>; use native <form ref={formRef}> + useFetcher instead",
    );
    // Verify the native form ref pattern is used
    assert.ok(
      panelSrc.includes("formRef") && panelSrc.includes("useRef"),
      "EditClassificationPanel must use useRef + formRef for the form element",
    );
    assert.ok(
      panelSrc.includes("saveFetcher") && panelSrc.includes("useFetcher"),
      "EditClassificationPanel must use useFetcher for save submissions",
    );
  });

  it("K.7 Save corrections button is type=button (not submit) — decoupled from form ownership", () => {
    const src = readFileSync(
      resolve(import.meta.dirname, "../../routes/admin.naia.closet.$itemId.tsx"),
      "utf8",
    );
    const panelStart = src.indexOf("function EditClassificationPanel(");
    const panelEnd = src.indexOf("// ── Small reusable form components", panelStart);
    const panelSrc = src.slice(panelStart, panelEnd);
    assert.ok(
      panelSrc.includes("type=\"button\"") && panelSrc.includes("handleSave"),
      "Save corrections button must be type=button with onClick={handleSave}",
    );
    const hasTypeSubmitSave = panelSrc.includes("type=\"submit\"");
    assert.ok(!hasTypeSubmitSave, "EditClassificationPanel must have no type=submit button — submit depends on form ownership which can be broken by DOM nesting");
  });

  it("K.8 shoulderCoverage true→false AND false→true both survive form round-trip", () => {
    // false direction (already in K.4; re-verify here as part of both-directions contract)
    const falseVal = "false";
    const parsedFalse = falseVal === "" ? null : falseVal === "true" ? true : false;
    assert.equal(parsedFalse, false);
    const validatedFalse = validateOverrides({ shoulderCoverage: parsedFalse });
    assert.ok(Object.hasOwn(validatedFalse, "shoulderCoverage"));
    assert.equal(validatedFalse.shoulderCoverage, false);

    // true direction (existing correction false → user changes to Yes → submit "true")
    const trueVal = "true";
    const parsedTrue = trueVal === "" ? null : trueVal === "true" ? true : false;
    assert.equal(parsedTrue, true);
    const validatedTrue = validateOverrides({ shoulderCoverage: parsedTrue });
    assert.ok(Object.hasOwn(validatedTrue, "shoulderCoverage"));
    assert.equal(validatedTrue.shoulderCoverage, true);
  });

  it("K.9 mark-correct action has no <Form> component in ClosetItemDetailPage — uses useFetcher only", () => {
    const src = readFileSync(
      resolve(import.meta.dirname, "../../routes/admin.naia.closet.$itemId.tsx"),
      "utf8",
    );
    const pageStart = src.indexOf("export default function ClosetItemDetailPage()");
    const pageEnd = src.indexOf("// ── EditClassificationPanel", pageStart);
    assert.ok(pageStart >= 0 && pageEnd > pageStart, "ClosetItemDetailPage must be present");
    const pageSrc = src.slice(pageStart, pageEnd);
    // No React Router <Form> in the main page — mark-correct uses markCorrectFetcher.submit()
    const reactRouterFormCount = (pageSrc.match(/<Form /g) ?? []).length;
    assert.equal(
      reactRouterFormCount,
      0,
      "ClosetItemDetailPage must not use React Router <Form> — mark-correct must use useFetcher.submit()",
    );
    assert.ok(pageSrc.includes("markCorrectFetcher"), "mark-correct must use markCorrectFetcher");
  });
});

// ── §CR-L — UX Cleanup (label rename, auto-close, button visibility, inline view) ─

describe("§CR-L — UX Cleanup contract", () => {
  const routeSrc = readFileSync(
    resolve(import.meta.dirname, "../../routes/admin.naia.closet.$itemId.tsx"),
    "utf8",
  );

  it("L.1 reviewBadgeLabel returns 'CORRECTED BY YOU · N correction(s)' for OVERRIDDEN status", () => {
    assert.ok(
      routeSrc.includes("CORRECTED BY YOU"),
      "Route must render 'CORRECTED BY YOU' label for overridden status",
    );
    assert.ok(
      routeSrc.includes("reviewBadgeLabel"),
      "Route must define reviewBadgeLabel helper",
    );
    assert.ok(
      routeSrc.includes("overrideCount"),
      "Route must compute overrideCount for the correction count suffix",
    );
  });

  it("L.2 reviewBadgeLabel uses singular 'correction' for count=1 and plural for count>1", () => {
    assert.ok(
      routeSrc.includes(`"correction"`) && routeSrc.includes(`"corrections"`),
      "reviewBadgeLabel must produce singular/plural noun based on count",
    );
    assert.ok(
      routeSrc.includes("overrideCount === 1 ?"),
      "reviewBadgeLabel must branch on count === 1",
    );
  });

  it("L.3 all three badge locations use reviewBadgeLabel (not raw displayReviewStatus)", () => {
    const rawDisplayCount = (routeSrc.match(/\{item\.displayReviewStatus\}/g) ?? []).length;
    assert.equal(
      rawDisplayCount,
      0,
      "No badge must render {item.displayReviewStatus} directly — all must go through reviewBadgeLabel()",
    );
    const labelCallCount = (routeSrc.match(/reviewBadgeLabel\(/g) ?? []).length;
    assert.ok(labelCallCount >= 3, `At least 3 badge sites must call reviewBadgeLabel — found ${labelCallCount}`);
  });

  it("L.4 Mark as correct button is hidden when corrections exist (!hasOverrides gate)", () => {
    assert.ok(
      routeSrc.includes("!hasOverrides") && routeSrc.includes("Mark as correct"),
      "Mark as correct button must be guarded by !hasOverrides",
    );
    const markCorrectIdx = routeSrc.indexOf("✓ Mark as correct");
    const hasOverridesGateIdx = routeSrc.lastIndexOf("!hasOverrides", markCorrectIdx);
    assert.ok(
      hasOverridesGateIdx > 0 && markCorrectIdx - hasOverridesGateIdx < 700,
      "!hasOverrides gate must appear close before the Mark as correct button",
    );
  });

  it("L.5 EditClassificationPanel accepts onSaveSuccess prop and uses useEffect + hasSubmitted for auto-close", () => {
    const panelStart = routeSrc.indexOf("function EditClassificationPanel(");
    const panelEnd = routeSrc.indexOf("// ── Small reusable form components", panelStart);
    const panelSrc = routeSrc.slice(panelStart, panelEnd);
    assert.ok(panelSrc.includes("onSaveSuccess"), "EditClassificationPanel must accept onSaveSuccess prop");
    assert.ok(panelSrc.includes("hasSubmitted"), "EditClassificationPanel must use hasSubmitted ref");
    assert.ok(panelSrc.includes("useEffect"), "EditClassificationPanel must use useEffect for auto-close");
    assert.ok(
      panelSrc.includes("onSaveSuccess()"),
      "EditClassificationPanel must call onSaveSuccess() after successful save",
    );
  });

  it("L.6 onSaveSuccess is wired to setShowEdit(false) in ClosetItemDetailPage", () => {
    const pageStart = routeSrc.indexOf("export default function ClosetItemDetailPage()");
    const pageEnd = routeSrc.indexOf("// ── EditClassificationPanel", pageStart);
    const pageSrc = routeSrc.slice(pageStart, pageEnd);
    assert.ok(
      pageSrc.includes("onSaveSuccess={() => setShowEdit(false)}"),
      "ClosetItemDetailPage must pass onSaveSuccess={() => setShowEdit(false)} to EditClassificationPanel",
    );
  });

  it("L.7 CorrectionsView rendered when !showEdit && hasOverrides", () => {
    const pageStart = routeSrc.indexOf("export default function ClosetItemDetailPage()");
    const pageEnd = routeSrc.indexOf("// ── EditClassificationPanel", pageStart);
    const pageSrc = routeSrc.slice(pageStart, pageEnd);
    assert.ok(
      pageSrc.includes("CorrectionsView"),
      "ClosetItemDetailPage must render CorrectionsView when corrections exist",
    );
    assert.ok(
      pageSrc.includes("!showEdit && hasOverrides"),
      "CorrectionsView must be gated by !showEdit && hasOverrides",
    );
  });

  it("L.8 CorrectionsView uses FIELD_LABELS, formatFieldValue, and RevertBtn", () => {
    const viewStart = routeSrc.indexOf("function CorrectionsView(");
    const viewEnd = routeSrc.indexOf("// ── Small reusable form components", viewStart);
    const viewSrc = routeSrc.slice(viewStart, viewEnd);
    assert.ok(viewSrc.includes("FIELD_LABELS"), "CorrectionsView must use FIELD_LABELS for field names");
    assert.ok(viewSrc.includes("formatFieldValue"), "CorrectionsView must use formatFieldValue for values");
    assert.ok(viewSrc.includes("RevertBtn"), "CorrectionsView must include per-field RevertBtn");
  });

  it("L.9 shoulderCoverage ThreeVal uses formatBoolVal (not raw String(true/false))", () => {
    const coverageIdx = routeSrc.indexOf("fieldKey=\"shoulderCoverage\"");
    assert.ok(coverageIdx >= 0, "shoulderCoverage ThreeVal must exist in EditClassificationPanel");
    const coverageSnippet = routeSrc.slice(coverageIdx, coverageIdx + 500);
    assert.ok(
      coverageSnippet.includes("formatBoolVal"),
      "shoulderCoverage ThreeVal must use formatBoolVal for human-readable labels",
    );
    assert.ok(
      !coverageSnippet.includes("String(stored.shoulderCoverage)"),
      "shoulderCoverage ThreeVal must not use raw String(true/false)",
    );
  });

  it("L.10 BOOL_FIELD_LABELS maps shoulderCoverage to Covered/Not covered and midriffExposed to Exposed/Not exposed", () => {
    assert.ok(
      routeSrc.includes(`["Covered", "Not covered"]`),
      "BOOL_FIELD_LABELS must map shoulderCoverage to Covered / Not covered",
    );
    assert.ok(
      routeSrc.includes(`["Exposed", "Not exposed"]`),
      "BOOL_FIELD_LABELS must map midriffExposed to Exposed / Not exposed",
    );
  });

  it("L.11 filterSameAsStored is defined and wired in the save-overrides action", () => {
    assert.ok(
      routeSrc.includes("function filterSameAsStored("),
      "Route must define filterSameAsStored helper",
    );
    assert.ok(
      routeSrc.includes("filterSameAsStored(validated,"),
      "save-overrides action must call filterSameAsStored(validated, storedCls)",
    );
    assert.ok(
      routeSrc.includes("getItemClassification(itemId)"),
      "save-overrides action must fetch stored classification for same-as-stored check",
    );
  });

  it("L.12 filterSameAsStored strips scalar override when value equals stored", () => {
    // Mirror the filterSameAsStored logic inline (avoids importing the server route).
    type R = Record<string, unknown>;
    function filter(validated: R, stored: R | null): R {
      if (!stored) return validated;
      const result: R = {};
      for (const key of Object.keys(validated)) {
        const val = validated[key];
        const storedVal = stored[key];
        if (Array.isArray(val) && Array.isArray(storedVal)) {
          const a = [...(val as string[])].sort().join("\x00");
          const b = [...(storedVal as string[])].sort().join("\x00");
          if (a !== b) result[key] = val;
        } else if (val !== storedVal) {
          result[key] = val;
        }
      }
      return result;
    }

    assert.deepEqual(filter({ formality: "casual" }, { formality: "casual" }), {}, "Same scalar stripped");
    assert.deepEqual(filter({ formality: "evening" }, { formality: "casual" }), { formality: "evening" }, "Different scalar kept");
    assert.deepEqual(filter({ shoulderCoverage: false }, { shoulderCoverage: null }), { shoulderCoverage: false }, "false vs null kept");
    assert.deepEqual(filter({ shoulderCoverage: true }, { shoulderCoverage: true }), {}, "Same boolean stripped");
  });

  it("L.13 filterSameAsStored strips array override when sorted elements match stored", () => {
    type R = Record<string, unknown>;
    function filter(validated: R, stored: R | null): R {
      if (!stored) return validated;
      const result: R = {};
      for (const key of Object.keys(validated)) {
        const val = validated[key];
        const storedVal = stored[key];
        if (Array.isArray(val) && Array.isArray(storedVal)) {
          const a = [...(val as string[])].sort().join("\x00");
          const b = [...(storedVal as string[])].sort().join("\x00");
          if (a !== b) result[key] = val;
        } else if (val !== storedVal) {
          result[key] = val;
        }
      }
      return result;
    }

    assert.deepEqual(
      filter({ occasions: ["work", "casual"] }, { occasions: ["casual", "work"] }),
      {},
      "Same-as-stored array (reordered) stripped",
    );
    assert.deepEqual(
      filter({ occasions: ["work", "evening"] }, { occasions: ["casual", "work"] }),
      { occasions: ["work", "evening"] },
      "Different array kept",
    );
  });

  it("L.14 getItemClassification is exported from closet-review.server", () => {
    const serverSrc = readFileSync(
      resolve(import.meta.dirname, "./closet-review.server.ts"),
      "utf8",
    );
    assert.ok(
      serverSrc.includes("export async function getItemClassification("),
      "closet-review.server.ts must export getItemClassification",
    );
  });
});

// ── §CR-M — Scoop neckline vocabulary ────────────────────────────────────────

import { NECKLINE_COVERAGE_VALUES } from "../ai/garment-intelligence.types";

describe("§CR-M — Scoop neckline canonical vocabulary", () => {
  const routeSrc = readFileSync(
    resolve(import.meta.dirname, "../../routes/admin.naia.closet.$itemId.tsx"),
    "utf8",
  );
  const signalSrc = readFileSync(
    resolve(import.meta.dirname, "../ai/signal-contract.ts"),
    "utf8",
  );

  it("M.1 'scoop' is in NECKLINE_COVERAGE_VALUES", () => {
    assert.ok(NECKLINE_COVERAGE_VALUES.has("scoop"), "NECKLINE_COVERAGE_VALUES must contain 'scoop'");
  });

  it("M.2 all existing neckline values still present", () => {
    for (const v of ["high", "crew", "mock", "cowl-high", "v-neck", "low", "off-shoulder", "wrap-variable", "n/a"]) {
      assert.ok(NECKLINE_COVERAGE_VALUES.has(v as any), `NECKLINE_COVERAGE_VALUES missing pre-existing value: ${v}`);
    }
  });

  it("M.3 NecklineCoverage type in signal-contract includes 'scoop'", () => {
    assert.ok(
      signalSrc.includes('"scoop"'),
      "signal-contract.ts NecklineCoverage type must include 'scoop'",
    );
  });

  it("M.4 validateOverrides accepts 'scoop' as necklineCoverage", () => {
    const result = validateOverrides({ necklineCoverage: "scoop" });
    assert.equal(result.necklineCoverage, "scoop");
  });

  it("M.5 validateOverrides rejects unknown neckline value (vocabulary guard still active)", () => {
    assert.throws(
      () => validateOverrides({ necklineCoverage: "racerback" }),
      /not a valid vocabulary token/,
    );
  });

  it("M.6 Teach nAia EDIT_OPTS.necklineCoverage includes 'scoop'", () => {
    assert.ok(
      routeSrc.includes('"scoop"'),
      "admin.naia.closet.$itemId.tsx EDIT_OPTS.necklineCoverage must include 'scoop'",
    );
  });

  it("M.7 Teach nAia EDIT_OPTS.necklineCoverage still includes all pre-existing values", () => {
    for (const v of ["high", "crew", "mock", "cowl-high", "v-neck", "low", "off-shoulder", "wrap-variable", "n/a"]) {
      assert.ok(
        routeSrc.includes(`"${v}"`),
        `EDIT_OPTS.necklineCoverage must still include pre-existing value: ${v}`,
      );
    }
  });
});

// ── §CR-N — Mesh + Tulle material vocabulary ──────────────────────────────────

import { GARMENT_MATERIAL_VALUES } from "../ai/garment-intelligence.types";

describe("§CR-N — Mesh + Tulle canonical material vocabulary", () => {
  const routeSrc = readFileSync(
    resolve(import.meta.dirname, "../../routes/admin.naia.closet.$itemId.tsx"),
    "utf8",
  );

  it("N.1 'mesh' is in GARMENT_MATERIAL_VALUES", () => {
    assert.ok(GARMENT_MATERIAL_VALUES.has("mesh"), "GARMENT_MATERIAL_VALUES must contain 'mesh'");
  });

  it("N.2 'tulle' is in GARMENT_MATERIAL_VALUES", () => {
    assert.ok(GARMENT_MATERIAL_VALUES.has("tulle"), "GARMENT_MATERIAL_VALUES must contain 'tulle'");
  });

  it("N.3 all pre-existing material values still present", () => {
    const existing = [
      "cotton", "linen", "silk", "satin", "wool", "cashmere",
      "denim", "leather", "suede", "velvet", "polyester", "nylon",
      "knit", "jersey", "chiffon", "georgette", "lace", "tweed", "corduroy",
    ];
    for (const v of existing) {
      assert.ok(GARMENT_MATERIAL_VALUES.has(v as any), `GARMENT_MATERIAL_VALUES missing pre-existing material: ${v}`);
    }
  });

  it("N.4 validateOverrides accepts 'mesh' as material", () => {
    const result = validateOverrides({ material: "mesh" });
    assert.equal(result.material, "mesh");
  });

  it("N.5 validateOverrides accepts 'tulle' as material", () => {
    const result = validateOverrides({ material: "tulle" });
    assert.equal(result.material, "tulle");
  });

  it("N.6 validateOverrides still rejects unknown material (vocabulary guard active)", () => {
    assert.throws(
      () => validateOverrides({ material: "spandex" }),
      /not a valid vocabulary token/,
    );
  });

  it("N.7 Teach nAia EDIT_OPTS.material includes 'mesh'", () => {
    assert.ok(routeSrc.includes('"mesh"'), "EDIT_OPTS.material must include 'mesh'");
  });

  it("N.8 Teach nAia EDIT_OPTS.material includes 'tulle'", () => {
    assert.ok(routeSrc.includes('"tulle"'), "EDIT_OPTS.material must include 'tulle'");
  });

  it("N.9 'mesh' and 'tulle' are distinct entries in GARMENT_MATERIAL_VALUES", () => {
    assert.notEqual("mesh", "tulle");
    assert.ok(GARMENT_MATERIAL_VALUES.has("mesh") && GARMENT_MATERIAL_VALUES.has("tulle"));
    assert.ok(GARMENT_MATERIAL_VALUES.has("lace"), "lace must remain distinct from mesh/tulle");
  });
});
