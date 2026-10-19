// app/routes/selfie-consent-version.test.ts
// Priority 5 (2026-10-19) — selfie consent versioning wired into passport.selfie.tsx.
//
// Source-string assertions. The behavioral correctness of
// beginSelfieAnalysis's new consentVersion parameter itself is already
// covered by app/lib/ai/selfie-analysis.test.ts (pa-2b and the updated
// pa-1..pa-6/ra-1..ra-2 call sites); this file proves passport.selfie.tsx
// passes the right version at each of its 4 call sites specifically.
//
// Run: node --import tsx/esm --test app/routes/selfie-consent-version.test.ts

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, "passport.selfie.tsx"), "utf8");

describe("passport.selfie.tsx — consent version at every beginSelfieAnalysis call site", () => {
  it("imports CURRENT_SELFIE_CONSENT_VERSION from selfie-persistence.server", () => {
    assert.ok(src.includes("CURRENT_SELFIE_CONSENT_VERSION"));
    assert.ok(src.includes("~/lib/ai/selfie-persistence.server"));
  });

  it("every beginSelfieAnalysis call site passes a version — none left at the old null-shifted arity", () => {
    const callStarts: number[] = [];
    let searchFrom = 0;
    while (true) {
      const idx = src.indexOf("beginSelfieAnalysis(", searchFrom);
      if (idx === -1) break;
      callStarts.push(idx);
      searchFrom = idx + 1;
    }
    assert.ok(callStarts.length === 4, `expected 4 call sites, found ${callStarts.length}`);
    for (const start of callStarts) {
      const window = src.slice(start, start + 250);
      assert.ok(
        window.includes("CURRENT_SELFIE_CONSENT_VERSION") || window.includes("creds.consentVersion"),
        `call site does not pass a consent version: ${window.slice(0, 120)}`,
      );
    }
  });

  it("the reanalyse flow reuses the existing record's version, falling back to current only if absent", () => {
    assert.ok(src.includes("creds.consentVersion ?? CURRENT_SELFIE_CONSENT_VERSION"));
  });
});
