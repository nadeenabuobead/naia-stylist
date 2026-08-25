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
  downloadModelPhotoAsDataUrl,
  uploadTryOnResult,
  executeTryOn,
  submitTryOnJob,
  type ExecuteTryOnParams,
  type ExecuteTryOnDeps,
  type SubmitJobParams,
  type SubmitJobDeps,
} from "./fashn-tryon-service.server.js";
import { isValidModelImageDataUrl } from "./fashn-try-on.server.js";
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

  it("EX03 cooldown blocks submission", async () => {
    const deps = makeDeps({
      _checkCooldown: async () => ({ ok: false, retryAfterMs: 5000 }),
    });
    const result = await executeTryOn(BASE_PARAMS, deps);
    assert.ok(!result.ok);
    assert.ok(!result.ok && result.code === "COOLDOWN");
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
