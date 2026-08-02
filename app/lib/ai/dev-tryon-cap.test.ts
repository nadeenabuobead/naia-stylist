// app/lib/ai/dev-tryon-cap.test.ts
// Unit tests for the persistent development call cap.
// Uses a temp file per test so no test shares state.
// Run: node --test --import tsx/esm app/lib/ai/dev-tryon-cap.test.ts

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";

import {
  DEV_MAX_NEW_CALLS,
  readCapState,
  getDevCapState,
  claimDevCallSlot,
  updateDevCallEntry,
  getExistingPredictionId,
} from "./dev-tryon-cap.server.ts";

function tmpCapFile(): string {
  return path.join(os.tmpdir(), `dev-tryon-cap-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
}

// ── §1 Initial state ──────────────────────────────────────────────────────────

describe("§1 Initial state", () => {
  it("CAP.1 — readCapState returns zero-calls state when file is absent", () => {
    const state = readCapState("/nonexistent/path/cap.json");
    assert.equal(state.newCalls, 0);
    assert.deepEqual(state.entries, []);
  });

  it("CAP.2 — getDevCapState returns zero/5/5 on fresh file", () => {
    const f = tmpCapFile();
    const s = getDevCapState(f);
    assert.equal(s.newCalls, 0);
    assert.equal(s.maxCalls, DEV_MAX_NEW_CALLS);
    assert.equal(s.remaining, DEV_MAX_NEW_CALLS);
    fs.rmSync(f, { force: true });
  });
});

// ── §2 Slot claiming ──────────────────────────────────────────────────────────

describe("§2 Slot claiming", () => {
  it("CAP.3 — claimDevCallSlot increments newCalls and returns allowed=true", () => {
    const f = tmpCapFile();
    const result = claimDevCallSlot("collar-shirt", f);
    assert.equal(result.allowed, true);
    assert.equal(readCapState(f).newCalls, 1);
    fs.rmSync(f, { force: true });
  });

  it("CAP.4 — consecutive claims accumulate correctly", () => {
    const f = tmpCapFile();
    for (let i = 1; i <= 3; i++) {
      const r = claimDevCallSlot(`handle-${i}`, f);
      assert.equal(r.allowed, true);
    }
    assert.equal(readCapState(f).newCalls, 3);
    fs.rmSync(f, { force: true });
  });

  it("CAP.5 — fifth claim succeeds, sixth returns allowed=false", () => {
    const f = tmpCapFile();
    for (let i = 0; i < DEV_MAX_NEW_CALLS; i++) {
      const r = claimDevCallSlot(`h-${i}`, f);
      assert.equal(r.allowed, true, `claim ${i + 1} of ${DEV_MAX_NEW_CALLS} should be allowed`);
    }
    const over = claimDevCallSlot("extra", f);
    assert.equal(over.allowed, false);
    assert.equal(readCapState(f).newCalls, DEV_MAX_NEW_CALLS);
    fs.rmSync(f, { force: true });
  });

  it("CAP.6 — state persists to disk (simulates server restart)", () => {
    const f = tmpCapFile();
    claimDevCallSlot("collar-shirt", f);
    claimDevCallSlot("midi-dress", f);
    // re-read from disk — simulates fresh process
    const s = readCapState(f);
    assert.equal(s.newCalls, 2);
    assert.equal(s.entries.length, 2);
    assert.equal(s.entries[0].handle, "collar-shirt");
    assert.equal(s.entries[1].handle, "midi-dress");
    fs.rmSync(f, { force: true });
  });
});

// ── §3 Entry updates ──────────────────────────────────────────────────────────

describe("§3 Entry updates", () => {
  it("CAP.7 — updateDevCallEntry saves predictionId on the open entry", () => {
    const f = tmpCapFile();
    claimDevCallSlot("collar-shirt", f);
    updateDevCallEntry("collar-shirt", { predictionId: "pred-abc" }, f);
    const e = readCapState(f).entries[0];
    assert.equal(e.predictionId, "pred-abc");
    assert.equal(e.outcome, undefined);
    fs.rmSync(f, { force: true });
  });

  it("CAP.8 — updateDevCallEntry saves outcome on the open entry", () => {
    const f = tmpCapFile();
    claimDevCallSlot("collar-shirt", f);
    updateDevCallEntry("collar-shirt", { predictionId: "pred-xyz", outcome: "completed" }, f);
    const e = readCapState(f).entries[0];
    assert.equal(e.outcome, "completed");
    fs.rmSync(f, { force: true });
  });

  it("CAP.9 — updateDevCallEntry only updates the most recent open entry for a handle", () => {
    const f = tmpCapFile();
    // Two claims for same handle (hypothetical; normally idempotency would prevent this)
    claimDevCallSlot("collar-shirt", f);
    updateDevCallEntry("collar-shirt", { outcome: "timeout" }, f); // close first
    claimDevCallSlot("collar-shirt", f);                           // second claim
    updateDevCallEntry("collar-shirt", { predictionId: "pred-second" }, f);
    const entries = readCapState(f).entries;
    assert.equal(entries[0].outcome, "timeout");
    assert.equal(entries[1].predictionId, "pred-second");
    assert.equal(entries[1].outcome, undefined);
    fs.rmSync(f, { force: true });
  });
});

// ── §4 Resume-polling helpers ─────────────────────────────────────────────────

describe("§4 Resume-polling helpers", () => {
  it("CAP.10 — getExistingPredictionId returns null when no entries", () => {
    const f = tmpCapFile();
    assert.equal(getExistingPredictionId("collar-shirt", f), null);
    fs.rmSync(f, { force: true });
  });

  it("CAP.11 — getExistingPredictionId returns null when entry has no predictionId yet", () => {
    const f = tmpCapFile();
    claimDevCallSlot("collar-shirt", f);
    // predictionId not set yet — POST hasn't returned
    assert.equal(getExistingPredictionId("collar-shirt", f), null);
    fs.rmSync(f, { force: true });
  });

  it("CAP.12 — getExistingPredictionId returns predictionId when set and no outcome", () => {
    const f = tmpCapFile();
    claimDevCallSlot("collar-shirt", f);
    updateDevCallEntry("collar-shirt", { predictionId: "pred-resume" }, f);
    assert.equal(getExistingPredictionId("collar-shirt", f), "pred-resume");
    fs.rmSync(f, { force: true });
  });

  it("CAP.13 — getExistingPredictionId returns null once outcome is set (terminal)", () => {
    const f = tmpCapFile();
    claimDevCallSlot("collar-shirt", f);
    updateDevCallEntry("collar-shirt", { predictionId: "pred-done", outcome: "completed" }, f);
    assert.equal(getExistingPredictionId("collar-shirt", f), null);
    fs.rmSync(f, { force: true });
  });

  it("CAP.14 — getExistingPredictionId ignores entries for different handles", () => {
    const f = tmpCapFile();
    claimDevCallSlot("midi-dress", f);
    updateDevCallEntry("midi-dress", { predictionId: "pred-other" }, f);
    assert.equal(getExistingPredictionId("collar-shirt", f), null);
    fs.rmSync(f, { force: true });
  });
});

// ── §5 Idempotent slot claiming ───────────────────────────────────────────────

describe("§5 Idempotent slot claiming", () => {
  it("CAP.15 — claimDevCallSlot does not double-count an open entry for the same handle", () => {
    const f = tmpCapFile();
    // First claim (e.g. preflight) — creates the entry and increments counter
    const first = claimDevCallSlot("collar-shirt", f);
    assert.equal(first.allowed, true);
    assert.equal(readCapState(f).newCalls, 1);
    // Second claim for the same handle while entry is still open (no outcome) — must reuse
    const second = claimDevCallSlot("collar-shirt", f);
    assert.equal(second.allowed, true);
    assert.equal(readCapState(f).newCalls, 1, "must not double-count an open entry");
    // After the entry is closed, a new claim increments normally
    updateDevCallEntry("collar-shirt", { outcome: "completed" }, f);
    const third = claimDevCallSlot("collar-shirt", f);
    assert.equal(third.allowed, true);
    assert.equal(readCapState(f).newCalls, 2, "closed entry should allow a fresh claim");
    fs.rmSync(f, { force: true });
  });
});
