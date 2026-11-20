// app/routes/style-me/result.full-look-not-eligible.test.ts
//
// 2026-11-21 — customer-facing handling of the Full-Look eligibility refusal.
// result.tsx is a large route with no render harness here, so (like its
// sibling result.full-look-vto-disclosure.test.ts) this asserts on the
// component source: a dedicated, non-retry message for the deterministic
// not_eligible code, no leaked internals, and the generic/busy branches intact.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "result.tsx"), "utf8");
const branch = (needle: string) => {
  const i = src.indexOf(needle);
  expect(i, `missing branch: ${needle}`).toBeGreaterThan(-1);
  // up to the next sibling conditional block
  const rest = src.slice(i);
  const next = rest.indexOf("{fullLookQA.status ===", 10);
  return next === -1 ? rest.slice(0, 1500) : rest.slice(0, next);
};

describe("Full-Look not_eligible customer message", () => {
  const nb = branch('fullLookQA.status === "error" && fullLookQA.message === "not_eligible"');

  it("has its own plain-language message instead of the generic 'couldn't create your try-on this time'", () => {
    expect(nb).toContain("One of the pieces in this look can't be tried on yet.");
    expect(nb).not.toContain("We couldn't create your try-on this time");
  });

  it("does NOT offer 'Try Again' (a retry can never succeed against a deterministic refusal), and points to My Closet instead", () => {
    expect(nb).not.toMatch(/Try Again/);
    expect(nb).not.toContain("triggerFullLook(");
    expect(nb).toContain('to="/closet"');
  });

  it("tells the customer they were not charged and the look is saved", () => {
    expect(nb).toContain("you haven't been charged for this attempt");
    expect(nb).toContain("still saved here");
  });

  it("exposes no internal detail: no reason code, no raw message, no category/enum names", () => {
    // Only the rendered JSX is checked — the branch's own condition legitimately names the "not_eligible" code.
    const rendered = nb.slice(nb.indexOf("<>"));
    for (const leak of ["category_not_allowed", "photo_flagged", "unsuitable_image", "category", "SWIMWEAR", "fullLookQA.reason", "not_eligible", "eligib"]) {
      expect(rendered).not.toContain(leak);
    }
  });

  it("the generic error branch now excludes not_eligible (no double render) and still offers Try Again for transient failures", () => {
    expect(src).toContain('fullLookQA.message !== "busy" && fullLookQA.message !== "not_eligible"');
    const gb = branch('fullLookQA.status === "error" && fullLookQA.message !== "busy"');
    expect(gb).toContain("Try Again");
  });

  it("the busy branch is untouched", () => {
    const bb = branch('fullLookQA.status === "error" && fullLookQA.message === "busy"');
    expect(bb).toContain("Check Again");
  });
});
