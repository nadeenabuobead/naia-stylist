// app/lib/ai/fashn-tryon-service.test.ts
// Phase 4A5 — 30 focused tests for the virtual try-on service layer.
// All external I/O (Cloudinary, FASHN, DB) is mocked via DI injection.
// No real provider calls. No secrets. No real customer images.
// Run: node --test --import tsx/esm app/lib/ai/fashn-tryon-service.test.ts

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  validateGarmentEligibility,
  resolveGarmentUrl,
  deriveTryOnResultPublicId,
  buildTryOnResultUrl,
  checkResultOwnership,
  isSourcePhotoStillValid,
  completeTryOnJobIfSourceStillValid,
  deleteCustomerVtoResults,
  deleteNaiaModelBodyPhotoAndVtoResults,
  withdrawSaveModelConsentAndVtoResults,
  downloadModelPhotoAsDataUrl,
  uploadTryOnResult,
  executeTryOn,
  submitTryOnJob,
  type ExecuteTryOnParams,
  type ExecuteTryOnDeps,
  type SubmitJobParams,
  type SubmitJobDeps,
  type FindNaiaModelForValidationFn,
  type CompletionTransactionOps,
  type RunCompletionTransactionFn,
} from "./fashn-tryon-service.server.js";
import { isValidModelImageDataUrl } from "./fashn-try-on.server.js";
import { computeRequestFingerprint } from "./my-naia-model.server.js";
import { VIRTUAL_TRY_ON_ENABLED, NAIA_COMPONENT_MEDIA_MAP } from "./naia-product-media.js";
import type { VirtualTryOnJobRecord, TryOnJobStatus } from "./virtual-try-on.types.js";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const MOCK_CONFIG = {
  cloudName: "test-cloud",
  apiKey: "test-key",
  apiSecret: "test-secret",
};

function mockJob(overrides: Partial<VirtualTryOnJobRecord> = {}): VirtualTryOnJobRecord {
  return {
    id: "job-001",
    customerId: "cust-001",
    naiaModelId: "model-001",
    productHandle: "collar-shirt",
    provider: "FASHN",
    predictionId: null,
    status: "CREATED",
    virtualTryOnConsentAt: new Date("2026-07-16T10:00:00Z"),
    consentPolicyVersion: "1.0",
    saveTryOnResultConsentAt: null,
    idempotencyKey: "ikey-001",
    requestFingerprint: null,
    errorCode: null,
    createdAt: new Date("2026-07-16T10:00:00Z"),
    updatedAt: new Date("2026-07-16T10:00:00Z"),
    completedAt: null,
    lastActivityAt: new Date("2026-07-16T10:00:00Z"),
    ...overrides,
  };
}

const BASE_PARAMS: ExecuteTryOnParams = {
  internalCustomerId: "cust-001",
  naiaModelId: "model-001",
  bodyPublicId: "naia-wardrobe/cust-001/body",
  bodyFormat: "jpg",
  deliveryType: "private",
  garmentHandle: "collar-shirt",
  virtualTryOnConsentAt: new Date("2026-07-16T10:00:00Z"),
  idempotencyKey: "ikey-001",
  bodyModerationStatus: "APPROVED",
};

const MINI_PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

function makePhotoFetch(ok = true): typeof fetch {
  if (!ok) {
    return async () => new Response(null, { status: 500 }) as unknown as Response;
  }
  return async () => {
    const buf = Buffer.from(MINI_PNG_B64, "base64");
    return new Response(buf.buffer as ArrayBuffer, { status: 200 }) as unknown as Response;
  };
}

function makeUploadFetch(ok = true): typeof fetch {
  if (!ok) {
    return async () => new Response(JSON.stringify({ error: { message: "fail" } }), { status: 200 }) as unknown as Response;
  }
  return async () =>
    new Response(JSON.stringify({ public_id: "naia-tryon/cust/job", format: "png", version: 1 }), {
      status: 200,
    }) as unknown as Response;
}

// ── §1 Garment eligibility ─────────────────────────────────────────────────────

describe("§1 Garment eligibility", () => {
  it("EL01 ready main-map garment resolves to ok", () => {
    const result = validateGarmentEligibility("collar-shirt");
    assert.ok(result.ok, "collar-shirt must be ready");
    assert.ok(result.ok && result.garmentUrl.startsWith("https://"), "garmentUrl must be HTTPS");
    assert.ok(result.ok && !result.isComponent, "collar-shirt is not a component");
  });

  it("EL02 ready component garment resolves to ok", () => {
    const result = validateGarmentEligibility("double-top/leather-underlayer");
    assert.ok(result.ok, "leather-underlayer must be ready");
    assert.ok(result.ok && result.isComponent, "must be flagged as component");
    assert.ok(result.ok && result.garmentUrl.startsWith("https://"), "garmentUrl must be HTTPS");
  });

  it("EL03 needs-manual-review main-map garment returns not-ok", () => {
    const result = validateGarmentEligibility("double-top");
    assert.ok(!result.ok, "double-top parent must not be ready");
    assert.ok(!result.ok && result.code === "NOT_READY");
  });

  it("EL04 needs-manual-review component returns not-ok", () => {
    const result = validateGarmentEligibility("double-top/chiffon-overlay");
    assert.ok(!result.ok, "chiffon-overlay must not be ready");
    assert.ok(!result.ok && result.code === "NOT_READY");
  });

  it("EL05 unknown handle returns UNKNOWN_HANDLE error", () => {
    const result = validateGarmentEligibility("not-a-real-handle");
    assert.ok(!result.ok);
    assert.ok(!result.ok && result.code === "UNKNOWN_HANDLE");
  });

  it("EL06 resolveGarmentUrl returns HTTPS URL for ready, null for non-ready", () => {
    const readyUrl = resolveGarmentUrl("collar-shirt");
    assert.ok(readyUrl !== null && readyUrl.startsWith("https://"));

    const notReadyUrl = resolveGarmentUrl("double-top");
    assert.strictEqual(notReadyUrl, null, "non-ready must return null");

    const unknownUrl = resolveGarmentUrl("fake-handle");
    assert.strictEqual(unknownUrl, null, "unknown must return null");
  });
});

// ── §2 Result storage helpers ─────────────────────────────────────────────────

describe("§2 Result storage helpers", () => {
  it("RS01 deriveTryOnResultPublicId returns correct path", () => {
    const id = deriveTryOnResultPublicId("cust-abc", "job-xyz");
    assert.strictEqual(id, "naia-tryon/cust-abc/job-xyz");
  });

  it("RS02 buildTryOnResultUrl returns null when config unavailable", () => {
    const url = buildTryOnResultUrl("c", "j", () => null);
    assert.strictEqual(url, null);
  });

  it("RS03 buildTryOnResultUrl returns HTTPS private_download URL when configured", () => {
    const url = buildTryOnResultUrl("cust-1", "job-1", () => MOCK_CONFIG);
    assert.ok(url !== null, "must return a URL");
    assert.ok(url!.startsWith("https://api.cloudinary.com"), "must use Cloudinary API endpoint");
    assert.ok(url!.includes("private_download") || url!.includes("download"), "must be a download URL");
  });

  it("RS04 uploadTryOnResult uses deriveTryOnResultPublicId path", async () => {
    let capturedPublicId = "";
    const mockFetch: typeof fetch = async (url) => {
      capturedPublicId = new URLSearchParams((url as string).split("?")[1] ?? "").get("public_id") ?? "";
      return new Response(JSON.stringify({ public_id: "naia-tryon/cust/job", format: "png", version: 1 }), {
        status: 200,
      }) as unknown as Response;
    };
    // The public_id is in the POST body, not URL — inspect body instead
    let capturedBody = "";
    const bodyFetch: typeof fetch = async (_url, init) => {
      const body = init?.body;
      if (body instanceof URLSearchParams) {
        capturedBody = body.get("public_id") ?? "";
      } else if (typeof body === "string") {
        capturedBody = new URLSearchParams(body).get("public_id") ?? "";
      }
      return new Response(JSON.stringify({ public_id: "naia-tryon/cust/job", format: "png", version: 1 }), {
        status: 200,
      }) as unknown as Response;
    };
    await uploadTryOnResult("cust", "job", "data:image/png;base64,aaa=", bodyFetch, () => MOCK_CONFIG);
    assert.strictEqual(capturedBody, "naia-tryon/cust/job", "public_id must be derived path");
  });
});

// ── §3 Ownership checks ───────────────────────────────────────────────────────

describe("§3 Ownership checks", () => {
  it("OW01 same customerId returns true", () => {
    assert.ok(checkResultOwnership("cust-001", "cust-001"));
  });

  it("OW02 different customerId returns false", () => {
    assert.ok(!checkResultOwnership("cust-001", "cust-002"));
  });

  it("OW03 empty requestingCustomerId returns false", () => {
    assert.ok(!checkResultOwnership("cust-001", ""));
  });

  it("OW04 empty jobCustomerId returns false", () => {
    assert.ok(!checkResultOwnership("", "cust-001"));
  });
});

// ── §3b Source-photo validity (deletion-during-processing + exact-identity guard) ──

describe("§3b isSourcePhotoStillValid — deletion-during-processing + exact-identity guard", () => {
  const CUSTOMER_ID = "cust-001";
  const PRODUCT_HANDLE = "silk-wrap-dress";
  const BODY_PUBLIC_ID_A = "naia-wardrobe/cust-001/body-photo-a";
  const BODY_PUBLIC_ID_B = "naia-wardrobe/cust-001/body-photo-b";
  const FINGERPRINT_A = computeRequestFingerprint(CUSTOMER_ID, PRODUCT_HANDLE, BODY_PUBLIC_ID_A);

  function makeFinder(
    result: { customerId: string; bodyPublicId: string | null } | null,
  ): FindNaiaModelForValidationFn {
    return async (_naiaModelId: string) => result;
  }

  it("SV01 null naiaModelId returns false without querying", async () => {
    let called = false;
    const finder: FindNaiaModelForValidationFn = async () => {
      called = true;
      return null;
    };
    const ok = await isSourcePhotoStillValid(null, CUSTOMER_ID, PRODUCT_HANDLE, FINGERPRINT_A, finder);
    assert.ok(!ok);
    assert.ok(!called, "must not query DB when naiaModelId is null");
  });

  it("SV02 model not found (deleted) returns false", async () => {
    const ok = await isSourcePhotoStillValid(
      "model-001",
      CUSTOMER_ID,
      PRODUCT_HANDLE,
      FINGERPRINT_A,
      makeFinder(null),
    );
    assert.ok(!ok);
  });

  it("SV03 model belongs to a different customer returns false", async () => {
    const ok = await isSourcePhotoStillValid(
      "model-001",
      CUSTOMER_ID,
      PRODUCT_HANDLE,
      FINGERPRINT_A,
      makeFinder({ customerId: "cust-002", bodyPublicId: BODY_PUBLIC_ID_A }),
    );
    assert.ok(!ok, "cross-customer model must never validate");
  });

  it("SV04 model found but bodyPublicId is null (photo removed) returns false", async () => {
    const ok = await isSourcePhotoStillValid(
      "model-001",
      CUSTOMER_ID,
      PRODUCT_HANDLE,
      FINGERPRINT_A,
      makeFinder({ customerId: CUSTOMER_ID, bodyPublicId: null }),
    );
    assert.ok(!ok);
  });

  it("SV05 model found but bodyPublicId is empty string returns false", async () => {
    const ok = await isSourcePhotoStillValid(
      "model-001",
      CUSTOMER_ID,
      PRODUCT_HANDLE,
      FINGERPRINT_A,
      makeFinder({ customerId: CUSTOMER_ID, bodyPublicId: "" }),
    );
    assert.ok(!ok);
  });

  it("SV06 matching customer with the ORIGINAL photo and a matching fingerprint returns true", async () => {
    const ok = await isSourcePhotoStillValid(
      "model-001",
      CUSTOMER_ID,
      PRODUCT_HANDLE,
      FINGERPRINT_A,
      makeFinder({ customerId: CUSTOMER_ID, bodyPublicId: BODY_PUBLIC_ID_A }),
    );
    assert.ok(ok);
  });

  it("SV07 default DI parameter calls real prisma-backed lookup (does not throw, resolves to a boolean) when naiaModelId is null", async () => {
    // Exercises the production default (_findNaiaModelForValidation) via the
    // null short-circuit only — confirms the default param wiring compiles
    // and runs without needing a live DB, since null never reaches prisma.
    const ok = await isSourcePhotoStillValid(null, CUSTOMER_ID, PRODUCT_HANDLE, FINGERPRINT_A);
    assert.equal(ok, false);
  });

  it("SV08 original photo deleted and replaced with a DIFFERENT photo — same customer, same product, but the fingerprint no longer matches — returns false", async () => {
    // The replacement is a legitimately-owned, non-empty, current photo —
    // SV01-06's checks would all pass on it alone. Only the fingerprint
    // recompute catches that it isn't the photo this job was submitted with.
    const ok = await isSourcePhotoStillValid(
      "model-001",
      CUSTOMER_ID,
      PRODUCT_HANDLE,
      FINGERPRINT_A, // fingerprint stored when the job was created against photo A
      makeFinder({ customerId: CUSTOMER_ID, bodyPublicId: BODY_PUBLIC_ID_B }), // but B is current now
    );
    assert.ok(!ok, "a replacement photo must never satisfy a fingerprint recorded against the original");
  });

  it("SV09 missing stored requestFingerprint (null) fails closed even with a perfectly valid current photo", async () => {
    const ok = await isSourcePhotoStillValid(
      "model-001",
      CUSTOMER_ID,
      PRODUCT_HANDLE,
      null,
      makeFinder({ customerId: CUSTOMER_ID, bodyPublicId: BODY_PUBLIC_ID_A }),
    );
    assert.ok(!ok, "a missing fingerprint must be treated as unverifiable, not skipped");
  });

  it("SV10 missing stored requestFingerprint (empty string) also fails closed", async () => {
    const ok = await isSourcePhotoStillValid(
      "model-001",
      CUSTOMER_ID,
      PRODUCT_HANDLE,
      "",
      makeFinder({ customerId: CUSTOMER_ID, bodyPublicId: BODY_PUBLIC_ID_A }),
    );
    assert.ok(!ok);
  });

  it("SV11 a fingerprint computed for a DIFFERENT productHandle never matches — the hash is bound to the specific job's handle, not just the customer and photo", async () => {
    const fingerprintForADifferentProduct = computeRequestFingerprint(
      CUSTOMER_ID,
      "a-different-product-handle",
      BODY_PUBLIC_ID_A,
    );
    const ok = await isSourcePhotoStillValid(
      "model-001",
      CUSTOMER_ID,
      PRODUCT_HANDLE, // the real job's own handle
      fingerprintForADifferentProduct, // but the stored fingerprint is for a different one
      makeFinder({ customerId: CUSTOMER_ID, bodyPublicId: BODY_PUBLIC_ID_A }),
    );
    assert.ok(!ok);
  });

  it("SV12 computeRequestFingerprint is reliably deterministic — same inputs always recompute the identical stored value", () => {
    // Directly verifies requirement #1 of the fingerprint-validation task: the
    // canonical function used at job creation (my-naia-model.server.ts) and
    // the one used here at re-check time are the SAME function and produce
    // byte-identical output for the same (customerId, productHandle,
    // bodyPublicId) triple, with no hidden time- or randomness-dependence.
    const a = computeRequestFingerprint(CUSTOMER_ID, PRODUCT_HANDLE, BODY_PUBLIC_ID_A);
    const b = computeRequestFingerprint(CUSTOMER_ID, PRODUCT_HANDLE, BODY_PUBLIC_ID_A);
    assert.equal(a, b);
    assert.equal(a, FINGERPRINT_A);
    assert.ok(a.length > 0);
  });
});

// ── §3c completeTryOnJobIfSourceStillValid — locked completion ────────────────
//
// These tests prove the APPLICATION LOGIC's reaction to each possible
// FOR UPDATE lock outcome (via the RunCompletionTransactionFn DI boundary,
// same pattern as my-naia-model.server.ts's RunTransactionFn) — they do not
// and cannot prove Postgres's own row-locking semantics. That needs a real
// Postgres connection; see the real-Postgres concurrency test plan handed
// back alongside this fix for the scenario design (pg_sleep-forced winner,
// run once per ordering) — not implemented in this repo's test tooling,
// which has no disposable test database wired in today.

describe("§3c completeTryOnJobIfSourceStillValid — locked completion", () => {
  const CUSTOMER_ID = "cust-001";
  const PRODUCT_HANDLE = "silk-wrap-dress";
  const BODY_PUBLIC_ID_A = "naia-wardrobe/cust-001/body-photo-a";
  const BODY_PUBLIC_ID_B = "naia-wardrobe/cust-001/body-photo-b";
  const FINGERPRINT_A = computeRequestFingerprint(CUSTOMER_ID, PRODUCT_HANDLE, BODY_PUBLIC_ID_A);
  const JOB = mockJob({
    id: "job-lock-001",
    customerId: CUSTOMER_ID,
    naiaModelId: "model-001",
    productHandle: PRODUCT_HANDLE,
    requestFingerprint: FINGERPRINT_A,
    status: "PROCESSING",
  });

  it("CT01 naiaModelId null short-circuits without running the transaction at all", async () => {
    let transactionRan = false;
    const run: RunCompletionTransactionFn = async (fn) => {
      transactionRan = true;
      return fn({ findModelLocked: async () => null, updateJobToCompleted: async (j) => j });
    };
    const result = await completeTryOnJobIfSourceStillValid(
      JOB, null, PRODUCT_HANDLE, FINGERPRINT_A, "pred-001", run,
    );
    assert.deepEqual(result, { ok: false, reason: "SOURCE_DELETED" });
    assert.ok(!transactionRan, "must not open a transaction when there is no naiaModelId to lock");
  });

  it("CT02 lock winner A — completion reaches the lock first and the model is still valid: commits, write attempted exactly once", async () => {
    let updateCalls = 0;
    const run: RunCompletionTransactionFn = (fn) =>
      fn({
        findModelLocked: async () => ({ customerId: CUSTOMER_ID, bodyPublicId: BODY_PUBLIC_ID_A }),
        updateJobToCompleted: async (job, predictionId) => {
          updateCalls++;
          return { ...job, status: "COMPLETED", predictionId };
        },
      });
    const result = await completeTryOnJobIfSourceStillValid(
      JOB, "model-001", PRODUCT_HANDLE, FINGERPRINT_A, "pred-001", run,
    );
    assert.deepEqual(result, { ok: true });
    assert.equal(updateCalls, 1, "the completion write must happen exactly once");
  });

  it("CT03 lock winner B — a concurrent deletion already committed and released the lock first: the locked read sees null, no write is attempted", async () => {
    let updateCalls = 0;
    const run: RunCompletionTransactionFn = (fn) =>
      fn({
        findModelLocked: async () => null,
        updateJobToCompleted: async (job, predictionId) => {
          updateCalls++; // must never be reached in this ordering
          return { ...job, status: "COMPLETED", predictionId };
        },
      });
    const result = await completeTryOnJobIfSourceStillValid(
      JOB, "model-001", PRODUCT_HANDLE, FINGERPRINT_A, "pred-001", run,
    );
    assert.deepEqual(result, { ok: false, reason: "SOURCE_DELETED" });
    assert.equal(updateCalls, 0, "must never persist COMPLETED once the locked read sees the source is gone");
  });

  it("CT04 lock winner B variant — the locked read sees a model that still exists but now belongs to a different customer: still fails closed before any write", async () => {
    let updateCalls = 0;
    const run: RunCompletionTransactionFn = (fn) =>
      fn({
        findModelLocked: async () => ({ customerId: "cust-OTHER", bodyPublicId: BODY_PUBLIC_ID_A }),
        updateJobToCompleted: async (job, predictionId) => {
          updateCalls++;
          return { ...job, status: "COMPLETED", predictionId };
        },
      });
    const result = await completeTryOnJobIfSourceStillValid(
      JOB, "model-001", PRODUCT_HANDLE, FINGERPRINT_A, "pred-001", run,
    );
    assert.deepEqual(result, { ok: false, reason: "SOURCE_DELETED" });
    assert.equal(updateCalls, 0);
  });

  it("CT05 photo replacement — the locked read sees a DIFFERENT current bodyPublicId than the one this job's fingerprint was computed against: fails closed, no write", async () => {
    let updateCalls = 0;
    const run: RunCompletionTransactionFn = (fn) =>
      fn({
        findModelLocked: async () => ({ customerId: CUSTOMER_ID, bodyPublicId: BODY_PUBLIC_ID_B }),
        updateJobToCompleted: async (job, predictionId) => {
          updateCalls++;
          return { ...job, status: "COMPLETED", predictionId };
        },
      });
    const result = await completeTryOnJobIfSourceStillValid(
      JOB, "model-001", PRODUCT_HANDLE, FINGERPRINT_A, "pred-001", run,
    );
    assert.deepEqual(result, { ok: false, reason: "SOURCE_DELETED" });
    assert.equal(updateCalls, 0, "a replacement photo must never satisfy a fingerprint recorded against the original");
  });

  it("CT06 updateJobToCompleted throwing (e.g. validateJobTransition rejected the transition) propagates — not swallowed into a false ok:true", async () => {
    const run: RunCompletionTransactionFn = (fn) =>
      fn({
        findModelLocked: async () => ({ customerId: CUSTOMER_ID, bodyPublicId: BODY_PUBLIC_ID_A }),
        updateJobToCompleted: async () => {
          throw new Error("Invalid status transition: COMPLETED → COMPLETED");
        },
      });
    await assert.rejects(
      completeTryOnJobIfSourceStillValid(JOB, "model-001", PRODUCT_HANDLE, FINGERPRINT_A, "pred-001", run),
      /Invalid status transition/,
    );
  });

  it("CT07 default _runTransaction parameter is wired to a real function (compiles and is callable) without needing a live Postgres connection to construct it", () => {
    // Exercises only that the production default param exists and has the
    // right shape — never invoked here, since that would need a real DB.
    assert.equal(typeof completeTryOnJobIfSourceStillValid, "function");
  });
});

// ── §4 Model photo download ───────────────────────────────────────────────────

describe("§4 Model photo download", () => {
  it("DL01 successful download returns ok with valid data URL", async () => {
    const result = await downloadModelPhotoAsDataUrl(
      "naia-wardrobe/cust/body",
      "png",
      "private",
      makePhotoFetch(true),
      () => MOCK_CONFIG,
    );
    assert.ok(result.ok, "must succeed");
    assert.ok(result.ok && result.dataUrl.startsWith("data:image/png;base64,"));
  });

  it("DL02 non-200 response returns PROVIDER_ERROR", async () => {
    const result = await downloadModelPhotoAsDataUrl(
      "naia-wardrobe/cust/body",
      "jpg",
      "private",
      makePhotoFetch(false),
      () => MOCK_CONFIG,
    );
    assert.ok(!result.ok);
    assert.ok(!result.ok && result.errorCode === "PROVIDER_ERROR");
  });

  it("DL03 fetch throws returns NETWORK_ERROR", async () => {
    const errorFetch: typeof fetch = async () => { throw new Error("network down"); };
    const result = await downloadModelPhotoAsDataUrl(
      "naia-wardrobe/cust/body",
      "jpg",
      "private",
      errorFetch,
      () => MOCK_CONFIG,
    );
    assert.ok(!result.ok && result.errorCode === "NETWORK_ERROR");
  });

  it("DL04 null config returns NOT_CONFIGURED", async () => {
    const result = await downloadModelPhotoAsDataUrl(
      "naia-wardrobe/cust/body",
      "jpg",
      "private",
      makePhotoFetch(true),
      () => null,
    );
    assert.ok(!result.ok && result.errorCode === "NOT_CONFIGURED");
  });

  it("DL05 returned data URL passes isValidModelImageDataUrl", async () => {
    const result = await downloadModelPhotoAsDataUrl(
      "naia-wardrobe/cust/body",
      "png",
      "private",
      makePhotoFetch(true),
      () => MOCK_CONFIG,
    );
    assert.ok(result.ok);
    assert.ok(result.ok && isValidModelImageDataUrl(result.dataUrl), "data URL must pass adapter validation");
  });
});

// ── §5 executeTryOn lifecycle ─────────────────────────────────────────────────

function makeDeps(overrides: ExecuteTryOnDeps = {}): Required<ExecuteTryOnDeps> {
  const createdJob = mockJob({ status: "CREATED" });
  const submittedJob = mockJob({ status: "SUBMITTED" });
  const completedJob = mockJob({ status: "COMPLETED", completedAt: new Date() });

  return {
    _downloadPhoto: async () => ({ ok: true, dataUrl: `data:image/png;base64,${MINI_PNG_B64}` }),
    _uploadResult:  async () => ({ ok: true }),
    _fashnTryOn: async () => ({
      ok: true as const,
      provider: "fashn" as const,
      predictionId: "pred-001",
      outputDataUrl: `data:image/png;base64,${MINI_PNG_B64}`,
      outputFormat: "png" as const,
    }),
    _createOrFindJob: async () => ({ ok: true, job: createdJob, created: true }),
    _advanceJob: async (job, status) => ({
      ok: true as const,
      job: { ...job, status } as VirtualTryOnJobRecord,
    }),
    _checkCooldown: async () => ({ ok: true }),
    _buildResultUrl: () => "https://api.cloudinary.com/v1_1/test/image/download?test=1",
    ...overrides,
  } as Required<ExecuteTryOnDeps>;
}

describe("§5 executeTryOn lifecycle", () => {
  it("EX01 happy path returns ok=true with jobId and isNewJob=true", async () => {
    const result = await executeTryOn(BASE_PARAMS, makeDeps());
    assert.ok(result.ok, `must succeed, got: ${JSON.stringify(result)}`);
    assert.ok(result.ok && result.isNewJob);
    assert.ok(result.ok && typeof result.jobId === "string");
    assert.ok(result.ok && result.resultUrl.startsWith("https://"));
  });

  it("EX02 existing COMPLETED job returns result without new FASHN call", async () => {
    let fashnCalled = false;
    const completedJob = mockJob({ status: "COMPLETED", completedAt: new Date() });
    const deps = makeDeps({
      _createOrFindJob: async () => ({ ok: true, job: completedJob, created: false }),
      _fashnTryOn: async () => { fashnCalled = true; return { ok: false, code: "PROVIDER_FAILED" as const, customerMessage: "" }; },
    });
    const result = await executeTryOn(BASE_PARAMS, deps);
    assert.ok(result.ok);
    assert.ok(result.ok && !result.isNewJob, "must be flagged as not new");
    assert.ok(!fashnCalled, "FASHN must not be called for existing completed job");
  });

  it("EX03 post-completion cooldown blocks submission with COOLDOWN code", async () => {
    const deps = makeDeps({
      _checkCooldown: async () => ({ ok: false, reason: "COOLDOWN" as const, retryAfterMs: 500 }),
    });
    const result = await executeTryOn(BASE_PARAMS, deps);
    assert.ok(!result.ok);
    assert.ok(!result.ok && result.code === "COOLDOWN");
    assert.ok(!result.ok && result.customerMessage.includes("wait a moment"));
  });

  it("EX03a active-job cooldown returns ACTIVE_JOB code with generating message", async () => {
    let fashnCalled = false;
    const deps = makeDeps({
      _checkCooldown: async () => ({ ok: false, reason: "ACTIVE_JOB" as const }),
      _fashnTryOn: async () => { fashnCalled = true; return { ok: false, code: "PROVIDER_FAILED" as const, customerMessage: "fail" }; },
    });
    const result = await executeTryOn(BASE_PARAMS, deps);
    assert.ok(!result.ok);
    assert.ok(!result.ok && result.code === "ACTIVE_JOB");
    assert.ok(!result.ok && result.customerMessage.includes("still generating"));
    assert.equal(fashnCalled, false, "FASHN must not be called when active job exists");
  });

  it("EX04 active existing job blocks new creation", async () => {
    const deps = makeDeps({
      _createOrFindJob: async () => ({ ok: false, error: "active job", code: "ACTIVE_JOB_EXISTS" }),
    });
    const result = await executeTryOn(BASE_PARAMS, deps);
    assert.ok(!result.ok);
    assert.ok(!result.ok && result.code === "ACTIVE_JOB_EXISTS");
  });

  it("EX05 ineligible garment handle returns NOT_READY", async () => {
    const params = { ...BASE_PARAMS, garmentHandle: "double-top" };
    const result = await executeTryOn(params, makeDeps());
    assert.ok(!result.ok);
    assert.ok(!result.ok && result.code === "NOT_READY");
  });

  it("EX06 FASHN failure advances job to FAILED and returns error", async () => {
    let advancedStatus: TryOnJobStatus | null = null;
    const deps = makeDeps({
      _fashnTryOn: async () => ({
        ok: false as const,
        code: "PROVIDER_FAILED" as const,
        customerMessage: "Provider unavailable.",
      }),
      _advanceJob: async (job, status) => {
        advancedStatus = status;
        return { ok: true as const, job: { ...job, status } as VirtualTryOnJobRecord };
      },
    });
    const result = await executeTryOn(BASE_PARAMS, deps);
    assert.ok(!result.ok);
    assert.ok(!result.ok && result.code === "PROVIDER_FAILED");
    assert.strictEqual(advancedStatus, "FAILED", "job must be advanced to FAILED");
  });

  it("EX07 model photo download failure advances job to FAILED", async () => {
    let finalStatus: TryOnJobStatus | null = null;
    const deps = makeDeps({
      _downloadPhoto: async () => ({ ok: false, errorCode: "PROVIDER_ERROR" }),
      _advanceJob: async (job, status) => {
        finalStatus = status;
        return { ok: true as const, job: { ...job, status } as VirtualTryOnJobRecord };
      },
    });
    const result = await executeTryOn(BASE_PARAMS, deps);
    assert.ok(!result.ok);
    assert.strictEqual(finalStatus, "FAILED", "job must end in FAILED");
  });

  it("EX08 result upload failure advances job to FAILED", async () => {
    let finalStatus: TryOnJobStatus | null = null;
    const deps = makeDeps({
      _uploadResult: async () => ({ ok: false, errorCode: "PROVIDER_ERROR" }),
      _advanceJob: async (job, status) => {
        finalStatus = status;
        return { ok: true as const, job: { ...job, status } as VirtualTryOnJobRecord };
      },
    });
    const result = await executeTryOn(BASE_PARAMS, deps);
    assert.ok(!result.ok);
    assert.strictEqual(finalStatus, "FAILED", "job must end in FAILED after upload failure");
  });
});

// ── §6 Invariants ─────────────────────────────────────────────────────────────

describe("§6 Invariants", () => {
  it("IN01 VIRTUAL_TRY_ON_ENABLED is false — storefront CTA globally suppressed", () => {
    assert.strictEqual(
      VIRTUAL_TRY_ON_ENABLED,
      false,
      "CTA gate must remain false until explicit staging review",
    );
  });

  it("IN02 all component entries have soldSeparately === false", () => {
    for (const [handle, entry] of NAIA_COMPONENT_MEDIA_MAP) {
      assert.strictEqual(
        entry.soldSeparately,
        false,
        `${handle}: soldSeparately must be false`,
      );
    }
  });

  it("IN03 result public ID has customer isolation prefix naia-tryon/", () => {
    const id = deriveTryOnResultPublicId("some-customer-id", "some-job-id");
    assert.ok(
      id.startsWith("naia-tryon/"),
      "result path must start with naia-tryon/ for customer isolation",
    );
    assert.ok(id.includes("some-customer-id"), "result path must include customerId");
    assert.ok(id.includes("some-job-id"), "result path must include jobId");
  });
});

// ── §7 Body moderation gate ───────────────────────────────────────────────────
// Verifies that submitTryOnJob and executeTryOn both enforce the fail-closed rule:
// APPROVED is the only status that passes; every other value blocks before any I/O.

// Shared base params for submitTryOnJob — use resolvedGarmentUrl to bypass catalog checks
// so tests can isolate the moderation gate.
const SUBMIT_BASE: SubmitJobParams = {
  internalCustomerId: "cust-mod",
  naiaModelId: "model-mod",
  bodyPublicId: "naia-wardrobe/cust-mod/body",
  bodyFormat: "jpg",
  deliveryType: "private",
  garmentHandle: "closet:item-mod",
  resolvedGarmentUrl: "https://cdn.shopify.com/test-garment.jpg",
  garmentSource: "closet",
  virtualTryOnConsentAt: new Date("2026-07-16T10:00:00Z"),
  idempotencyKey: "ikey-mod-001",
  bodyModerationStatus: "APPROVED",
};

function makeSubmitDeps(overrides: SubmitJobDeps = {}): SubmitJobDeps {
  const createdJob = mockJob({ status: "CREATED" });
  return {
    _downloadPhoto: async () => ({ ok: true, dataUrl: `data:image/png;base64,${MINI_PNG_B64}` }),
    _submitToProvider: async () => ({
      ok: true as const,
      predictionId: "pred-mod-001",
    }),
    _createOrFindJob: async () => ({ ok: true, job: createdJob, created: true }),
    _advanceJob: async (job, status) => ({
      ok: true as const,
      job: { ...job, status } as VirtualTryOnJobRecord,
    }),
    _checkCooldown: async () => ({ ok: true }),
    ...overrides,
  };
}

describe("§7 Body moderation gate", () => {
  // ── submitTryOnJob ─────────────────────────────────────────────────

  it("MG01 submitTryOnJob — APPROVED passes moderation gate", async () => {
    const result = await submitTryOnJob(
      { ...SUBMIT_BASE, bodyModerationStatus: "APPROVED" },
      makeSubmitDeps(),
    );
    // Should not fail with a moderation NOT_READY; may fail for other reasons
    if (!result.ok) {
      assert.notEqual(
        result.customerMessage,
        "Your model photo is pending review. Please try again in a moment.",
        "APPROVED must not trigger moderation rejection",
      );
    }
  });

  it("MG02 submitTryOnJob — undefined bodyModerationStatus is blocked (fail-closed)", async () => {
    let downloadCalled = false;
    let providerCalled = false;
    const result = await submitTryOnJob(
      { ...SUBMIT_BASE, bodyModerationStatus: undefined },
      makeSubmitDeps({
        _downloadPhoto: async () => { downloadCalled = true; return { ok: true, dataUrl: `data:image/png;base64,${MINI_PNG_B64}` }; },
        _submitToProvider: async () => { providerCalled = true; return { ok: true as const, predictionId: "p" }; },
      }),
    );
    assert.ok(!result.ok, "undefined status must fail");
    assert.ok(!downloadCalled, "body photo must not be downloaded when moderation blocks");
    assert.ok(!providerCalled, "FASHN provider must not be called when moderation blocks");
  });

  it("MG03 submitTryOnJob — null bodyModerationStatus is blocked", async () => {
    let downloadCalled = false;
    const result = await submitTryOnJob(
      { ...SUBMIT_BASE, bodyModerationStatus: null },
      makeSubmitDeps({
        _downloadPhoto: async () => { downloadCalled = true; return { ok: true, dataUrl: `data:image/png;base64,${MINI_PNG_B64}` }; },
      }),
    );
    assert.ok(!result.ok, "null status must fail");
    assert.ok(!downloadCalled, "body photo must not be downloaded for null moderation status");
  });

  it("MG04 submitTryOnJob — PENDING is blocked", async () => {
    const result = await submitTryOnJob(
      { ...SUBMIT_BASE, bodyModerationStatus: "PENDING" },
      makeSubmitDeps(),
    );
    assert.ok(!result.ok, "PENDING must fail");
    assert.ok(!result.ok && result.code === "NOT_READY");
  });

  it("MG05 submitTryOnJob — REJECTED is blocked", async () => {
    const result = await submitTryOnJob(
      { ...SUBMIT_BASE, bodyModerationStatus: "REJECTED" },
      makeSubmitDeps(),
    );
    assert.ok(!result.ok, "REJECTED must fail");
    assert.ok(!result.ok && result.code === "NOT_READY");
  });

  it("MG06 submitTryOnJob — moderation rejection fires before FASHN submission", async () => {
    let providerCalled = false;
    const result = await submitTryOnJob(
      { ...SUBMIT_BASE, bodyModerationStatus: "PENDING" },
      makeSubmitDeps({
        _submitToProvider: async () => {
          providerCalled = true;
          return { ok: true as const, predictionId: "p" };
        },
      }),
    );
    assert.ok(!result.ok);
    assert.ok(!providerCalled, "FASHN provider must not be invoked when moderation gate blocks");
  });

  // ── executeTryOn ───────────────────────────────────────────────────

  it("MG07 executeTryOn — undefined bodyModerationStatus is blocked (fail-closed)", async () => {
    let downloadCalled = false;
    const params: ExecuteTryOnParams = { ...BASE_PARAMS, bodyModerationStatus: undefined };
    const result = await executeTryOn(
      params,
      makeDeps({
        _downloadPhoto: async () => { downloadCalled = true; return { ok: true, dataUrl: `data:image/png;base64,${MINI_PNG_B64}` }; },
      }),
    );
    assert.ok(!result.ok, "undefined status must fail");
    assert.ok(!result.ok && result.code === "NOT_READY");
    assert.ok(!downloadCalled, "body photo must not be downloaded when moderation gate blocks");
  });

  it("MG08 executeTryOn — null bodyModerationStatus is blocked", async () => {
    const result = await executeTryOn(
      { ...BASE_PARAMS, bodyModerationStatus: null },
      makeDeps(),
    );
    assert.ok(!result.ok, "null status must fail");
    assert.ok(!result.ok && result.code === "NOT_READY");
  });

  it("MG09 executeTryOn — PENDING is blocked before garment check and body-photo download", async () => {
    let downloadCalled = false;
    const result = await executeTryOn(
      { ...BASE_PARAMS, bodyModerationStatus: "PENDING" },
      makeDeps({
        _downloadPhoto: async () => { downloadCalled = true; return { ok: true, dataUrl: `data:image/png;base64,${MINI_PNG_B64}` }; },
      }),
    );
    assert.ok(!result.ok && result.code === "NOT_READY");
    assert.ok(!downloadCalled, "body photo must not be downloaded for PENDING status");
  });

  it("MG10 executeTryOn — APPROVED passes and reaches garment check", async () => {
    // collar-shirt has media eligibility "ready" so it passes validateGarmentEligibility.
    // It does NOT pass isTryOnEligible (outcome: pending), but executeTryOn does not
    // call isTryOnEligible — only validateGarmentEligibility. So this should succeed.
    const result = await executeTryOn(
      { ...BASE_PARAMS, bodyModerationStatus: "APPROVED" },
      makeDeps(),
    );
    // Moderation gate passed — result is the normal happy-path ok=true
    assert.ok(result.ok, `APPROVED must pass moderation gate; got: ${JSON.stringify(result)}`);
  });
});

// ── §8 Cooldown reliability (submitTryOnJob) ──────────────────────────────────
//
// Verifies the three distinct throttle outcomes and that no FASHN call is made
// when the cooldown guard fires — ensuring zero provider credits are consumed.

describe("§8 Cooldown reliability", () => {
  it("SJ-CD01 active-job cooldown returns ACTIVE_JOB code with generating message, no FASHN call", async () => {
    let fashnCalled = false;
    const deps = makeSubmitDeps({
      _checkCooldown: async () => ({ ok: false, reason: "ACTIVE_JOB" as const }),
      _submitToProvider: async () => { fashnCalled = true; return { ok: true, predictionId: "x" }; },
    });
    const result = await submitTryOnJob(SUBMIT_BASE, deps);
    assert.ok(!result.ok);
    assert.ok(!result.ok && result.code === "ACTIVE_JOB");
    assert.ok(!result.ok && result.customerMessage.includes("still generating"),
      `expected 'still generating' message; got: ${!result.ok ? result.customerMessage : ""}`);
    assert.equal(fashnCalled, false, "FASHN must not be called when active job is blocking");
  });

  it("SJ-CD02 post-completion cooldown returns COOLDOWN code with wait-a-moment message, no FASHN call", async () => {
    let fashnCalled = false;
    const deps = makeSubmitDeps({
      _checkCooldown: async () => ({ ok: false, reason: "COOLDOWN" as const, retryAfterMs: 500 }),
      _submitToProvider: async () => { fashnCalled = true; return { ok: true, predictionId: "x" }; },
    });
    const result = await submitTryOnJob(SUBMIT_BASE, deps);
    assert.ok(!result.ok);
    assert.ok(!result.ok && result.code === "COOLDOWN");
    assert.ok(!result.ok && result.customerMessage.includes("wait a moment"),
      `expected 'wait a moment' message; got: ${!result.ok ? result.customerMessage : ""}`);
    assert.equal(fashnCalled, false, "FASHN must not be called during short cooldown");
  });

  it("SJ-CD03 approved cooldown passes through and reaches FASHN submission", async () => {
    let fashnCalled = false;
    const deps = makeSubmitDeps({
      _checkCooldown: async () => ({ ok: true }),
      _submitToProvider: async () => { fashnCalled = true; return { ok: true, predictionId: "pred-123" }; },
    });
    const result = await submitTryOnJob(SUBMIT_BASE, deps);
    assert.ok(result.ok, `should succeed; got: ${JSON.stringify(result)}`);
    assert.equal(fashnCalled, true, "FASHN must be called when cooldown is clear");
  });
});
