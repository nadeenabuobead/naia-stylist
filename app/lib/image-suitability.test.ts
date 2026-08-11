// app/lib/image-suitability.test.ts
// Layer 3 — feature-specific image suitability logic tests.
//
// Tests use the injectable _analyze parameter — no live Claude calls.
// Covers:
//   T1  garment PASS → PASS
//   T2  garment RETRY_IMAGE with valid subCode → RETRY_IMAGE
//   T3  garment NEEDS_CLARIFICATION with valid subCode → NEEDS_CLARIFICATION
//   T4  garment: unknown subCode falls back to assessment_failed
//   T5  garment: API throws → RETRY_IMAGE/assessment_failed (fail-closed)
//   T6  garment: malformed JSON → RETRY_IMAGE/assessment_failed
//   T7  garment: markdown code fence stripped before parse
//   T8  VTO body PASS → PASS
//   T9  VTO body RETRY_IMAGE with valid subCode → RETRY_IMAGE
//   T10 VTO body: API throws → RETRY_IMAGE/assessment_failed (fail-closed)
//   T11 VTO body: unknown subCode falls back to assessment_failed

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  screenGarmentSuitability,
  screenVtoBodyPhoto,
} from "./image-suitability.server.js";
import type { AnalyzeForSuitabilityFn } from "./image-suitability.server.js";

const FAKE_URL = "https://res.cloudinary.com/example/private/v1/test.jpg";

function makeAnalyzer(response: string): AnalyzeForSuitabilityFn {
  return async () => response;
}

function garmentJson(status: string, subCode: string | null = null): string {
  return JSON.stringify({ status, subCode });
}

function vtoJson(status: string, subCode: string | null = null): string {
  return JSON.stringify({ status, subCode });
}

// ── T1: Garment PASS ──────────────────────────────────────────────────────────

describe("T1: garment PASS → PASS", () => {
  it("returns PASS for a clear PASS response", async () => {
    const result = await screenGarmentSuitability(FAKE_URL, {}, makeAnalyzer(garmentJson("PASS")));
    assert.equal(result.status, "PASS");
  });
});

// ── T2: Garment RETRY_IMAGE ───────────────────────────────────────────────────

describe("T2: garment RETRY_IMAGE + valid subCode", () => {
  const cases = [
    "no_garment_visible",
    "image_too_blurry",
    "garment_excessively_cropped",
    "multiple_items_ambiguous",
    "color_indeterminate",
    "category_mismatch",
    "item_not_identifiable",
  ] as const;

  for (const subCode of cases) {
    it(`returns RETRY_IMAGE/${subCode}`, async () => {
      const result = await screenGarmentSuitability(FAKE_URL, {}, makeAnalyzer(garmentJson("RETRY_IMAGE", subCode)));
      assert.equal(result.status, "RETRY_IMAGE");
      assert.equal((result as { status: "RETRY_IMAGE"; subCode: string }).subCode, subCode);
    });
  }
});

// ── T3: Garment NEEDS_CLARIFICATION ──────────────────────────────────────────

describe("T3: garment NEEDS_CLARIFICATION + valid subCode", () => {
  it("returns NEEDS_CLARIFICATION/category_mismatch", async () => {
    const result = await screenGarmentSuitability(FAKE_URL, { declaredCategory: "Top" }, makeAnalyzer(garmentJson("NEEDS_CLARIFICATION", "category_mismatch")));
    assert.equal(result.status, "NEEDS_CLARIFICATION");
    assert.equal((result as { status: "NEEDS_CLARIFICATION"; subCode: string }).subCode, "category_mismatch");
  });
});

// ── T4: Garment unknown subCode → assessment_failed fallback ─────────────────

describe("T4: garment unknown subCode falls back to assessment_failed", () => {
  it("replaces unknown subCode with assessment_failed", async () => {
    const result = await screenGarmentSuitability(FAKE_URL, {}, makeAnalyzer(garmentJson("RETRY_IMAGE", "totally_unknown")));
    assert.equal(result.status, "RETRY_IMAGE");
    assert.equal((result as { status: "RETRY_IMAGE"; subCode: string }).subCode, "assessment_failed");
  });

  it("replaces null subCode with assessment_failed on RETRY_IMAGE", async () => {
    const result = await screenGarmentSuitability(FAKE_URL, {}, makeAnalyzer(garmentJson("RETRY_IMAGE", null)));
    assert.equal(result.status, "RETRY_IMAGE");
    assert.equal((result as { status: "RETRY_IMAGE"; subCode: string }).subCode, "assessment_failed");
  });
});

// ── T5: Garment API throws → RETRY_IMAGE/assessment_failed (fail-closed) ─────

describe("T5: garment API throws → RETRY_IMAGE/assessment_failed", () => {
  it("returns assessment_failed when _analyze throws", async () => {
    const throwing: AnalyzeForSuitabilityFn = async () => { throw new Error("api error"); };
    const result = await screenGarmentSuitability(FAKE_URL, {}, throwing);
    assert.equal(result.status, "RETRY_IMAGE");
    assert.equal((result as { status: "RETRY_IMAGE"; subCode: string }).subCode, "assessment_failed");
  });
});

// ── T6: Garment malformed JSON → RETRY_IMAGE/assessment_failed ───────────────

describe("T6: garment malformed JSON → RETRY_IMAGE/assessment_failed", () => {
  it("returns assessment_failed for invalid JSON", async () => {
    const result = await screenGarmentSuitability(FAKE_URL, {}, makeAnalyzer("not json"));
    assert.equal(result.status, "RETRY_IMAGE");
    assert.equal((result as { status: "RETRY_IMAGE"; subCode: string }).subCode, "assessment_failed");
  });

  it("returns assessment_failed for a JSON array", async () => {
    const result = await screenGarmentSuitability(FAKE_URL, {}, makeAnalyzer("[1, 2, 3]"));
    assert.equal(result.status, "RETRY_IMAGE");
    assert.equal((result as { status: "RETRY_IMAGE"; subCode: string }).subCode, "assessment_failed");
  });
});

// ── T7: Garment markdown fence stripped ───────────────────────────────────────

describe("T7: garment markdown code fence stripped before parse", () => {
  it("parses PASS response wrapped in ```json fences", async () => {
    const fenced = "```json\n" + garmentJson("PASS") + "\n```";
    const result = await screenGarmentSuitability(FAKE_URL, {}, makeAnalyzer(fenced));
    assert.equal(result.status, "PASS");
  });
});

// ── T8: VTO body PASS ─────────────────────────────────────────────────────────

describe("T8: VTO body PASS → PASS", () => {
  it("returns PASS for a valid PASS response", async () => {
    const result = await screenVtoBodyPhoto(FAKE_URL, makeAnalyzer(vtoJson("PASS")));
    assert.equal(result.status, "PASS");
  });
});

// ── T9: VTO body RETRY_IMAGE with valid subCodes ──────────────────────────────

describe("T9: VTO body RETRY_IMAGE + valid subCode", () => {
  const cases = [
    "no_person",
    "multiple_people",
    "body_area_not_visible",
    "image_too_blurry",
    "unusable_pose",
  ] as const;

  for (const subCode of cases) {
    it(`returns RETRY_IMAGE/${subCode}`, async () => {
      const result = await screenVtoBodyPhoto(FAKE_URL, makeAnalyzer(vtoJson("RETRY_IMAGE", subCode)));
      assert.equal(result.status, "RETRY_IMAGE");
      assert.equal((result as { status: "RETRY_IMAGE"; subCode: string }).subCode, subCode);
    });
  }
});

// ── T10: VTO body API throws → RETRY_IMAGE/assessment_failed ─────────────────

describe("T10: VTO body API throws → RETRY_IMAGE/assessment_failed", () => {
  it("returns assessment_failed when _analyze throws", async () => {
    const throwing: AnalyzeForSuitabilityFn = async () => { throw new Error("timeout"); };
    const result = await screenVtoBodyPhoto(FAKE_URL, throwing);
    assert.equal(result.status, "RETRY_IMAGE");
    assert.equal((result as { status: "RETRY_IMAGE"; subCode: string }).subCode, "assessment_failed");
  });
});

// ── T11: VTO body unknown subCode → assessment_failed ────────────────────────

describe("T11: VTO body unknown subCode falls back to assessment_failed", () => {
  it("replaces unknown subCode with assessment_failed", async () => {
    const result = await screenVtoBodyPhoto(FAKE_URL, makeAnalyzer(vtoJson("RETRY_IMAGE", "invented_code")));
    assert.equal(result.status, "RETRY_IMAGE");
    assert.equal((result as { status: "RETRY_IMAGE"; subCode: string }).subCode, "assessment_failed");
  });
});
