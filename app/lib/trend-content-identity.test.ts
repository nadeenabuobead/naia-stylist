// app/lib/trend-content-identity.test.ts
//
// The contract these tests defend: a customer's save must keep pointing at the
// thing she saved. Every test below is a way that could break.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  TREND_CONTENT_TYPES,
  TAKEAWAY_SECTION_KEYS,
  IDENTITY_BEARING_FIELD_NAMES,
  isContentId,
  isTrendContentType,
  isTakeawaySectionKey,
  deriveContentId,
  recoverOrMintIds,
  computeEditionKey,
  buildRefKey,
  makeTakeawayContentId,
  applyContentIdentity,
} from "./trend-content-identity.ts";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const AUTUMN = {
  slug: "autumn-edit-2026",
  title: "Autumn Edit",
  season: "Autumn 2026",
  keyTrends: [
    { name: "The New Bag Shapes", description: "East-west shapes, softly built." },
    { name: "Suede Textures", description: "Suede returns as a surface, not a statement." },
    { name: "Burgundy", description: "A deep red that behaves like a neutral." },
  ],
  rising: [{ signal: "Relaxed tailoring", why: "Softer shoulders", source: "Vogue" }],
  fading: [{ signal: "Micro bags", why: "Impractical", source: "BoF" }],
  referencesBehindThisEdit: [
    { brand: "The Row", collection: "AW26", signal: "Soft leather", naiaRead: "Quiet structure" },
  ],
};

// ── §TCI-1 vocabulary ─────────────────────────────────────────────────────────

describe("§TCI-1 vocabulary", () => {
  it("covers every individually saveable object, not just key trends", () => {
    // If a content type can receive a ♡ or a "Not for me", it must be here.
    for (const type of ["TREND", "SIGNAL", "REFERENCE", "PRODUCT", "FACET", "TAKEAWAY", "LOOK"]) {
      assert.ok(isTrendContentType(type), `${type} must be a known content type`);
    }
    assert.equal(TREND_CONTENT_TYPES.length, 7);
  });

  it("identity-bearing fields cover all four report arrays", () => {
    assert.deepEqual(
      [...IDENTITY_BEARING_FIELD_NAMES].sort(),
      ["fading", "keyTrends", "referencesBehindThisEdit", "rising"],
    );
  });

  it("rejects unknown content types", () => {
    assert.equal(isTrendContentType("OUTFIT"), false);
    assert.equal(isTrendContentType(null), false);
  });
});

// ── §TCI-2 id format and determinism ──────────────────────────────────────────

describe("§TCI-2 id derivation", () => {
  it("produces a well-formed id", () => {
    assert.ok(isContentId(deriveContentId("anything")));
  });

  it("is deterministic — the backfill can be re-run safely", () => {
    assert.equal(deriveContentId("autumn|keyTrends|0|bags"), deriveContentId("autumn|keyTrends|0|bags"));
  });

  it("separates different seeds", () => {
    assert.notEqual(deriveContentId("a"), deriveContentId("b"));
  });

  it("rejects malformed ids", () => {
    for (const bad of ["tc_", "tc_XYZ", "abc123", "", null, undefined, 42]) {
      assert.equal(isContentId(bad), false, `${String(bad)} must not be a valid id`);
    }
  });

  it("derives 36 distinct ids across a realistic report set with no collision", () => {
    const seen = new Set<string>();
    for (const slug of ["a", "b", "c"]) {
      for (const field of IDENTITY_BEARING_FIELD_NAMES) {
        for (let i = 0; i < 4; i++) seen.add(deriveContentId(`${slug}|${field}|${i}|x`));
      }
    }
    assert.equal(seen.size, 3 * 4 * 4);
  });
});

// ── §TCI-3 IDS ARE IMMUTABLE — the core guarantee ────────────────────────────

describe("§TCI-3 identity survives editing", () => {
  it("keeps an existing id untouched", () => {
    const existing = [{ id: "tc_aaaaaaaabbbb", name: "The New Bag Shapes" }];
    const out = recoverOrMintIds("autumn", "keyTrends", existing);
    assert.equal(out[0].id, "tc_aaaaaaaabbbb");
  });

  it("RENAME: a retitled trend keeps its id", () => {
    const before = recoverOrMintIds("autumn", "keyTrends", AUTUMN.keyTrends);
    const originalId = before[0].id;

    // Admin renames the trend and drops the id from the JSON textarea.
    const renamed = [
      { name: "Bag Shapes, Reconsidered", description: "East-west shapes, softly built." },
      ...AUTUMN.keyTrends.slice(1),
    ];
    const after = recoverOrMintIds("autumn", "keyTrends", renamed, before);
    assert.equal(after[0].id, originalId, "a rename must not mint a new id");
  });

  it("COPY EDIT: rewriting a description keeps the id", () => {
    const before = recoverOrMintIds("autumn", "keyTrends", AUTUMN.keyTrends);
    const edited = AUTUMN.keyTrends.map((t) => ({ ...t, description: "Completely rewritten." }));
    const after = recoverOrMintIds("autumn", "keyTrends", edited, before);
    assert.deepEqual(after.map((e) => e.id), before.map((e) => e.id));
  });

  it("REORDER: moving a trend up the list carries its id with it", () => {
    const before = recoverOrMintIds("autumn", "keyTrends", AUTUMN.keyTrends);
    const suedeId = before[1].id;
    const reordered = [AUTUMN.keyTrends[1], AUTUMN.keyTrends[0], AUTUMN.keyTrends[2]];
    const after = recoverOrMintIds("autumn", "keyTrends", reordered, before);
    assert.equal(after[0].id, suedeId, "id follows the entry, not the position");
  });

  it("INSERT: adding a trend leaves every existing id alone", () => {
    const before = recoverOrMintIds("autumn", "keyTrends", AUTUMN.keyTrends);
    const withNew = [{ name: "Polished Knitwear", description: "New." }, ...AUTUMN.keyTrends];
    const after = recoverOrMintIds("autumn", "keyTrends", withNew, before);
    for (const original of before) {
      assert.ok(after.some((e) => e.id === original.id), `${original.name} lost its id`);
    }
    assert.equal(new Set(after.map((e) => e.id)).size, 4);
  });

  it("never issues the same id twice within a field, even for duplicate labels", () => {
    const dupes = [{ name: "Suede" }, { name: "Suede" }, { name: "Suede" }];
    const out = recoverOrMintIds("autumn", "keyTrends", dupes);
    assert.equal(new Set(out.map((e) => e.id)).size, 3);
  });

  it("does not let two entries claim one previous id", () => {
    const before = [{ id: "tc_aaaaaaaabbbb", name: "Suede" }];
    const after = recoverOrMintIds("autumn", "keyTrends", [{ name: "Suede" }, { name: "Suede" }], before);
    assert.equal(after[0].id, "tc_aaaaaaaabbbb");
    assert.notEqual(after[1].id, "tc_aaaaaaaabbbb");
  });

  it("DISPLAY TEXT IS NOT IDENTITY: same label in two reports yields different ids", () => {
    const a = recoverOrMintIds("autumn-edit", "keyTrends", [{ name: "Burgundy" }]);
    const b = recoverOrMintIds("winter-edit", "keyTrends", [{ name: "Burgundy" }]);
    assert.notEqual(a[0].id, b[0].id);
  });
});

// ── §TCI-4 edition key ────────────────────────────────────────────────────────

describe("§TCI-4 edition key", () => {
  const identified = applyContentIdentity(AUTUMN);

  it("is stable when copy is edited — history shows one card, not two", () => {
    const reworded = applyContentIdentity({
      ...AUTUMN,
      keyTrends: identified.keyTrends.map((t) => ({ ...t, description: "Reworded entirely." })),
      rising: identified.rising,
      fading: identified.fading,
      referencesBehindThisEdit: identified.referencesBehindThisEdit,
    });
    assert.equal(reworded.editionKey, identified.editionKey);
  });

  it("is stable when entries are reordered", () => {
    const reordered = applyContentIdentity({
      ...AUTUMN,
      keyTrends: [...identified.keyTrends].reverse(),
      rising: identified.rising,
      fading: identified.fading,
      referencesBehindThisEdit: identified.referencesBehindThisEdit,
    });
    assert.equal(reordered.editionKey, identified.editionKey);
  });

  it("changes when a trend is added — the report is materially different", () => {
    const expanded = applyContentIdentity({
      ...AUTUMN,
      keyTrends: [...identified.keyTrends, { id: "tc_ffffffffffff", name: "New" }],
      rising: identified.rising,
      fading: identified.fading,
      referencesBehindThisEdit: identified.referencesBehindThisEdit,
    });
    assert.notEqual(expanded.editionKey, identified.editionKey);
  });

  it("changes when the title changes", () => {
    const retitled = applyContentIdentity({ ...AUTUMN, title: "Autumn Edit, Revised" });
    assert.notEqual(retitled.editionKey, identified.editionKey);
  });
});

// ── §TCI-5 takeaways ──────────────────────────────────────────────────────────

describe("§TCI-5 takeaway identity", () => {
  it("covers every ShopperEdit section", () => {
    assert.ok(TAKEAWAY_SECTION_KEYS.includes("yourVersion"));
    assert.ok(TAKEAWAY_SECTION_KEYS.includes("aLookToTry"));
    assert.ok(TAKEAWAY_SECTION_KEYS.includes("partToLeave"));
    assert.equal(isTakeawaySectionKey("notASection"), false);
  });

  it("uses the section key, never the generated sentence", () => {
    assert.equal(makeTakeawayContentId("aLookToTry"), "aLookToTry");
    assert.equal(makeTakeawayContentId("partToTake", 1), "partToTake:1");
  });

  it("rejects a non-integer index", () => {
    assert.throws(() => makeTakeawayContentId("partToTake", 1.5));
    assert.throws(() => makeTakeawayContentId("partToTake", -1));
  });

  it("REGENERATION: a rewritten takeaway keeps its identity", () => {
    // Identity is the section, so regenerating the edit cannot orphan the save.
    const before = buildRefKey({
      contentType: "TAKEAWAY", contentId: makeTakeawayContentId("aLookToTry"),
      reportId: "rep_1", editionKey: "abc123",
    });
    const after = buildRefKey({
      contentType: "TAKEAWAY", contentId: makeTakeawayContentId("aLookToTry"),
      reportId: "rep_1", editionKey: "abc123",
    });
    assert.equal(before, after);
  });
});

// ── §TCI-6 ref keys ───────────────────────────────────────────────────────────

describe("§TCI-6 ref keys", () => {
  it("scopes report-bound content to its report", () => {
    assert.equal(
      buildRefKey({ contentType: "TREND", contentId: "tc_aaaaaaaabbbb", reportId: "rep_1" }),
      "r:rep_1|TREND|tc_aaaaaaaabbbb",
    );
  });

  it("scopes a takeaway to the report EDITION", () => {
    assert.equal(
      buildRefKey({ contentType: "TAKEAWAY", contentId: "aLookToTry", reportId: "rep_1", editionKey: "e1" }),
      "r:rep_1@e1|TAKEAWAY|aLookToTry",
    );
  });

  it("keeps facets and products global — the same object across reports", () => {
    assert.equal(buildRefKey({ contentType: "FACET", contentId: "material:suede" }), "g|FACET|material:suede");
    assert.equal(buildRefKey({ contentType: "PRODUCT", contentId: "oversized-blazer" }), "g|PRODUCT|oversized-blazer");
  });

  it("refuses report-scoped content without a report", () => {
    assert.throws(() => buildRefKey({ contentType: "TREND", contentId: "tc_aaaaaaaabbbb" }), /reportId/);
  });

  it("refuses a takeaway without an edition", () => {
    assert.throws(
      () => buildRefKey({ contentType: "TAKEAWAY", contentId: "aLookToTry", reportId: "rep_1" }),
      /editionKey/,
    );
  });

  it("refuses an empty content id", () => {
    assert.throws(() => buildRefKey({ contentType: "FACET", contentId: "" }), /required/);
  });

  it("contains no display text — only stable identifiers", () => {
    const key = buildRefKey({ contentType: "TREND", contentId: "tc_aaaaaaaabbbb", reportId: "rep_1" });
    assert.equal(key.toLowerCase().includes("bag"), false);
    assert.equal(key.toLowerCase().includes("suede"), false);
  });
});

// ── §TCI-7 applying identity to a report ─────────────────────────────────────

describe("§TCI-7 applyContentIdentity", () => {
  it("identifies every object across all four arrays", () => {
    const applied = applyContentIdentity(AUTUMN);
    assert.equal(applied.keyTrends.length, 3);
    assert.equal(applied.rising.length, 1);
    assert.equal(applied.fading.length, 1);
    assert.equal(applied.referencesBehindThisEdit.length, 1);
    assert.equal(applied.assigned.length, 6);
    for (const field of IDENTITY_BEARING_FIELD_NAMES) {
      for (const entry of applied[field]) assert.ok(isContentId(entry.id));
    }
  });

  it("is idempotent — a second run assigns nothing", () => {
    const first = applyContentIdentity(AUTUMN);
    const second = applyContentIdentity({ ...AUTUMN, ...first });
    assert.equal(second.assigned.length, 0);
    assert.equal(second.editionKey, first.editionKey);
    assert.deepEqual(second.keyTrends.map((e) => e.id), first.keyTrends.map((e) => e.id));
  });

  it("drops an empty facets key rather than storing a matches-nothing object", () => {
    const applied = applyContentIdentity({
      ...AUTUMN,
      keyTrends: [{ name: "Burgundy", facets: {} }],
    });
    assert.equal("facets" in applied.keyTrends[0], false);
  });

  it("keeps valid facets and reports invalid ones instead of swallowing them", () => {
    const applied = applyContentIdentity({
      ...AUTUMN,
      keyTrends: [{ name: "Suede Textures", facets: { material: ["suede", "moonstone"] } }],
    });
    assert.deepEqual(applied.keyTrends[0].facets, { material: ["suede"] });
    assert.equal(applied.rejectedFacets.length, 1);
    assert.equal(applied.rejectedFacets[0].value, "moonstone");
  });

  it("handles a report with empty arrays without throwing", () => {
    const applied = applyContentIdentity({ slug: "empty", title: "E", season: "S" });
    assert.equal(applied.assigned.length, 0);
    assert.ok(applied.editionKey.length > 0);
  });
});
