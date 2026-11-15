// app/routes/api.full-look-vto.test.ts
// Contract tests for /api/full-look-vto — the real, persisted, customer-facing
// Full-Look VTO trigger (2026-11-14), mirroring api.trigger-tryon.test.ts's own
// source-assertion style for this route family. Behavioral coverage of the
// orchestrator and chain functions this route calls lives in their own
// extensive test suites (full-look-vto-orchestrator.server.test.ts,
// full-look-tryon-real.server.test.ts); this file verifies the ROUTE's own
// wiring — the security contract stated in its header comment.
//
// All tests are source-code assertions — no live DB, no Cloudinary, no FASHN,
// no live session.
//
// Run: node --test --import tsx/esm app/routes/api.full-look-vto.test.ts

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");

function readRootFile(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

const route = readRootFile("app/routes/api.full-look-vto.tsx");
const routesConfig = readRootFile("app/routes.ts");

describe("FL1 — route is registered", () => {
  it("app/routes.ts registers api/full-look-vto pointing at this file", () => {
    assert.ok(routesConfig.includes('route("api/full-look-vto", "routes/api.full-look-vto.tsx")'));
  });
});

describe("FL2 — unauthenticated request rejected before any DB access", () => {
  it("loader checks getCurrentNaiaCustomer and returns authRequired() first", () => {
    const loaderBody = route.split("export async function loader")[1].split("export async function action")[0];
    const customerCheckIdx = loaderBody.indexOf("getCurrentNaiaCustomer");
    const authRequiredIdx = loaderBody.indexOf("authRequired()");
    const firstPrismaIdx = loaderBody.indexOf("loadOwnedSuggestion");
    assert.ok(customerCheckIdx !== -1 && authRequiredIdx !== -1);
    assert.ok(customerCheckIdx < authRequiredIdx);
    assert.ok(authRequiredIdx < firstPrismaIdx, "auth check happens before any suggestion lookup");
  });

  it("action checks getCurrentNaiaCustomer and returns authRequired() before parsing the body", () => {
    const actionBody = route.split("export async function action")[1];
    const customerCheckIdx = actionBody.indexOf("getCurrentNaiaCustomer");
    const authRequiredIdx = actionBody.indexOf("authRequired()");
    const bodyParseIdx = actionBody.indexOf("request.json()");
    assert.ok(customerCheckIdx !== -1 && authRequiredIdx !== -1 && bodyParseIdx !== -1);
    assert.ok(customerCheckIdx < authRequiredIdx);
    assert.ok(authRequiredIdx < bodyParseIdx, "auth check happens before the request body is ever read");
  });
});

describe("FL3 — customerId never accepted from client input", () => {
  it("action destructures only outfitSuggestionId, virtualTryOnConsentAt, retry from the body — never customerId", () => {
    const match = route.match(/const \{ ([^}]+) \} = body as Record<string, unknown>;/);
    assert.ok(match, "expected a destructure of the parsed body");
    const destructured = match[1].split(",").map((s) => s.trim());
    assert.deepEqual(destructured.sort(), ["outfitSuggestionId", "retry", "virtualTryOnConsentAt"].sort());
    assert.ok(!destructured.includes("customerId"));
  });

  it("every startFullLookOutfit/pollFullLookOutfit call passes customer.id, not a body/query value", () => {
    assert.ok(route.includes("customerId: customer.id,"));
    assert.ok(!route.includes("customerId: outfitSuggestionId"));
  });
});

describe("FL4 — outfitSuggestionId ownership verified before anything else runs", () => {
  it("loadOwnedSuggestion scopes the lookup by the session's own customer.id, failing closed (null) on a mismatch", () => {
    const fn = route.split("async function loadOwnedSuggestion")[1].split("export async function loader")[0];
    assert.ok(fn.includes("suggestion.session.customerId !== customerId"));
    assert.ok(fn.includes("return null"));
  });

  it("loader calls loadOwnedSuggestion before findCompletedFullLookForSuggestion or pollFullLookOutfit", () => {
    const loaderBody = route.split("export async function loader")[1].split("export async function action")[0];
    const ownedIdx = loaderBody.indexOf("loadOwnedSuggestion(");
    const completedIdx = loaderBody.indexOf("findCompletedFullLookForSuggestion(");
    const pollIdx = loaderBody.indexOf("pollFullLookOutfit(");
    assert.ok(ownedIdx !== -1 && completedIdx !== -1 && pollIdx !== -1);
    assert.ok(ownedIdx < completedIdx && completedIdx < pollIdx);
  });

  it("action calls loadOwnedSuggestion before any entitlement check or chain start", () => {
    const actionBody = route.split("export async function action")[1];
    const ownedIdx = actionBody.indexOf("loadOwnedSuggestion(");
    const entitlementIdx = actionBody.indexOf("checkEntitlement(");
    const startIdx = actionBody.indexOf("startFullLookOutfit(");
    assert.ok(ownedIdx !== -1 && entitlementIdx !== -1 && startIdx !== -1);
    assert.ok(ownedIdx < entitlementIdx && entitlementIdx < startIdx);
  });

  it("an owned-suggestion miss (null) returns notFound(), not a 403 — same not-found-not-403 convention as the rest of this codebase", () => {
    const loaderBody = route.split("export async function loader")[1].split("export async function action")[0];
    assert.ok(/if \(!suggestion\) return notFound\(\);/.test(loaderBody));
  });
});

describe("FL5 — garment image URLs are resolved server-side only", () => {
  it("selectFullLookGarments is called on suggestion.items (server-loaded), never on any client-supplied image field", () => {
    assert.ok(route.includes("selectFullLookGarments(\n    suggestion.items"));
    assert.ok(!route.includes("body.productImageUrl"));
    assert.ok(!route.includes("body.garments"));
  });
});

describe("FL6 — per-generation consent, same 15-minute freshness window as the single-item flow", () => {
  it("MAX_CONSENT_AGE_MS is exactly 15 minutes", () => {
    assert.ok(route.includes("const MAX_CONSENT_AGE_MS = 15 * 60 * 1000;"));
  });

  it("a missing or non-string virtualTryOnConsentAt is rejected before the suggestion is ever loaded", () => {
    const actionBody = route.split("export async function action")[1];
    const consentCheckIdx = actionBody.indexOf('typeof virtualTryOnConsentAt !== "string"');
    const ownedIdx = actionBody.indexOf("loadOwnedSuggestion(");
    assert.ok(consentCheckIdx !== -1 && ownedIdx !== -1);
    assert.ok(consentCheckIdx < ownedIdx);
  });

  it("a future-dated or stale consent timestamp (outside [0, MAX_CONSENT_AGE_MS]) is rejected", () => {
    assert.ok(route.includes("if (consentAgeMs < 0 || consentAgeMs > MAX_CONSENT_AGE_MS)"));
  });
});

describe("FL7 — entitlement is checked only when starting a NEW outfit, never on poll or resume", () => {
  it("checkEntitlement is referenced exactly once, inside the action — never in the loader", () => {
    const loaderBody = route.split("export async function loader")[1].split("export async function action")[0];
    const actionBody = route.split("export async function action")[1];
    assert.ok(!loaderBody.includes("checkEntitlement"), "loader (GET/poll) must never check entitlement");
    const occurrences = actionBody.split("checkEntitlement(").length - 1;
    assert.equal(occurrences, 1);
  });

  it("the entitlement check happens AFTER the already-completed short-circuit — resuming a finished result never re-checks quota", () => {
    const actionBody = route.split("export async function action")[1];
    const completedCheckIdx = actionBody.indexOf("findCompletedFullLookForSuggestion(");
    const entitlementIdx = actionBody.indexOf("checkEntitlement(");
    assert.ok(completedCheckIdx !== -1 && entitlementIdx !== -1);
    assert.ok(completedCheckIdx < entitlementIdx);
  });

  it("an over-quota customer gets a 429 quota_exceeded response, never reaching chain start", () => {
    const actionBody = route.split("export async function action")[1];
    const entCheckIdx = actionBody.indexOf("if (!entCheck.allowed)");
    const tooManyIdx = actionBody.indexOf('tooMany("You\'ve used all your Virtual Try-On sessions');
    const startIdx = actionBody.indexOf("startFullLookOutfit(");
    assert.ok(entCheckIdx !== -1 && tooManyIdx !== -1 && startIdx !== -1);
    assert.ok(entCheckIdx < tooManyIdx && tooManyIdx < startIdx);
  });
});

describe("FL8 — never regenerates on revisit; retry only applies to a genuinely failed attempt", () => {
  it("loader short-circuits to the saved result via findCompletedFullLookForSuggestion before touching the chain", () => {
    const loaderBody = route.split("export async function loader")[1].split("export async function action")[0];
    assert.ok(loaderBody.includes("findCompletedFullLookForSuggestion(customer.id, suggestionId)"));
    assert.ok(/if \(existing\) \{\s*return data\(\s*\{ ok: true, status: "COMPLETED"/.test(loaderBody));
  });

  it("action's retry flag only maps to forceNewAttempt on startFullLookOutfit — it cannot skip ownership, consent, model-readiness, or entitlement checks", () => {
    const actionBody = route.split("export async function action")[1];
    assert.ok(actionBody.includes("{ forceNewAttempt: retry === true }"));
    // The only place `retry` is referenced in the action body.
    const retryRefs = (actionBody.match(/\bretry\b/g) || []).length;
    assert.ok(retryRefs <= 3, "retry must not be threaded through multiple branches (destructure + one usage)");
  });

  it("action also short-circuits to the saved result when one already exists — a retry request against an already-completed outfit cannot regenerate", () => {
    const actionBody = route.split("export async function action")[1];
    assert.ok(/if \(existing\) \{\s*return data\(\{ ok: true, status: "COMPLETED"/.test(actionBody));
  });
});

describe("FL9 — model readiness gate mirrors the single-item flow", () => {
  it("action rejects before starting a chain when the model lacks a full-body photo or isn't VTO-ready", () => {
    const actionBody = route.split("export async function action")[1];
    assert.ok(actionBody.includes("computeModelReadinessFromRecord(naiaModel)"));
    assert.ok(actionBody.includes("!readiness.hasFullBodyPhoto || !readiness.isReadyForTryOn"));
  });
});

describe("FL10 — the staging prototype route is untouched and kept for rollback, not called by this one", () => {
  it("this route never imports from the staging prototype module (its header comment may still mention it by name for context)", () => {
    assert.ok(!route.includes('from "~/lib/ai/staging-full-look-vto'));
    assert.ok(!route.includes('from "./api.staging-full-look-vto'));
    assert.ok(!/import[^;]*staging-full-look-vto/.test(route));
  });
});

// 2026-11-15 REGRESSION FIX — the GET loader used to pass garments: [] to
// pollFullLookOutfit on the mistaken belief that advance/poll never reads
// them. advanceFullLookChain's auto-advance-to-next-step DOES read
// ctx.garments[nextIndex] the moment the current step completes — which is
// exactly when a poll fires — so every real attempt crashed on its very
// next poll after the first step finished, making generation look
// permanently stuck. Fixed by having the loader re-derive the same real
// garments selectFullLookGarments produced when the chain was started.
describe("FL11 — the GET loader resolves real garments for poll/resume, never an empty array", () => {
  it("loader calls selectFullLookGarments on the loaded suggestion's items, the same way the action does", () => {
    const loaderBody = route.split("export async function loader")[1].split("export async function action")[0];
    assert.ok(
      loaderBody.includes("selectFullLookGarments(\n    suggestion.items"),
      "loader must resolve garments from the owned suggestion, not pass an empty array",
    );
  });

  it("loader passes the resolved garments (not a literal empty array) into pollFullLookOutfit", () => {
    const loaderBody = route.split("export async function loader")[1].split("export async function action")[0];
    const pollCallIdx = loaderBody.indexOf("pollFullLookOutfit(");
    const pollCallArgs = loaderBody.slice(pollCallIdx, pollCallIdx + 400);
    assert.ok(pollCallArgs.includes("garments,"));
    assert.ok(!pollCallArgs.includes("garments: []"));
  });

  it("an unresolvable garment set on poll/resume returns a controlled server error, never lets the raw chain functions run with bad input", () => {
    const loaderBody = route.split("export async function loader")[1].split("export async function action")[0];
    const selectionCheckIdx = loaderBody.indexOf("if (!selection)");
    const pollCallIdx = loaderBody.indexOf("pollFullLookOutfit(");
    assert.ok(selectionCheckIdx !== -1 && selectionCheckIdx < pollCallIdx, "garment selection must be validated before being used to poll");
  });
});

// 2026-11-15 — requirement: nAia must disclose, not silently hide, any
// recommended piece that didn't make it into a Full-Look chain (e.g. the
// outfit had more eligible categories than FULL_LOOK_MAX_GARMENTS). This
// is never allowed to be presented as if it were the complete look.
describe("FL12 — omitted recommended pieces are disclosed, never silently dropped", () => {
  it("loader includes omittedLabels in every response shape, computed before the completed-result short-circuit", () => {
    const loaderBody = route.split("export async function loader")[1].split("export async function action")[0];
    const selectionIdx = loaderBody.indexOf("selectFullLookGarments(");
    const existingCheckIdx = loaderBody.indexOf("findCompletedFullLookForSuggestion(");
    assert.ok(selectionIdx !== -1 && existingCheckIdx !== -1 && selectionIdx < existingCheckIdx,
      "garment selection (and therefore omittedLabels) must be computed before the completed-result check, so it's available on every branch");
    const occurrences = (loaderBody.match(/omittedLabels/g) || []).length;
    assert.ok(occurrences >= 2, "omittedLabels must appear in more than one response — both the COMPLETED short-circuit and the live poll result");
  });

  it("action includes omittedLabels in both the completed-result short-circuit and the started/resumed result", () => {
    const actionBody = route.split("export async function action")[1];
    const occurrences = (actionBody.match(/omittedLabels/g) || []).length;
    assert.ok(occurrences >= 2);
  });
});

// 2026-11-15 REGRESSION FIX — the garment-selection fingerprint must reach
// both orchestrator entry points, or a changed outfit (e.g. 3→5 pieces)
// could still resume an incompatible older attempt via whichever call
// site was missed.
describe("FL13 — the garment-selection fingerprint reaches both startFullLookOutfit and pollFullLookOutfit", () => {
  it("loader destructures fingerprint from the selection and passes it to pollFullLookOutfit", () => {
    const loaderBody = route.split("export async function loader")[1].split("export async function action")[0];
    assert.ok(/const \{ garments, omittedLabels, fingerprint \} = selection;/.test(loaderBody));
    const pollCallIdx = loaderBody.indexOf("pollFullLookOutfit(");
    const pollCallArgs = loaderBody.slice(pollCallIdx, pollCallIdx + 500);
    assert.ok(pollCallArgs.includes("fingerprint,"), "pollFullLookOutfit must receive the fingerprint as its second argument");
  });

  it("action destructures fingerprint from the selection and passes it to startFullLookOutfit", () => {
    const actionBody = route.split("export async function action")[1];
    assert.ok(/const \{ garments, omittedLabels, fingerprint \} = selection;/.test(actionBody));
    const startCallIdx = actionBody.indexOf("startFullLookOutfit(");
    const startCallArgs = actionBody.slice(startCallIdx, startCallIdx + 600);
    assert.ok(startCallArgs.includes("fingerprint,"), "startFullLookOutfit must receive the fingerprint as its second argument");
  });
});

// 2026-11-15 — a stale, never-resolved job from an earlier attempt used to
// surface as a raw HTTP 500 the moment a new attempt's cooldown check hit
// ACTIVE_JOB (see full-look-vto-orchestrator.server.ts's OrchestratorStatus
// BUSY case). "Another generation is already running" is an expected,
// temporary business condition, not a server failure — this must be a
// controlled response the client can distinguish from a real crash, not
// lumped into serverError().
describe("FL14 — a BUSY orchestrator status (ACTIVE_JOB/COOLDOWN) returns a controlled response, never the generic 500", () => {
  it("action checks result.status === \"BUSY\" before the ERROR check and returns busy(), not serverError()", () => {
    const actionBody = route.split("export async function action")[1];
    const busyCheckIdx = actionBody.indexOf('result.status === "BUSY"');
    const errorCheckIdx = actionBody.indexOf('result.status === "ERROR"');
    assert.ok(busyCheckIdx !== -1, "action must explicitly branch on a BUSY status");
    assert.ok(errorCheckIdx !== -1 && busyCheckIdx < errorCheckIdx, "BUSY must be checked before the generic ERROR fallthrough");
    const busyLine = actionBody.slice(busyCheckIdx, busyCheckIdx + 80);
    assert.ok(busyLine.includes("busy(result.reason)"), "a BUSY status must be routed to the dedicated busy() helper, not serverError()");
  });

  it("busy() returns HTTP 409, not 500 — distinguishable from a real server error", () => {
    const busyFnBody = route.split("function busy(")[1].split("function ")[0];
    assert.ok(busyFnBody.includes('status: 409'));
    assert.ok(busyFnBody.includes('code: "busy"'));
  });
});
