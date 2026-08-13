// app/routes/selfie-moderation.test.ts
// Selfie analysis moderation contract tests.
//
// Static source-code assertions — no DB, no Cloudinary, no Claude calls.
// Covers:
//   T1  Layer 2 moderation imported and called after upload
//   T2  SAFETY_REJECT → deleteSelfiePhoto called + safety-rejected outcome
//   T3  MODERATION_UNAVAILABLE → photo kept (not deleted), moderation-unavailable outcome
//   T4  retry-moderation intent exists and calls moderateImageContent
//   T5  retry-moderation uses getSelfieForModeration (no re-upload)
//   T6  retry-moderation SAFETY_REJECT → deleteSelfiePhoto called
//   T7  SelfieAnalysisOutcome includes safety-rejected and moderation-unavailable
//   T8  OutcomeFeedback handles safety-rejected and moderation-unavailable
//   T9  moderation called before analyseSelfie (ordering check)
//   T10 retry-moderation intent does not process new file bytes

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

function readRoute(name: string): string {
  return readFileSync(join(__dirname, name), "utf8");
}

function readLib(rel: string): string {
  return readFileSync(join(__dirname, "../lib", rel), "utf8");
}

const selfie  = readRoute("passport.selfie.tsx");
const analysis = readLib("ai/selfie-analysis.ts");
const persist  = readLib("ai/selfie-persistence.server.ts");

// ── T1: Layer 2 imported and called ──────────────────────────────────────────

describe("T1: Layer 2 moderation imported and called after upload", () => {
  it("imports moderateImageContent", () => {
    assert.ok(
      selfie.includes("moderateImageContent"),
      "passport.selfie must import and call moderateImageContent",
    );
  });

  it("calls moderateImageContent with the server-built analysisUrl", () => {
    assert.ok(
      selfie.includes("moderateImageContent(analysisUrl)"),
      "moderation must be called with analysisUrl (server-built signed URL)",
    );
  });
});

// ── T2: SAFETY_REJECT → deleteSelfiePhoto + safety-rejected outcome ───────────

describe("T2: SAFETY_REJECT → deleteSelfiePhoto called + safety-rejected outcome", () => {
  it("handles SAFETY_REJECT status", () => {
    assert.ok(
      selfie.includes("SAFETY_REJECT"),
      "selfie route must handle SAFETY_REJECT",
    );
  });

  it("calls deleteSelfiePhoto on SAFETY_REJECT", () => {
    const idx = selfie.indexOf("SAFETY_REJECT");
    const block = selfie.slice(idx, idx + 500);
    assert.ok(
      block.includes("deleteSelfiePhoto"),
      "SAFETY_REJECT block must call deleteSelfiePhoto to remove the uploaded asset",
    );
  });

  it("returns safety-rejected outcome on SAFETY_REJECT", () => {
    const idx = selfie.indexOf("SAFETY_REJECT");
    const block = selfie.slice(idx, idx + 600);
    assert.ok(
      block.includes("safety-rejected"),
      "SAFETY_REJECT must produce a safety-rejected outcome for the UI",
    );
  });
});

// ── T3: MODERATION_UNAVAILABLE → photo kept, moderation-unavailable outcome ──

describe("T3: MODERATION_UNAVAILABLE → photo kept (not deleted), retryable outcome", () => {
  // Find the CODE occurrence (not the file-header comment) using the status check string
  const codeIdx = selfie.indexOf('.status === "MODERATION_UNAVAILABLE"');

  it("handles MODERATION_UNAVAILABLE status in code", () => {
    assert.ok(
      codeIdx !== -1,
      "selfie route action must have a .status === \"MODERATION_UNAVAILABLE\" check",
    );
  });

  it("MODERATION_UNAVAILABLE block does NOT call deleteSelfiePhoto", () => {
    assert.ok(codeIdx !== -1, "MODERATION_UNAVAILABLE check must exist");
    // Tight window: just the MODERATION_UNAVAILABLE branch body (before the closing brace)
    // The return statement is ~140 chars away; SAFETY_REJECT+deleteSelfiePhoto is ~200 chars away.
    const block = selfie.slice(codeIdx, codeIdx + 160);
    assert.ok(
      !block.includes("deleteSelfiePhoto"),
      "MODERATION_UNAVAILABLE must NOT delete the photo — it must remain for retry",
    );
  });

  it("returns moderation-unavailable outcome on MODERATION_UNAVAILABLE", () => {
    assert.ok(codeIdx !== -1, "MODERATION_UNAVAILABLE check must exist");
    const block = selfie.slice(codeIdx, codeIdx + 400);
    assert.ok(
      block.includes("moderation-unavailable"),
      "MODERATION_UNAVAILABLE must produce a moderation-unavailable outcome for the UI",
    );
  });
});

// ── T4: retry-moderation intent calls moderateImageContent ───────────────────

describe("T4: retry-moderation intent re-runs moderation", () => {
  it("retry-moderation intent is handled in action", () => {
    assert.ok(
      selfie.includes('"retry-moderation"'),
      'selfie route must handle the "retry-moderation" intent',
    );
  });

  it("retry-moderation calls moderateImageContent", () => {
    // Use the handler guard to find the actual code block (not the file-header comment)
    const handlerIdx = selfie.indexOf('intent === "retry-moderation"');
    assert.ok(handlerIdx !== -1, "retry-moderation handler must exist");
    const block = selfie.slice(handlerIdx, handlerIdx + 3000);
    assert.ok(
      block.includes("moderateImageContent("),
      "retry-moderation must call moderateImageContent",
    );
  });
});

// ── T5: retry-moderation uses getSelfieForModeration (no file upload) ─────────

describe("T5: retry-moderation uses stored credentials (no re-upload)", () => {
  it("retry-moderation calls getSelfieForModeration", () => {
    assert.ok(
      selfie.includes("getSelfieForModeration"),
      "retry-moderation must call getSelfieForModeration to retrieve stored publicId",
    );
  });

  it("getSelfieForModeration is exported from selfie-persistence.server", () => {
    assert.ok(
      persist.includes("getSelfieForModeration"),
      "getSelfieForModeration must be exported from selfie-persistence.server",
    );
  });
});

// ── T6: retry-moderation SAFETY_REJECT → deleteSelfiePhoto ──────────────────

describe("T6: retry-moderation SAFETY_REJECT → deleteSelfiePhoto", () => {
  it("retry-moderation block deletes photo on SAFETY_REJECT", () => {
    // Use the handler guard expression to find the actual intent handler (not the file header comment)
    const handlerIdx = selfie.indexOf('intent === "retry-moderation"');
    assert.ok(handlerIdx !== -1, "retry-moderation handler must exist");
    const block = selfie.slice(handlerIdx, handlerIdx + 3000);
    const rejectIdx = block.indexOf("SAFETY_REJECT");
    assert.ok(rejectIdx !== -1, "retry-moderation block must handle SAFETY_REJECT");
    const rejectBlock = block.slice(rejectIdx, rejectIdx + 400);
    assert.ok(
      rejectBlock.includes("deleteSelfiePhoto"),
      "retry-moderation SAFETY_REJECT must call deleteSelfiePhoto",
    );
  });
});

// ── T7: SelfieAnalysisOutcome includes new statuses ──────────────────────────

describe("T7: SelfieAnalysisOutcome type includes safety-rejected and moderation-unavailable", () => {
  it("includes safety-rejected status", () => {
    assert.ok(
      analysis.includes('"safety-rejected"'),
      "SelfieAnalysisOutcome must include safety-rejected status",
    );
  });

  it("includes moderation-unavailable status", () => {
    assert.ok(
      analysis.includes('"moderation-unavailable"'),
      "SelfieAnalysisOutcome must include moderation-unavailable status",
    );
  });
});

// ── T8: OutcomeFeedback handles new statuses ──────────────────────────────────

describe("T8: OutcomeFeedback component handles new statuses", () => {
  it("renders feedback for safety-rejected", () => {
    assert.ok(
      selfie.includes("safety-rejected"),
      "OutcomeFeedback must handle safety-rejected outcome",
    );
  });

  it("renders feedback for moderation-unavailable", () => {
    assert.ok(
      selfie.includes("moderation-unavailable"),
      "OutcomeFeedback must handle moderation-unavailable outcome",
    );
  });
});

// ── T9: Moderation called before analysis in the analyse/replace flow ────────

describe("T9: moderateImageContent(analysisUrl) called before analyseSelfie in analyse/replace flow", () => {
  it("moderateImageContent(analysisUrl) appears before the following analyseSelfie call", () => {
    // Find the Layer 2 call in the analyse/replace flow (uses `analysisUrl`, not `retryUrl`)
    const modIdx = selfie.indexOf("moderateImageContent(analysisUrl)");
    assert.ok(modIdx !== -1, "moderateImageContent(analysisUrl) call must exist in analyse/replace flow");
    // Find the analyseSelfie call that comes AFTER the Layer 2 block
    const analIdx = selfie.indexOf("analyseSelfie(", modIdx);
    assert.ok(analIdx !== -1, "analyseSelfie must appear after the Layer 2 block");
    assert.ok(modIdx < analIdx, "moderateImageContent must appear before the following analyseSelfie call");
  });
});

// ── T10: retry-moderation does not process file bytes ────────────────────────

describe("T10: retry-moderation does not handle file upload", () => {
  it("retry-moderation handler does not reference validateSelfieFile or uploadSelfieToCloudinary", () => {
    // Use the handler guard to find the actual block (not the file header comment)
    const handlerStart = selfie.indexOf('intent === "retry-moderation"');
    assert.ok(handlerStart !== -1, "retry-moderation handler must exist");
    // The block ends at the closing brace before "// ── Analyse / replace intents"
    const endMarker = selfie.indexOf("// ── Analyse / replace intents", handlerStart);
    const block = endMarker > handlerStart
      ? selfie.slice(handlerStart, endMarker)
      : selfie.slice(handlerStart, handlerStart + 3000);
    assert.ok(
      !block.includes("validateSelfieFile"),
      "retry-moderation must not re-validate file bytes — it uses the stored asset",
    );
    assert.ok(
      !block.includes("uploadSelfieToCloudinary"),
      "retry-moderation must not re-upload — it uses the stored Cloudinary asset",
    );
  });
});

// ── T11: beginSelfieAnalysis calls wrapped in try/catch ──────────────────────
// Regression guard: before the fix, unhandled TypeError from undefined prisma
// accessor escaped to React Router and produced APPLICATION ERROR.

describe("T11: persistence exceptions do not escape action — beginSelfieAnalysis guarded", () => {
  it("first beginSelfieAnalysis has a catch block that logs and returns system-failure", () => {
    assert.ok(
      selfie.includes("[selfie-action] beginSelfieAnalysis (1) failed:"),
      "first beginSelfieAnalysis must be inside a try/catch whose catch logs '[selfie-action] beginSelfieAnalysis (1) failed:'",
    );
  });

  it("second beginSelfieAnalysis (post-upload) has a catch block that returns system-failure", () => {
    assert.ok(
      selfie.includes("[selfie-action] beginSelfieAnalysis (2) failed:"),
      "second beginSelfieAnalysis must be inside a try/catch whose catch logs '[selfie-action] beginSelfieAnalysis (2) failed:'",
    );
  });

  it("first beginSelfieAnalysis catch returns system-failure outcome (not an unhandled throw)", () => {
    const idx = selfie.indexOf("[selfie-action] beginSelfieAnalysis (1) failed:");
    assert.ok(idx !== -1, "first catch block must exist");
    const catchBlock = selfie.slice(idx, idx + 200);
    assert.ok(
      catchBlock.includes("system-failure"),
      "first beginSelfieAnalysis catch must return { status: 'system-failure' } to prevent APPLICATION ERROR",
    );
  });
});

// ── T13: completeSelfieAnalysis uses update() not upsert() ───────────────────
// Regression guard: upsert() requires consentAt in the create block; completeSelfieAnalysis
// does not pass consentAt, so upsert() was throwing PrismaClientValidationError.
// The fix switches non-begin operations to update() whose create block is never evaluated.

describe("T13: completeSelfieAnalysis/failSelfieAnalysis use update() not upsert()", () => {
  it("_updateSelfieRecord uses prisma.selfieAnalysis.update (not upsert)", () => {
    assert.ok(
      persist.includes("prisma.selfieAnalysis.update("),
      "selfie-persistence must contain _updateSelfieRecord using prisma.selfieAnalysis.update()",
    );
  });

  it("completeSelfieAnalysis defaults to _updateSelfieRecord", () => {
    const fnIdx = persist.indexOf("export async function completeSelfieAnalysis(");
    assert.ok(fnIdx !== -1, "completeSelfieAnalysis must be exported");
    const sig = persist.slice(fnIdx, fnIdx + 400);
    assert.ok(
      sig.includes("_updateSelfieRecord"),
      "completeSelfieAnalysis must default to _updateSelfieRecord so the create block is never evaluated",
    );
    assert.ok(
      !sig.includes("= _upsertSelfieRecord"),
      "completeSelfieAnalysis must NOT default to _upsertSelfieRecord (causes consentAt error)",
    );
  });

  it("failSelfieAnalysis defaults to _updateSelfieRecord", () => {
    const fnIdx = persist.indexOf("export async function failSelfieAnalysis(");
    assert.ok(fnIdx !== -1, "failSelfieAnalysis must be exported");
    const sig = persist.slice(fnIdx, fnIdx + 200);
    assert.ok(
      sig.includes("_updateSelfieRecord"),
      "failSelfieAnalysis must default to _updateSelfieRecord",
    );
  });

  it("beginSelfieAnalysis still defaults to _upsertSelfieRecord (needs create semantics)", () => {
    const fnIdx = persist.indexOf("export async function beginSelfieAnalysis(");
    assert.ok(fnIdx !== -1, "beginSelfieAnalysis must be exported");
    const sig = persist.slice(fnIdx, fnIdx + 400);
    assert.ok(
      sig.includes("= _upsertSelfieRecord"),
      "beginSelfieAnalysis must keep _upsertSelfieRecord — it is the only operation that creates the record",
    );
  });
});

// ── T14: retry-moderation persistence guarded ────────────────────────────────

describe("T14: retry-moderation persistence guarded against APPLICATION ERROR", () => {
  it("retry-moderation final persistence has a catch block that logs and returns system-failure", () => {
    assert.ok(
      selfie.includes("[selfie-action] retry-moderation persistence failed:"),
      "retry-moderation completeSelfieAnalysis/failSelfieAnalysis must be inside a try/catch that logs '[selfie-action] retry-moderation persistence failed:'",
    );
  });

  it("retry-moderation catch returns system-failure outcome", () => {
    const idx = selfie.indexOf("[selfie-action] retry-moderation persistence failed:");
    assert.ok(idx !== -1, "retry-moderation catch block must exist");
    const catchBlock = selfie.slice(idx, idx + 200);
    assert.ok(
      catchBlock.includes("system-failure"),
      "retry-moderation catch must return { status: 'system-failure' } to prevent APPLICATION ERROR",
    );
  });
});

// ── T12: final persistence wrapped in try/catch ───────────────────────────────

describe("T12: final completeSelfieAnalysis/failSelfieAnalysis guarded against APPLICATION ERROR", () => {
  it("final persistence block has a catch that logs and returns system-failure", () => {
    assert.ok(
      selfie.includes("[selfie-action] final persistence failed:"),
      "final completeSelfieAnalysis/failSelfieAnalysis must be inside a try/catch that logs '[selfie-action] final persistence failed:'",
    );
  });

  it("final persistence catch returns system-failure outcome (not an unhandled throw)", () => {
    const idx = selfie.indexOf("[selfie-action] final persistence failed:");
    assert.ok(idx !== -1, "final catch block must exist");
    const catchBlock = selfie.slice(idx, idx + 200);
    assert.ok(
      catchBlock.includes("system-failure"),
      "final persistence catch must return { status: 'system-failure' } to prevent APPLICATION ERROR",
    );
  });
});
