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
