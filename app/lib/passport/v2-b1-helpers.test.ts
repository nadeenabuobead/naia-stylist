import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  FIT_TO_SILHOUETTE,
  FIT_TO_STRUCTURE,
  LIFESTYLE_MAX,
  TYPICAL_DAY_MAX,
  isLifestyleCountValid,
  resolveColourConflict,
  deriveFitMigration,
  normalizeTypicalDay,
} from "./v2-b1-helpers.ts";

// ── HLP.1  isLifestyleCountValid ──────────────────────────────────────────────

describe("HLP.1 isLifestyleCountValid — empty array is valid", () => {
  it("accepts []", () => {
    assert.equal(isLifestyleCountValid([]), true);
  });
});

describe("HLP.1 isLifestyleCountValid — 1, 2, 3 IDs are valid", () => {
  it("accepts 1 ID", () => assert.equal(isLifestyleCountValid(["everyday"]), true));
  it("accepts 2 IDs", () => assert.equal(isLifestyleCountValid(["everyday", "work"]), true));
  it("accepts 3 IDs", () => assert.equal(isLifestyleCountValid(["everyday", "work", "travel"]), true));
});

describe("HLP.1 isLifestyleCountValid — 4+ IDs are rejected", () => {
  it("rejects 4 IDs", () => {
    assert.equal(isLifestyleCountValid(["everyday", "work", "travel", "dinner"]), false);
  });
  it("rejects 10 IDs", () => {
    assert.equal(isLifestyleCountValid(Array(10).fill("everyday")), false);
  });
});

describe("HLP.1 LIFESTYLE_MAX constant is 3", () => {
  it("exports LIFESTYLE_MAX = 3", () => assert.equal(LIFESTYLE_MAX, 3));
});

// ── HLP.2  resolveColourConflict ──────────────────────────────────────────────

describe("HLP.2 resolveColourConflict — no conflict passes through unchanged", () => {
  it("preserves favorites when avoids is empty", () => {
    assert.deepEqual(resolveColourConflict(["black", "navy"], []), ["black", "navy"]);
  });
  it("preserves favorites when no overlap", () => {
    assert.deepEqual(resolveColourConflict(["black", "navy"], ["pink"]), ["black", "navy"]);
  });
});

describe("HLP.2 resolveColourConflict — avoid wins on conflict", () => {
  it("removes conflicting ID from favorites", () => {
    assert.deepEqual(resolveColourConflict(["black", "navy", "pink"], ["pink"]), ["black", "navy"]);
  });
  it("removes all conflicting IDs when multiple overlap", () => {
    assert.deepEqual(
      resolveColourConflict(["black", "navy", "pink", "green"], ["navy", "green"]),
      ["black", "pink"],
    );
  });
  it("returns empty array when all favorites are conflicting", () => {
    assert.deepEqual(resolveColourConflict(["black"], ["black"]), []);
  });
});

describe("HLP.2 resolveColourConflict — avoids array itself is unmodified", () => {
  it("does not alter the avoids list", () => {
    const avoids = ["black", "navy"];
    resolveColourConflict(["black"], avoids);
    assert.deepEqual(avoids, ["black", "navy"]);
  });
});

describe("HLP.2 resolveColourConflict — preserves insertion order of favorites", () => {
  it("keeps remaining favorites in original order", () => {
    assert.deepEqual(
      resolveColourConflict(["green", "black", "navy", "pink"], ["black"]),
      ["green", "navy", "pink"],
    );
  });
});

// ── HLP.3  deriveFitMigration ─────────────────────────────────────────────────

describe("HLP.3 deriveFitMigration — silhouette mapping", () => {
  it("maps defined-waist → defined-waist", () => {
    const r = deriveFitMigration(["defined-waist"], [], null);
    assert.deepEqual(r.silhouette, ["defined-waist"]);
  });
  it("maps relaxed-fits → relaxed", () => {
    const r = deriveFitMigration(["relaxed-fits"], [], null);
    assert.deepEqual(r.silhouette, ["relaxed"]);
  });
  it("maps oversized → oversized", () => {
    const r = deriveFitMigration(["oversized"], [], null);
    assert.deepEqual(r.silhouette, ["oversized"]);
  });
  it("maps flowy → flowing", () => {
    const r = deriveFitMigration(["flowy"], [], null);
    assert.deepEqual(r.silhouette, ["flowing"]);
  });
  it("maps fitted → fitted", () => {
    const r = deriveFitMigration(["fitted"], [], null);
    assert.deepEqual(r.silhouette, ["fitted"]);
  });
});

describe("HLP.3 deriveFitMigration — structure mapping", () => {
  it("maps structured → sharp-tailored", () => {
    const r = deriveFitMigration(["structured"], [], null);
    assert.equal(r.structure, "sharp-tailored");
  });
});

describe("HLP.3 deriveFitMigration — unmapped values produce nothing", () => {
  it("coverage has no silhouette mapping", () => {
    const r = deriveFitMigration(["coverage"], [], null);
    assert.deepEqual(r.silhouette, []);
  });
  it("coverage has no structure mapping", () => {
    const r = deriveFitMigration(["coverage"], [], null);
    assert.equal(r.structure, null);
  });
  it("simple has no mapping", () => {
    const r = deriveFitMigration(["simple"], [], null);
    assert.deepEqual(r.silhouette, []);
    assert.equal(r.structure, null);
  });
});

describe("HLP.3 deriveFitMigration — multiple fitPreferences merge correctly", () => {
  it("produces multiple silhouette values in order", () => {
    const r = deriveFitMigration(["defined-waist", "flowy", "fitted"], [], null);
    assert.deepEqual(r.silhouette, ["defined-waist", "flowing", "fitted"]);
  });
  it("deduplicates silhouette values", () => {
    const r = deriveFitMigration(["fitted", "fitted"], [], null);
    assert.deepEqual(r.silhouette, ["fitted"]);
  });
  it("takes first structure match when multiple candidates present", () => {
    // only "structured" maps to structure; second structured is deduplicated
    const r = deriveFitMigration(["structured", "fitted"], [], null);
    assert.equal(r.structure, "sharp-tailored");
  });
});

describe("HLP.3 deriveFitMigration — idempotent: never overwrites existing values", () => {
  it("preserves non-empty existing silhouette", () => {
    const r = deriveFitMigration(["fitted", "flowy"], ["oversized"], null);
    assert.deepEqual(r.silhouette, ["oversized"]);
  });
  it("preserves non-null existing structure", () => {
    const r = deriveFitMigration(["structured"], [], "relaxed-tailored");
    assert.equal(r.structure, "relaxed-tailored");
  });
  it("both existing values preserved simultaneously", () => {
    const r = deriveFitMigration(["structured", "fitted"], ["flowing"], "custom");
    assert.deepEqual(r.silhouette, ["flowing"]);
    assert.equal(r.structure, "custom");
  });
});

describe("HLP.3 deriveFitMigration — empty fitPreferences yields empty derived fields", () => {
  it("returns empty silhouette and null structure", () => {
    const r = deriveFitMigration([], [], null);
    assert.deepEqual(r.silhouette, []);
    assert.equal(r.structure, null);
  });
});

describe("HLP.3 FIT_TO_SILHOUETTE and FIT_TO_STRUCTURE export all approved mappings", () => {
  it("FIT_TO_SILHOUETTE covers 5 approved values", () => {
    assert.deepEqual(Object.keys(FIT_TO_SILHOUETTE).sort(), [
      "defined-waist", "fitted", "flowy", "oversized", "relaxed-fits",
    ].sort());
  });
  it("FIT_TO_STRUCTURE covers 1 approved value", () => {
    assert.deepEqual(Object.keys(FIT_TO_STRUCTURE), ["structured"]);
  });
});

// ── HLP.4  normalizeTypicalDay ────────────────────────────────────────────────

describe("HLP.4 normalizeTypicalDay — null / undefined / blank → null", () => {
  it("returns null for null", () => assert.equal(normalizeTypicalDay(null), null));
  it("returns null for undefined", () => assert.equal(normalizeTypicalDay(undefined), null));
  it("returns null for empty string", () => assert.equal(normalizeTypicalDay(""), null));
  it("returns null for whitespace-only string", () => assert.equal(normalizeTypicalDay("   "), null));
});

describe("HLP.4 normalizeTypicalDay — trims whitespace", () => {
  it("trims leading and trailing spaces", () => {
    assert.equal(normalizeTypicalDay("  hello world  "), "hello world");
  });
  it("trims leading newlines", () => {
    assert.equal(normalizeTypicalDay("\nhello"), "hello");
  });
});

describe("HLP.4 normalizeTypicalDay — preserves non-blank content", () => {
  it("returns the string as-is (after trim)", () => {
    assert.equal(normalizeTypicalDay("I work from home"), "I work from home");
  });
});

describe("HLP.4 TYPICAL_DAY_MAX constant is 500", () => {
  it("exports TYPICAL_DAY_MAX = 500", () => assert.equal(TYPICAL_DAY_MAX, 500));
});
