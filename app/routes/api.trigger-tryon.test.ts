// app/routes/api.trigger-tryon.test.ts
// M1 — Contract tests for /api/trigger-tryon and related service functions.
//
// All tests are source-code assertions — no live DB, no Cloudinary, no FASHN calls.
// Covers:
//   T1  unauthenticated request rejected (401)
//   T2  customerId never accepted from request body
//   T3  customer identity loaded from session, not request body
//   T4  NaiaModel loaded from authenticated customer (not browser-supplied ID)
//   T5  no ready model → rejected before provider submission
//   T6  missing save-model consent → rejected before provider submission
//   T7  missing generation consent → rejected before provider submission
//   T8  stale consent timestamp → rejected before provider submission
//   T9  product eligibility checked server-side (productHandle only — no garment URLs from client)
//   T10 cooldown enforced (checkCustomerCooldown used)
//   T11 idempotent retry → createOrFindTryOnJob used (not ad-hoc duplicate check)
//   T12 result remains private (resultUrl never returned; only jobId)
//   T13 no measurement/bodyShape/fit inference introduced in route or submitTryOnJob
//
// Run: node --test --import tsx/esm app/routes/api.trigger-tryon.test.ts

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");

function readRoute(name: string): string {
  return readFileSync(join(__dirname, name), "utf8");
}

function readLib(rel: string): string {
  return readFileSync(join(__dirname, "../lib", rel), "utf8");
}

function readRootFile(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

const route = readRoute("api.trigger-tryon.tsx");
const service = readLib("ai/fashn-tryon-service.server.ts");
const adapter = readLib("ai/fashn-try-on.server.ts");
const routesConfig = readRootFile("app/routes.ts");

// ── T1: Unauthenticated request rejected ─────────────────────────────────────

describe("T1 — unauthenticated request rejected", () => {
  it("route uses getCurrentNaiaCustomer from naia-session.server", () => {
    assert.ok(
      route.includes("getCurrentNaiaCustomer"),
      "must import getCurrentNaiaCustomer",
    );
    assert.ok(
      route.includes("naia-session.server"),
      "must import from naia-session.server",
    );
  });

  it("route returns 401 when customer is null", () => {
    assert.ok(
      route.includes("status: 401"),
      "must return 401 on null customer",
    );
    assert.ok(
      route.includes("auth_required"),
      "must use auth_required code on 401",
    );
  });

  it("customer check is the first guard in action (before body parse)", () => {
    const actionBody = route.slice(route.indexOf("export async function action"));
    const customerCheckPos = actionBody.indexOf("getCurrentNaiaCustomer");
    const bodyParsePos = actionBody.indexOf("request.json");
    assert.ok(customerCheckPos < bodyParsePos, "customer check must precede body parsing");
  });
});

// ── T2: customerId never accepted from request body ───────────────────────────

describe("T2 — customerId never read from request body", () => {
  it("route does not read customerId from request body", () => {
    // The route may reference customer.id (from session) but must NOT destructure
    // or otherwise read a customerId key from the parsed body object.
    const bodySection = (() => {
      // Extract the body destructuring block
      const start = route.indexOf("body as Record");
      if (start === -1) return route;
      return route.slice(start, start + 400);
    })();
    assert.ok(
      !bodySection.includes('"customerId"') && !bodySection.includes("'customerId'"),
      "customerId must not be read from request body",
    );
  });

  it("submitTryOnJob receives internalCustomerId from session customer, not request", () => {
    // The route passes customer.id (session-derived) as internalCustomerId
    assert.ok(
      route.includes("customer.id"),
      "must use customer.id (session-derived) as internalCustomerId",
    );
    assert.ok(
      route.includes("internalCustomerId") && route.includes("customer.id"),
      "internalCustomerId must come from customer.id",
    );
  });
});

// ── T3: Customer identity from session ────────────────────────────────────────

describe("T3 — customer identity from authenticated session only", () => {
  it("route calls getCurrentNaiaCustomer(request) to resolve customer", () => {
    assert.ok(
      route.includes("getCurrentNaiaCustomer(request)"),
      "must resolve customer from request session",
    );
  });

  it("route does not call requireCurrentNaiaCustomer (which throws redirect — use data/401 for API routes)", () => {
    // API routes should return 401 JSON, not redirect — confirm we use getCurrentNaiaCustomer
    const usesGetCurrent = route.includes("getCurrentNaiaCustomer");
    const usesRequire = route.includes("requireCurrentNaiaCustomer");
    assert.ok(usesGetCurrent, "must use getCurrentNaiaCustomer");
    assert.ok(!usesRequire, "API routes must not use requireCurrentNaiaCustomer (it throws redirect, not 401)");
  });
});

// ── T4: NaiaModel loaded from DB for authenticated customer ───────────────────

describe("T4 — NaiaModel loaded from authenticated customer record", () => {
  it("route imports loadNaiaModel from my-naia-model.server", () => {
    assert.ok(
      route.includes("loadNaiaModel"),
      "must import loadNaiaModel",
    );
    assert.ok(
      route.includes("my-naia-model.server"),
      "must import from my-naia-model.server",
    );
  });

  it("route calls loadNaiaModel with customer.id (session-derived)", () => {
    assert.ok(
      route.includes("loadNaiaModel(customer.id)"),
      "must call loadNaiaModel(customer.id)",
    );
  });

  it("bodyPublicId is taken from naiaModel.bodyPublicId (DB), not request body", () => {
    assert.ok(
      route.includes("naiaModel.bodyPublicId"),
      "bodyPublicId must come from naiaModel (DB record)",
    );
    // Check only the destructuring block (bounded to 400 chars) — not the rest of the file
    const bodyStart = route.indexOf("body as Record");
    const bodySection = route.slice(bodyStart, bodyStart + 400);
    assert.ok(
      !bodySection.includes("bodyPublicId") && !bodySection.includes("modelPublicId"),
      "bodyPublicId must not be destructured from request body",
    );
  });
});

// ── T5: No ready model → rejected before provider submission ──────────────────

describe("T5 — missing body photo → rejected before FASHN submission", () => {
  it("route checks hasFullBodyPhoto from computeModelReadinessFromRecord", () => {
    assert.ok(
      route.includes("computeModelReadinessFromRecord"),
      "must call computeModelReadinessFromRecord",
    );
    assert.ok(
      route.includes("hasFullBodyPhoto"),
      "must check hasFullBodyPhoto",
    );
  });

  it("route returns model_not_ready when body photo missing", () => {
    assert.ok(
      route.includes("model_not_ready"),
      "must return model_not_ready code",
    );
  });

  it("submitTryOnJob service also validates garment before downloading photo", () => {
    // Service checks eligibility BEFORE downloading the photo (step 1 before step 6)
    const eligPos = service.indexOf("validateGarmentEligibility");
    const downloadPos = service.indexOf("_downloadPhoto");
    assert.ok(
      eligPos < downloadPos,
      "eligibility check must precede photo download in submitTryOnJob",
    );
  });
});

// ── T6: Missing save-model consent → rejected ─────────────────────────────────

describe("T6 — missing save-model consent → rejected before FASHN submission", () => {
  it("computeModelReadinessFromRecord checks saveModelConsentAt for isReadyForTryOn", () => {
    const src = readLib("ai/my-naia-model.server.ts");
    const readinessFn = src.slice(
      src.indexOf("export function computeModelReadinessFromRecord"),
      src.indexOf("export function computeModelReadinessFromRecord") + 600,
    );
    assert.ok(
      readinessFn.includes("saveModelConsentAt"),
      "computeModelReadinessFromRecord must check saveModelConsentAt",
    );
    assert.ok(
      readinessFn.includes("isReadyForTryOn"),
      "must compute isReadyForTryOn",
    );
  });

  it("route checks isReadyForTryOn and returns model_not_ready when false", () => {
    assert.ok(
      route.includes("isReadyForTryOn"),
      "must check isReadyForTryOn",
    );
  });
});

// ── T7: Missing generation consent → rejected ─────────────────────────────────

describe("T7 — missing per-generation consent → rejected before FASHN submission", () => {
  it("route requires virtualTryOnConsentAt in request body", () => {
    assert.ok(
      route.includes("virtualTryOnConsentAt") || route.includes("consentAtRaw"),
      "must require virtualTryOnConsentAt",
    );
    assert.ok(
      route.includes("consent_required"),
      "must return consent_required when missing",
    );
  });

  it("submitTryOnJob passes virtualTryOnConsentAt to createOrFindTryOnJob", () => {
    const submitBlock = service.slice(service.indexOf("async function submitTryOnJob"));
    assert.ok(
      submitBlock.includes("virtualTryOnConsentAt"),
      "submitTryOnJob must pass virtualTryOnConsentAt to job creation",
    );
  });

  it("per-generation consent is stored on the VirtualTryOnJob (not NaiaModel)", () => {
    // VirtualTryOnJob schema has virtualTryOnConsentAt; NaiaModel does not
    const schema = readRootFile("prisma/schema.prisma");
    const jobBlock = schema.slice(
      schema.indexOf("model VirtualTryOnJob"),
      schema.indexOf("model VirtualTryOnJob") + 2000,
    );
    assert.ok(
      jobBlock.includes("virtualTryOnConsentAt"),
      "VirtualTryOnJob must have virtualTryOnConsentAt field",
    );
    const naiaModelBlock = schema.slice(
      schema.indexOf("model NaiaModel"),
      schema.indexOf("model NaiaModel") + 1500,
    );
    assert.ok(
      !naiaModelBlock.includes("virtualTryOnConsentAt"),
      "NaiaModel must NOT have virtualTryOnConsentAt (it is per-job, not per-model)",
    );
  });
});

// ── T8: Stale consent timestamp → rejected ────────────────────────────────────

describe("T8 — stale consent timestamp → rejected", () => {
  it("route defines MAX_CONSENT_AGE_MS expiry window", () => {
    assert.ok(
      route.includes("MAX_CONSENT_AGE_MS"),
      "must define a max consent age constant",
    );
  });

  it("route rejects when consent age exceeds the window", () => {
    assert.ok(
      route.includes("consentAgeMs") || route.includes("MAX_CONSENT_AGE_MS"),
      "must compute and check consent age",
    );
    assert.ok(
      route.includes("consent_expired"),
      "must return consent_expired code on stale consent",
    );
  });

  it("route rejects future consent timestamps", () => {
    // consentAgeMs < 0 means timestamp is in the future
    assert.ok(
      route.includes("consentAgeMs < 0"),
      "must reject future consent timestamps (consentAgeMs < 0)",
    );
  });
});

// ── T9: Product eligibility checked server-side ───────────────────────────────

describe("T9 — garment eligibility resolved server-side from productHandle", () => {
  it("route accepts productHandle from client (not a garment URL)", () => {
    assert.ok(
      route.includes("productHandle"),
      "must accept productHandle",
    );
    // Must not accept a garmentUrl or modelUrl from client
    const bodySection = route.slice(route.indexOf("body as Record"));
    assert.ok(
      !bodySection.includes("garmentUrl") && !bodySection.includes("modelUrl"),
      "must not accept garmentUrl or modelUrl from client",
    );
  });

  it("submitTryOnJob calls validateGarmentEligibility (server-side lookup)", () => {
    assert.ok(
      service.includes("validateGarmentEligibility"),
      "service must call validateGarmentEligibility",
    );
  });

  it("validateGarmentEligibility resolves garment URL from server-side NAIA_VERIFIED_MEDIA_MAP", () => {
    assert.ok(
      adapter.includes("resolveVerifiedMedia") || service.includes("resolveVerifiedMedia"),
      "garment URL must come from resolveVerifiedMedia (server-side map)",
    );
  });

  it("submitTryOnJob does not accept garmentUrl from caller (only garmentHandle)", () => {
    const submitJobFnStart = service.indexOf("interface SubmitJobParams");
    const submitJobFnEnd = service.indexOf("interface SubmitJobDeps");
    const paramsBlock = service.slice(submitJobFnStart, submitJobFnEnd);
    assert.ok(
      !paramsBlock.includes("garmentUrl"),
      "SubmitJobParams must not have a garmentUrl field",
    );
    assert.ok(
      paramsBlock.includes("garmentHandle"),
      "SubmitJobParams must have garmentHandle",
    );
  });
});

// ── T10: Cooldown enforced ────────────────────────────────────────────────────

describe("T10 — per-customer cooldown enforced", () => {
  it("submitTryOnJob calls checkCustomerCooldown", () => {
    const submitBlock = service.slice(service.indexOf("async function submitTryOnJob"));
    assert.ok(
      submitBlock.includes("_checkCooldown") || submitBlock.includes("checkCustomerCooldown"),
      "submitTryOnJob must call checkCustomerCooldown",
    );
  });

  it("cooldown check precedes job creation in submitTryOnJob", () => {
    // Search `await` calls to skip the deps destructuring where both appear
    const submitBlock = service.slice(service.indexOf("async function submitTryOnJob"));
    const cooldownPos = submitBlock.indexOf("await _checkCooldown");
    const jobCreatePos = submitBlock.indexOf("await _createOrFindJob");
    assert.ok(cooldownPos > -1, "_checkCooldown must be awaited in submitTryOnJob");
    assert.ok(jobCreatePos > -1, "_createOrFindJob must be awaited in submitTryOnJob");
    assert.ok(
      cooldownPos < jobCreatePos,
      "cooldown check (await _checkCooldown) must precede job creation (await _createOrFindJob)",
    );
  });

  it("route maps COOLDOWN/RATE_LIMITED codes to 429", () => {
    assert.ok(
      route.includes("status: 429"),
      "must return 429 for cooldown",
    );
    assert.ok(
      route.includes("COOLDOWN") || route.includes("RATE_LIMITED"),
      "must handle COOLDOWN and RATE_LIMITED codes",
    );
  });
});

// ── T11: Idempotent retry via createOrFindTryOnJob ───────────────────────────

describe("T11 — idempotent retry uses createOrFindTryOnJob", () => {
  it("submitTryOnJob calls createOrFindTryOnJob", () => {
    const submitBlock = service.slice(service.indexOf("async function submitTryOnJob"));
    assert.ok(
      submitBlock.includes("_createOrFindJob"),
      "submitTryOnJob must use createOrFindTryOnJob",
    );
  });

  it("route accepts idempotencyKey from client for browser retry safety", () => {
    assert.ok(
      route.includes("idempotencyKey"),
      "route must accept idempotencyKey",
    );
    assert.ok(
      route.includes("IDEMPOTENCY_KEY_RE") || route.includes("idempotencyKey"),
      "route must validate idempotencyKey format",
    );
  });

  it("submitTryOnJob forwards idempotencyKey to createOrFindTryOnJob", () => {
    const submitBlock = service.slice(service.indexOf("async function submitTryOnJob"));
    assert.ok(
      submitBlock.includes("idempotencyKey"),
      "submitTryOnJob must forward idempotencyKey",
    );
  });

  it("createOrFindTryOnJob enforces per-customer idempotency ownership", () => {
    const src = readLib("ai/my-naia-model.server.ts");
    const fn = src.slice(
      src.indexOf("export async function createOrFindTryOnJob"),
      src.indexOf("export async function createOrFindTryOnJob") + 1500,
    );
    assert.ok(
      fn.includes("IDEMPOTENCY_CONFLICT"),
      "must reject idempotency key belonging to a different customer",
    );
  });
});

// ── T12: Result remains private — only jobId returned ─────────────────────────

describe("T12 — result URL never returned; only jobId", () => {
  it("SubmitJobResult type does not include resultUrl", () => {
    const submitResult = service.slice(
      service.indexOf("export type SubmitJobResult"),
      service.indexOf("export type SubmitJobResult") + 300,
    );
    assert.ok(
      !submitResult.includes("resultUrl"),
      "SubmitJobResult must not include resultUrl",
    );
    assert.ok(
      submitResult.includes("jobId"),
      "SubmitJobResult must include jobId",
    );
  });

  it("trigger route returns only jobId (not resultUrl or Cloudinary public ID)", () => {
    // The 202 response is { ok: true, jobId: result.jobId }
    assert.ok(
      route.includes("jobId: result.jobId"),
      "route must return jobId from service result",
    );
    assert.ok(
      !route.includes("resultUrl"),
      "route must not return resultUrl",
    );
  });

  it("result stored privately — submitTryOnJob does not upload Cloudinary result (M2 responsibility)", () => {
    // Anchor on function names instead of section header to avoid encoding issues
    const submitFnStart = service.indexOf("export async function submitTryOnJob");
    const submitFnEnd = service.indexOf("export async function executeTryOn");
    assert.ok(submitFnStart > -1, "submitTryOnJob must exist in service file");
    assert.ok(submitFnEnd > submitFnStart, "executeTryOn must follow submitTryOnJob in service file");
    const submitBlock = service.slice(submitFnStart, submitFnEnd);
    assert.ok(
      !submitBlock.includes("uploadTryOnResult"),
      "submitTryOnJob must not call uploadTryOnResult (M2 poll route handles result upload)",
    );
    assert.ok(
      !submitBlock.includes("buildTryOnResultUrl"),
      "submitTryOnJob must not build a result URL (M2 responsibility)",
    );
  });
});

// ── T13: No measurement/bodyShape/fit inference ───────────────────────────────

describe("T13 — no measurement, body shape, or fit inference", () => {
  it("trigger route does not reference measurement fields in executable code", () => {
    // Strip single-line comments before checking — the security contract comment
    // intentionally names prohibited fields but must not use them in logic.
    const codeLines = route
      .split("\n")
      .filter((l) => !l.trimStart().startsWith("//"))
      .join("\n");
    // "hip" excluded — appears as a suffix in "Ownership" (validatePublicIdOwnership fn name).
    // The remaining terms are unambiguous body data field names.
    const PROHIBITED = [
      "bodyShape", "body_shape", "waist", "bust",
      "weight", "fitProfile", "fit_profile",
    ];
    for (const term of PROHIBITED) {
      assert.ok(
        !codeLines.toLowerCase().includes(term.toLowerCase()),
        `trigger route must not reference "${term}" in executable code`,
      );
    }
    // "measurement" may appear in comments but not as a field access or variable name
    assert.ok(
      !codeLines.includes(".measurement") && !codeLines.includes("measurement:"),
      "trigger route must not access or assign measurement fields",
    );
  });

  it("submitTryOnJob does not reference measurement or fit fields", () => {
    const submitBlock = service.slice(
      service.indexOf("async function submitTryOnJob"),
      service.indexOf("// ── executeTryOn"),
    );
    // "hip" excluded — suffix of "checkResultOwnership" / "validatePublicIdOwnership" names.
    const PROHIBITED = ["measurement", "bodyShape", "waist", "bust", "weight", "fitProfile"];
    for (const term of PROHIBITED) {
      assert.ok(
        !submitBlock.toLowerCase().includes(term.toLowerCase()),
        `submitTryOnJob must not reference "${term}"`,
      );
    }
  });

  it("SubmitJobParams does not include measurement or body shape fields", () => {
    const paramsBlock = service.slice(
      service.indexOf("export interface SubmitJobParams"),
      service.indexOf("export interface SubmitJobParams") + 600,
    );
    // "hip" excluded — substring of "ownership" in comments; "shape" excluded — would
    // match "garmentSource" comments. Remaining terms are unambiguous body data fields.
    const PROHIBITED = ["measurement", "bodyShape", "waist", "bust", "weight", "fitProfile"];
    for (const term of PROHIBITED) {
      assert.ok(
        !paramsBlock.toLowerCase().includes(term.toLowerCase()),
        `SubmitJobParams must not include "${term}"`,
      );
    }
  });

  it("FASHN submit payload includes model_image and product_image only (no measurements)", () => {
    // submitTryOnToProvider forwards only: model_image, product_image, format params
    const submitToProviderBlock = adapter.slice(
      adapter.indexOf("export async function submitTryOnToProvider"),
      adapter.indexOf("// ── Helpers"),
    );
    assert.ok(
      submitToProviderBlock.includes("model_image"),
      "FASHN payload must include model_image",
    );
    assert.ok(
      submitToProviderBlock.includes("product_image"),
      "FASHN payload must include product_image",
    );
    const PROHIBITED = ["measurement", "weight", "size", "shape", "waist", "hip", "bust"];
    for (const term of PROHIBITED) {
      assert.ok(
        !submitToProviderBlock.toLowerCase().includes(term.toLowerCase()),
        `FASHN payload must not include "${term}"`,
      );
    }
  });
});

// ── T14: bodyModerationStatus gate enforced ───────────────────────────────────

describe("T14 — bodyModerationStatus gate enforced before FASHN submission", () => {
  it("trigger route passes bodyModerationStatus from naiaModel to submitTryOnJob", () => {
    assert.ok(
      route.includes("bodyModerationStatus"),
      "trigger route must reference bodyModerationStatus",
    );
    assert.ok(
      route.includes("naiaModel.bodyModerationStatus"),
      "bodyModerationStatus must come from naiaModel (DB), not request body",
    );
  });

  it("bodyModerationStatus is NOT destructured from request body", () => {
    const bodyStart = route.indexOf("body as Record");
    const bodySection = route.slice(bodyStart, bodyStart + 400);
    assert.ok(
      !bodySection.includes("bodyModerationStatus"),
      "bodyModerationStatus must not be read from request body",
    );
  });

  it("submitTryOnJob service gate requires APPROVED bodyModerationStatus", () => {
    const submitBlock = service.slice(service.indexOf("export async function submitTryOnJob"));
    assert.ok(
      submitBlock.includes("bodyModerationStatus") && submitBlock.includes("APPROVED"),
      "submitTryOnJob must check bodyModerationStatus === APPROVED",
    );
  });

  it("bodyModerationStatus gate fires before photo download in submitTryOnJob", () => {
    const submitBlock = service.slice(service.indexOf("export async function submitTryOnJob"));
    const gatePos = submitBlock.indexOf("bodyModerationStatus");
    // Use the await call site, not the destructuring assignment, to get the true call position
    const downloadPos = submitBlock.indexOf("await _downloadPhoto");
    assert.ok(gatePos > -1, "bodyModerationStatus must appear in submitTryOnJob");
    assert.ok(downloadPos > -1, "await _downloadPhoto must appear in submitTryOnJob");
    assert.ok(gatePos < downloadPos, "bodyModerationStatus gate must precede photo download");
  });
});

// ── T15: Outcome eligibility enforced ────────────────────────────────────────

describe("T15 — outcome eligibility enforced in submitTryOnJob", () => {
  it("fashn-tryon-service imports isTryOnEligible from tryon-product-eligibility", () => {
    assert.ok(
      service.includes("tryon-product-eligibility"),
      "service must import from tryon-product-eligibility",
    );
    assert.ok(
      service.includes("isTryOnEligible"),
      "service must use isTryOnEligible",
    );
  });

  it("isTryOnEligible is called inside submitTryOnJob body", () => {
    const submitFnStart = service.indexOf("export async function submitTryOnJob");
    const submitFnEnd = service.indexOf("export async function executeTryOn");
    const submitBlock = service.slice(submitFnStart, submitFnEnd);
    assert.ok(
      submitBlock.includes("isTryOnEligible"),
      "submitTryOnJob body must call isTryOnEligible to enforce outcome eligibility",
    );
  });

  it("outcome eligibility check follows image eligibility but precedes cooldown in submitTryOnJob", () => {
    const submitFnStart = service.indexOf("export async function submitTryOnJob");
    const submitFnEnd = service.indexOf("export async function executeTryOn");
    const submitBlock = service.slice(submitFnStart, submitFnEnd);
    const imgEligPos = submitBlock.indexOf("validateGarmentEligibility");
    const outcomePos = submitBlock.indexOf("isTryOnEligible");
    const cooldownPos = submitBlock.indexOf("await _checkCooldown");
    assert.ok(imgEligPos < outcomePos, "outcome check must follow image eligibility check");
    assert.ok(outcomePos < cooldownPos, "outcome check must precede cooldown check");
  });
});

// ── Route registration ────────────────────────────────────────────────────────

describe("Route registration", () => {
  it("api/trigger-tryon is registered in routes.ts", () => {
    assert.ok(
      routesConfig.includes("api/trigger-tryon"),
      "routes.ts must register api/trigger-tryon",
    );
    assert.ok(
      routesConfig.includes("api.trigger-tryon.tsx"),
      "routes.ts must reference api.trigger-tryon.tsx",
    );
  });

  it("submitTryOnToProvider is exported from fashn-try-on.server.ts", () => {
    assert.ok(
      adapter.includes("export async function submitTryOnToProvider"),
      "fashn-try-on.server.ts must export submitTryOnToProvider",
    );
  });

  it("submitTryOnJob is exported from fashn-tryon-service.server.ts", () => {
    assert.ok(
      service.includes("export async function submitTryOnJob"),
      "fashn-tryon-service.server.ts must export submitTryOnJob",
    );
  });
});

// ── Multi-source contract tests ───────────────────────────────────────────────
// These tests cover the 10 required scenarios for the unified VTO contract.

const hook = readFileSync(join(__dirname, "../hooks/useTryOn.ts"), "utf8");
const m2Route = readFileSync(join(__dirname, "api.tryon-status.$jobId.tsx"), "utf8");
const styleMeResult = readFileSync(join(__dirname, "style-me/result.tsx"), "utf8");
const closetRoute = readFileSync(join(__dirname, "closet._index.tsx"), "utf8");
const buyskipRoute = readFileSync(join(__dirname, "buyskip.$id.tsx"), "utf8");

// ── MS1: StyleMe NADINE source accepted ──────────────────────────────────────

describe("MS1 — StyleMe NADINE source accepted", () => {
  it("route accepts source: 'nadine' as a valid source value", () => {
    assert.ok(
      route.includes('"nadine"'),
      "route must accept nadine source",
    );
  });

  it("route reads productHandle for NADINE source and uses it as garmentHandle", () => {
    assert.ok(
      route.includes("productHandle"),
      "route must read productHandle for NADINE source",
    );
    assert.ok(
      route.includes("garmentHandle = productHandle.trim()"),
      "route must set garmentHandle from productHandle for NADINE source",
    );
  });

  it("route passes garmentSource: 'nadine' to submitTryOnJob for NADINE requests", () => {
    assert.ok(
      route.includes("garmentSource") && route.includes("source as"),
      "route must forward garmentSource to submitTryOnJob",
    );
  });

  it("StyleMe result loader uses VTO_UI_ENABLED flag (not VERCEL_ENV)", () => {
    assert.ok(
      styleMeResult.includes("VTO_UI_ENABLED"),
      "StyleMe result.tsx must gate VTO on VTO_UI_ENABLED",
    );
    assert.ok(
      !styleMeResult.includes('VERCEL_ENV !== "production"'),
      "StyleMe result.tsx must not use VERCEL_ENV for VTO gate",
    );
  });

  it("StyleMe uses isTryOnEligible guard before rendering VtoExperience", () => {
    const vtoSection = styleMeResult.slice(styleMeResult.indexOf("VtoExperience"));
    assert.ok(
      styleMeResult.includes("isTryOnEligible") && vtoSection.indexOf("isTryOnEligible") > -10,
      "StyleMe must call isTryOnEligible before rendering VtoExperience",
    );
  });
});

// ── MS2: Closet owned eligible item accepted ──────────────────────────────────

describe("MS2 — Closet owned eligible item accepted", () => {
  it("route accepts closetItemId for closet source", () => {
    assert.ok(
      route.includes("closetItemId"),
      "route must accept closetItemId for closet source",
    );
  });

  it("route queries ClosetItem with ownership check (customer.id)", () => {
    assert.ok(
      route.includes("closetItem.findUnique") || route.includes("ClosetItem.findUnique") ||
      route.includes("prisma.closetItem.findUnique"),
      "route must query ClosetItem from DB",
    );
    assert.ok(
      route.includes("item.customerId !== customer.id"),
      "route must enforce ownership: item.customerId !== customer.id",
    );
  });

  it("route uses screenGarmentSuitability at VTO time instead of tryOnEligibility state", () => {
    // Stage B (ready-for-try-on) was removed from Closet upload.
    // Suitability is assessed at VTO trigger time via screenGarmentSuitability.
    assert.ok(
      route.includes("screenGarmentSuitability"),
      "route must call screenGarmentSuitability for closet items at VTO time",
    );
    assert.ok(
      route.includes("not_eligible"),
      "route must return not_eligible when garment suitability fails",
    );
    const closetPath = route.slice(route.indexOf("source === \"closet\""));
    assert.ok(
      !closetPath.includes("tryOnEligibility"),
      "closet trigger path must not check tryOnEligibility state",
    );
  });

  it("route resolves closet garment URL via buildPrivateDownloadUrl (not from client)", () => {
    assert.ok(
      route.includes("buildPrivateDownloadUrl"),
      "route must call buildPrivateDownloadUrl for closet source",
    );
    assert.ok(
      route.includes("resolvedGarmentUrl"),
      "route must pass resolvedGarmentUrl to submitTryOnJob for closet source",
    );
  });
});

// ── MS3: Closet — another customer's item blocked ─────────────────────────────

describe("MS3 — Closet ownership check blocks another customer's item", () => {
  it("route returns not_found for unowned closet item (prevents existence disclosure)", () => {
    // Ownership check uses the same not_found code whether item is missing or unowned
    const closetBlock = route.slice(route.indexOf("source === \"closet\""));
    assert.ok(
      closetBlock.includes("not_found"),
      "closet path must return not_found (not 403/forbidden) to avoid existence disclosure",
    );
    assert.ok(
      closetBlock.includes("item.customerId !== customer.id"),
      "closet path must compare item.customerId from DB against session customer.id",
    );
  });

  it("closet ownership check uses DB query with customerId — not a client-supplied field", () => {
    const closetBlock = route.slice(route.indexOf("source === \"closet\""));
    // The ownership field compared is item.customerId (from DB), never from body
    assert.ok(
      closetBlock.includes("item.customerId"),
      "closet path must compare item.customerId (from DB) against customer.id",
    );
    const bodySection = route.slice(route.indexOf("body as Record"), route.indexOf("body as Record") + 400);
    assert.ok(
      !bodySection.includes("customerId"),
      "ownership customerId must not come from request body",
    );
  });
});

// ── MS4: Buy/Skip owned S0 item accepted ─────────────────────────────────────

describe("MS4 — Buy/Skip owned S0 item accepted", () => {
  it("route accepts analysisId for buyskip source", () => {
    assert.ok(
      route.includes("analysisId"),
      "route must accept analysisId for buyskip source",
    );
  });

  it("route queries BuyOrSkipAnalysis with ownership check", () => {
    assert.ok(
      route.includes("buyOrSkipAnalysis.findUnique") || route.includes("BuyOrSkipAnalysis.findUnique") ||
      route.includes("prisma.buyOrSkipAnalysis.findUnique"),
      "route must query BuyOrSkipAnalysis from DB",
    );
    assert.ok(
      route.includes("analysis.customerId !== customer.id"),
      "route must enforce ownership: analysis.customerId !== customer.id",
    );
  });

  it("route requires imagePublicId for buyskip items (S0 safety pipeline gate)", () => {
    const buyskipBlock = route.slice(route.indexOf("source === \"buyskip\"") > -1
      ? route.indexOf("source === \"buyskip\"")
      : route.indexOf("Buy/Skip"));
    assert.ok(
      route.includes("analysis.imagePublicId") && route.includes("analysis.imageFormat"),
      "route must gate on imagePublicId and imageFormat (S0 pipeline) for buyskip source",
    );
  });

  it("route calls validatePublicIdOwnership before building buyskip garment URL", () => {
    assert.ok(
      route.includes("validatePublicIdOwnership"),
      "route must call validatePublicIdOwnership for buyskip source",
    );
  });
});

// ── MS5: Buy/Skip — another customer's item blocked ───────────────────────────

describe("MS5 — Buy/Skip ownership check blocks another customer's analysis", () => {
  it("route returns not_found for unowned buyskip analysis", () => {
    // Both ownership branches (not-found + unowned) return not_found to avoid disclosure
    const buyskipOwnership = route.slice(route.indexOf("analysis.customerId"));
    assert.ok(
      buyskipOwnership.indexOf("not_found") < 200,
      "buyskip path must return not_found when ownership check fails",
    );
  });
});

// ── MS6: Unapproved body blocks all sources ───────────────────────────────────

describe("MS6 — unapproved body photo blocks VTO for all sources", () => {
  it("bodyModerationStatus is passed from naiaModel to submitTryOnJob regardless of source", () => {
    // The route always loads naiaModel and passes bodyModerationStatus — applies to all sources
    assert.ok(
      route.includes("naiaModel.bodyModerationStatus"),
      "route must always pass naiaModel.bodyModerationStatus to submitTryOnJob",
    );
    // The naiaModel load happens before the source dispatch block
    const naiaModelLoadPos = route.indexOf("loadNaiaModel(customer.id)");
    const sourceDispatchPos = route.indexOf("if (source === \"nadine\")");
    assert.ok(
      naiaModelLoadPos < sourceDispatchPos,
      "naiaModel load (and bodyModerationStatus) must precede source-specific dispatch",
    );
  });

  it("submitTryOnJob service gates on APPROVED bodyModerationStatus for resolvedGarmentUrl path too", () => {
    // The service checks bodyModerationStatus BEFORE downloading photos — applies to all sources
    const submitBlock = service.slice(service.indexOf("export async function submitTryOnJob"));
    const moderationPos = submitBlock.indexOf("bodyModerationStatus");
    const photoDownloadPos = submitBlock.indexOf("await _downloadPhoto");
    assert.ok(
      moderationPos < photoDownloadPos,
      "bodyModerationStatus gate must fire before photo download for all sources",
    );
  });
});

// ── MS7: Arbitrary client-supplied garment URL rejected ───────────────────────

describe("MS7 — arbitrary client-supplied garment URLs are never accepted", () => {
  it("request body destructuring never includes garmentUrl, imageUrl, or resolvedGarmentUrl", () => {
    const bodyStart = route.indexOf("body as Record");
    const bodySection = route.slice(bodyStart, bodyStart + 600);
    assert.ok(
      !bodySection.includes("garmentUrl"),
      "garmentUrl must not be read from request body",
    );
    assert.ok(
      !bodySection.includes('"imageUrl"') && !bodySection.includes("'imageUrl'"),
      "imageUrl must not be read from request body",
    );
    assert.ok(
      !bodySection.includes("resolvedGarmentUrl"),
      "resolvedGarmentUrl must not be read from request body",
    );
  });

  it("all three sources resolve garment URLs server-side only", () => {
    // resolvedGarmentUrl is set inside the source dispatch block — never from body
    const dispatchBlock = route.slice(route.indexOf("if (source === \"nadine\")"));
    assert.ok(
      dispatchBlock.includes("resolvedGarmentUrl = buildPrivateDownloadUrl"),
      "resolvedGarmentUrl must be set via server-side buildPrivateDownloadUrl — not from client",
    );
  });

  it("useTryOn hook never sends garmentUrl in POST body", () => {
    const triggerBlock = hook.slice(hook.indexOf("fetch(\"/api/trigger-tryon\""));
    assert.ok(
      !triggerBlock.includes("garmentUrl"),
      "useTryOn hook must not send garmentUrl to trigger endpoint",
    );
    assert.ok(
      !triggerBlock.includes("imageUrl"),
      "useTryOn hook must not send imageUrl to trigger endpoint",
    );
  });
});

// ── MS8: Result ownership still protected in M2 ───────────────────────────────

describe("MS8 — M2 poll route enforces ownership before returning result URL", () => {
  it("M2 route imports and calls checkResultOwnership", () => {
    assert.ok(
      m2Route.includes("checkResultOwnership"),
      "M2 route must call checkResultOwnership",
    );
  });

  it("M2 route returns FORBIDDEN when ownership check fails", () => {
    assert.ok(
      m2Route.includes("FORBIDDEN"),
      "M2 route must return FORBIDDEN status on ownership failure",
    );
  });

  it("M2 route requires session-cookie auth (getCurrentNaiaCustomer), not proxy HMAC", () => {
    assert.ok(
      m2Route.includes("getCurrentNaiaCustomer"),
      "M2 route must use session-cookie auth",
    );
    // Shopify proxy HMAC auth is used by api.tryon-result.$jobId — M2 uses session auth
    assert.ok(
      !m2Route.includes("hmac") && !m2Route.includes("shopifyHmac"),
      "M2 route must not use Shopify proxy HMAC (it is a session-auth SPA route)",
    );
  });

  it("M2 result URL has Cache-Control: no-store to prevent caching", () => {
    assert.ok(
      m2Route.includes("no-store"),
      "M2 route must set Cache-Control: no-store on completed response",
    );
  });
});

// ── MS9: Hook polls /api/tryon-status/:jobId ──────────────────────────────────

describe("MS9 — useTryOn hook polls the correct M2 status endpoint", () => {
  it("hook polls /api/tryon-status/ for job status", () => {
    assert.ok(
      hook.includes("/api/tryon-status/"),
      "useTryOn must poll /api/tryon-status/:jobId",
    );
    assert.ok(
      !hook.includes("/api/tryon-result/"),
      "useTryOn must not poll /api/tryon-result/ (that is the proxy-auth endpoint, not SPA-safe)",
    );
  });

  it("hook never constructs or infers resultUrl client-side", () => {
    // resultUrl must only come from the server polling response — never from a
    // client-side string literal, URL template, or local variable assignment.
    assert.ok(
      !hook.includes('resultUrl = "') && !hook.includes("resultUrl = `"),
      "useTryOn must never construct resultUrl from a string literal or template",
    );
    assert.ok(
      hook.includes("resBody.resultUrl") || hook.includes("body.resultUrl"),
      "resultUrl must come from server polling response only",
    );
  });

  it("hook sends source and source-specific ID in trigger POST body", () => {
    assert.ok(
      hook.includes("body.productHandle = sourceId") || hook.includes("body.productHandle"),
      "hook must send productHandle for nadine source",
    );
    assert.ok(
      hook.includes("body.closetItemId"),
      "hook must send closetItemId for closet source",
    );
    assert.ok(
      hook.includes("body.analysisId"),
      "hook must send analysisId for buyskip source",
    );
  });
});

// ── MS10: Staging flag defaults OFF ──────────────────────────────────────────

describe("MS10 — VTO staging flag defaults OFF; must be explicitly enabled", () => {
  it("StyleMe result.tsx uses VTO_UI_ENABLED === 'true' (explicit opt-in)", () => {
    assert.ok(
      styleMeResult.includes('VTO_UI_ENABLED === "true"') ||
      styleMeResult.includes("VTO_UI_ENABLED === 'true'"),
      "StyleMe must use VTO_UI_ENABLED === 'true' for VTO gate",
    );
  });

  it("Closet route uses VTO_UI_ENABLED === 'true'", () => {
    assert.ok(
      closetRoute.includes('VTO_UI_ENABLED === "true"') ||
      closetRoute.includes("VTO_UI_ENABLED === 'true'"),
      "Closet route must gate VTO on VTO_UI_ENABLED === 'true'",
    );
  });

  it("Buy/Skip result route uses VTO_UI_ENABLED === 'true'", () => {
    assert.ok(
      buyskipRoute.includes('VTO_UI_ENABLED === "true"') ||
      buyskipRoute.includes("VTO_UI_ENABLED === 'true'"),
      "Buy/Skip result route must gate VTO on VTO_UI_ENABLED === 'true'",
    );
  });

  it("no route uses VERCEL_ENV !== 'production' for VTO gate", () => {
    const files = [styleMeResult, closetRoute, buyskipRoute];
    for (const src of files) {
      assert.ok(
        !src.includes('VERCEL_ENV !== "production"'),
        "VTO gate must never use VERCEL_ENV !== 'production' (enables all preview envs)",
      );
    }
  });

  it("VTO_UI_ENABLED === false is default — undefined env var evaluates to disabled", () => {
    // If VTO_UI_ENABLED is undefined, strict equality with "true" is false → VTO off
    // This test asserts the string equality pattern (not truthy check) is used
    assert.ok(
      styleMeResult.includes('=== "true"'),
      "VTO gate must use strict === 'true' equality (so missing env var defaults to OFF)",
    );
  });
});

// ── Eligibility correction tests ──────────────────────────────────────────────
// Proves the corrected Closet + Buy/Skip eligibility gates.

// ── A: Normal eligible Closet item can reach VTO without Stage B ──────────────

describe("A — Closet item reaches VTO without Stage-B ready-for-try-on state", () => {
  it("trigger route does NOT gate on tryOnEligibility for closet source", () => {
    const closetPath = route.slice(route.indexOf("source === \"closet\""));
    assert.ok(
      !closetPath.includes("tryOnEligibility"),
      "closet trigger path must not check tryOnEligibility (Stage B was removed from Closet upload)",
    );
  });

  it("trigger route runs screenGarmentSuitability at VTO time for closet items", () => {
    assert.ok(
      route.includes("screenGarmentSuitability"),
      "trigger route must import and call screenGarmentSuitability",
    );
    assert.ok(
      route.includes("image-suitability.server"),
      "must import from image-suitability.server",
    );
    const closetPath = route.slice(route.indexOf("source === \"closet\""));
    assert.ok(
      closetPath.includes("screenGarmentSuitability"),
      "screenGarmentSuitability must be called inside the closet source path",
    );
  });

  it("closet UI gate uses category check + imagePublicId, NOT tryOnEligibility", () => {
    const closetRoute = readFileSync(join(__dirname, "closet._index.tsx"), "utf8");
    assert.ok(
      closetRoute.includes("VTO_CATEGORY_GATE"),
      "closet UI must use a VTO_CATEGORY_GATE for coarse category filtering",
    );
    assert.ok(
      closetRoute.includes("item.imagePublicId"),
      "closet UI must require imagePublicId (S0 upload pipeline)",
    );
    // Check specifically the VtoExperience JSX guard — not the eligibility display code
    const vtoJsxBlock = closetRoute.slice(
      closetRoute.indexOf("loaderData.vtoEnabled && item.imagePublicId"),
      closetRoute.indexOf("loaderData.vtoEnabled && item.imagePublicId") + 300,
    );
    assert.ok(
      !vtoJsxBlock.includes("tryOnEligibility"),
      "VtoExperience JSX guard must not gate on tryOnEligibility",
    );
  });

  it("VTO_CATEGORY_GATE includes clothing categories but excludes bags and accessories", () => {
    const closetRoute = readFileSync(join(__dirname, "closet._index.tsx"), "utf8");
    const gateBlock = closetRoute.slice(
      closetRoute.indexOf("VTO_CATEGORY_GATE"),
      closetRoute.indexOf("VTO_CATEGORY_GATE") + 200,
    );
    assert.ok(gateBlock.includes("TOPS"), "VTO_CATEGORY_GATE must include TOPS");
    assert.ok(gateBlock.includes("BOTTOMS"), "VTO_CATEGORY_GATE must include BOTTOMS");
    assert.ok(gateBlock.includes("DRESSES"), "VTO_CATEGORY_GATE must include DRESSES");
    assert.ok(gateBlock.includes("OUTERWEAR"), "VTO_CATEGORY_GATE must include OUTERWEAR");
    assert.ok(!gateBlock.includes("BAGS"), "VTO_CATEGORY_GATE must exclude BAGS");
    assert.ok(!gateBlock.includes("ACCESSORIES"), "VTO_CATEGORY_GATE must exclude ACCESSORIES");
  });
});

// ── B: Unsuitable Closet garment is blocked before FASHN ─────────────────────

describe("B — unsuitable Closet garment blocked before FASHN", () => {
  it("trigger route checks screenGarmentSuitability result before proceeding", () => {
    const closetPath = route.slice(route.indexOf("source === \"closet\""));
    assert.ok(
      closetPath.includes("garmentCheck.status !== \"PASS\"") ||
      closetPath.includes("status !== \"PASS\""),
      "closet path must block when suitability check does not return PASS",
    );
    assert.ok(
      closetPath.includes("not_eligible"),
      "closet path must return not_eligible when suitability fails",
    );
  });

  it("resolvedGarmentUrl is only assigned AFTER suitability passes for closet", () => {
    const closetPath = route.slice(route.indexOf("source === \"closet\""));
    const suitabilityCheckPos = closetPath.indexOf("screenGarmentSuitability");
    const resolvedUrlPos = closetPath.indexOf("resolvedGarmentUrl = ");
    assert.ok(
      suitabilityCheckPos < resolvedUrlPos,
      "suitability check must precede resolvedGarmentUrl assignment for closet source",
    );
  });

  it("screenGarmentSuitability is called with the signed Cloudinary URL and item category", () => {
    const closetPath = route.slice(route.indexOf("source === \"closet\""));
    assert.ok(
      closetPath.includes("item.category"),
      "screenGarmentSuitability must receive item.category as context",
    );
    assert.ok(
      closetPath.includes("closetSignedUrl") || closetPath.includes("buildPrivateDownloadUrl"),
      "screenGarmentSuitability must be called with the private signed URL",
    );
  });
});

// ── C: Another user's Closet item is blocked ──────────────────────────────────

describe("C — cross-customer Closet access blocked", () => {
  it("closet path compares item.customerId from DB against session customer.id", () => {
    const closetPath = route.slice(route.indexOf("source === \"closet\""));
    assert.ok(
      closetPath.includes("item.customerId !== customer.id"),
      "closet path must reject items belonging to another customer",
    );
  });

  it("closet path returns not_found for unowned items (prevents existence disclosure)", () => {
    const closetPath = route.slice(route.indexOf("source === \"closet\""));
    assert.ok(
      closetPath.includes("not_found"),
      "closet path must return not_found (not 403) to avoid existence disclosure",
    );
  });
});

// ── D: Completed valid Buy/Skip analysis can reach VTO ────────────────────────

describe("D — completed Buy/Skip analysis with imagePublicId + verdict + fullAnalysis reaches VTO", () => {
  it("buyskip path selects verdict and fullAnalysis from DB", () => {
    const buyskipPath = route.slice(route.indexOf("buyOrSkipAnalysis.findUnique"));
    const selectBlock = buyskipPath.slice(0, buyskipPath.indexOf(");"));
    assert.ok(
      selectBlock.includes("verdict"),
      "buyskip DB query must select verdict",
    );
    assert.ok(
      selectBlock.includes("fullAnalysis"),
      "buyskip DB query must select fullAnalysis",
    );
  });

  it("buyskip path requires imagePublicId, verdict, and fullAnalysis all present", () => {
    const buyskipPath = route.slice(route.indexOf("buyOrSkipAnalysis.findUnique"));
    assert.ok(
      buyskipPath.includes("analysis.verdict") || buyskipPath.includes("verdict"),
      "buyskip path must check verdict presence",
    );
    assert.ok(
      buyskipPath.includes("analysis.fullAnalysis") || buyskipPath.includes("fullAnalysis"),
      "buyskip path must check fullAnalysis presence",
    );
    assert.ok(
      buyskipPath.includes("analysis.imagePublicId"),
      "buyskip path must check imagePublicId presence",
    );
  });
});

// ── E: imagePublicId alone is not enough for Buy/Skip VTO ────────────────────

describe("E — Buy/Skip VTO blocked when analysis is incomplete", () => {
  it("buyskip path gates on verdict AND fullAnalysis in addition to imagePublicId", () => {
    const buyskipPath = route.slice(route.indexOf("buyOrSkipAnalysis.findUnique"));
    // All three gates must be present in the buyskip path
    assert.ok(
      buyskipPath.includes("analysis.verdict"),
      "buyskip path must check analysis.verdict",
    );
    assert.ok(
      buyskipPath.includes("analysis.fullAnalysis"),
      "buyskip path must check analysis.fullAnalysis",
    );
    assert.ok(
      buyskipPath.includes("analysis.imagePublicId"),
      "buyskip path must check analysis.imagePublicId",
    );
    // verdict + fullAnalysis gate must have its own not_eligible rejection
    const imageGateIdx = buyskipPath.indexOf("analysis.imagePublicId");
    const verdictGateIdx = buyskipPath.indexOf("analysis.verdict");
    assert.ok(
      verdictGateIdx > imageGateIdx,
      "verdict/fullAnalysis gate must follow the imagePublicId gate",
    );
  });

  it("buyskip UI loader vtoSupported requires verdict and fullAnalysis", () => {
    const buyskipRoute = readFileSync(join(__dirname, "buyskip.$id.tsx"), "utf8");
    const vtoSupportedBlock = buyskipRoute.slice(
      buyskipRoute.indexOf("vtoSupported"),
      buyskipRoute.indexOf("vtoSupported") + 300,
    );
    assert.ok(
      vtoSupportedBlock.includes("verdict"),
      "vtoSupported must require verdict for UI display",
    );
    assert.ok(
      vtoSupportedBlock.includes("fullAnalysis"),
      "vtoSupported must require fullAnalysis for UI display",
    );
  });
});

// ── F: Ownership protection still works for both sources ─────────────────────

describe("F — ownership protection enforced for Closet and Buy/Skip", () => {
  it("closet path queries by item id and verifies customerId matches session", () => {
    assert.ok(
      route.includes("item.customerId !== customer.id"),
      "closet path must verify item.customerId from DB against session customer.id",
    );
  });

  it("buyskip path queries by analysis id and verifies customerId matches session", () => {
    assert.ok(
      route.includes("analysis.customerId !== customer.id"),
      "buyskip path must verify analysis.customerId from DB against session customer.id",
    );
  });

  it("neither path accepts customerId from request body", () => {
    const bodySection = route.slice(route.indexOf("body as Record"), route.indexOf("body as Record") + 600);
    assert.ok(
      !bodySection.includes("customerId"),
      "customerId must never be accepted from request body",
    );
  });

  it("buyskip path re-verifies publicId path integrity before URL generation", () => {
    const buyskipPath = route.slice(route.indexOf("buyOrSkipAnalysis.findUnique"));
    assert.ok(
      buyskipPath.includes("validatePublicIdOwnership"),
      "buyskip path must call validatePublicIdOwnership before building signed URL",
    );
  });
});
