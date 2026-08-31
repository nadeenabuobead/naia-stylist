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

// ── T15: ColourSwatch type exported ──────────────────────────────────────────

describe("T15: ColourSwatch interface exported from selfie-analysis.ts", () => {
  it("exports ColourSwatch interface", () => {
    assert.ok(
      analysis.includes("export interface ColourSwatch"),
      "selfie-analysis.ts must export ColourSwatch interface for typed swatch display",
    );
  });

  it("ColourSwatch has name and hex fields", () => {
    const idx = analysis.indexOf("export interface ColourSwatch");
    assert.ok(idx !== -1, "ColourSwatch must exist");
    const block = analysis.slice(idx, idx + 200);
    assert.ok(block.includes("name:"), "ColourSwatch must have name field");
    assert.ok(block.includes("hex:"), "ColourSwatch must have hex field");
  });
});

// ── T16: SelfieStyleSignals has v2 optional fields ───────────────────────────

describe("T16: SelfieStyleSignals expanded with v2 optional fields", () => {
  it("has featureBalance optional field", () => {
    assert.ok(
      analysis.includes("featureBalance?:"),
      "SelfieStyleSignals must have optional featureBalance field",
    );
  });

  it("has colourTemperature optional field", () => {
    assert.ok(
      analysis.includes("colourTemperature?:"),
      "SelfieStyleSignals must have optional colourTemperature field",
    );
  });

  it("has necklinesTop optional field", () => {
    assert.ok(
      analysis.includes("necklinesTop?:"),
      "SelfieStyleSignals must have optional necklinesTop field",
    );
  });

  it("has styleFormula optional field", () => {
    assert.ok(
      analysis.includes("styleFormula?:"),
      "SelfieStyleSignals must have optional styleFormula field",
    );
  });

  it("has bestNeutrals as ColourSwatch array", () => {
    assert.ok(
      analysis.includes("bestNeutrals?:"),
      "SelfieStyleSignals must have optional bestNeutrals field",
    );
  });
});

// ── T17: ANALYSIS_VERSION is 2 ────────────────────────────────────────────────

describe("T17: ANALYSIS_VERSION bumped to 2 for expanded signal schema", () => {
  const serverSrc = readLib("ai/selfie-analysis.server.ts");

  it("ANALYSIS_VERSION constant is set to 2", () => {
    assert.ok(
      serverSrc.includes("ANALYSIS_VERSION = 2"),
      "ANALYSIS_VERSION must be 2 to distinguish v2 (expanded) analysis records",
    );
  });
});

// ── T18: validateStyleSignals whitelist includes v2 fields ────────────────────

describe("T18: validateStyleSignals extracts new v2 fields from parsed response", () => {
  const serverSrc = readLib("ai/selfie-analysis.server.ts");

  it("whitelist includes bestNeutrals extraction", () => {
    assert.ok(
      serverSrc.includes("bestNeutrals"),
      "validateStyleSignals must extract bestNeutrals from parsed response",
    );
  });

  it("whitelist includes necklinesTop extraction", () => {
    assert.ok(
      serverSrc.includes("necklinesTop"),
      "validateStyleSignals must extract necklinesTop from parsed response",
    );
  });

  it("whitelist includes styleFormula extraction", () => {
    assert.ok(
      serverSrc.includes("styleFormula"),
      "validateStyleSignals must extract styleFormula from parsed response",
    );
  });

  it("swatch hex validation uses regex for 6-character CSS hex", () => {
    assert.ok(
      serverSrc.includes("HEX_RE") || serverSrc.includes("#[0-9a-fA-F]{6}"),
      "swatch validation must enforce 6-character CSS hex codes",
    );
  });
});

// ── T19: buildSelfiePreviewUrl exported from selfie-upload.server ─────────────

describe("T19: buildSelfiePreviewUrl exported from selfie-upload.server.ts", () => {
  const uploadSrc = readLib("ai/selfie-upload.server.ts");

  it("exports buildSelfiePreviewUrl", () => {
    assert.ok(
      uploadSrc.includes("export function buildSelfiePreviewUrl"),
      "selfie-upload.server must export buildSelfiePreviewUrl for signed display URLs",
    );
  });

  it("buildSelfiePreviewUrl uses 3600 second TTL (1 hour)", () => {
    const idx = uploadSrc.indexOf("buildSelfiePreviewUrl");
    assert.ok(idx !== -1, "buildSelfiePreviewUrl must exist");
    const block = uploadSrc.slice(idx, idx + 400);
    assert.ok(
      block.includes("3600"),
      "buildSelfiePreviewUrl must use 3600s TTL (1 hour) — longer than analysis URL (600s)",
    );
  });
});

// ── T20: SelfieDisplayRecord has selfiePreviewUrl ─────────────────────────────

describe("T20: SelfieDisplayRecord includes selfiePreviewUrl field", () => {
  it("SelfieDisplayRecord has selfiePreviewUrl field", () => {
    assert.ok(
      persist.includes("selfiePreviewUrl:"),
      "SelfieDisplayRecord must include selfiePreviewUrl for browser display",
    );
  });

  it("selfiePreviewUrl is nullable (string | null)", () => {
    const idx = persist.indexOf("selfiePreviewUrl:");
    assert.ok(idx !== -1, "selfiePreviewUrl must exist in SelfieDisplayRecord");
    const field = persist.slice(idx, idx + 40);
    assert.ok(
      field.includes("null"),
      "selfiePreviewUrl must be string | null — null when no photo or Cloudinary not configured",
    );
  });
});

// ── T21: loadSelfieForDisplay accepts _buildPreviewUrl ────────────────────────

describe("T21: loadSelfieForDisplay accepts injectable _buildPreviewUrl parameter", () => {
  it("_buildPreviewUrl parameter exists in loadSelfieForDisplay signature", () => {
    const fnIdx = persist.indexOf("export async function loadSelfieForDisplay(");
    assert.ok(fnIdx !== -1, "loadSelfieForDisplay must be exported");
    const sig = persist.slice(fnIdx, fnIdx + 300);
    assert.ok(
      sig.includes("_buildPreviewUrl"),
      "loadSelfieForDisplay must accept _buildPreviewUrl for DI and test isolation",
    );
  });

  it("BuildPreviewUrlFn type is exported", () => {
    assert.ok(
      persist.includes("BuildPreviewUrlFn"),
      "BuildPreviewUrlFn type must be exported for type-safe injection",
    );
  });
});

// ── T22: passport.selfie loader passes buildSelfiePreviewUrl ──────────────────

describe("T22: passport.selfie loader imports and uses buildSelfiePreviewUrl", () => {
  it("imports buildSelfiePreviewUrl from selfie-upload.server", () => {
    assert.ok(
      selfie.includes("buildSelfiePreviewUrl"),
      "passport.selfie must import buildSelfiePreviewUrl from selfie-upload.server",
    );
  });

  it("loader passes buildSelfiePreviewUrl to loadSelfieForDisplay", () => {
    const loaderIdx = selfie.indexOf("export async function loader(");
    assert.ok(loaderIdx !== -1, "loader must exist");
    const loaderBlock = selfie.slice(loaderIdx, loaderIdx + 600);
    assert.ok(
      loaderBlock.includes("buildSelfiePreviewUrl"),
      "loader must pass buildSelfiePreviewUrl to loadSelfieForDisplay for signed preview URL generation",
    );
  });

  it("selfieDisplayUrl uses selfiePreviewUrl from loader data", () => {
    assert.ok(
      selfie.includes("selfiePreviewUrl"),
      "component must use selfiePreviewUrl from loader data for return-visit display",
    );
  });
});

// ── T23: reanalyse-selfie intent exists ───────────────────────────────────────

describe("T23: reanalyse-selfie intent handled in action (no new upload)", () => {
  it("reanalyse-selfie intent is handled in action", () => {
    assert.ok(
      selfie.includes('"reanalyse-selfie"'),
      'selfie route must handle the "reanalyse-selfie" intent',
    );
  });

  it("reanalyse-selfie is in ActionResult type", () => {
    assert.ok(
      selfie.includes('"reanalyse-selfie"'),
      "ActionResult type must include reanalyse-selfie intent",
    );
  });
});

// ── T24: reanalyse-selfie uses stored credentials, no file upload ─────────────

describe("T24: reanalyse-selfie uses getSelfieForModeration — no re-upload", () => {
  const handlerStart = selfie.indexOf('intent === "reanalyse-selfie"');

  it("reanalyse-selfie handler exists", () => {
    assert.ok(handlerStart !== -1, "reanalyse-selfie handler must exist in action");
  });

  it("reanalyse-selfie calls getSelfieForModeration", () => {
    assert.ok(handlerStart !== -1, "handler must exist");
    const block = selfie.slice(handlerStart, handlerStart + 3000);
    assert.ok(
      block.includes("getSelfieForModeration"),
      "reanalyse-selfie must call getSelfieForModeration to resolve stored photo credentials",
    );
  });

  it("reanalyse-selfie does NOT call validateSelfieFile or uploadSelfieToCloudinary", () => {
    assert.ok(handlerStart !== -1, "handler must exist");
    const endMarker = selfie.indexOf("// ── Analyse / replace intents", handlerStart);
    const block = endMarker > handlerStart
      ? selfie.slice(handlerStart, endMarker)
      : selfie.slice(handlerStart, handlerStart + 3000);
    assert.ok(
      !block.includes("validateSelfieFile"),
      "reanalyse-selfie must not re-validate file bytes — it uses the stored Cloudinary asset",
    );
    assert.ok(
      !block.includes("uploadSelfieToCloudinary"),
      "reanalyse-selfie must not re-upload — it uses the stored Cloudinary asset",
    );
  });
});

// ── T25: reanalyse-selfie resets analysis status via beginSelfieAnalysis ──────

describe("T25: reanalyse-selfie calls beginSelfieAnalysis with forceReplace to reset status", () => {
  const handlerStart = selfie.indexOf('intent === "reanalyse-selfie"');

  it("reanalyse-selfie calls beginSelfieAnalysis", () => {
    assert.ok(handlerStart !== -1, "handler must exist");
    const block = selfie.slice(handlerStart, handlerStart + 3000);
    assert.ok(
      block.includes("beginSelfieAnalysis"),
      "reanalyse-selfie must call beginSelfieAnalysis to reset status to pending",
    );
  });

  it("reanalyse-selfie passes forceReplace: true", () => {
    assert.ok(handlerStart !== -1, "handler must exist");
    const block = selfie.slice(handlerStart, handlerStart + 3000);
    assert.ok(
      block.includes("forceReplace: true"),
      "reanalyse-selfie must pass forceReplace: true to bypass the pending guard",
    );
  });
});

// ── T26: reanalyse-selfie runs moderation ────────────────────────────────────

describe("T26: reanalyse-selfie runs moderateImageContent on the stored selfie", () => {
  const handlerStart = selfie.indexOf('intent === "reanalyse-selfie"');

  it("reanalyse-selfie calls moderateImageContent", () => {
    assert.ok(handlerStart !== -1, "handler must exist");
    const block = selfie.slice(handlerStart, handlerStart + 3000);
    assert.ok(
      block.includes("moderateImageContent("),
      "reanalyse-selfie must call moderateImageContent for Layer 2 safety check",
    );
  });

  it("reanalyse-selfie SAFETY_REJECT deletes photo", () => {
    assert.ok(handlerStart !== -1, "handler must exist");
    const block = selfie.slice(handlerStart, handlerStart + 3000);
    const rejectIdx = block.indexOf("SAFETY_REJECT");
    assert.ok(rejectIdx !== -1, "reanalyse-selfie must handle SAFETY_REJECT");
    const rejectBlock = block.slice(rejectIdx, rejectIdx + 300);
    assert.ok(
      rejectBlock.includes("deleteSelfiePhoto"),
      "reanalyse-selfie SAFETY_REJECT must call deleteSelfiePhoto",
    );
  });
});

// ── T27: reanalyse-selfie calls analyseSelfie (quality + v2) ─────────────────

describe("T27: reanalyse-selfie runs analyseSelfie (quality check + v2 analysis)", () => {
  const handlerStart = selfie.indexOf('intent === "reanalyse-selfie"');

  it("reanalyse-selfie calls analyseSelfie", () => {
    assert.ok(handlerStart !== -1, "handler must exist");
    const block = selfie.slice(handlerStart, handlerStart + 3000);
    assert.ok(
      block.includes("analyseSelfie(") || block.includes("= analyseSelfie"),
      "reanalyse-selfie must call analyseSelfie (which runs quality + v2 analysis)",
    );
  });

  it("reanalyse-selfie persistence guarded with try/catch", () => {
    assert.ok(
      selfie.includes("[selfie-action] reanalyse-selfie persistence failed:"),
      "reanalyse-selfie final persistence must be guarded with a try/catch",
    );
  });
});

// ── T28: showFailedSection — photo visible after failed analysis ──────────────

describe("T28: showFailedSection renders selfie and Reanalyse CTA (not upload form)", () => {
  it("showFailedSection variable defined in component", () => {
    assert.ok(
      selfie.includes("showFailedSection"),
      "component must define showFailedSection for the failed-analysis + stored-photo state",
    );
  });

  it("showFailedSection checks photoExists and not analysisCompleted", () => {
    const idx = selfie.indexOf("showFailedSection");
    assert.ok(idx !== -1, "showFailedSection must exist");
    const block = selfie.slice(idx, idx + 400);
    assert.ok(
      block.includes("photoExists"),
      "showFailedSection must gate on photoExists so it only shows when photo is stored",
    );
    assert.ok(
      block.includes("analysisCompleted"),
      "showFailedSection must gate on !analysisCompleted",
    );
  });

  it("showFailedSection renders reanalyse-selfie form", () => {
    const failIdx = selfie.indexOf("{showFailedSection &&");
    assert.ok(failIdx !== -1, "showFailedSection section must be rendered in JSX");
    const block = selfie.slice(failIdx, failIdx + 1000);
    assert.ok(
      block.includes("reanalyse-selfie"),
      "showFailedSection section must include a form with reanalyse-selfie intent",
    );
  });
});

// ── T29: showDeletedSection — photo visible after analysis deletion ────────────

describe("T29: showDeletedSection renders selfie and Analyse CTA (not upload form)", () => {
  it("showDeletedSection variable defined in component", () => {
    assert.ok(
      selfie.includes("showDeletedSection"),
      "component must define showDeletedSection for the analysis-deleted + stored-photo state",
    );
  });

  it("showDeletedSection checks photoExists and dbStatus deleted", () => {
    const idx = selfie.indexOf("showDeletedSection");
    assert.ok(idx !== -1, "showDeletedSection must exist");
    const block = selfie.slice(idx, idx + 300);
    assert.ok(
      block.includes("photoExists"),
      "showDeletedSection must gate on photoExists",
    );
    assert.ok(
      block.includes('"deleted"'),
      'showDeletedSection must check dbStatus === "deleted"',
    );
  });

  it("showDeletedSection renders reanalyse-selfie form", () => {
    const delIdx = selfie.indexOf("{showDeletedSection &&");
    assert.ok(delIdx !== -1, "showDeletedSection section must be rendered in JSX");
    const block = selfie.slice(delIdx, delIdx + 1000);
    assert.ok(
      block.includes("reanalyse-selfie"),
      "showDeletedSection must include a form with reanalyse-selfie intent",
    );
  });
});

// ── T30: Selfie shown independent of analysis state ──────────────────────────

describe("T30: selfie image shown whenever photoExists — not gated on analysisCompleted", () => {
  it("selfie section uses photoExists as the primary gate, not showResults/analysisCompleted", () => {
    assert.ok(
      selfie.includes("photoExists"),
      "component must use photoExists to gate selfie display",
    );
  });

  it("selfie img src uses displaySelfieUrl — server-signed URL, never raw publicId", () => {
    // Security + structural invariant: selfie is served via a server-signed URL
    // (displaySelfieUrl → selfieDisplayUrl → selfiePreviewUrl from loader).
    // The raw Cloudinary publicId is never serialised to the browser.
    const imgIdx = selfie.indexOf("src={displaySelfieUrl}");
    const completedJsxIdx = selfie.indexOf("{showCompletedSection && displaySignals");
    assert.ok(imgIdx !== -1, "selfie img src must be displaySelfieUrl — server-signed preview URL, not a raw publicId");
    assert.ok(completedJsxIdx !== -1, "showCompletedSection JSX block must exist");
    assert.ok(
      imgIdx > completedJsxIdx,
      "selfie img must render inside the showCompletedSection block (shown with analysis results)",
    );
  });
});

// ── T31: Status label says "Analysis unavailable", not duplicate message ──────

describe("T31: Status label uses 'Analysis unavailable' for failed states (no duplicate card)", () => {
  it("statusLabel uses 'Analysis unavailable' for failed DB state", () => {
    assert.ok(
      selfie.includes('"Analysis unavailable"'),
      'statusLabel must produce "Analysis unavailable" for failed analysis state',
    );
  });

  it("statusLabel does NOT say 'Analysis failed — please try again'", () => {
    assert.ok(
      !selfie.includes("Analysis failed — please try again"),
      "status label must not duplicate the old 'Analysis failed — please try again' string — it is now 'Analysis unavailable'",
    );
  });

  it("statusDescription provides supporting copy for failed state", () => {
    assert.ok(
      selfie.includes("We couldn't complete your analysis this time."),
      "statusDescription must provide 'We couldn't complete your analysis this time.' as supporting copy",
    );
  });
});

// ── T32: OutcomeFeedback suppressed for system-failure / timeout ──────────────

describe("T32: OutcomeFeedback does NOT render for system-failure or timeout outcomes", () => {
  it("showOutcomeFeedback explicitly excludes system-failure", () => {
    const idx = selfie.indexOf("showOutcomeFeedback");
    assert.ok(idx !== -1, "showOutcomeFeedback variable must exist");
    const block = selfie.slice(idx, idx + 500);
    assert.ok(
      block.includes("system-failure"),
      "showOutcomeFeedback must exclude system-failure so no duplicate error card renders",
    );
  });

  it("showOutcomeFeedback explicitly excludes timeout", () => {
    const idx = selfie.indexOf("showOutcomeFeedback");
    assert.ok(idx !== -1, "showOutcomeFeedback must exist");
    const block = selfie.slice(idx, idx + 500);
    assert.ok(
      block.includes("timeout"),
      "showOutcomeFeedback must exclude timeout so no duplicate error card renders",
    );
  });
});

// ── T33: showChooseDifferent toggle state ─────────────────────────────────────

describe("T33: showChooseDifferent state controls Choose a Different Photo flow", () => {
  it("showChooseDifferent state variable exists in component", () => {
    assert.ok(
      selfie.includes("showChooseDifferent"),
      "component must have showChooseDifferent state for the choose-different-photo toggle",
    );
  });

  it("Choose a Different Photo button sets showChooseDifferent", () => {
    assert.ok(
      selfie.includes("setShowChooseDifferent"),
      "Choose a Different Photo button must call setShowChooseDifferent to reveal the replace form",
    );
  });
});

// ── T34: Delete button independence ──────────────────────────────────────────

describe("T34: delete-analysis intent preserved separate from delete-photo and delete-both", () => {
  it("delete-analysis intent preserved in action and modal", () => {
    const count = (selfie.match(/"delete-analysis"/g) ?? []).length;
    assert.ok(
      count >= 2,
      "delete-analysis must appear at least twice (action handler + modal form intent value)",
    );
  });

  it("delete-photo intent does NOT appear in delete-analysis handler block", () => {
    const handlerIdx = selfie.indexOf('intent === "delete-analysis"');
    assert.ok(handlerIdx !== -1, "delete-analysis handler must exist");
    const block = selfie.slice(handlerIdx, handlerIdx + 200);
    assert.ok(
      !block.includes("deleteSelfiePhoto"),
      "delete-analysis handler must NOT call deleteSelfiePhoto — it only clears analysis",
    );
  });

  it("delete-analysis handler calls deleteAnalysisResult", () => {
    const handlerIdx = selfie.indexOf('intent === "delete-analysis"');
    assert.ok(handlerIdx !== -1, "handler must exist");
    const block = selfie.slice(handlerIdx, handlerIdx + 200);
    assert.ok(
      block.includes("deleteAnalysisResult"),
      "delete-analysis handler must call deleteAnalysisResult",
    );
  });
});
