// app/lib/admin/new-intention-review-filter.test.ts
//
// Admin workflow support for the 79-garment review sweep of the four intentions
// added in the 2026-09 taxonomy expansion.
//
// The filter and the per-garment badge must agree, so both derive completion from
// one helper — getIntentionReviewState — and from key presence only. A stored
// "None" is a human answer and counts as reviewed; a missing key does not.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  getIntentionReviewState,
  ORIGINAL_INTENTION_IDS,
  NEW_INTENTION_IDS,
} from "./styleme-garment-profile.vocab.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const src = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

const LIST_SERVER = "app/lib/admin/closet-intelligence.server.ts";
const LIST_ROUTE = "app/routes/admin.naia.closet._index.tsx";

function approvedTwelve(): Record<string, string> {
  return Object.fromEntries(ORIGINAL_INTENTION_IDS.map((id) => [id, "Supporting"]));
}

/** Mirrors the completion predicate used by the filter and the row flag. */
const isComplete = (potentials: Record<string, string> | null) =>
  getIntentionReviewState(potentials).pendingNew.length === 0;

// ── Completion semantics ─────────────────────────────────────────────────────

describe("NIR.1 — completion is decided by key presence, nothing else", () => {
  it("a garment approved under the old taxonomy is NOT complete", () => {
    assert.equal(isComplete(approvedTwelve()), false);
    assert.equal(getIntentionReviewState(approvedTwelve()).pendingNew.length, 4);
  });

  it("a garment with all four rated is complete", () => {
    const all = { ...approvedTwelve(), ...Object.fromEntries(NEW_INTENTION_IDS.map((id) => [id, "Strong"])) };
    assert.equal(isComplete(all), true);
  });

  it("a stored None counts as reviewed", () => {
    const allNone = { ...approvedTwelve(), ...Object.fromEntries(NEW_INTENTION_IDS.map((id) => [id, "None"])) };
    assert.equal(isComplete(allNone), true, "a human choosing None is a completed review");
  });

  it("a mix of Strong, Supporting and None is complete", () => {
    const mixed = {
      ...approvedTwelve(),
      "feel-elevated": "Strong",
      "stand-out": "None",
      "feel-fun": "Supporting",
      "feel-powerful": "None",
    };
    assert.equal(isComplete(mixed), true);
  });

  it("three of four is still incomplete", () => {
    const partial = {
      ...approvedTwelve(),
      "feel-elevated": "Strong",
      "stand-out": "None",
      "feel-fun": "Supporting",
    };
    assert.equal(isComplete(partial), false);
    assert.deepEqual(getIntentionReviewState(partial).pendingNew, ["feel-powerful"]);
  });

  it("a garment with no StyleMe profile at all is incomplete, not complete", () => {
    assert.equal(isComplete(null), false);
    assert.equal(getIntentionReviewState(null).pendingNew.length, 4);
  });

  it("an empty-string rating does not count as reviewed", () => {
    const blank = { ...approvedTwelve(), ...Object.fromEntries(NEW_INTENTION_IDS.map((id) => [id, ""])) };
    assert.equal(isComplete(blank), false);
  });

  it("ratings for the original 12 never affect new-intention completion", () => {
    const allStrongOriginals = Object.fromEntries(ORIGINAL_INTENTION_IDS.map((id) => [id, "Strong"]));
    const allNoneOriginals = Object.fromEntries(ORIGINAL_INTENTION_IDS.map((id) => [id, "None"]));
    assert.equal(isComplete(allStrongOriginals), false);
    assert.equal(isComplete(allNoneOriginals), false);
  });
});

// ── Progress counting ────────────────────────────────────────────────────────

describe("NIR.2 — the X / N progress count", () => {
  it("counts only fully-rated garments as reviewed", () => {
    const fixtures: Array<Record<string, string> | null> = [
      { ...approvedTwelve(), "feel-elevated": "Strong", "stand-out": "None", "feel-fun": "None", "feel-powerful": "None" },
      { ...approvedTwelve(), "feel-elevated": "Strong" },
      approvedTwelve(),
      null,
    ];
    const reviewed = fixtures.filter((f) => isComplete(f)).length;
    assert.equal(reviewed, 1, "only the fully-rated garment counts");
    assert.equal(fixtures.length - reviewed, 3);
  });

  it("a 79-garment closet with none reviewed reports 0 complete", () => {
    const closet = Array.from({ length: 79 }, () => approvedTwelve());
    assert.equal(closet.filter(isComplete).length, 0);
    assert.equal(closet.filter((c) => !isComplete(c)).length, 79);
  });

  it("a 79-garment closet fully swept reports 79 complete", () => {
    const closet = Array.from({ length: 79 }, () => ({
      ...approvedTwelve(),
      ...Object.fromEntries(NEW_INTENTION_IDS.map((id) => [id, "None"])),
    }));
    assert.equal(closet.filter(isComplete).length, 79);
  });
});

// ── Wiring ───────────────────────────────────────────────────────────────────

describe("NIR.3 — the list filter is wired to the shared helper", () => {
  it("the list server exposes the filter and the summary", () => {
    const text = src(LIST_SERVER);
    assert.ok(text.includes("newIntentionReview?: NewIntentionReviewFilter"));
    assert.ok(text.includes('export type NewIntentionReviewFilter = "needs-review" | "complete"'));
    assert.ok(text.includes("export async function getNewIntentionReviewSummary"));
  });

  it("both the filter and the row flag call getIntentionReviewState", () => {
    const text = src(LIST_SERVER);
    const calls = text.match(/getIntentionReviewState\(/g) ?? [];
    assert.ok(calls.length >= 3, "filter, row flag and summary must all use one helper");
    assert.ok(text.includes('from "./styleme-garment-profile.vocab"'));
  });

  it("the row carries the reviewed flag and the pending count", () => {
    const text = src(LIST_SERVER);
    assert.ok(text.includes("newIntentionsReviewed: boolean"));
    assert.ok(text.includes("pendingNewIntentionCount: number"));
    assert.ok(text.includes("styleMeProfile: {\n          select: { intentionPotentials: true },"));
  });

  it("the admin list offers All / Needs review / Complete", () => {
    const text = src(LIST_ROUTE);
    assert.ok(text.includes('name="newIntentionReview"'));
    assert.ok(text.includes('<option value="">All</option>'));
    assert.ok(text.includes('<option value="needs-review">Needs review</option>'));
    assert.ok(text.includes('<option value="complete">Complete</option>'));
  });

  it("the admin list shows the NEW INTENTIONS REVIEWED progress count", () => {
    const text = src(LIST_ROUTE);
    assert.ok(text.includes("NEW INTENTIONS REVIEWED:"));
    assert.ok(text.includes("newIntentionSummary.reviewed"));
    assert.ok(text.includes("newIntentionSummary.total"));
  });

  it("the filter participates in the active-filter count and round-trips via the URL", () => {
    const text = src(LIST_ROUTE);
    assert.ok(text.includes('url.searchParams.get("newIntentionReview")'));
    assert.ok(text.includes("filters.newIntentionReview,"));
    assert.ok(text.includes("defaultValue={filters.newIntentionReview ?? \"\"}"));
  });
});

// ── Boundaries ───────────────────────────────────────────────────────────────

describe("NIR.4 — this is admin workflow only", () => {
  it("no CI V2 / Wardrobe Intelligence module is involved", () => {
    const text = src(LIST_SERVER);
    assert.ok(!text.includes("wardrobe-intelligence"), "must not reach into Wardrobe Intelligence");
    assert.ok(!text.includes("garment-intelligence-v1"), "must not reach into CI V2 derived intelligence");
  });

  it("nothing writes a rating — the sweep only reads", () => {
    const text = src(LIST_SERVER);
    const summaryBlock = text.slice(
      text.indexOf("export async function getNewIntentionReviewSummary"),
      text.indexOf("export interface ClosetReviewSummary"),
    );
    assert.ok(!summaryBlock.includes("update"), "the summary must never write");
    assert.ok(!summaryBlock.includes("create"), "the summary must never write");
  });

  it("the four IDs the sweep tracks are exactly the expansion set", () => {
    assert.deepEqual(
      [...NEW_INTENTION_IDS],
      ["feel-elevated", "stand-out", "feel-fun", "feel-powerful"],
    );
  });
});
