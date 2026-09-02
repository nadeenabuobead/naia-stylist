// app/routes/onboarding/complete.test.ts
// Static source-code contract tests for onboarding/complete.tsx.
// All assertions are against the route source — no DB or browser required.
//
// Tests I–P: Rev 6 completion page + First Read pipeline fixes.
//   I   profileVersion returned from loader
//   J   loader payload includes profileVersion field
//   K   component destructures profileVersion from useLoaderData
//   L   section 2 impression is gated on !isRev6
//   M   section 2 feelings is gated on !isRev6
//   N   section 5 becoming is gated on !isRev6
//   O   section 5 struggles/support is gated on !isRev6
//   P   StyleMe CTA subtitle updated to Rev 3 copy

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const complete = readFileSync(join(__dirname, "complete.tsx"), "utf8");

// ── I: profileVersion returned from loader ──────────────────────────────────

describe("CPL-I — profileVersion is part of the loader return payload", () => {
  it("loader assigns profileVersion from op.profileVersion", () => {
    assert.ok(
      complete.includes("profileVersion"),
      "complete.tsx must include profileVersion",
    );
    assert.ok(
      complete.includes("(op as any)?.profileVersion"),
      "loader must read (op as any)?.profileVersion",
    );
  });
});

// ── J: loader payload includes profileVersion ───────────────────────────────

describe("CPL-J — payload object includes profileVersion key", () => {
  it("const payload object contains the profileVersion key", () => {
    const payloadIdx = complete.indexOf("const payload = {");
    assert.ok(payloadIdx !== -1, "loader must build a const payload object");
    const payloadBlock = complete.slice(payloadIdx, payloadIdx + 400);
    assert.ok(
      payloadBlock.includes("profileVersion"),
      "payload object must include the profileVersion key",
    );
  });
});

// ── K: component destructures profileVersion ────────────────────────────────

describe("CPL-K — component destructures profileVersion from useLoaderData", () => {
  it("useLoaderData destructure includes profileVersion", () => {
    const loaderDataIdx = complete.indexOf("useLoaderData<typeof loader>()");
    assert.ok(loaderDataIdx !== -1, "component must call useLoaderData<typeof loader>()");
    const destructureStart = complete.lastIndexOf("{", loaderDataIdx);
    const destructureEnd   = complete.indexOf("}", loaderDataIdx);
    const destructure = complete.slice(destructureStart, destructureEnd + 1);
    assert.ok(
      destructure.includes("profileVersion"),
      "useLoaderData destructure must include profileVersion",
    );
  });
});

// ── L: section 2 impression gated on !isRev6 ───────────────────────────────

describe("CPL-L — section 2 (impression) is hidden for Rev 6 profiles", () => {
  it("desired-impression block is gated on !isRev6", () => {
    const sec2Comment = complete.indexOf("/* 2 —");
    assert.ok(sec2Comment !== -1, 'section 2 comment "/* 2 —" must exist');
    // Find the JSX condition that guards the section
    const sec2Block = complete.slice(sec2Comment, sec2Comment + 400);
    assert.ok(
      sec2Block.includes("!isRev6"),
      "section 2 impression+feelings guard must include !isRev6",
    );
  });
});

// ── M: section 2 feelings gated on !isRev6 (same condition as impression) ──

describe("CPL-M — section 2 (feelings) shares the !isRev6 gate with impression", () => {
  it("cp-section-label for 'How you want to feel' is inside the !isRev6 block", () => {
    const feelingsLabelIdx = complete.indexOf("How you want to feel");
    assert.ok(feelingsLabelIdx !== -1, "'How you want to feel' label must exist");
    // The !isRev6 condition must appear before this label within the same section
    const sec2Start = complete.indexOf("/* 2 —");
    const sec2End   = feelingsLabelIdx + 200;
    const sec2Region = complete.slice(sec2Start, sec2End);
    assert.ok(
      sec2Region.includes("!isRev6"),
      "!isRev6 must appear in the section 2 region containing feelings",
    );
  });
});

// ── N: section 5 becoming gated on !isRev6 ─────────────────────────────────

describe("CPL-N — section 5 (becoming) is hidden for Rev 6 profiles", () => {
  it("becoming block is gated on !isRev6", () => {
    const sec5Comment = complete.indexOf("/* 5 —");
    assert.ok(sec5Comment !== -1, 'section 5 comment "/* 5 —" must exist');
    const sec5Block = complete.slice(sec5Comment, sec5Comment + 300);
    assert.ok(
      sec5Block.includes("!isRev6"),
      "section 5 becoming+struggles+support guard must include !isRev6",
    );
  });
});

// ── O: section 5 struggles/support gated on !isRev6 ───────────────────────

describe("CPL-O — section 5 (struggles and support) shares the !isRev6 gate", () => {
  it("'When you feel most disconnected' label is inside the !isRev6 section 5 block", () => {
    const sec5Comment  = complete.indexOf("/* 5 —");
    const sec5End      = complete.indexOf("/* 6 —");
    assert.ok(sec5Comment !== -1, "section 5 comment must exist");
    assert.ok(sec5End !== -1, "section 6 comment must follow section 5");
    const sec5Region = complete.slice(sec5Comment, sec5End);
    assert.ok(
      sec5Region.includes("!isRev6"),
      "!isRev6 must appear in section 5 region (struggling + support)",
    );
    assert.ok(
      sec5Region.includes("disconnected"),
      "section 5 must contain the disconnected label",
    );
    assert.ok(
      sec5Region.includes("easier"),
      "section 5 must contain the 'easier' label (style support copy)",
    );
  });
});

// ── A: Rev 6 completion page does not render old definitive Creative description ──

describe("CPL-A — old assertive Creative description is not in source", () => {
  it("old Creative description is not present", () => {
    assert.ok(
      !complete.includes("You express who you are through original, artistic choices that are distinctly yours."),
      "old Creative-Expressive description must be removed from complete.tsx",
    );
  });
});

// ── B: new Creative description exact copy ──────────────────────────────────

describe("CPL-B — new Creative-Expressive description is exact approved copy", () => {
  it("new description uses the approved observational voice", () => {
    assert.ok(
      complete.includes("Your answers currently point toward creative, expressive styling with a softer, romantic edge."),
      "creative-expressive must use the exact approved description",
    );
  });
});

// ── C: other Rev 6 identity descriptions do not contain old assertive patterns ──

describe("CPL-C — Rev 6 IDENTITY descriptions do not contain assertive 'You' patterns", () => {
  const v3Keys = ["classic-polished", "feminine-romantic", "minimal-relaxed", "bold-edgy", "creative-expressive"];

  it("IDENTITY map does not contain 'You appreciate' for any V3 archetype", () => {
    // Extract V3 section of IDENTITY map (from start of map to end of V2 legacy comment)
    const mapStart = complete.indexOf("const IDENTITY:");
    const legacyComment = complete.indexOf("// V2 legacy");
    assert.ok(mapStart !== -1 && legacyComment !== -1, "IDENTITY map boundaries must be locatable");
    const v3Block = complete.slice(mapStart, legacyComment);
    assert.ok(
      !v3Block.includes("You appreciate"),
      "V3 archetypes must not use 'You appreciate' pattern",
    );
  });

  it("IDENTITY map does not contain \"You're not afraid\" for any V3 archetype", () => {
    const mapStart = complete.indexOf("const IDENTITY:");
    const legacyComment = complete.indexOf("// V2 legacy");
    const v3Block = complete.slice(mapStart, legacyComment);
    assert.ok(
      !v3Block.includes("You're not afraid"),
      "V3 archetypes must not use \"You're not afraid\" pattern",
    );
  });

  it("IDENTITY map does not contain 'You express' as a direct identity claim in V3 archetypes", () => {
    const mapStart = complete.indexOf("const IDENTITY:");
    const legacyComment = complete.indexOf("// V2 legacy");
    const v3Block = complete.slice(mapStart, legacyComment);
    assert.ok(
      !v3Block.includes("You express who you are"),
      "V3 archetypes must not use 'You express who you are' identity claim",
    );
  });

  it("all 5 V3 archetypes have descriptions using observational answer-based framing", () => {
    const mapStart = complete.indexOf("const IDENTITY:");
    const legacyComment = complete.indexOf("// V2 legacy");
    const v3Block = complete.slice(mapStart, legacyComment);
    const observationalPhrases = [
      "Your answers currently point toward",
      "Your selections currently lean toward",
    ];
    for (const key of v3Keys) {
      const keyIdx = v3Block.indexOf(`"${key}"`);
      assert.ok(keyIdx !== -1, `V3 archetype "${key}" must be present in IDENTITY map`);
      const entryEnd = v3Block.indexOf("\n", keyIdx);
      const entryLine = v3Block.slice(keyIdx, entryEnd);
      const hasObservational = observationalPhrases.some(p => entryLine.includes(p));
      assert.ok(
        hasObservational,
        `V3 archetype "${key}" description must use observational phrasing (found: ${entryLine.trim()})`,
      );
    }
  });
});

// ── D: "Style DNA" is not shown on the Rev 6 completion CTA ─────────────────

describe("CPL-D — 'Style DNA' is not shown on the completion CTA button", () => {
  it("source does not contain 'Style DNA' in CTA title", () => {
    assert.ok(
      !complete.includes("View your updated Style DNA"),
      "'View your updated Style DNA' CTA title must be removed",
    );
  });
  it("'Style DNA' does not appear in completion CTA action-title context", () => {
    const ctaIdx = complete.indexOf("cp-action-title");
    while (ctaIdx !== -1) {
      // Check no cp-action-title block contains "Style DNA"
    }
    // Simple substring check: Style DNA must not appear in the actions section at all
    const actionsStart = complete.indexOf("cp-action");
    const actionsBlock = actionsStart !== -1 ? complete.slice(actionsStart, actionsStart + 2000) : "";
    assert.ok(
      !actionsBlock.includes("Style DNA"),
      "'Style DNA' must not appear in any cp-action CTA on the completion page",
    );
  });
});

// ── E: CTA says exactly "View your Style Passport" ──────────────────────────

describe("CPL-E — CTA title is exactly 'View your Style Passport'", () => {
  it("source contains the exact approved CTA label", () => {
    assert.ok(
      complete.includes("View your Style Passport"),
      "complete.tsx must contain 'View your Style Passport'",
    );
  });
});

// ── F: subtitle says exactly "Your Style Passport has been saved." ────────────

describe("CPL-F — CTA subtitle is exactly 'Your Style Passport has been saved.'", () => {
  it("source contains the exact approved subtitle", () => {
    assert.ok(
      complete.includes("Your Style Passport has been saved."),
      "complete.tsx must contain 'Your Style Passport has been saved.'",
    );
  });
  it("old 'Your nAia Passport has been saved' subtitle is removed", () => {
    assert.ok(
      !complete.includes("Your nAia Passport has been saved"),
      "old 'Your nAia Passport has been saved' subtitle must be removed",
    );
  });
});

// ── G: destination route is unchanged ───────────────────────────────────────

describe("CPL-G — Style Passport CTA destination route is unchanged", () => {
  it("CTA links to /my-naia (unchanged)", () => {
    assert.ok(
      complete.includes('href="/my-naia"'),
      "Style Passport CTA must still link to /my-naia",
    );
  });
});

// ── P: StyleMe CTA subtitle updated ────────────────────────────────────────

describe("CPL-P — StyleMe CTA subtitle uses Rev 3 copy", () => {
  it("subtitle is 'Get outfit ideas based on what you need today.'", () => {
    assert.ok(
      complete.includes("Get outfit ideas based on what you need today."),
      "StyleMe CTA subtitle must say 'Get outfit ideas based on what you need today.'",
    );
  });
  it("old mood-based subtitle is removed", () => {
    assert.ok(
      !complete.includes("Get outfit ideas based on your mood"),
      "old 'Get outfit ideas based on your mood' subtitle must not appear",
    );
  });
});
