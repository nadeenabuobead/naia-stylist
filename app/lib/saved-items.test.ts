// app/lib/saved-items.test.ts
//
// The contract: one canonical object, one Saved card. Saving twice must not
// produce two. Provenance must record where the customer actually found a
// thing, and must not be rewritten by a later encounter somewhere else.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  SAVED_SOURCE_KINDS,
  SAVED_LANE_LABELS,
  isSavedSourceKind,
  buildSaveItemRow,
  savedItemToCard,
  savedLookToCard,
  mergeSavedCards,
  activeLanes,
  countByLane,
  type SaveItemRequest,
  type SavedItemRecord,
} from "./saved-items.ts";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const REPORT_ID = "cmq8f2k1a0000ab12cd34ef56";  // cuid, as Prisma generates
const TREND_ID = "tc_aaaaaaaaaaaa";

function trendSave(overrides: Partial<SaveItemRequest> = {}): SaveItemRequest {
  return {
    contentType: "TREND",
    contentId: TREND_ID,
    reportId: REPORT_ID,
    label: "Suede Textures",
    sublabel: "Suede returns as a surface, not a statement.",
    sourceKind: "TREND_REPORT",
    sourceReportTitle: "Autumn Edit",
    sourceSeason: "September 2026",
    sourcePath: `/trends/my-edits/autumn-edit-2026`,
    ...overrides,
  };
}

function record(overrides: Partial<SavedItemRecord> = {}): SavedItemRecord {
  return {
    id: "si_1",
    refKey: `r:${REPORT_ID}|TREND|${TREND_ID}`,
    contentType: "TREND",
    contentId: TREND_ID,
    label: "Suede Textures",
    sublabel: "Suede returns as a surface.",
    imageUrl: null,
    sourceKind: "TREND_REPORT",
    sourceReportTitle: "Autumn Edit",
    sourceSeason: "September 2026",
    sourceContentLabel: null,
    sourcePath: "/trends/my-edits/autumn-edit-2026",
    createdAt: "2026-09-20T10:00:00.000Z",
    ...overrides,
  };
}

// ── §SI-1 canonical identity ─────────────────────────────────────────────────

describe("§SI-1 canonical identity", () => {
  it("a TREND is report-scoped — the same trend in two reports is two objects", () => {
    const autumn = buildSaveItemRow(trendSave());
    const winter = buildSaveItemRow(trendSave({ reportId: "cmq8f2k1a0001zz98yy76xx54" }));
    assert.notEqual(autumn.refKey, winter.refKey);
  });

  it("a PRODUCT is global — saved from two reports, ONE object", () => {
    const fromAutumn = buildSaveItemRow({
      contentType: "PRODUCT", contentId: "oversized-blazer", label: "Oversized Blazer",
      sourceKind: "TREND_REPORT", sourceReportTitle: "Autumn Edit",
    });
    const fromWinter = buildSaveItemRow({
      contentType: "PRODUCT", contentId: "oversized-blazer", label: "Oversized Blazer",
      sourceKind: "TREND_REPORT", sourceReportTitle: "Winter Edit",
    });
    assert.equal(fromAutumn.refKey, fromWinter.refKey);
  });

  it("a FACET is global — material:suede saved twice is ONE object", () => {
    const a = buildSaveItemRow({
      contentType: "FACET", contentId: "material:suede", label: "Suede",
      sourceKind: "TREND_REPORT", sourceReportTitle: "Autumn Edit",
    });
    const b = buildSaveItemRow({
      contentType: "FACET", contentId: "material:suede", label: "Suede",
      sourceKind: "TREND_REPORT", sourceReportTitle: "Spring Edit",
    });
    assert.equal(a.refKey, b.refKey);
    assert.equal(a.refKey, "g|FACET|material:suede");
  });

  it("the refKey carries no display text", () => {
    const row = buildSaveItemRow(trendSave());
    assert.equal(row.refKey.toLowerCase().includes("suede"), false);
    assert.equal(row.refKey.toLowerCase().includes("autumn"), false);
  });

  it("renaming the trend does not change the identity of the save", () => {
    const before = buildSaveItemRow(trendSave());
    const after = buildSaveItemRow(trendSave({ label: "Suede, Reconsidered" }));
    assert.equal(before.refKey, after.refKey);
  });

  it("refuses a report-scoped save with no report", () => {
    assert.throws(() => buildSaveItemRow(trendSave({ reportId: null })), /reportId/);
  });
});

// ── §SI-2 the row ─────────────────────────────────────────────────────────────

describe("§SI-2 row construction", () => {
  it("keeps a display snapshot so the card renders if the report is deleted", () => {
    const row = buildSaveItemRow(trendSave());
    assert.equal(row.label, "Suede Textures");
    assert.equal(row.sublabel, "Suede returns as a surface, not a statement.");
    assert.equal(row.reportId, REPORT_ID);
  });

  it("refuses a save with no label — a blank card helps nobody", () => {
    assert.throws(() => buildSaveItemRow(trendSave({ label: "   " })), /label/);
  });

  it("rejects an unknown content type or source kind", () => {
    assert.throws(() => buildSaveItemRow(trendSave({ contentType: "OUTFIT" as never })));
    assert.throws(() => buildSaveItemRow(trendSave({ sourceKind: "TIKTOK" as never })));
  });

  it("normalises whitespace and bounds snapshot length", () => {
    const row = buildSaveItemRow(trendSave({ label: "  Suede\n\n  Textures  ", sublabel: "x".repeat(500) }));
    assert.equal(row.label, "Suede Textures");
    assert.ok(row.sublabel!.length <= 320);
    assert.ok(row.sublabel!.endsWith("…"));
  });

  it("empty optional snapshots become null, not empty strings", () => {
    const row = buildSaveItemRow(trendSave({ sublabel: "  ", sourceSeason: "" }));
    assert.equal(row.sublabel, null);
    assert.equal(row.sourceSeason, null);
  });

  it("keeps only in-app paths — a stored URL must not redirect off-site", () => {
    assert.equal(buildSaveItemRow(trendSave({ sourcePath: "/trends/x" })).sourcePath, "/trends/x");
    for (const hostile of ["https://evil.test/x", "//evil.test/x", "javascript:alert(1)"]) {
      assert.equal(buildSaveItemRow(trendSave({ sourcePath: hostile })).sourcePath, null, hostile);
    }
  });

  it("every source kind is accepted", () => {
    for (const kind of SAVED_SOURCE_KINDS) assert.ok(isSavedSourceKind(kind));
    assert.equal(isSavedSourceKind("INSTAGRAM"), false);
  });
});

// ── §SI-3 cards ───────────────────────────────────────────────────────────────

describe("§SI-3 card rendering", () => {
  it("answers what / what type / where from", () => {
    const card = savedItemToCard(record());
    assert.equal(card.label, "Suede Textures");            // what
    assert.equal(card.typeLabel, "Trend");                  // what type
    assert.equal(card.provenance, "From: Autumn Edit · September 2026"); // where from
  });

  it("names the trend a nested object was saved from", () => {
    const card = savedItemToCard(record({
      contentType: "FACET", contentId: "material:suede", label: "Suede",
      sourceContentLabel: "Suede Textures",
    }));
    assert.equal(card.provenanceDetail, "Trend: Suede Textures");
  });

  it("labels a saved facet by its kind", () => {
    assert.equal(savedItemToCard(record({ contentType: "FACET", contentId: "colourFamily:red-burgundy" })).typeLabel, "Colour");
    assert.equal(savedItemToCard(record({ contentType: "FACET", contentId: "material:suede" })).typeLabel, "Material");
    assert.equal(savedItemToCard(record({ contentType: "FACET", contentId: "silhouette:relaxed" })).typeLabel, "Silhouette");
  });

  it("falls back to the source kind when the report snapshot is partial", () => {
    const card = savedItemToCard(record({ sourceReportTitle: null, sourceSeason: null }));
    assert.equal(card.provenance, "From: Trend Report");
  });

  it("prints no stray separator when only one provenance part exists", () => {
    const card = savedItemToCard(record({ sourceSeason: null }));
    assert.equal(card.provenance, "From: Autumn Edit");
  });

  it("routes each content type to the right lane", () => {
    const lane = (contentType: string, contentId = TREND_ID) =>
      savedItemToCard(record({ contentType, contentId })).lane;
    assert.equal(lane("TREND"), "trends");
    assert.equal(lane("SIGNAL"), "trends");
    assert.equal(lane("REFERENCE"), "brands");
    assert.equal(lane("PRODUCT"), "pieces");
    assert.equal(lane("FACET", "material:suede"), "directions");
    assert.equal(lane("TAKEAWAY", "aLookToTry"), "notes");
  });

  it("every lane has a label", () => {
    for (const lane of Object.keys(SAVED_LANE_LABELS)) {
      assert.ok(SAVED_LANE_LABELS[lane as keyof typeof SAVED_LANE_LABELS].length > 0);
    }
  });
});

// ── §SI-4 looks alongside items ──────────────────────────────────────────────

describe("§SI-4 SavedLook in the same destination", () => {
  const look = {
    id: "sl_1",
    name: "Dinner, softly",
    occasion: "Dinner",
    images: ["a.jpg", "b.jpg", "c.jpg", "d.jpg"],
    originalSessionId: "sess_1",
    timesWorn: 2,
    createdAt: "2026-09-21T10:00:00.000Z",
  };

  it("renders a look as a card without restating its storage", () => {
    const card = savedLookToCard(look);
    assert.equal(card.store, "look");
    assert.equal(card.lane, "looks");
    assert.equal(card.typeLabel, "Look");
    assert.equal(card.label, "Dinner, softly");
    assert.equal(card.provenance, "From: StyleMe");
    assert.equal(card.href, "/style-me/result?sessionId=sess_1");
  });

  it("identifies a look by row id, never by refKey", () => {
    assert.equal(savedLookToCard(look).refKey, null);
  });

  it("shows at most three pieces", () => {
    assert.equal(savedLookToCard(look).images.length, 3);
  });

  it("names an unnamed look rather than rendering blank", () => {
    assert.equal(savedLookToCard({ ...look, name: null }).label, "Saved look");
  });

  it("has no link when the session is gone", () => {
    assert.equal(savedLookToCard({ ...look, originalSessionId: null }).href, null);
  });

  it("merges both stores newest-first", () => {
    const merged = mergeSavedCards([
      savedItemToCard(record({ id: "old", createdAt: "2026-09-01T00:00:00.000Z" })),
      savedLookToCard(look),
      savedItemToCard(record({ id: "new", createdAt: "2026-09-30T00:00:00.000Z" })),
    ]);
    assert.deepEqual(merged.map((c) => c.id), ["new", "sl_1", "old"]);
  });

  it("card keys stay unique even if a look and an item share a row id", () => {
    const item = savedItemToCard(record({ id: "same" }));
    const lk = savedLookToCard({ ...look, id: "same" });
    assert.notEqual(`${item.store}-${item.id}`, `${lk.store}-${lk.id}`);
  });
});

// ── §SI-5 lanes ───────────────────────────────────────────────────────────────

describe("§SI-5 lanes", () => {
  it("only surfaces lanes that have something in them", () => {
    const cards = [
      savedLookToCard({ id: "l", name: "L", occasion: null, images: [], originalSessionId: null, timesWorn: 0, createdAt: "2026-09-01T00:00:00.000Z" }),
      savedItemToCard(record({ contentType: "TREND" })),
    ];
    assert.deepEqual(activeLanes(cards), ["looks", "trends"]);
  });

  it("keeps a stable display order regardless of save order", () => {
    const cards = [
      savedItemToCard(record({ id: "a", contentType: "FACET", contentId: "material:suede" })),
      savedItemToCard(record({ id: "b", contentType: "TREND" })),
    ];
    assert.deepEqual(activeLanes(cards), ["trends", "directions"]);
  });

  it("counts per lane", () => {
    const cards = [
      savedItemToCard(record({ id: "a", contentType: "TREND" })),
      savedItemToCard(record({ id: "b", contentType: "SIGNAL" })),
      savedItemToCard(record({ id: "c", contentType: "PRODUCT", contentId: "blazer" })),
    ];
    assert.deepEqual(countByLane(cards), { trends: 2, pieces: 1 });
  });

  it("an empty archive has no lanes", () => {
    assert.deepEqual(activeLanes([]), []);
  });
});

// ── §SI-6 the static pre-seed fallback ───────────────────────────────────────
//
// loadReportSaveState is the gate the UI reads. On a report with no canonical
// row it must hand back nothing at all, so no ♡ is ever rendered — including
// for a globally identified product, whose provenance would otherwise reference
// throwaway content ids from the fallback.

describe("§SI-6 no saveable controls on a non-canonical report", () => {
  // Re-implements the guard's contract rather than importing the server module,
  // which would pull in Prisma. The assertion below pins the source of truth.
  it("the server helper returns early with nothing saveable when there is no row id", async () => {
    const src = await import("node:fs").then((fs) =>
      fs.readFileSync(new URL("./saved-items.server.ts", import.meta.url), "utf8"));
    assert.match(src, /if \(!reportId\) return \{ refKeys: \{\}, saved: \[\], canSave: false \}/);
    // The early return must sit BEFORE product handles are turned into refKeys,
    // or a fallback report would still offer a ♡ on its NADINE piece.
    const guardAt = src.indexOf("if (!reportId) return { refKeys: {}");
    const productAt = src.indexOf("options.productHandles");
    assert.ok(guardAt > 0 && productAt > guardAt, "the guard must precede product refKeys");
  });
});
