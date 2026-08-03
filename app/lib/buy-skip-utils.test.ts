import { describe, expect, it } from "vitest";
import { verdictHeading, isSkipVerdict } from "./buy-skip-utils";

describe("verdictHeading", () => {
  // ── Canonical cases ───────────────────────────────────────────────────────
  it("BUY → Why It Works", () => {
    expect(verdictHeading("BUY")).toBe("Why It Works");
  });

  it("SKIP FOR NOW → Why It May Not Work Yet", () => {
    expect(verdictHeading("SKIP FOR NOW")).toBe("Why It May Not Work Yet");
  });

  it("SKIP → Why It Doesn't Work", () => {
    expect(verdictHeading("SKIP")).toBe("Why It Doesn't Work");
  });

  // ── Case normalisation ────────────────────────────────────────────────────
  it("buy (lowercase) → Why It Works", () => {
    expect(verdictHeading("buy")).toBe("Why It Works");
  });

  it("skip for now (lowercase) → Why It May Not Work Yet", () => {
    expect(verdictHeading("skip for now")).toBe("Why It May Not Work Yet");
  });

  it("Skip For Now (title case) → Why It May Not Work Yet", () => {
    expect(verdictHeading("Skip For Now")).toBe("Why It May Not Work Yet");
  });

  // ── Whitespace normalisation ──────────────────────────────────────────────
  it("normalises extra internal spaces", () => {
    expect(verdictHeading("SKIP  FOR  NOW")).toBe("Why It May Not Work Yet");
  });

  it("normalises leading/trailing whitespace", () => {
    expect(verdictHeading("  SKIP FOR NOW  ")).toBe("Why It May Not Work Yet");
  });

  // ── MAYBE alias ───────────────────────────────────────────────────────────
  it("MAYBE → Why It May Not Work Yet", () => {
    expect(verdictHeading("MAYBE")).toBe("Why It May Not Work Yet");
  });

  // ── Null / empty / unknown fallbacks ─────────────────────────────────────
  it("null → Why It Doesn't Work", () => {
    expect(verdictHeading(null)).toBe("Why It Doesn't Work");
  });

  it("undefined → Why It Doesn't Work", () => {
    expect(verdictHeading(undefined)).toBe("Why It Doesn't Work");
  });

  it("empty string → Why It Doesn't Work", () => {
    expect(verdictHeading("")).toBe("Why It Doesn't Work");
  });

  it("unknown value → Why It Doesn't Work", () => {
    expect(verdictHeading("INCOMPLETE")).toBe("Why It Doesn't Work");
  });

  // ── DB-normalised SKIP (stored when AI returned SKIP FOR NOW) ────────────
  it("DB-stored SKIP (normalised from SKIP FOR NOW) → Why It Doesn't Work", () => {
    // The DB verdict enum stores SKIP for both SKIP and SKIP FOR NOW.
    // verdictHeading should always be called with fullAnalysis.verdict (the raw AI value),
    // not the DB field. This test documents the difference.
    expect(verdictHeading("SKIP")).toBe("Why It Doesn't Work");
  });
});

describe("isSkipVerdict", () => {
  it("SKIP → true", () => expect(isSkipVerdict("SKIP")).toBe(true));
  it("SKIP FOR NOW → true", () => expect(isSkipVerdict("SKIP FOR NOW")).toBe(true));
  it("BUY → false", () => expect(isSkipVerdict("BUY")).toBe(false));
  it("MAYBE → false", () => expect(isSkipVerdict("MAYBE")).toBe(false));
  it("null → false", () => expect(isSkipVerdict(null)).toBe(false));
});
