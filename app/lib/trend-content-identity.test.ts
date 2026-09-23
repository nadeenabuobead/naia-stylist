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
  deriveLegacyContentId,
  isLegacyContentId,
  mintOpaqueContentId,
  mintLegacyContentId,
  recoverOrMintIds,
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

// ── §TCI-2 minting ────────────────────────────────────────────────────────────

describe("§TCI-2 id minting", () => {
  it("runtime ids are OPAQUE and random — never derived from content", () => {
    const a = mintOpaqueContentId({ slug: "s", field: "keyTrends", index: 0, entry: { name: "Suede" } });
    const b = mintOpaqueContentId({ slug: "s", field: "keyTrends", index: 0, entry: { name: "Suede" } });
    assert.ok(isContentId(a));
    assert.notEqual(a, b, "identical content must not produce identical ids");
    assert.equal(isLegacyContentId(a), false);
  });

  it("an opaque id leaks nothing about the content it identifies", () => {
    const id = mintOpaqueContentId({ slug: "autumn", field: "keyTrends", index: 0, entry: { name: "Suede Textures" } });
    assert.equal(/^tc_[0-9a-f]{32}$/.test(id), true);
    assert.equal(id.toLowerCase().includes("suede"), false);
    assert.equal(id.toLowerCase().includes("autumn"), false);
  });

  it("10k opaque ids collide zero times", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 10_000; i++) {
      seen.add(mintOpaqueContentId({ slug: "s", field: "f", index: i, entry: {} }));
    }
    assert.equal(seen.size, 10_000);
  });

  it("the LEGACY minter is deterministic — the one-time backfill must be re-runnable", () => {
    const ctx = { slug: "autumn", field: "keyTrends", index: 0, entry: { name: "Suede" } };
    assert.equal(mintLegacyContentId(ctx), mintLegacyContentId(ctx));
    assert.ok(isLegacyContentId(mintLegacyContentId(ctx)));
  });

  it("legacy derivation separates different seeds", () => {
    assert.notEqual(deriveLegacyContentId("a"), deriveLegacyContentId("b"));
  });

  it("accepts both id shapes, rejects everything else", () => {
    assert.ok(isContentId("tc_803039921185"));
    assert.ok(isContentId(`tc_${"a".repeat(32)}`));
    for (const bad of ["tc_", "tc_XYZ", "abc123", "tc_80303992118", "", null, undefined, 42]) {
      assert.equal(isContentId(bad), false, `${String(bad)} must not be a valid id`);
    }
  });
});

// ── §TCI-3 IDENTITY PRESERVATION — the seven scenarios ───────────────────────
//
// Post-backfill every entry carries its id, so scenario 1 is the normal path and
// the rest are the safety net for a hand-edited payload.

const ID_A = "tc_aaaaaaaaaaaa";
const ID_B = "tc_bbbbbbbbbbbb";
const ID_C = "tc_cccccccccccc";

describe("§TCI-3 identity preservation", () => {
  it("1. RENAME with the id preserved → same id", () => {
    const previous = [{ id: ID_A, name: "The New Bag Shapes", description: "d" }];
    const out = recoverOrMintIds("autumn", "keyTrends", [
      { id: ID_A, name: "Bag Shapes, Reconsidered", description: "d" },
    ], previous);
    assert.equal(out[0].id, ID_A);
  });

  it("2. DESCRIPTION REWRITE with the id preserved → same id", () => {
    const previous = [{ id: ID_A, name: "Suede Textures", description: "old" }];
    const out = recoverOrMintIds("autumn", "keyTrends", [
      { id: ID_A, name: "Suede Textures", description: "completely rewritten" },
    ], previous);
    assert.equal(out[0].id, ID_A);
  });

  it("3. REORDER → same ids, following the entries", () => {
    const previous = [
      { id: ID_A, name: "Bags" }, { id: ID_B, name: "Suede" }, { id: ID_C, name: "Burgundy" },
    ];
    const out = recoverOrMintIds("autumn", "keyTrends", [previous[2], previous[0], previous[1]], previous);
    assert.deepEqual(out.map((e) => e.id), [ID_C, ID_A, ID_B]);
  });

  it("4. INSERTION → existing ids unchanged, the new object gets a new id", () => {
    const previous = [{ id: ID_A, name: "Bags" }, { id: ID_B, name: "Suede" }];
    const out = recoverOrMintIds("autumn", "keyTrends", [
      { id: ID_A, name: "Bags" }, { name: "Polished Knitwear" }, { id: ID_B, name: "Suede" },
    ], previous);
    assert.equal(out[0].id, ID_A);
    assert.equal(out[2].id, ID_B);
    assert.ok(isContentId(out[1].id));
    assert.ok(![ID_A, ID_B].includes(out[1].id as string), "new content must not inherit an existing id");
  });

  it("5. DELETION + REPLACEMENT AT THE SAME INDEX → the replacement gets a NEW id", () => {
    // The scenario that made positional recovery unsafe: trend A is deleted, an
    // unrelated trend D takes its slot, and the payload arrives with no id.
    const previous = [{ id: ID_A, name: "Trend A" }, { id: ID_B, name: "Trend B" }];
    const out = recoverOrMintIds("autumn", "keyTrends", [
      { name: "Trend D" }, { id: ID_B, name: "Trend B" },
    ], previous);
    assert.notEqual(out[0].id, ID_A, "Trend D must NOT inherit Trend A's id");
    assert.ok(isContentId(out[0].id));
    assert.equal(out[1].id, ID_B, "the untouched entry keeps its id");
  });

  it("5b. even a full no-id payload never inherits by position", () => {
    const previous = [{ id: ID_A, name: "Trend A" }, { id: ID_B, name: "Trend B" }];
    const out = recoverOrMintIds("autumn", "keyTrends", [{ name: "X" }, { name: "Y" }], previous);
    for (const entry of out) {
      assert.ok(![ID_A, ID_B].includes(entry.id as string), `${entry.name} inherited a stale id`);
    }
  });

  it("6. DUPLICATE LABELS → distinct ids", () => {
    const out = recoverOrMintIds("autumn", "keyTrends", [{ name: "Suede" }, { name: "Suede" }, { name: "Suede" }]);
    assert.equal(new Set(out.map((e) => e.id)).size, 3);
  });

  it("6b. two entries cannot both claim one previous id", () => {
    const previous = [{ id: ID_A, name: "Suede" }];
    const out = recoverOrMintIds("autumn", "keyTrends", [{ name: "Suede" }, { name: "Suede" }], previous);
    assert.equal(out[0].id, ID_A);
    assert.notEqual(out[1].id, ID_A);
  });

  it("7. DELETE, then a LATER object reuses the old label → the dead id is NOT resurrected", () => {
    // Save 1 → A and B exist.
    const save1 = recoverOrMintIds("autumn", "keyTrends", [{ name: "Suede" }, { name: "Bags" }]);
    const suedeId = save1[0].id;

    // Save 2 → Suede is deleted. Only Bags survives.
    const save2 = recoverOrMintIds("autumn", "keyTrends", [save1[1]], save1);

    // Save 3 → a NEW trend reuses the label "Suede", with no id.
    const save3 = recoverOrMintIds("autumn", "keyTrends", [save2[0], { name: "Suede" }], save2);

    assert.notEqual(save3[1].id, suedeId, "a deleted trend's id must not be resurrected by label");
    assert.ok(isContentId(save3[1].id));
  });

  it("label recovery only consults the IMMEDIATELY previous version", () => {
    const v1 = recoverOrMintIds("autumn", "keyTrends", [{ name: "Suede" }]);
    const v2 = recoverOrMintIds("autumn", "keyTrends", [], v1);          // deleted
    const v3 = recoverOrMintIds("autumn", "keyTrends", [{ name: "Suede" }], v2); // re-added
    assert.notEqual(v3[0].id, v1[0].id);
  });

  it("an embedded id always beats label evidence", () => {
    const previous = [{ id: ID_A, name: "Suede" }];
    const out = recoverOrMintIds("autumn", "keyTrends", [{ id: ID_B, name: "Suede" }], previous);
    assert.equal(out[0].id, ID_B, "the payload's own id is canonical");
  });

  it("DISPLAY TEXT IS NOT IDENTITY: the same label in two reports gets different ids", () => {
    const a = recoverOrMintIds("autumn-edit", "keyTrends", [{ name: "Burgundy" }]);
    const b = recoverOrMintIds("winter-edit", "keyTrends", [{ name: "Burgundy" }]);
    assert.notEqual(a[0].id, b[0].id);
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
    assert.equal(makeTakeawayContentId("partToTake"), "partToTake");
  });

  it("refuses positional bullet identity — an index identifies a slot, not a thing", () => {
    // "partToTake:1" would re-point at different advice after a regeneration.
    assert.throws(() => makeTakeawayContentId("partToTake:1" as never));
    assert.throws(() => makeTakeawayContentId("notASection" as never));
  });

  it("REGENERATION: a rewritten takeaway keeps its identity", () => {
    // Identity is the section, so regenerating the edit cannot orphan the save.
    const before = buildRefKey({
      contentType: "TAKEAWAY", contentId: makeTakeawayContentId("aLookToTry"), reportId: "rep_1",
    });
    const after = buildRefKey({
      contentType: "TAKEAWAY", contentId: makeTakeawayContentId("aLookToTry"), reportId: "rep_1",
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

  it("scopes a takeaway to its report", () => {
    assert.equal(
      buildRefKey({ contentType: "TAKEAWAY", contentId: "aLookToTry", reportId: "rep_1" }),
      "r:rep_1|TAKEAWAY|aLookToTry",
    );
  });

  it("keeps facets and products global — the same object across reports", () => {
    assert.equal(buildRefKey({ contentType: "FACET", contentId: "material:suede" }), "g|FACET|material:suede");
    assert.equal(buildRefKey({ contentType: "PRODUCT", contentId: "oversized-blazer" }), "g|PRODUCT|oversized-blazer");
  });

  it("refuses report-scoped content without a report", () => {
    assert.throws(() => buildRefKey({ contentType: "TREND", contentId: "tc_aaaaaaaabbbb" }), /reportId/);
  });

  it("refuses a takeaway without a report", () => {
    assert.throws(() => buildRefKey({ contentType: "TAKEAWAY", contentId: "aLookToTry" }), /reportId/);
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

  it("is idempotent — a second run over identified content assigns nothing", () => {
    const first = applyContentIdentity(AUTUMN, null, mintLegacyContentId);
    const second = applyContentIdentity({ ...AUTUMN, ...first }, null, mintLegacyContentId);
    assert.equal(second.assigned.length, 0);
    assert.deepEqual(second.keyTrends.map((e) => e.id), first.keyTrends.map((e) => e.id));
  });

  it("the legacy backfill is reproducible — same input, same ids", () => {
    const a = applyContentIdentity(AUTUMN, null, mintLegacyContentId);
    const b = applyContentIdentity(AUTUMN, null, mintLegacyContentId);
    assert.deepEqual(a.keyTrends.map((e) => e.id), b.keyTrends.map((e) => e.id));
  });

  it("runtime identity is opaque, so two runs over UNIDENTIFIED content differ", () => {
    const a = applyContentIdentity(AUTUMN);
    const b = applyContentIdentity(AUTUMN);
    assert.notDeepEqual(a.keyTrends.map((e) => e.id), b.keyTrends.map((e) => e.id));
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
  });
});
