// app/lib/passport/v2-e.test.ts
// V2-E contract tests — lifestyle migration from String? to String[] @default([])

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { readLifestyle } from "../../lib/ai/signal-contract.js";

// ─────────────────────────────────────────────────────────────────────────────
// E.1  Approved lifestyle IDs (matches quiz-data.ts)
// ─────────────────────────────────────────────────────────────────────────────

describe("E.1 Approved lifestyle IDs", () => {
  const VALID = new Set(["office", "busy-mom", "creative", "casual-days", "events", "always-on-the-go", "travel", "hybrid"]);

  it("contains exactly 8 IDs", () => assert.equal(VALID.size, 8));
  it("contains office",           () => assert.ok(VALID.has("office")));
  it("contains busy-mom",         () => assert.ok(VALID.has("busy-mom")));
  it("contains creative",         () => assert.ok(VALID.has("creative")));
  it("contains casual-days",      () => assert.ok(VALID.has("casual-days")));
  it("contains events",           () => assert.ok(VALID.has("events")));
  it("contains always-on-the-go", () => assert.ok(VALID.has("always-on-the-go")));
  it("contains travel",           () => assert.ok(VALID.has("travel")));
  it("contains hybrid",           () => assert.ok(VALID.has("hybrid")));
  it("does NOT contain casual",   () => assert.ok(!VALID.has("casual")));
  it("does NOT contain student",  () => assert.ok(!VALID.has("student")));
});

// ─────────────────────────────────────────────────────────────────────────────
// E.2  readLifestyle — native String[] input (V2-E path)
// ─────────────────────────────────────────────────────────────────────────────

describe("E.2 readLifestyle — native String[] input", () => {
  it("returns [] for empty array",       () => assert.deepEqual(readLifestyle([]), []));
  it("returns [] for null",              () => assert.deepEqual(readLifestyle(null), []));
  it("returns [] for undefined",         () => assert.deepEqual(readLifestyle(undefined), []));
  it("passes through single-value array", () => assert.deepEqual(readLifestyle(["casual-days"]), ["casual-days"]));
  it("passes through multi-value array",  () => assert.deepEqual(readLifestyle(["office", "hybrid"]), ["office", "hybrid"]));
  it("filters empty strings from array",  () => assert.deepEqual(readLifestyle(["office", "", "hybrid"]), ["office", "hybrid"]));
  it("preserves order",                  () => assert.deepEqual(readLifestyle(["travel", "events", "creative"]), ["travel", "events", "creative"]));
  it("preserves >3 legacy values",       () => assert.deepEqual(readLifestyle(["office", "hybrid", "casual-days", "events"]), ["office", "hybrid", "casual-days", "events"]));
});

// ─────────────────────────────────────────────────────────────────────────────
// E.3  readLifestyle — legacy comma-string input (migration compat)
// ─────────────────────────────────────────────────────────────────────────────

describe("E.3 readLifestyle — legacy comma-string input", () => {
  it("returns [] for empty string",           () => assert.deepEqual(readLifestyle(""), []));
  it("parses single value",                   () => assert.deepEqual(readLifestyle("casual-days"), ["casual-days"]));
  it("parses comma-joined no-space",          () => assert.deepEqual(readLifestyle("office,hybrid"), ["office", "hybrid"]));
  it("parses comma-space-joined (old format)", () => assert.deepEqual(readLifestyle("office, casual-days"), ["office", "casual-days"]));
  it("trims whitespace from each segment",    () => assert.deepEqual(readLifestyle(" office , hybrid "), ["office", "hybrid"]));
  it("preserves >3 legacy comma values",      () => assert.deepEqual(readLifestyle("office,hybrid,casual-days,events"), ["office", "hybrid", "casual-days", "events"]));
});

// ─────────────────────────────────────────────────────────────────────────────
// E.4  Save API — max-3 enforcement
// ─────────────────────────────────────────────────────────────────────────────

describe("E.4 Save API — max-3 enforcement", () => {
  function isLifestyleCountValid(ids: string[]): boolean {
    return ids.length <= 3;
  }

  it("accepts 0 IDs",   () => assert.ok(isLifestyleCountValid([])));
  it("accepts 1 ID",    () => assert.ok(isLifestyleCountValid(["office"])));
  it("accepts 2 IDs",   () => assert.ok(isLifestyleCountValid(["office", "hybrid"])));
  it("accepts 3 IDs",   () => assert.ok(isLifestyleCountValid(["office", "hybrid", "travel"])));
  it("rejects 4 IDs",   () => assert.ok(!isLifestyleCountValid(["office", "hybrid", "travel", "events"])));
  it("rejects 5 IDs",   () => assert.ok(!isLifestyleCountValid(["office", "hybrid", "travel", "events", "creative"])));
});

// ─────────────────────────────────────────────────────────────────────────────
// E.5  Save API — valid-ID enforcement
// ─────────────────────────────────────────────────────────────────────────────

describe("E.5 Save API — valid-ID enforcement", () => {
  const VALID = new Set(["office", "busy-mom", "creative", "casual-days", "events", "always-on-the-go", "travel", "hybrid"]);
  const allValid = (ids: string[]) => ids.every(id => VALID.has(id));

  it("accepts all approved IDs",    () => assert.ok(allValid(["office", "hybrid", "casual-days"])));
  it("rejects unknown ID 'casual'", () => assert.ok(!allValid(["casual"])));
  it("rejects unknown ID 'student'",() => assert.ok(!allValid(["student"])));
  it("rejects mixed valid+invalid", () => assert.ok(!allValid(["office", "student"])));
  it("accepts empty array",         () => assert.ok(allValid([])));
});

// ─────────────────────────────────────────────────────────────────────────────
// E.6  Data migration — staging DB values map cleanly
// ─────────────────────────────────────────────────────────────────────────────

describe("E.6 Migration — staging values coerce correctly", () => {
  function migrateRow(old: string | null): string[] {
    if (!old || old.trim() === "") return [];
    return old.split(",").map((s) => s.trim()).filter(Boolean);
  }

  it("null → []",                     () => assert.deepEqual(migrateRow(null), []));
  it("'' → []",                       () => assert.deepEqual(migrateRow(""), []));
  it("'casual-days' → ['casual-days']",() => assert.deepEqual(migrateRow("casual-days"), ["casual-days"]));
  it("'creative' → ['creative']",      () => assert.deepEqual(migrateRow("creative"), ["creative"]));
  it("'events' → ['events']",          () => assert.deepEqual(migrateRow("events"), ["events"]));
  it("'hybrid' → ['hybrid']",          () => assert.deepEqual(migrateRow("hybrid"), ["hybrid"]));
  it("'travel' → ['travel']",          () => assert.deepEqual(migrateRow("travel"), ["travel"]));
  it("'office, casual-days' → ['office','casual-days']", () =>
    assert.deepEqual(migrateRow("office, casual-days"), ["office", "casual-days"]));
});

// ─────────────────────────────────────────────────────────────────────────────
// E.7  Legacy >3 values preserved on read; only enforced on explicit edit
// ─────────────────────────────────────────────────────────────────────────────

describe("E.7 Legacy >3 values: preserved on read, blocked on explicit edit", () => {
  function isLifestyleCountValid(ids: string[]): boolean { return ids.length <= 3; }

  const legacyFour = ["office", "hybrid", "casual-days", "events"];

  it("readLifestyle preserves all 4 values", () =>
    assert.deepEqual(readLifestyle(legacyFour), legacyFour));

  it("save validation rejects if submitted with 4 IDs", () =>
    assert.ok(!isLifestyleCountValid(legacyFour)));

  it("save validation accepts if submitted with ≤3 IDs (valid edit)", () =>
    assert.ok(isLifestyleCountValid(["office", "hybrid", "casual-days"])));
});
