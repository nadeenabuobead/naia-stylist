// app/lib/image-moderation.test.ts
// Layer 2 — global content safety moderation logic tests.
//
// Tests use the injectable _analyze parameter — no live Claude calls.
// Covers the fail-closed contract:
//   T1  PASS response → PASS result
//   T2  safe=false + valid reasonCode → SAFETY_REJECT with correct code
//   T3  safe=false + invalid/missing reasonCode → SAFETY_REJECT with "unsafe_content" fallback
//   T4  API throws → MODERATION_UNAVAILABLE (fail-closed)
//   T5  timeout (null returned by race) → MODERATION_UNAVAILABLE
//   T6  parse error (malformed JSON) → MODERATION_UNAVAILABLE
//   T7  wrong shape (not an object) → MODERATION_UNAVAILABLE
//   T8  safe field not boolean → MODERATION_UNAVAILABLE
//   T9  markdown code fence stripped before parse
//   T10 all five SafetyReasonCodes accepted

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { moderateImageContent } from "./image-moderation.server.js";
import type { AnalyzeForModerationFn } from "./image-moderation.server.js";

const FAKE_URL = "https://res.cloudinary.com/example/private/v1/test.jpg";

function makeAnalyzer(response: string | null | (() => Promise<never>)): AnalyzeForModerationFn {
  return async () => {
    if (response === null) return null as never;
    if (typeof response === "function") return response();
    return response;
  };
}

function passJson(): string {
  return JSON.stringify({ safe: true, reasonCode: null });
}

function rejectJson(reasonCode: string | null = "explicit_sexual"): string {
  return JSON.stringify({ safe: false, reasonCode });
}

// ── T1: PASS ──────────────────────────────────────────────────────────────────

describe("T1: safe=true response → PASS", () => {
  it("returns PASS for a valid safe=true response", async () => {
    const result = await moderateImageContent(FAKE_URL, makeAnalyzer(passJson()));
    assert.equal(result.status, "PASS");
  });
});

// ── T2: SAFETY_REJECT with valid reasonCode ───────────────────────────────────

describe("T2: safe=false + valid reasonCode → SAFETY_REJECT", () => {
  it("returns SAFETY_REJECT with explicit_sexual", async () => {
    const result = await moderateImageContent(FAKE_URL, makeAnalyzer(rejectJson("explicit_sexual")));
    assert.equal(result.status, "SAFETY_REJECT");
    assert.equal((result as { status: "SAFETY_REJECT"; reasonCode: string }).reasonCode, "explicit_sexual");
  });

  it("returns SAFETY_REJECT with graphic_violence", async () => {
    const result = await moderateImageContent(FAKE_URL, makeAnalyzer(rejectJson("graphic_violence")));
    assert.equal(result.status, "SAFETY_REJECT");
    assert.equal((result as { status: "SAFETY_REJECT"; reasonCode: string }).reasonCode, "graphic_violence");
  });
});

// ── T3: SAFETY_REJECT with unknown reasonCode falls back to unsafe_content ────

describe("T3: safe=false + unknown reasonCode → SAFETY_REJECT with unsafe_content fallback", () => {
  it("falls back to unsafe_content for an unknown code", async () => {
    const result = await moderateImageContent(FAKE_URL, makeAnalyzer(rejectJson("totally_made_up_code")));
    assert.equal(result.status, "SAFETY_REJECT");
    assert.equal((result as { status: "SAFETY_REJECT"; reasonCode: string }).reasonCode, "unsafe_content");
  });

  it("falls back to unsafe_content when reasonCode is null and safe=false", async () => {
    const result = await moderateImageContent(FAKE_URL, makeAnalyzer(rejectJson(null)));
    assert.equal(result.status, "SAFETY_REJECT");
    assert.equal((result as { status: "SAFETY_REJECT"; reasonCode: string }).reasonCode, "unsafe_content");
  });
});

// ── T4: API throws → MODERATION_UNAVAILABLE (fail-closed) ───────────────────

describe("T4: API throws → MODERATION_UNAVAILABLE (never fails open)", () => {
  it("returns MODERATION_UNAVAILABLE when _analyze throws", async () => {
    const throwing: AnalyzeForModerationFn = async () => {
      throw new Error("network failure");
    };
    const result = await moderateImageContent(FAKE_URL, throwing);
    assert.equal(result.status, "MODERATION_UNAVAILABLE");
  });
});

// ── T5: null (timeout simulation) → MODERATION_UNAVAILABLE ───────────────────

describe("T5: null result (timeout) → MODERATION_UNAVAILABLE", () => {
  it("returns MODERATION_UNAVAILABLE when analyzer returns null", async () => {
    // Simulate timeout: _analyze resolves with null before the timeout timer fires
    const nullReturning: AnalyzeForModerationFn = async () => null as never;
    const result = await moderateImageContent(FAKE_URL, nullReturning);
    assert.equal(result.status, "MODERATION_UNAVAILABLE");
  });
});

// ── T6: parse error → MODERATION_UNAVAILABLE ─────────────────────────────────

describe("T6: malformed JSON → MODERATION_UNAVAILABLE", () => {
  it("returns MODERATION_UNAVAILABLE for completely invalid JSON", async () => {
    const result = await moderateImageContent(FAKE_URL, makeAnalyzer("not json at all"));
    assert.equal(result.status, "MODERATION_UNAVAILABLE");
  });

  it("returns MODERATION_UNAVAILABLE for truncated JSON", async () => {
    const result = await moderateImageContent(FAKE_URL, makeAnalyzer('{"safe": tru'));
    assert.equal(result.status, "MODERATION_UNAVAILABLE");
  });
});

// ── T7: wrong shape → MODERATION_UNAVAILABLE ─────────────────────────────────

describe("T7: unexpected JSON shape → MODERATION_UNAVAILABLE", () => {
  it("returns MODERATION_UNAVAILABLE for a JSON array", async () => {
    const result = await moderateImageContent(FAKE_URL, makeAnalyzer("[true, false]"));
    assert.equal(result.status, "MODERATION_UNAVAILABLE");
  });

  it("returns MODERATION_UNAVAILABLE for JSON null", async () => {
    const result = await moderateImageContent(FAKE_URL, makeAnalyzer("null"));
    assert.equal(result.status, "MODERATION_UNAVAILABLE");
  });

  it("returns MODERATION_UNAVAILABLE for empty string", async () => {
    const result = await moderateImageContent(FAKE_URL, makeAnalyzer(""));
    assert.equal(result.status, "MODERATION_UNAVAILABLE");
  });
});

// ── T8: safe not boolean → MODERATION_UNAVAILABLE ────────────────────────────

describe("T8: safe field not boolean → MODERATION_UNAVAILABLE", () => {
  it("returns MODERATION_UNAVAILABLE when safe is a string", async () => {
    const result = await moderateImageContent(FAKE_URL, makeAnalyzer(JSON.stringify({ safe: "true", reasonCode: null })));
    assert.equal(result.status, "MODERATION_UNAVAILABLE");
  });

  it("returns MODERATION_UNAVAILABLE when safe is missing", async () => {
    const result = await moderateImageContent(FAKE_URL, makeAnalyzer(JSON.stringify({ reasonCode: null })));
    assert.equal(result.status, "MODERATION_UNAVAILABLE");
  });
});

// ── T9: markdown code fence stripped ─────────────────────────────────────────

describe("T9: markdown code fence stripped before parse", () => {
  it("parses PASS response wrapped in ```json fences", async () => {
    const fenced = "```json\n" + passJson() + "\n```";
    const result = await moderateImageContent(FAKE_URL, makeAnalyzer(fenced));
    assert.equal(result.status, "PASS");
  });
});

// ── T10: all five SafetyReasonCodes accepted ──────────────────────────────────

describe("T10: all SafetyReasonCodes are accepted", () => {
  const codes = ["explicit_sexual", "graphic_violence", "self_harm", "child_safety", "unsafe_content"] as const;
  for (const code of codes) {
    it(`accepts reasonCode "${code}"`, async () => {
      const result = await moderateImageContent(FAKE_URL, makeAnalyzer(rejectJson(code)));
      assert.equal(result.status, "SAFETY_REJECT");
      assert.equal((result as { status: "SAFETY_REJECT"; reasonCode: string }).reasonCode, code);
    });
  }
});
