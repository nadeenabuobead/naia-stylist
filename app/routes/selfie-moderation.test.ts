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
