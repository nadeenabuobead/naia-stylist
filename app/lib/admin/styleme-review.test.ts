import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  STYLEME_QA_STATUSES,
  isValidQaStatus,
  validateQaStatus,
} from "./styleme-review.server";
import type { StyleMeQaStatus } from "./styleme-review.server";

// ── SM-01: valid status values ────────────────────────────────────────────────

describe("SM-01 isValidQaStatus valid values", () => {
  for (const status of STYLEME_QA_STATUSES) {
    it(`"${status}" is valid`, () => {
      assert.ok(isValidQaStatus(status), `expected ${status} to be valid`);
    });
  }
});

// ── SM-02: invalid status values ─────────────────────────────────────────────

describe("SM-02 isValidQaStatus invalid values", () => {
  it("rejects empty string", () => {
    assert.equal(isValidQaStatus(""), false);
  });

  it("rejects unknown string", () => {
    assert.equal(isValidQaStatus("needs-review"), false);
  });

  it("rejects 'approved' (not a valid status)", () => {
    assert.equal(isValidQaStatus("approved"), false);
  });

  it("rejects null", () => {
    assert.equal(isValidQaStatus(null), false);
  });

  it("rejects undefined", () => {
    assert.equal(isValidQaStatus(undefined), false);
  });

  it("rejects number", () => {
    assert.equal(isValidQaStatus(1), false);
  });

  it("rejects object", () => {
    assert.equal(isValidQaStatus({}), false);
  });

  it("rejects uppercase variant", () => {
    assert.equal(isValidQaStatus("PASS"), false);
  });

  it("rejects mixed case", () => {
    assert.equal(isValidQaStatus("Pass"), false);
  });
});

// ── SM-03: validateQaStatus happy path ───────────────────────────────────────

describe("SM-03 validateQaStatus happy path", () => {
  it("returns 'unreviewed' unchanged", () => {
    assert.equal(validateQaStatus("unreviewed"), "unreviewed");
  });

  it("returns 'pass' unchanged", () => {
    assert.equal(validateQaStatus("pass"), "pass");
  });

  it("returns 'questionable' unchanged", () => {
    assert.equal(validateQaStatus("questionable"), "questionable");
  });

  it("returns 'fail' unchanged", () => {
    assert.equal(validateQaStatus("fail"), "fail");
  });

  it("return type is StyleMeQaStatus", () => {
    const status: StyleMeQaStatus = validateQaStatus("pass");
    assert.equal(status, "pass");
  });
});

// ── SM-04: validateQaStatus error path ───────────────────────────────────────

describe("SM-04 validateQaStatus error path", () => {
  it("throws on invalid string", () => {
    assert.throws(() => validateQaStatus("needs-review"), /invalid qa status/i);
  });

  it("throws on null", () => {
    assert.throws(() => validateQaStatus(null), /invalid qa status/i);
  });

  it("throws on undefined", () => {
    assert.throws(() => validateQaStatus(undefined), /invalid qa status/i);
  });

  it("throws on number", () => {
    assert.throws(() => validateQaStatus(42), /invalid qa status/i);
  });

  it("error message includes the valid statuses", () => {
    try {
      validateQaStatus("bad");
      assert.fail("should have thrown");
    } catch (e) {
      const msg = (e as Error).message;
      for (const status of STYLEME_QA_STATUSES) {
        assert.ok(msg.includes(status), `error message should mention '${status}'`);
      }
    }
  });
});

// ── SM-05: STYLEME_QA_STATUSES contract ──────────────────────────────────────

describe("SM-05 STYLEME_QA_STATUSES contract", () => {
  it("contains exactly 4 statuses", () => {
    assert.equal(STYLEME_QA_STATUSES.length, 4);
  });

  it("first status is unreviewed (new records default)", () => {
    assert.equal(STYLEME_QA_STATUSES[0], "unreviewed");
  });

  it("contains pass, questionable, fail", () => {
    assert.ok(STYLEME_QA_STATUSES.includes("pass"));
    assert.ok(STYLEME_QA_STATUSES.includes("questionable"));
    assert.ok(STYLEME_QA_STATUSES.includes("fail"));
  });
});
