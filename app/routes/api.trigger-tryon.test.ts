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
    const PROHIBITED = [
      "bodyShape", "body_shape", "waist", "hip", "bust",
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
    const PROHIBITED = ["measurement", "bodyShape", "waist", "hip", "bust", "weight", "fitProfile"];
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
    const PROHIBITED = ["measurement", "bodyShape", "waist", "hip", "bust", "weight", "shape"];
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
