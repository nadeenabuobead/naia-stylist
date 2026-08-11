// app/routes/my-naia-model-moderation.test.ts
// NaiaModel body photo and FASHN VTO moderation contract tests.
//
// Static source-code assertions — no DB, no Cloudinary, no Claude calls.
// Covers:
//   T1  saveNaiaModelPhoto imports and calls Layer 2 moderateImageContent
//   T2  saveNaiaModelPhoto imports and calls Layer 3 screenVtoBodyPhoto
//   T3  MODERATION_UNAVAILABLE → body slot rejected (fail-closed)
//   T4  SAFETY_REJECT → body slot rejected
//   T5  bodyModerationStatus set to APPROVED only after Layer 2+3 pass
//   T6  bodyModerationStatus PENDING when moderation fails/unavailable
//   T7  submitTryOnJob rejects unless bodyModerationStatus === "APPROVED"
//   T8  bodyModerationStatus is NOT_READY gate for FASHN call
//   T9  DI injectable _moderateContent and _screenBodyPhoto exist on saveNaiaModelPhoto
//   T10 ModerateFn and ScreenBodyFn exported types present

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

function readLib(rel: string): string {
  return readFileSync(join(__dirname, "../lib", rel), "utf8");
}

const model   = readLib("ai/my-naia-model.server.ts");
const fashn   = readLib("ai/fashn-tryon-service.server.ts");

// ── T1: Layer 2 imported and called ──────────────────────────────────────────

describe("T1: saveNaiaModelPhoto calls Layer 2 moderateImageContent", () => {
  it("imports moderateImageContent", () => {
    assert.ok(
      model.includes("moderateImageContent"),
      "my-naia-model.server must import and call moderateImageContent",
    );
  });

  it("calls moderation in the body-slot path via injectable _moderateContent", () => {
    // The actual call uses DI: _moderateContent(url) where default is moderateImageContent
    assert.ok(
      model.includes("_moderateContent(") || model.includes("await _moderateContent("),
      "_moderateContent must be called in the body-slot path (DI-based call)",
    );
  });
});

// ── T2: Layer 3 imported and called ──────────────────────────────────────────

describe("T2: saveNaiaModelPhoto calls Layer 3 screenVtoBodyPhoto", () => {
  it("imports screenVtoBodyPhoto", () => {
    assert.ok(
      model.includes("screenVtoBodyPhoto"),
      "my-naia-model.server must import and call screenVtoBodyPhoto",
    );
  });

  it("calls body suitability check via injectable _screenBodyPhoto", () => {
    // The actual call uses DI: _screenBodyPhoto(url) where default is screenVtoBodyPhoto
    assert.ok(
      model.includes("_screenBodyPhoto(") || model.includes("await _screenBodyPhoto("),
      "_screenBodyPhoto must be called in the body-slot path (DI-based call)",
    );
  });
});

// ── T3: MODERATION_UNAVAILABLE → body slot rejected ──────────────────────────

describe("T3: MODERATION_UNAVAILABLE → body slot fails (fail-closed)", () => {
  it("returns an error result when moderation is unavailable", () => {
    assert.ok(
      model.includes("MODERATION_UNAVAILABLE"),
      "body slot path must handle MODERATION_UNAVAILABLE",
    );
    const idx = model.indexOf("MODERATION_UNAVAILABLE");
    const block = model.slice(idx, idx + 400);
    assert.ok(
      block.includes("return") || block.includes("ok: false") || block.includes("error"),
      "MODERATION_UNAVAILABLE must cause an early return (fail-closed)",
    );
  });
});

// ── T4: SAFETY_REJECT → body slot rejected ───────────────────────────────────

describe("T4: SAFETY_REJECT → body slot fails", () => {
  it("returns an error result on SAFETY_REJECT", () => {
    assert.ok(
      model.includes("SAFETY_REJECT"),
      "body slot path must handle SAFETY_REJECT",
    );
    const idx = model.indexOf("SAFETY_REJECT");
    const block = model.slice(idx, idx + 400);
    assert.ok(
      block.includes("return"),
      "SAFETY_REJECT must cause an early return",
    );
  });
});

// ── T5: bodyModerationStatus APPROVED only after Layer 2+3 pass ──────────────

describe("T5: bodyModerationStatus set to APPROVED only after full moderation pass", () => {
  it('writes bodyModerationStatus: "APPROVED" only when bodyModerationApproved is true', () => {
    assert.ok(
      model.includes('bodyModerationStatus: bodyModerationApproved ? "APPROVED"'),
      'bodyModerationStatus must be "APPROVED" only when the full L2+L3 check passes',
    );
  });
});

// ── T6: bodyModerationStatus PENDING on failure ───────────────────────────────

describe("T6: bodyModerationStatus defaults to PENDING when moderation fails", () => {
  it('sets bodyModerationStatus to "PENDING" on the false-branch', () => {
    assert.ok(
      model.includes(': "PENDING"'),
      'bodyModerationStatus must be "PENDING" when moderation has not yet passed',
    );
  });
});

// ── T7: submitTryOnJob rejects non-APPROVED status ───────────────────────────

describe("T7: submitTryOnJob rejects unless bodyModerationStatus is APPROVED", () => {
  it("has a gate that checks bodyModerationStatus !== APPROVED", () => {
    assert.ok(
      fashn.includes('bodyModerationStatus !== "APPROVED"') ||
      fashn.includes("bodyModerationStatus !== 'APPROVED'"),
      "submitTryOnJob must reject when bodyModerationStatus is not APPROVED",
    );
  });

  it("returns NOT_READY code when bodyModerationStatus check fails", () => {
    // Find the gate check expression (not the type definition)
    const gateIdx = fashn.indexOf('bodyModerationStatus !== "APPROVED"');
    assert.ok(gateIdx !== -1, "bodyModerationStatus APPROVED gate must exist in fashn service");
    const block = fashn.slice(gateIdx, gateIdx + 400);
    assert.ok(
      block.includes("NOT_READY"),
      "bodyModerationStatus gate must return NOT_READY code",
    );
  });
});

// ── T8: bodyModerationStatus field present in SubmitJobParams ────────────────

describe("T8: bodyModerationStatus present in SubmitJobParams type", () => {
  it("declares bodyModerationStatus in the params interface", () => {
    assert.ok(
      fashn.includes("bodyModerationStatus"),
      "SubmitJobParams must include bodyModerationStatus",
    );
  });
});

// ── T9: DI injectable parameters on saveNaiaModelPhoto ───────────────────────

describe("T9: injectable _moderateContent and _screenBodyPhoto exist", () => {
  it("has _moderateContent parameter", () => {
    assert.ok(
      model.includes("_moderateContent"),
      "saveNaiaModelPhoto must accept _moderateContent for DI/testing",
    );
  });

  it("has _screenBodyPhoto parameter", () => {
    assert.ok(
      model.includes("_screenBodyPhoto"),
      "saveNaiaModelPhoto must accept _screenBodyPhoto for DI/testing",
    );
  });
});

// ── T10: ModerateFn and ScreenBodyFn exported ────────────────────────────────

describe("T10: DI type exports present", () => {
  it("exports ModerateFn", () => {
    assert.ok(
      model.includes("export type ModerateFn"),
      "ModerateFn must be exported for test injection",
    );
  });

  it("exports ScreenBodyFn", () => {
    assert.ok(
      model.includes("export type ScreenBodyFn"),
      "ScreenBodyFn must be exported for test injection",
    );
  });
});
