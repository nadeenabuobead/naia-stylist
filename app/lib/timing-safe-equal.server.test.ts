// app/lib/timing-safe-equal.server.test.ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { timingSafeStringEqual } from "./timing-safe-equal.server";

describe("timingSafeStringEqual", () => {
  it("TSE-1 — equal strings match", () => {
    assert.equal(timingSafeStringEqual("abc123", "abc123"), true);
  });

  it("TSE-2 — different strings of the same length do not match", () => {
    assert.equal(timingSafeStringEqual("abc123", "abc124"), false);
  });

  it("TSE-3 — different lengths do not match and never throw", () => {
    assert.equal(timingSafeStringEqual("short", "a-much-longer-value"), false);
  });

  it("TSE-4 — non-string inputs (null/undefined/number) are rejected, never throw", () => {
    assert.equal(timingSafeStringEqual(null, "abc"), false);
    assert.equal(timingSafeStringEqual(undefined, "abc"), false);
    assert.equal(timingSafeStringEqual(123 as unknown as string, "123"), false);
    assert.equal(timingSafeStringEqual("abc", null), false);
  });

  it("TSE-5 — empty strings compare equal to each other, not to a non-empty string", () => {
    assert.equal(timingSafeStringEqual("", ""), true);
    assert.equal(timingSafeStringEqual("", "x"), false);
  });
});
