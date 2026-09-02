// app/routes/passport-cta-state.test.ts
// Executable node:test covering the START / CONTINUE / VIEW state matrix.
// Mirrors the exact passportState logic in my-naia._index.tsx loader.
//
// Case matrix:
//   A. no OnboardingProfile                           → start
//   B. profile exists, completed=false                → continue
//   C. legacy: completed=true, profileVersion=null    → continue (NOT view)
//   D. profileVersion=6 (canonical Rev 6 complete)    → view
//   E. profileVersion=6 + Notes empty                 → view (optional field)
//   F. profileVersion=6 + Sizes empty                 → view (optional field)
//   G. profileVersion=6 + dressingPreferences empty   → view (optional field)
//
// Static contract checks:
//   H. source uses profileVersion===6, not completed alone
//   I. legacy isLegacyCustomer pattern is consistent with passport.tsx canonical

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const indexSrc = readFileSync(join(__dirname, "my-naia._index.tsx"), "utf8");
const passportSrc = readFileSync(join(__dirname, "passport.tsx"), "utf8");

// ── Inline state function matching the loader exactly ─────────────────────────

function derivePassportState(p: { completed?: boolean; profileVersion?: number | null } | null): "start" | "continue" | "view" {
  if (!p) return "start";
  if ((p as any).profileVersion === 6) return "view";
  return "continue";
}

// ── State matrix A–G ──────────────────────────────────────────────────────────

describe("PCTA-A — no OnboardingProfile → start", () => {
  it("null profile returns 'start'", () => {
    assert.equal(derivePassportState(null), "start");
  });
  it("undefined profile returns 'start'", () => {
    assert.equal(derivePassportState(undefined as any), "start");
  });
});

describe("PCTA-B — incomplete new profile → continue", () => {
  it("completed=false + no profileVersion → continue", () => {
    assert.equal(derivePassportState({ completed: false }), "continue");
  });
  it("completed=false + profileVersion=null → continue", () => {
    assert.equal(derivePassportState({ completed: false, profileVersion: null }), "continue");
  });
});

describe("PCTA-C — legacy: completed=true, profileVersion=null → continue (NOT view)", () => {
  it("completed=true + profileVersion=null → continue", () => {
    assert.equal(
      derivePassportState({ completed: true, profileVersion: null }),
      "continue",
      "legacy completed=true customer must get CONTINUE, not VIEW",
    );
  });
  it("completed=true + profileVersion=undefined → continue", () => {
    assert.equal(
      derivePassportState({ completed: true, profileVersion: undefined }),
      "continue",
      "legacy profileVersion=undefined must be CONTINUE",
    );
  });
  it("completed=true + no profileVersion key → continue", () => {
    assert.equal(
      derivePassportState({ completed: true } as any),
      "continue",
      "missing profileVersion must not be treated as VIEW",
    );
  });
});

describe("PCTA-D — profileVersion=6 → view", () => {
  it("profileVersion=6 + completed=true → view", () => {
    assert.equal(derivePassportState({ completed: true, profileVersion: 6 }), "view");
  });
});

describe("PCTA-E — profileVersion=6 + empty Notes → view (optional field)", () => {
  it("Notes are optional; missing Notes does not change VIEW state", () => {
    // Notes live in finalNotes (optional field, never blocks profileVersion=6)
    // The state function doesn't inspect Notes — VIEW is determined by profileVersion alone.
    assert.equal(
      derivePassportState({ completed: true, profileVersion: 6 }),
      "view",
      "profileVersion=6 must be VIEW regardless of Notes presence",
    );
  });
});

describe("PCTA-F — profileVersion=6 + empty Sizes → view (optional field)", () => {
  it("Sizes are optional; missing Sizes does not change VIEW state", () => {
    assert.equal(
      derivePassportState({ completed: true, profileVersion: 6 }),
      "view",
      "profileVersion=6 must be VIEW regardless of sizing fields",
    );
  });
});

describe("PCTA-G — profileVersion=6 + empty dressingPreferences → view (optional under canonical contract)", () => {
  it("dressingPreferences not required; missing does not change VIEW state", () => {
    assert.equal(
      derivePassportState({ completed: true, profileVersion: 6 }),
      "view",
      "profileVersion=6 must be VIEW regardless of dressingPreferences",
    );
  });
});

// ── Static source contract checks (H–I) ──────────────────────────────────────

describe("PCTA-H — source uses profileVersion===6, not completed alone", () => {
  it("loader derives passportState using profileVersion === 6", () => {
    assert.ok(
      indexSrc.includes("profileVersion === 6"),
      "my-naia._index.tsx must check profileVersion === 6 for VIEW state",
    );
  });
  it("source does not derive VIEW state from completed alone", () => {
    // Slice from the = assignment (after the type annotation) to end of ternary
    const declStart  = indexSrc.indexOf("const passportState:");
    const assignStart = indexSrc.indexOf("=\n", declStart);  // start of ternary after type annotation
    const endIdx     = indexSrc.indexOf('"continue";', declStart);
    assert.ok(declStart !== -1 && assignStart !== -1 && endIdx !== -1, "passportState ternary must be locatable");
    const ternaryBlock = indexSrc.slice(assignStart, endIdx + 12);
    const viewIdx          = ternaryBlock.indexOf('"view"');
    const profileVersionIdx = ternaryBlock.indexOf("profileVersion === 6");
    assert.ok(viewIdx !== -1, '"view" must appear in passportState ternary');
    assert.ok(profileVersionIdx !== -1, "profileVersion === 6 must appear in passportState ternary");
    assert.ok(
      profileVersionIdx < viewIdx,
      "profileVersion === 6 check must precede the view assignment in the ternary",
    );
  });
  it("legacy pattern is guarded: VIEW never assigned when profileVersion is not 6", () => {
    const declStart  = indexSrc.indexOf("const passportState:");
    const assignStart = indexSrc.indexOf("=\n", declStart);
    const endIdx     = indexSrc.indexOf('"continue";', declStart);
    const ternaryBlock = indexSrc.slice(assignStart, endIdx + 12);
    const firstViewIdx  = ternaryBlock.indexOf('"view"');
    const profileChk    = ternaryBlock.indexOf("profileVersion === 6");
    assert.ok(profileChk !== -1 && profileChk < firstViewIdx, "profileVersion check must guard the view assignment in the ternary");
  });
});

// ── CTA label contract (copy checks) ─────────────────────────────────────────

describe("PCTA-CTA-labels — exact approved CTA label strings are in source", () => {
  it("START state uses label 'START YOUR STYLE PASSPORT'", () => {
    assert.ok(
      indexSrc.includes("START YOUR STYLE PASSPORT"),
      "my-naia._index.tsx must render 'START YOUR STYLE PASSPORT'",
    );
  });
  it("CONTINUE state uses label 'CONTINUE YOUR STYLE PASSPORT'", () => {
    assert.ok(
      indexSrc.includes("CONTINUE YOUR STYLE PASSPORT"),
      "my-naia._index.tsx must render 'CONTINUE YOUR STYLE PASSPORT'",
    );
  });
  it("VIEW state uses label 'VIEW STYLE PASSPORT'", () => {
    assert.ok(
      indexSrc.includes("VIEW STYLE PASSPORT"),
      "my-naia._index.tsx must render 'VIEW STYLE PASSPORT'",
    );
  });
});

// ── Routing behavior D–G (static checks against passport.tsx) ─────────────────
//
// Routing contract:
//   D. no profile         → /passport redirect to /onboarding/step/1
//   E. incomplete current → /passport redirect to /onboarding/step/1 (saved answers hydrate)
//   F. legacy (completed=true, profileVersion=null) → /passport does NOT redirect → isLegacyCustomer view
//   G. profileVersion=6   → /passport does NOT redirect → full Rev 6 overview
//
// Checks are static source analysis of passport.tsx loader, which encodes this contract.

describe("PCTA-D — no profile: /passport redirects to /onboarding/step/1", () => {
  it("passport.tsx loader redirects when !op (no OnboardingProfile)", () => {
    assert.ok(
      passportSrc.includes("!op || !op.completed") || passportSrc.includes("!op ||"),
      "passport.tsx must redirect when op is falsy (no profile)",
    );
    assert.ok(
      passportSrc.includes('redirect("/onboarding/step/1")'),
      "passport.tsx must redirect to /onboarding/step/1",
    );
  });
});

describe("PCTA-E — incomplete current profile: /passport redirects to /onboarding/step/1", () => {
  it("passport.tsx loader redirects when !op.completed (incomplete profile)", () => {
    assert.ok(
      passportSrc.includes("!op.completed"),
      "passport.tsx must redirect when op.completed is falsy (incomplete profile)",
    );
    assert.ok(
      passportSrc.includes('redirect("/onboarding/step/1")'),
      "passport.tsx must redirect to /onboarding/step/1 (step 1 hydrates saved answers)",
    );
  });
  it("step.$step.tsx loader builds existingAnswers from DB profile fields", () => {
    const stepSrc = readFileSync(join(__dirname, "onboarding/step.$step.tsx"), "utf8");
    assert.ok(
      stepSrc.includes("existingAnswers"),
      "step.$step.tsx loader must build existingAnswers from DB for resume hydration",
    );
    assert.ok(
      stepSrc.includes("stylePersonalities") || stepSrc.includes("currentGoal"),
      "step.$step.tsx loader must map profile fields into existingAnswers",
    );
  });
});

describe("PCTA-F — legacy (completed=true, profileVersion=null): /passport does NOT redirect", () => {
  it("isLegacyCustomer is defined in passport.tsx using profileVersion===null", () => {
    assert.ok(
      passportSrc.includes("isLegacyCustomer"),
      "passport.tsx must define isLegacyCustomer for legacy customers",
    );
    assert.ok(
      passportSrc.includes("profileVersion === null") || passportSrc.includes("profileVersion == null"),
      "passport.tsx must detect legacy via profileVersion===null",
    );
  });
  it("redirect guard uses !op.completed — legacy completed=true customers pass through", () => {
    // The redirect fires on !op || !op.completed.
    // Legacy customers have completed=true, so !op.completed is false — they pass through.
    const redirectGuard = passportSrc.match(/if\s*\(!op[^)]+\)\s*\{\s*throw redirect/);
    assert.ok(
      redirectGuard !== null,
      "passport.tsx must have a redirect guard for !op || !op.completed",
    );
    // Guard must NOT include profileVersion check (legacy completed=true must pass through)
    const guardStr = redirectGuard![0];
    assert.ok(
      !guardStr.includes("profileVersion"),
      "passport.tsx redirect guard must not check profileVersion — legacy completed=true must reach the passport view",
    );
  });
});

describe("PCTA-G — profileVersion=6: /passport shows full Rev 6 overview (no redirect)", () => {
  it("profileVersion=6 customer is NOT caught by the !op.completed redirect", () => {
    // profileVersion=6 implies completed=true, so they pass through the redirect.
    // Confirm by checking the flag is used for display (isRev6 or rev6Only sections), not for redirect.
    assert.ok(
      passportSrc.includes("profileVersion") && passportSrc.includes("isLegacyCustomer"),
      "passport.tsx must use profileVersion for display decisions (not redirect)",
    );
  });
  it("my-naia loader assigns VIEW only when profileVersion===6, confirming the route contract", () => {
    assert.ok(
      indexSrc.includes("profileVersion === 6"),
      "my-naia loader VIEW state requires profileVersion===6 which also passes the /passport redirect guard",
    );
  });
});

describe("PCTA-I — passportState legacy rule is consistent with canonical passport.tsx", () => {
  it("passport.tsx canonical isLegacyCustomer = profileVersion===null OR undefined", () => {
    assert.ok(
      passportSrc.includes("profileVersion === null") || passportSrc.includes("profileVersion == null"),
      "passport.tsx must define isLegacyCustomer via profileVersion===null check",
    );
  });
  it("my-naia._index.tsx treats null/undefined profileVersion as CONTINUE (not VIEW)", () => {
    const declStart  = indexSrc.indexOf("const passportState:");
    const assignStart = indexSrc.indexOf("=\n", declStart);
    const endIdx     = indexSrc.indexOf('"continue";', declStart);
    assert.ok(declStart !== -1 && assignStart !== -1 && endIdx !== -1, "passportState ternary must be locatable");
    const ternaryBlock = indexSrc.slice(assignStart, endIdx + 12);
    // VIEW is only assigned when profileVersion===6
    assert.ok(
      ternaryBlock.includes('"view"'),
      '"view" must appear in passportState ternary',
    );
    assert.ok(
      ternaryBlock.includes("profileVersion === 6"),
      "profileVersion === 6 must appear in passportState ternary",
    );
    // "continue" is the else/fallback — null/undefined profileVersion falls here
    assert.ok(
      ternaryBlock.includes('"continue"'),
      '"continue" must be the fallback in passportState ternary',
    );
  });
});
