// app/lib/personalised-trend-history.test.ts
//
// History and allowance are separate concepts and these tests keep them apart.
// A snapshot records what she was shown. An unlock records that she received
// the report. Many snapshots may sit under one unlock and cost nothing.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  computeSnapshotHash,
  canonicalJson,
  sanitiseEditForSnapshot,
  summariseEditEvidence,
  buildHistoryCards,
  PERSONALISED_EDIT_ENGINE_VERSION,
  type SnapshotRecord,
} from "./personalised-trend-history.ts";
import type { ShopperEdit } from "./trend-evidence.server.ts";

const REPORT_ID = "cmq8f2k1a0000ab12cd34ef56";

function edit(overrides: Partial<ShopperEdit> = {}): ShopperEdit {
  return {
    subTitle: "SUEDE, READ THROUGH YOUR STYLE",
    yourVersion: "Your version of this trend.",
    evidenceStyleDna: "Your style DNA says…",
    evidencePassportSays: "Your Passport says…",
    evidenceClosetItems: [
      { name: "Navy Blazer", imageUrl: null, category: "OUTERWEAR", roleNote: "Your tailored anchor." },
    ],
    evidenceReviews: null,
    lowDataNotice: null,
    yourBestRouteIn: "Start with the blazer.",
    aLookToTry: "Blazer + fluid trouser.",
    theBalanceToProtect: "Keep one thing soft.",
    partToTake: ["A", "B"],
    worthInvestingStatement: null,
    coveredClosetCategories: ["OUTERWEAR"],
    partToLeave: ["C", "D"],
    ...overrides,
  } as ShopperEdit;
}

const hash = (e: ShopperEdit, reportId = REPORT_ID) =>
  computeSnapshotHash({ reportId, engineVersion: PERSONALISED_EDIT_ENGINE_VERSION, edit: e });

// ── §PH-1 canonical serialisation ────────────────────────────────────────────

describe("§PH-1 canonical json", () => {
  it("is key-order independent", () => {
    assert.equal(canonicalJson({ a: 1, b: 2 }), canonicalJson({ b: 2, a: 1 }));
  });

  it("preserves array order — bullet one is not bullet two", () => {
    assert.notEqual(canonicalJson(["A", "B"]), canonicalJson(["B", "A"]));
  });

  it("handles null, nesting and undefined", () => {
    assert.equal(canonicalJson(null), "null");
    assert.equal(canonicalJson({ x: { b: [1, { d: 4, c: 3 }], a: null } }), '{"x":{"a":null,"b":[1,{"c":3,"d":4}]}}');
    assert.equal(canonicalJson({ a: 1, b: undefined }), '{"a":1}');
  });
});

// ── §PH-2 snapshot identity ──────────────────────────────────────────────────

describe("§PH-2 snapshot hash", () => {
  it("is deterministic — a refresh with identical output is the same snapshot", () => {
    assert.equal(hash(edit()), hash(edit()));
  });

  it("changes when the personalised output changes", () => {
    assert.notEqual(hash(edit()), hash(edit({ aLookToTry: "Something else entirely." })));
  });

  it("changes when the engine version changes", () => {
    const a = computeSnapshotHash({ reportId: REPORT_ID, engineVersion: "1.0.0", edit: edit() });
    const b = computeSnapshotHash({ reportId: REPORT_ID, engineVersion: "2.0.0", edit: edit() });
    assert.notEqual(a, b);
  });

  it("separates reports", () => {
    assert.notEqual(hash(edit()), hash(edit(), "cmq8f2k1a0001zz98yy76xx54"));
  });

  it("IGNORES expiring signed image URLs — the duplicate-per-refresh trap", () => {
    // Signed Cloudinary URLs embed timestamp + expires_at and differ on every
    // request. If they entered the hash, every refresh would mint a new row.
    const first = edit({
      evidenceClosetItems: [{ name: "Navy Blazer", imageUrl: "https://res.cloudinary.test/x?timestamp=111&expires_at=711", category: "OUTERWEAR", roleNote: "Your tailored anchor." }],
    } as Partial<ShopperEdit>);
    const second = edit({
      evidenceClosetItems: [{ name: "Navy Blazer", imageUrl: "https://res.cloudinary.test/x?timestamp=222&expires_at=822", category: "OUTERWEAR", roleNote: "Your tailored anchor." }],
    } as Partial<ShopperEdit>);
    assert.equal(hash(first), hash(second));
  });

  it("still notices a genuinely different closet piece", () => {
    const other = edit({
      evidenceClosetItems: [{ name: "Camel Coat", imageUrl: null, category: "OUTERWEAR", roleNote: "Your tailored anchor." }],
    } as Partial<ShopperEdit>);
    assert.notEqual(hash(edit()), hash(other));
  });

  it("produces a stable 32-char fingerprint", () => {
    assert.match(hash(edit()), /^[0-9a-f]{32}$/);
  });

  it("does not collide across many distinct edits", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 2000; i++) seen.add(hash(edit({ aLookToTry: `Look number ${i}.` })));
    assert.equal(seen.size, 2000);
  });
});

// ── §PH-3 what is persisted ──────────────────────────────────────────────────

describe("§PH-3 sanitisation", () => {
  it("strips signed image URLs — never store a credential that dies in ten minutes", () => {
    const sanitised = sanitiseEditForSnapshot(edit({
      evidenceClosetItems: [{ name: "Navy Blazer", imageUrl: "https://res.cloudinary.test/signed?x=1", category: "OUTERWEAR", roleNote: "Anchor." }],
    } as Partial<ShopperEdit>));
    assert.equal(sanitised.evidenceClosetItems[0].imageUrl, null);
  });

  it("keeps the labels the customer actually read", () => {
    const sanitised = sanitiseEditForSnapshot(edit());
    assert.equal(sanitised.evidenceClosetItems[0].name, "Navy Blazer");
    assert.equal(sanitised.evidenceClosetItems[0].roleNote, "Your tailored anchor.");
    assert.equal(sanitised.evidenceClosetItems[0].category, "OUTERWEAR");
  });

  it("keeps the rest of the edit intact", () => {
    const sanitised = sanitiseEditForSnapshot(edit());
    assert.equal(sanitised.aLookToTry, "Blazer + fluid trouser.");
    assert.deepEqual(sanitised.partToTake, ["A", "B"]);
  });

  it("the evidence summary is counts and flags only", () => {
    const summary = summariseEditEvidence(edit());
    assert.deepEqual(summary, {
      closetItemsNamed: 1,
      hasStyleDnaEvidence: true,
      hasPassportEvidence: true,
      hasReviewEvidence: false,
    });
    // No names, no ids, no garment data.
    assert.equal(JSON.stringify(summary).includes("Blazer"), false);
  });
});

// ── §PH-4 history is not a version log ───────────────────────────────────────

const snap = (o: Partial<SnapshotRecord>): SnapshotRecord => ({
  id: "s1", reportId: REPORT_ID, reportSlug: "autumn-edit", reportTitle: "Autumn Edit",
  reportSeason: "September 2026", engineVersion: "1.0.0", snapshotHash: "h",
  createdAt: "2026-09-01T00:00:00.000Z", ...o,
});

describe("§PH-4 customer-facing history", () => {
  it("collapses five internal versions into ONE card", () => {
    const cards = buildHistoryCards([
      snap({ id: "v1", createdAt: "2026-09-01T00:00:00.000Z" }),
      snap({ id: "v2", createdAt: "2026-09-05T00:00:00.000Z" }),
      snap({ id: "v3", createdAt: "2026-09-09T00:00:00.000Z" }),
      snap({ id: "v4", createdAt: "2026-09-12T00:00:00.000Z" }),
      snap({ id: "v5", createdAt: "2026-09-20T00:00:00.000Z" }),
    ]);
    assert.equal(cards.length, 1);
    assert.equal(cards[0].versionCount, 5);
  });

  it("opens the LATEST snapshot for that report", () => {
    const cards = buildHistoryCards([
      snap({ id: "old", createdAt: "2026-09-01T00:00:00.000Z" }),
      snap({ id: "newest", createdAt: "2026-09-20T00:00:00.000Z" }),
    ]);
    assert.equal(cards[0].snapshotId, "newest");
  });

  it("reports when she RECEIVED it, not when it was last regenerated", () => {
    const cards = buildHistoryCards([
      snap({ id: "old", createdAt: "2026-09-01T00:00:00.000Z" }),
      snap({ id: "newest", createdAt: "2026-09-20T00:00:00.000Z" }),
    ]);
    assert.equal(cards[0].receivedAt, "2026-09-01T00:00:00.000Z");
  });

  it("one card per report, most recently received first", () => {
    const cards = buildHistoryCards([
      snap({ id: "a", reportId: "r-spring", reportTitle: "Spring Edit", createdAt: "2026-03-01T00:00:00.000Z" }),
      snap({ id: "b", reportId: REPORT_ID, reportTitle: "Autumn Edit", createdAt: "2026-09-01T00:00:00.000Z" }),
    ]);
    assert.deepEqual(cards.map((c) => c.reportTitle), ["Autumn Edit", "Spring Edit"]);
  });

  it("is order-independent on input", () => {
    const forward = buildHistoryCards([snap({ id: "a", createdAt: "2026-09-01T00:00:00.000Z" }), snap({ id: "b", createdAt: "2026-09-20T00:00:00.000Z" })]);
    const reverse = buildHistoryCards([snap({ id: "b", createdAt: "2026-09-20T00:00:00.000Z" }), snap({ id: "a", createdAt: "2026-09-01T00:00:00.000Z" })]);
    assert.deepEqual(forward, reverse);
  });

  it("an empty history yields no cards", () => {
    assert.deepEqual(buildHistoryCards([]), []);
  });

  it("carries the slug needed to build the replay link", () => {
    assert.equal(buildHistoryCards([snap({})])[0].reportSlug, "autumn-edit");
  });
});

// ── §PH-5 enforcement is measurable, NOT enabled ─────────────────────────────
//
// Step 4 makes usage countable. It must not quietly start blocking: the
// existing monthly guards sit behind ENTITLEMENT_ENFORCEMENT, which is off, and
// the personalised-trend allowance has never had a guard at all.

import { readFileSync } from "node:fs";

describe("§PH-5 entitlement wiring", () => {
  const entitlement = readFileSync(new URL("./plan/entitlement.server.ts", import.meta.url), "utf8");

  it("monthlyUsed counts UNLOCKS, not snapshots", () => {
    assert.match(entitlement, /personalisedTrendEditUnlock\.count/);
    assert.equal(entitlement.includes("personalisedTrendEdit.count"), false,
      "usage must never be derived from snapshot rows");
  });

  it("reuses the existing entitlement window — no second month calculation", () => {
    const query = entitlement.slice(entitlement.indexOf("personalisedTrendEditUnlock.count"));
    assert.match(query.slice(0, 260), /window\.start/);
    assert.match(query.slice(0, 260), /window\.end/);
  });

  it("monthlyUsed is a real number now, not the old null placeholder", () => {
    assert.equal(entitlement.includes("monthlyUsed: null"), false);
  });

  it("adds NO enforcement gate for personalised trends", () => {
    // Enforcement stays deferred in this phase. Counting is not blocking.
    assert.equal(entitlement.includes('"personalisedTrend"'), false,
      "personalisedTrend must not be added to the EntitlementFeature gate");
  });

  it("the history layer never blocks access", () => {
    const server = readFileSync(new URL("./personalised-trend-history.server.ts", import.meta.url), "utf8");
    assert.equal(server.includes("checkEntitlement"), false);
    assert.equal(server.includes("ENTITLEMENT_ENFORCEMENT"), false);
  });
});
