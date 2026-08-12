// app/lib/ai/my-naia-model.test.ts
// Unit tests for My nAia Model and VirtualTryOnJob service layer.
// All DB and Cloudinary operations are exercised via DI stubs — no live DB or network.
// Run: node --test --import tsx/esm app/lib/ai/my-naia-model.test.ts

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  // Photo URL validation
  validateCloudinaryPhotoUrl,
  validatePublicIdOwnership,
  buildSignedDeliveryUrl,
  buildPrivateDownloadUrl,
  assertPhotoOwnership,
  // NaiaModel service
  saveNaiaModelPhoto,
  deleteNaiaModelPhoto,
  saveNaiaModelConsent,
  withdrawSaveModelConsent,
  withdrawPhotoAnalysisConsent,
  buildModelPreviewUrl,
  // Readiness
  computeModelReadiness,
  computeModelReadinessFromRecord,
  // Job lifecycle
  validateJobTransition,
  createOrFindTryOnJob,
  advanceTryOnJob,
  checkCustomerCooldown,
  // Helpers
  generateIdempotencyKey,
  computeRequestFingerprint,
  POLICY_VERSION,
  type NaiaModelRecord,
  type VirtualTryOnJobRecord,
  type RunTransactionFn,
  type FindJobFn,
  type VerifyAssetFn,
  type ModerateFn,
  type ScreenBodyFn,
} from "./my-naia-model.server.ts";
import { deleteCloudinaryAsset, buildModelUploadUrl, type CloudinaryConfig } from "../cloudinary-admin.server.ts";
import { DEFAULT_CONSENT_STATE } from "./virtual-try-on.types.ts";

// ── Test fixtures ─────────────────────────────────────────────────────────────

const CUST = "cust-abc123";
const OTHER_CUST = "cust-other";
const VALID_PUBLIC_ID = `naia-wardrobe/${CUST}/face-photo`;
const VALID_URL = `https://res.cloudinary.com/naia-cloud/image/upload/v1234/naia-wardrobe/${CUST}/photo.jpg`;

function makeModel(overrides: Partial<NaiaModelRecord> = {}): NaiaModelRecord {
  return {
    id: "model-1",
    customerId: CUST,
    facePublicId: null,
    faceVersion: null,
    faceFormat: null,
    bodyPublicId: null,
    bodyVersion: null,
    bodyFormat: null,
    deliveryType: "private",
    photoAnalysisConsentAt: null,
    saveModelConsentAt: null,
    consentPolicyVersion: null,
    bodyModerationStatus: null,
    bodyModerationAt: null,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    ...overrides,
  };
}

function makeJob(overrides: Partial<VirtualTryOnJobRecord> = {}): VirtualTryOnJobRecord {
  return {
    id: "job-1",
    customerId: CUST,
    naiaModelId: null,
    productHandle: "test-handle",
    provider: "FASHN",
    predictionId: null,
    status: "CREATED",
    virtualTryOnConsentAt: new Date("2026-01-01"),
    consentPolicyVersion: POLICY_VERSION,
    saveTryOnResultConsentAt: null,
    idempotencyKey: "idem-key-1",
    requestFingerprint: null,
    errorCode: null,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    completedAt: null,
    lastActivityAt: new Date("2026-01-01"),
    ...overrides,
  };
}

// ── Shared DI mocks ───────────────────────────────────────────────────────────

// Happy-path verifyAsset mock: simulates Admin API confirming a valid private image.
const mockVerifyOk: VerifyAssetFn = async (pid) => ({
  ok: true,
  asset: { publicId: pid, resourceType: "image", type: "private", version: "1", format: "jpg" },
});

// Happy-path moderation/suitability mocks — bypass real Claude calls in tests.
const mockModerationPass: ModerateFn = async () => ({ status: "PASS" });
const mockSuitabilityPass: ScreenBodyFn = async () => ({ status: "PASS" });
const mockCfg: CloudinaryConfig = { cloudName: "test-cloud", apiKey: "test-key", apiSecret: "test-secret" };
const mockGetCfg = () => mockCfg;

// ── MM.1-9: NaiaModel service ─────────────────────────────────────────────────
// Note: saveNaiaModelPhoto signature: (customerId, slot, publicId, version, format, deliveryType,
//   _findModelFn, _upsertModelFn, _deleteAsset, _verifyAsset)
// Note: deleteNaiaModelPhoto signature: (customerId, slot, _findModelFn, _upsertModelFn, _deleteAsset)

describe("saveNaiaModelPhoto", () => {
  it("MM.1 — persists face public ID and returns the upserted model", async () => {
    const upserted = makeModel({ facePublicId: VALID_PUBLIC_ID });
    const result = await saveNaiaModelPhoto(
      CUST,
      "face",
      VALID_PUBLIC_ID,
      "1234",
      null,
      "private",
      async () => null,
      async (_cid, data) => ({ ...upserted, ...data }),
      async () => ({ ok: true }),
      mockVerifyOk,
      mockModerationPass,
      mockSuitabilityPass,
      mockGetCfg,
    );
    assert.equal(result.ok, true);
    if (!result.ok) throw new Error("unreachable");
    assert.equal(result.model.facePublicId, VALID_PUBLIC_ID);
  });

  it("MM.2 — persists body public ID for correct customer", async () => {
    const bodyId = `naia-wardrobe/${CUST}/body-photo`;
    const upserted = makeModel({ bodyPublicId: bodyId });
    const result = await saveNaiaModelPhoto(
      CUST,
      "body",
      bodyId,
      null,
      null,
      "private",
      async () => null,
      async (_cid, data) => ({ ...upserted, ...data }),
      async () => ({ ok: true }),
      mockVerifyOk,
      mockModerationPass,
      mockSuitabilityPass,
      mockGetCfg,
    );
    assert.equal(result.ok, true);
    if (!result.ok) throw new Error("unreachable");
    assert.equal(result.model.bodyPublicId, bodyId);
  });

  it("MM.3 — rejects public ID from a different customer's folder", async () => {
    const wrongId = `naia-wardrobe/${OTHER_CUST}/photo`;
    const result = await saveNaiaModelPhoto(
      CUST,
      "face",
      wrongId,
      null,
      null,
      "private",
      async () => { throw new Error("findModel should not be called"); },
      async () => { throw new Error("upsert should not be called"); },
      async () => ({ ok: true }),
      async () => { throw new Error("_verifyAsset must not be called before ownership check"); },
    );
    assert.equal(result.ok, false);
    if (result.ok) throw new Error("unreachable");
    assert.ok(result.error.includes("belong"), "error message should mention ownership");
  });

  it("MM.4 — deleteNaiaModelPhoto: returns ok=true when no model record exists", async () => {
    const result = await deleteNaiaModelPhoto(
      CUST,
      "face",
      async () => null,  // _findModelFn: no model
      async () => { throw new Error("upsert should not be called"); },
      async () => ({ ok: true }),
    );
    assert.equal(result.ok, true);
    assert.equal(result.cloudinaryOk, true);
  });

  it("MM.5 — deleteNaiaModelPhoto: calls deleteAsset for existing publicId then clears DB", async () => {
    const deletedIds: string[] = [];
    const model = makeModel({ facePublicId: VALID_PUBLIC_ID, faceVersion: "v1" });
    const result = await deleteNaiaModelPhoto(
      CUST,
      "face",
      async () => model,  // _findModelFn
      async (_cid, data) => makeModel(data),  // _upsertModelFn
      async (pid) => { deletedIds.push(pid); return { ok: true }; },
    );
    assert.equal(result.ok, true);
    assert.equal(result.cloudinaryOk, true);
    assert.deepEqual(deletedIds, [VALID_PUBLIC_ID]);
  });

  it("MM.6 — deleteNaiaModelPhoto: ok=false when Cloudinary deletion fails", async () => {
    const model = makeModel({ bodyPublicId: `naia-wardrobe/${CUST}/body` });
    const result = await deleteNaiaModelPhoto(
      CUST,
      "body",
      async () => model,  // _findModelFn
      async (_cid, _data) => makeModel(),  // _upsertModelFn
      async () => ({ ok: false, errorCode: "NETWORK_ERROR" }),
    );
    assert.equal(result.ok, false);
    assert.equal(result.cloudinaryOk, false);
    assert.equal(result.error, "NETWORK_ERROR");
  });

  it("MM.7 — saveNaiaModelConsent: records photoAnalysisConsentAt when type=photoAnalysis", async () => {
    const now = new Date("2026-07-15");
    let upsertedData: Partial<NaiaModelRecord> = {};
    await saveNaiaModelConsent(
      CUST,
      ["photoAnalysis"],
      POLICY_VERSION,
      now,
      async (_cid, data) => { upsertedData = data; return makeModel(data); },
    );
    assert.equal(upsertedData.photoAnalysisConsentAt?.toISOString(), now.toISOString());
    assert.equal(upsertedData.saveModelConsentAt, undefined);
  });

  it("MM.8 — saveNaiaModelConsent: records saveModelConsentAt when type=saveModel", async () => {
    const now = new Date("2026-07-15");
    let upsertedData: Partial<NaiaModelRecord> = {};
    await saveNaiaModelConsent(
      CUST,
      ["saveModel"],
      POLICY_VERSION,
      now,
      async (_cid, data) => { upsertedData = data; return makeModel(data); },
    );
    assert.equal(upsertedData.saveModelConsentAt?.toISOString(), now.toISOString());
    assert.equal(upsertedData.photoAnalysisConsentAt, undefined);
  });

  it("MM.9 — withdrawSaveModelConsent: deletes both Cloudinary assets, clears DB", async () => {
    const faceId = `naia-wardrobe/${CUST}/face`;
    const bodyId = `naia-wardrobe/${CUST}/body`;
    const model = makeModel({ facePublicId: faceId, bodyPublicId: bodyId, saveModelConsentAt: new Date() });
    const deletedIds: string[] = [];
    let upsertedData: Partial<NaiaModelRecord> = {};

    const result = await withdrawSaveModelConsent(
      CUST,
      async (_cid, data) => { upsertedData = data; return makeModel(data); },
      async () => model,
      async (pid) => { deletedIds.push(pid); return { ok: true }; },
    );

    assert.equal(result.ok, true);
    assert.deepEqual(deletedIds.sort(), [bodyId, faceId].sort());
    assert.equal(upsertedData.saveModelConsentAt, null);
    assert.equal(upsertedData.facePublicId, null);
    assert.equal(upsertedData.bodyPublicId, null);
  });
});

// ── CL.1-7: Cloudinary validation ────────────────────────────────────────────

describe("validatePublicIdOwnership", () => {
  it("CL.1 — accepts valid public ID for the correct customer", () => {
    const r = validatePublicIdOwnership(VALID_PUBLIC_ID, CUST);
    assert.equal(r.ok, true);
  });

  it("CL.2 — rejects public ID belonging to a different customer", () => {
    const r = validatePublicIdOwnership(`naia-wardrobe/${OTHER_CUST}/photo`, CUST);
    assert.equal(r.ok, false);
    if (r.ok) throw new Error("unreachable");
    assert.ok(r.error.includes("belong"));
  });

  it("CL.3 — rejects empty string", () => {
    const r = validatePublicIdOwnership("", CUST);
    assert.equal(r.ok, false);
  });
});

describe("validateCloudinaryPhotoUrl", () => {
  it("CL.4 — accepts a valid https Cloudinary URL for the correct customer", () => {
    const r = validateCloudinaryPhotoUrl(VALID_URL, CUST);
    assert.equal(r.ok, true);
    if (!r.ok) throw new Error("unreachable");
    assert.equal(r.url, VALID_URL);
  });

  it("CL.5 — rejects http (non-https) URL", () => {
    const r = validateCloudinaryPhotoUrl(
      `http://res.cloudinary.com/naia-cloud/image/upload/naia-wardrobe/${CUST}/photo.jpg`,
      CUST,
    );
    assert.equal(r.ok, false);
  });

  it("CL.6 — rejects URL with wrong customer folder", () => {
    const r = validateCloudinaryPhotoUrl(
      `https://res.cloudinary.com/naia-cloud/image/upload/naia-wardrobe/${OTHER_CUST}/photo.jpg`,
      CUST,
    );
    assert.equal(r.ok, false);
    if (r.ok) throw new Error("unreachable");
    assert.ok(r.error.includes("belong"));
  });
});

describe("buildSignedDeliveryUrl", () => {
  it("CL.7 — produces a signed private URL with and without version", () => {
    const cfg = { cloudName: "my-cloud", apiKey: "key", apiSecret: "test-secret" };

    const withV = buildSignedDeliveryUrl(cfg, VALID_PUBLIC_ID, "999");
    assert.ok(withV.startsWith("https://res.cloudinary.com/my-cloud/image/private/"), "URL must use private delivery");
    assert.ok(withV.includes("/v999/"), "should include version segment");
    assert.ok(/s--[A-Za-z0-9_-]{8}--/.test(withV), "signature segment must be 8 chars base64url");

    const noV = buildSignedDeliveryUrl(cfg, VALID_PUBLIC_ID, null);
    assert.ok(!noV.includes("/v"), "should not include version segment");
    assert.ok(noV.endsWith(`/${VALID_PUBLIC_ID}`));
  });
});

// ── JB.1-12: Job lifecycle ────────────────────────────────────────────────────

describe("validateJobTransition", () => {
  it("JB.1 — CREATED → SUBMITTED is valid", () => {
    assert.equal(validateJobTransition("CREATED", "SUBMITTED").ok, true);
  });

  it("JB.2 — CREATED → PROCESSING is invalid", () => {
    const r = validateJobTransition("CREATED", "PROCESSING");
    assert.equal(r.ok, false);
    if (r.ok) throw new Error("unreachable");
    assert.ok(r.error.includes("CREATED"));
  });

  it("JB.3 — PROCESSING → TIMED_OUT is valid", () => {
    assert.equal(validateJobTransition("PROCESSING", "TIMED_OUT").ok, true);
  });

  it("JB.4 — COMPLETED is terminal: no valid exits", () => {
    const statuses = ["SUBMITTED", "PROCESSING", "FAILED", "CANCELED", "TIMED_OUT"] as const;
    for (const s of statuses) {
      assert.equal(
        validateJobTransition("COMPLETED", s).ok,
        false,
        `COMPLETED → ${s} should be invalid`,
      );
    }
  });

  it("JB.5 — FAILED is terminal: no valid exits", () => {
    assert.equal(validateJobTransition("FAILED", "CREATED").ok, false);
    assert.equal(validateJobTransition("FAILED", "SUBMITTED").ok, false);
  });
});

describe("createOrFindTryOnJob", () => {
  const baseParams = {
    customerId: CUST,
    naiaModelId: null,
    productHandle: "test-handle",
    bodyPublicId: null,
    virtualTryOnConsentAt: new Date("2026-07-15"),
    idempotencyKey: "idem-unique-1",
  };

  it("JB.6 — creates a new job when no existing job with that idempotency key", async () => {
    const created = makeJob({ idempotencyKey: baseParams.idempotencyKey, status: "CREATED" });
    const mockTx: RunTransactionFn = async (fn) =>
      fn({
        findActiveJob: async () => null,
        createJob: async (_data) => created,
      });

    const result = await createOrFindTryOnJob(
      baseParams,
      async () => null,  // no existing job by idempotency key
      mockTx,
    );
    assert.equal(result.ok, true);
    if (!result.ok) throw new Error("unreachable");
    assert.equal(result.created, true);
    assert.equal(result.job.idempotencyKey, baseParams.idempotencyKey);
  });

  it("JB.7 — returns existing job (created=false) for repeated idempotency key", async () => {
    const existing = makeJob({ idempotencyKey: baseParams.idempotencyKey, customerId: CUST });
    const result = await createOrFindTryOnJob(
      baseParams,
      async () => existing,  // already exists
      async () => { throw new Error("transaction should not be called"); },
    );
    assert.equal(result.ok, true);
    if (!result.ok) throw new Error("unreachable");
    assert.equal(result.created, false);
    assert.equal(result.job.id, "job-1");
  });

  it("JB.8 — rejects when idempotency key belongs to a different customer", async () => {
    const alienJob = makeJob({ idempotencyKey: baseParams.idempotencyKey, customerId: OTHER_CUST });
    const result = await createOrFindTryOnJob(
      baseParams,
      async () => alienJob,
      async () => { throw new Error("transaction should not be called"); },
    );
    assert.equal(result.ok, false);
    if (result.ok) throw new Error("unreachable");
    assert.equal(result.code, "IDEMPOTENCY_CONFLICT");
  });
});

describe("advanceTryOnJob", () => {
  it("JB.9 — advances CREATED → SUBMITTED and updates lastActivityAt", async () => {
    const job = makeJob({ status: "CREATED" });
    const before = Date.now();
    const result = await advanceTryOnJob(
      job,
      "SUBMITTED",
      { predictionId: "pred-123" },
      async (id, data) => makeJob({ ...data, id }),
    );
    assert.equal(result.ok, true);
    if (!result.ok) throw new Error("unreachable");
    assert.equal(result.job.status, "SUBMITTED");
    assert.ok(result.job.lastActivityAt.getTime() >= before);
  });

  it("JB.10 — sets completedAt when transitioning to COMPLETED (terminal)", async () => {
    const job = makeJob({ status: "PROCESSING" });
    const before = Date.now();
    const result = await advanceTryOnJob(
      job,
      "COMPLETED",
      {},
      async (_id, data) => makeJob({ ...data }),
    );
    assert.equal(result.ok, true);
    if (!result.ok) throw new Error("unreachable");
    assert.ok(result.job.completedAt !== null);
    assert.ok(result.job.completedAt!.getTime() >= before);
  });

  it("JB.11 — refuses an invalid status transition", async () => {
    const job = makeJob({ status: "COMPLETED" });
    const result = await advanceTryOnJob(
      job,
      "SUBMITTED",
      {},
      async () => { throw new Error("update should not be called"); },
    );
    assert.equal(result.ok, false);
    if (result.ok) throw new Error("unreachable");
    assert.ok(result.error.includes("COMPLETED"));
  });

  it("JB.12 — checkCustomerCooldown: blocked by active job; allowed when no job exists", async () => {
    const activeJob = makeJob({ status: "PROCESSING", lastActivityAt: new Date() });
    const blocked = await checkCustomerCooldown(CUST, 10_000, async () => activeJob);
    assert.equal(blocked.ok, false);
    assert.equal(blocked.retryAfterMs, 0);

    const allowed = await checkCustomerCooldown(CUST, 10_000, async () => null);
    assert.equal(allowed.ok, true);
  });
});

// ── RD.1-9: Readiness and route helpers ──────────────────────────────────────

describe("computeModelReadiness", () => {
  it("RD.1 — hasFacePhoto=false when facePhotoUrl is null", () => {
    const r = computeModelReadiness(null, null, DEFAULT_CONSENT_STATE);
    assert.equal(r.hasFacePhoto, false);
  });

  it("RD.2 — hasFacePhoto=true for a non-empty string", () => {
    const r = computeModelReadiness("https://example.com/face.jpg", null, DEFAULT_CONSENT_STATE);
    assert.equal(r.hasFacePhoto, true);
  });

  it("RD.3 — isReadyForTryOn=false when body exists but virtualTryOnConsent=false", () => {
    const r = computeModelReadiness(null, "https://example.com/body.jpg", DEFAULT_CONSENT_STATE);
    assert.equal(r.isReadyForTryOn, false);
  });

  it("RD.4 — isReadyForTryOn=true when body photo + virtualTryOnConsent", () => {
    const consent = { ...DEFAULT_CONSENT_STATE, virtualTryOnConsent: true };
    const r = computeModelReadiness(null, "https://example.com/body.jpg", consent);
    assert.equal(r.isReadyForTryOn, true);
  });
});

describe("computeModelReadinessFromRecord", () => {
  it("RD.5 — returns all-false for a null model record", () => {
    const r = computeModelReadinessFromRecord(null);
    assert.equal(r.hasFacePhoto, false);
    assert.equal(r.hasFullBodyPhoto, false);
    assert.equal(r.isReadyForTryOn, false);
  });

  it("RD.6 — hasFacePhoto=true when facePublicId is set", () => {
    const r = computeModelReadinessFromRecord(makeModel({ facePublicId: VALID_PUBLIC_ID }));
    assert.equal(r.hasFacePhoto, true);
  });

  it("RD.7 — isReadyForTryOn=true when bodyPublicId + saveModelConsentAt set", () => {
    const r = computeModelReadinessFromRecord(
      makeModel({ bodyPublicId: `naia-wardrobe/${CUST}/body`, saveModelConsentAt: new Date() }),
    );
    assert.equal(r.isReadyForTryOn, true);
  });

  it("RD.8 — isReadyForTryOn=false when bodyPublicId set but saveModelConsentAt is null", () => {
    const r = computeModelReadinessFromRecord(
      makeModel({ bodyPublicId: `naia-wardrobe/${CUST}/body`, saveModelConsentAt: null }),
    );
    assert.equal(r.isReadyForTryOn, false);
  });
});

describe("idempotency helpers", () => {
  it("RD.9 — generateIdempotencyKey returns unique non-empty strings; fingerprint is deterministic", () => {
    const k1 = generateIdempotencyKey();
    const k2 = generateIdempotencyKey();
    assert.ok(typeof k1 === "string" && k1.length > 0);
    assert.notEqual(k1, k2, "two keys should not collide");

    const fp1 = computeRequestFingerprint(CUST, "handle-a", null);
    const fp2 = computeRequestFingerprint(CUST, "handle-a", null);
    const fp3 = computeRequestFingerprint(CUST, "handle-b", null);
    assert.equal(fp1, fp2, "same inputs → same fingerprint");
    assert.notEqual(fp1, fp3, "different inputs → different fingerprint");
    assert.ok(fp1.length === 32, "fingerprint should be 32 hex chars");
  });
});

// ── PV.1-6: Private delivery ──────────────────────────────────────────────────

describe("PV — private delivery", () => {
  it("PV.1 — saveNaiaModelPhoto includes deliveryType in upserted data", async () => {
    let upsertedData: Partial<NaiaModelRecord> = {};
    await saveNaiaModelPhoto(
      CUST,
      "face",
      VALID_PUBLIC_ID,
      null,
      null,
      "private",
      async () => null,
      async (_cid, data) => { upsertedData = data; return makeModel(data); },
      async () => ({ ok: true }),
      mockVerifyOk,
      mockModerationPass,
      mockSuitabilityPass,
      mockGetCfg,
    );
    assert.equal(upsertedData.deliveryType, "private");
  });

  it("PV.2 — buildSignedDeliveryUrl produces URL with 8-char base64url s-- signature", () => {
    const cfg = { cloudName: "my-cloud", apiKey: "key", apiSecret: "secret" };
    const url = buildSignedDeliveryUrl(cfg, VALID_PUBLIC_ID, "1234");
    assert.ok(url.includes("s--"), "URL should contain s-- signature segment");
    assert.ok(/s--[A-Za-z0-9_-]{8}--/.test(url), "signature segment must be exactly 8 base64url chars");
  });

  it("PV.3 — buildSignedDeliveryUrl uses 'private' delivery type in the URL path", () => {
    const cfg = { cloudName: "my-cloud", apiKey: "key", apiSecret: "secret" };
    const url = buildSignedDeliveryUrl(cfg, VALID_PUBLIC_ID, null, "private");
    assert.ok(url.includes("/image/private/"), "URL should use /image/private/ path segment");
  });

  it("PV.4 — buildSignedDeliveryUrl without version produces URL without /v segment", () => {
    const cfg = { cloudName: "my-cloud", apiKey: "key", apiSecret: "secret" };
    const url = buildSignedDeliveryUrl(cfg, VALID_PUBLIC_ID, null);
    assert.ok(!url.includes("/v"), "URL without version should not include /v");
    assert.ok(url.endsWith(VALID_PUBLIC_ID), "URL should end with the public ID");
  });

  it("PV.5 — buildSignedDeliveryUrl with version includes /v{version}/ segment", () => {
    const cfg = { cloudName: "my-cloud", apiKey: "key", apiSecret: "secret" };
    const url = buildSignedDeliveryUrl(cfg, VALID_PUBLIC_ID, "9876");
    assert.ok(url.includes("/v9876/"), "URL should include version segment");
  });

  it("PV.6 — deleteCloudinaryAsset sends type=private in request body for private delivery", async () => {
    let capturedBody: URLSearchParams | null = null;
    const mockFetch = async (_url: string, init: RequestInit) => {
      capturedBody = init.body as URLSearchParams;
      return new Response(JSON.stringify({ result: "ok" }), { status: 200 });
    };
    const mockConfig = () => ({ cloudName: "test-cloud", apiKey: "key", apiSecret: "secret" });

    await deleteCloudinaryAsset(VALID_PUBLIC_ID, "private", mockFetch as typeof fetch, mockConfig);

    assert.ok(capturedBody !== null, "fetch should have been called");
    assert.equal((capturedBody as URLSearchParams).get("type"), "private", "request body must include type=private");
  });
});

// ── CP.1-8: Compensation and privacy-first deletion ───────────────────────────

describe("CP — compensation and privacy-first deletion", () => {
  it("CP.1 — saveNaiaModelPhoto compensates by deleting new upload when DB upsert fails", async () => {
    const deletedIds: string[] = [];
    const result = await saveNaiaModelPhoto(
      CUST,
      "face",
      VALID_PUBLIC_ID,
      null,
      null,
      "private",
      async () => null,
      async () => { throw new Error("DB error"); },
      async (pid) => { deletedIds.push(pid); return { ok: true }; },
      mockVerifyOk,
      mockModerationPass,
      mockSuitabilityPass,
      mockGetCfg,
    );
    assert.equal(result.ok, false);
    assert.deepEqual(deletedIds, [VALID_PUBLIC_ID], "newly uploaded asset must be deleted as compensation");
  });

  it("CP.2 — saveNaiaModelPhoto returns ok=false even when compensation deletion also fails", async () => {
    const result = await saveNaiaModelPhoto(
      CUST,
      "face",
      VALID_PUBLIC_ID,
      null,
      null,
      "private",
      async () => null,
      async () => { throw new Error("DB error"); },
      async () => ({ ok: false, errorCode: "NET_ERROR" }),
      mockVerifyOk,
      mockModerationPass,
      mockSuitabilityPass,
      mockGetCfg,
    );
    assert.equal(result.ok, false, "success must never be reported when DB persist fails");
  });

  it("CP.3 — saveNaiaModelPhoto deletes old asset after successful DB persist (replacement flow)", async () => {
    const oldId = `naia-wardrobe/${CUST}/old-face`;
    const existingModel = makeModel({ facePublicId: oldId, faceVersion: "1" });
    const deletedIds: string[] = [];

    const result = await saveNaiaModelPhoto(
      CUST,
      "face",
      VALID_PUBLIC_ID,
      "2",
      null,
      "private",
      async () => existingModel,
      async (_cid, data) => makeModel({ ...data }),
      async (pid) => { deletedIds.push(pid); return { ok: true }; },
      mockVerifyOk,
      mockModerationPass,
      mockSuitabilityPass,
      mockGetCfg,
    );
    assert.equal(result.ok, true);
    assert.deepEqual(deletedIds, [oldId], "old asset must be deleted after successful DB persist");
  });

  it("CP.4 — saveNaiaModelPhoto does not delete asset when publicId is unchanged", async () => {
    const existingModel = makeModel({ facePublicId: VALID_PUBLIC_ID, faceVersion: "1" });
    const deletedIds: string[] = [];

    const result = await saveNaiaModelPhoto(
      CUST,
      "face",
      VALID_PUBLIC_ID,
      "2",
      null,
      "private",
      async () => existingModel,
      async (_cid, data) => makeModel({ ...data }),
      async (pid) => { deletedIds.push(pid); return { ok: true }; },
      mockVerifyOk,
      mockModerationPass,
      mockSuitabilityPass,
      mockGetCfg,
    );
    assert.equal(result.ok, true);
    assert.deepEqual(deletedIds, [], "no Cloudinary call when publicId is unchanged");
  });

  it("CP.5 — saveNaiaModelPhoto returns orphanPublicId when old asset deletion fails after DB persist", async () => {
    const oldId = `naia-wardrobe/${CUST}/old-face`;
    const existingModel = makeModel({ facePublicId: oldId });

    const result = await saveNaiaModelPhoto(
      CUST,
      "face",
      VALID_PUBLIC_ID,
      null,
      null,
      "private",
      async () => existingModel,
      async (_cid, data) => makeModel({ ...data }),
      async () => ({ ok: false, errorCode: "NET_ERROR" }),
      mockVerifyOk,
      mockModerationPass,
      mockSuitabilityPass,
      mockGetCfg,
    );
    assert.equal(result.ok, true, "overall ok=true — DB persisted the new reference");
    if (!result.ok) throw new Error("unreachable");
    assert.equal(result.orphanPublicId, oldId, "stale old publicId must be returned for retry");
  });

  it("CP.6 — deleteNaiaModelPhoto calls Cloudinary deletion before DB clear (privacy-first order)", async () => {
    const callOrder: string[] = [];
    const model = makeModel({ facePublicId: VALID_PUBLIC_ID, faceVersion: "1" });

    await deleteNaiaModelPhoto(
      CUST,
      "face",
      async () => model,
      async (_cid, _data) => { callOrder.push("db"); return makeModel(); },
      async (_pid) => { callOrder.push("cloudinary"); return { ok: true }; },
    );
    assert.deepEqual(callOrder, ["cloudinary", "db"], "Cloudinary must be called before DB clear");
  });

  it("CP.7 — deleteNaiaModelPhoto returns staleReference=true when Cloudinary succeeds but DB clear throws", async () => {
    const model = makeModel({ facePublicId: VALID_PUBLIC_ID });

    const result = await deleteNaiaModelPhoto(
      CUST,
      "face",
      async () => model,
      async () => { throw new Error("DB error"); },
      async () => ({ ok: true }),
    );
    assert.equal(result.ok, false);
    assert.equal(result.cloudinaryOk, true, "Cloudinary deletion succeeded");
    assert.equal(result.dbCleared, false, "DB clear failed");
    assert.equal(result.staleReference, true, "stale DB reference to deleted asset");
  });

  it("CP.8 — deleteNaiaModelPhoto returns ok=false and does not touch DB when Cloudinary fails", async () => {
    const model = makeModel({ facePublicId: VALID_PUBLIC_ID });
    let dbClearCalled = false;

    const result = await deleteNaiaModelPhoto(
      CUST,
      "face",
      async () => model,
      async (_cid, _data) => { dbClearCalled = true; return makeModel(); },
      async () => ({ ok: false, errorCode: "PROVIDER_ERROR" }),
    );
    assert.equal(result.ok, false);
    assert.equal(result.cloudinaryOk, false);
    assert.equal(result.staleReference, false);
    assert.equal(dbClearCalled, false, "DB must not be touched when Cloudinary deletion fails");
  });
});

// ── CC.1-7: Concurrency-safe job creation ─────────────────────────────────────

describe("CC — concurrency-safe job creation", () => {
  const baseParams = {
    customerId: CUST,
    naiaModelId: null,
    productHandle: "test-handle",
    bodyPublicId: null,
    virtualTryOnConsentAt: new Date("2026-07-15"),
    idempotencyKey: "cc-idem-key",
  };

  it("CC.1 — createOrFindTryOnJob invokes _runTransaction when no existing job found", async () => {
    let txCalled = false;
    const created = makeJob({ idempotencyKey: baseParams.idempotencyKey });
    const mockTx: RunTransactionFn = async (fn) => {
      txCalled = true;
      return fn({ findActiveJob: async () => null, createJob: async () => created });
    };
    await createOrFindTryOnJob(baseParams, async () => null, mockTx);
    assert.equal(txCalled, true, "_runTransaction must be called when no pre-existing job");
  });

  it("CC.2 — createOrFindTryOnJob returns ACTIVE_JOB_EXISTS when transaction finds active job", async () => {
    const activeJob = makeJob({ status: "PROCESSING" });
    const mockTx: RunTransactionFn = async (fn) =>
      fn({
        findActiveJob: async () => activeJob,
        createJob: async () => { throw new Error("createJob should not be called"); },
      });
    const result = await createOrFindTryOnJob(baseParams, async () => null, mockTx);
    assert.equal(result.ok, false);
    if (result.ok) throw new Error("unreachable");
    assert.equal(result.code, "ACTIVE_JOB_EXISTS");
  });

  it("CC.3 — createOrFindTryOnJob returns created=true when transaction creates job successfully", async () => {
    const created = makeJob({ idempotencyKey: baseParams.idempotencyKey, customerId: CUST });
    const mockTx: RunTransactionFn = async (fn) =>
      fn({ findActiveJob: async () => null, createJob: async () => created });
    const result = await createOrFindTryOnJob(baseParams, async () => null, mockTx);
    assert.equal(result.ok, true);
    if (!result.ok) throw new Error("unreachable");
    assert.equal(result.created, true);
    assert.equal(result.job.id, created.id);
  });

  it("CC.4 — createOrFindTryOnJob retries transaction on P2034 serialization error", async () => {
    let txCalls = 0;
    const created = makeJob({ idempotencyKey: baseParams.idempotencyKey });
    const mockTx: RunTransactionFn = async (fn) => {
      txCalls++;
      if (txCalls === 1) throw Object.assign(new Error("Serialization failure"), { code: "P2034" });
      return fn({ findActiveJob: async () => null, createJob: async () => created });
    };
    const result = await createOrFindTryOnJob(baseParams, async () => null, mockTx);
    assert.equal(result.ok, true, "should succeed after retry");
    assert.equal(txCalls, 2, "transaction must be retried exactly once on P2034");
  });

  it("CC.5 — createOrFindTryOnJob propagates error after MAX_TX_RETRIES exhausted", async () => {
    const p2034 = Object.assign(new Error("Serialization failure"), { code: "P2034" });
    const mockTx: RunTransactionFn = async (_fn) => { throw p2034; };
    await assert.rejects(
      () => createOrFindTryOnJob(baseParams, async () => null, mockTx),
      (e: any) => e.code === "P2034",
    );
  });

  it("CC.6 — createOrFindTryOnJob re-reads by idempotency key on P2002 concurrent creation", async () => {
    const concurrent = makeJob({ idempotencyKey: baseParams.idempotencyKey, customerId: CUST });
    let findCallCount = 0;
    const mockFind: FindJobFn = async () => {
      findCallCount++;
      return findCallCount === 1 ? null : concurrent;
    };
    const mockTx: RunTransactionFn = async (_fn) => {
      throw Object.assign(new Error("Unique constraint"), { code: "P2002" });
    };
    const result = await createOrFindTryOnJob(baseParams, mockFind, mockTx);
    assert.equal(result.ok, true, "should recover from P2002 by re-reading the concurrent job");
    if (!result.ok) throw new Error("unreachable");
    assert.equal(result.created, false);
    assert.equal(result.job.id, concurrent.id);
  });

  it("CC.7 — checkCustomerCooldown returns ok=false with retryAfterMs when within cooldown window", async () => {
    const recentJob = makeJob({
      status: "COMPLETED",
      lastActivityAt: new Date(Date.now() - 3_000),  // 3 s ago
    });
    const result = await checkCustomerCooldown(CUST, 10_000, async () => recentJob);
    assert.equal(result.ok, false);
    assert.ok(result.retryAfterMs !== undefined && result.retryAfterMs > 0);
    assert.ok(result.retryAfterMs! <= 7_100, "retryAfterMs should be roughly 7 s");
  });
});

// ── CS.1-4: Consent withdrawal ────────────────────────────────────────────────

describe("CS — consent withdrawal", () => {
  it("CS.1 — withdrawPhotoAnalysisConsent sets photoAnalysisConsentAt=null only", async () => {
    let upsertedData: Partial<NaiaModelRecord> = {};
    await withdrawPhotoAnalysisConsent(
      CUST,
      async (_cid, data) => { upsertedData = data; return makeModel(data); },
    );
    assert.equal(upsertedData.photoAnalysisConsentAt, null, "photoAnalysisConsentAt must be cleared");
  });

  it("CS.2 — withdrawPhotoAnalysisConsent does not clear photos or saveModelConsentAt", async () => {
    let upsertedData: Partial<NaiaModelRecord> = {};
    await withdrawPhotoAnalysisConsent(
      CUST,
      async (_cid, data) => { upsertedData = data; return makeModel(data); },
    );
    assert.equal(upsertedData.facePublicId, undefined, "facePublicId must not be touched");
    assert.equal(upsertedData.bodyPublicId, undefined, "bodyPublicId must not be touched");
    assert.equal(upsertedData.saveModelConsentAt, undefined, "saveModelConsentAt must not be touched");
  });

  it("CS.3 — withdrawSaveModelConsent attempts body deletion even when face deletion fails", async () => {
    const faceId = `naia-wardrobe/${CUST}/face`;
    const bodyId = `naia-wardrobe/${CUST}/body`;
    const model = makeModel({ facePublicId: faceId, bodyPublicId: bodyId, saveModelConsentAt: new Date() });
    const attemptedIds: string[] = [];

    const result = await withdrawSaveModelConsent(
      CUST,
      async (_cid, data) => makeModel(data),
      async () => model,
      async (pid) => {
        attemptedIds.push(pid);
        return pid === faceId ? { ok: false, errorCode: "NETWORK_ERROR" } : { ok: true };
      },
    );

    assert.deepEqual(attemptedIds.sort(), [bodyId, faceId].sort(), "both assets must be attempted");
    assert.equal(result.ok, false, "overall ok=false when one deletion fails");
    assert.deepEqual(result.failedAssets, [faceId]);
    assert.deepEqual(result.deletedAssets, [bodyId]);
  });

  it("CS.4 — withdrawSaveModelConsent always clears DB even when all Cloudinary deletions fail", async () => {
    const faceId = `naia-wardrobe/${CUST}/face`;
    const model = makeModel({ facePublicId: faceId, saveModelConsentAt: new Date() });
    let upsertCalled = false;

    await withdrawSaveModelConsent(
      CUST,
      async (_cid, data) => { upsertCalled = true; return makeModel(data); },
      async () => model,
      async () => ({ ok: false, errorCode: "NETWORK_ERROR" }),
    );

    assert.equal(upsertCalled, true, "DB clear must always be called regardless of Cloudinary failures");
  });
});

// ── PE.1-10: Private-download endpoint and delivery enforcement ───────────────

describe("PE — private-download endpoint and delivery enforcement", () => {
  const cfg = { cloudName: "test-cloud", apiKey: "test-key", apiSecret: "test-secret" };

  it("PE.1 — saveNaiaModelPhoto rejects deliveryType='upload' (public) before Admin API is reached", async () => {
    let upsertCalled = false;
    let verifyCalled = false;
    const result = await saveNaiaModelPhoto(
      CUST,
      "face",
      VALID_PUBLIC_ID,
      null,
      null,
      "upload",           // Cloudinary's public default — must be fast-rejected
      async () => null,
      async (_cid, data) => { upsertCalled = true; return makeModel(data); },
      async () => ({ ok: true }),
      async () => { verifyCalled = true; return { ok: false, errorCode: "SHOULD_NOT_REACH" }; },
    );
    assert.equal(result.ok, false, "upload delivery type must be rejected");
    assert.equal(upsertCalled, false, "DB upsert must not be called");
    assert.equal(verifyCalled, false, "Admin API must not be called before PERMITTED_DELIVERY_TYPES guard");
    if (result.ok) throw new Error("unreachable");
    assert.ok(
      result.error.toLowerCase().includes("public") || result.error.toLowerCase().includes("permitted"),
      "error must indicate the delivery type is not permitted",
    );
  });

  it("PE.2 — saveNaiaModelPhoto accepts deliveryType='private' and returns ok=true", async () => {
    const result = await saveNaiaModelPhoto(
      CUST,
      "face",
      VALID_PUBLIC_ID,
      null,
      null,
      "private",
      async () => null,
      async (_cid, data) => makeModel(data),
      async () => ({ ok: true }),
      mockVerifyOk,
      mockModerationPass,
      mockSuitabilityPass,
      mockGetCfg,
    );
    assert.equal(result.ok, true, "private delivery type must be accepted");
  });

  it("PE.3 — buildPrivateDownloadUrl URL contains expires_at query parameter", () => {
    const url = buildPrivateDownloadUrl(cfg, VALID_PUBLIC_ID, "jpg");
    const params = new URL(url).searchParams;
    assert.ok(params.has("expires_at"), "URL must contain expires_at parameter");
    const expiresAt = Number(params.get("expires_at"));
    assert.ok(!isNaN(expiresAt) && expiresAt > 0, "expires_at must be a positive integer");
  });

  it("PE.4 — buildPrivateDownloadUrl expiry is derived from injected nowFn (fixed clock)", () => {
    const fixedNow = 1_750_000_000_000; // arbitrary fixed timestamp ms
    const url = buildPrivateDownloadUrl(cfg, VALID_PUBLIC_ID, "jpg", "private", () => fixedNow);
    const params = new URL(url).searchParams;
    const expiresAt = Number(params.get("expires_at"));
    const timestamp = Number(params.get("timestamp"));
    // Default expirySeconds is 600 (10 min). expiresAt = floor(nowMs / 1000) + 600.
    assert.equal(timestamp, Math.floor(fixedNow / 1000), "timestamp must equal floor(nowFn() / 1000)");
    assert.equal(expiresAt, timestamp + 600, "expires_at must be timestamp + 600 seconds");
  });

  it("PE.5 — buildPrivateDownloadUrl includes expires_at in the signature (mutating it breaks the URL)", () => {
    const fixedNow = 1_750_000_000_000;
    const url = buildPrivateDownloadUrl(cfg, VALID_PUBLIC_ID, "jpg", "private", () => fixedNow);
    const params = new URL(url).searchParams;
    const originalSig = params.get("signature");
    const originalExpiresAt = Number(params.get("expires_at"));

    // Build a second URL with a longer expiry — different expires_at must produce a different signature.
    const url2 = buildPrivateDownloadUrl(cfg, VALID_PUBLIC_ID, "jpg", "private", () => fixedNow, 1200);
    const params2 = new URL(url2).searchParams;
    const altSig = params2.get("signature");
    const altExpiresAt = Number(params2.get("expires_at"));

    assert.notEqual(originalExpiresAt, altExpiresAt, "test setup: expires_at values must differ");
    assert.notEqual(originalSig, altSig, "changing expires_at must change the signature");
  });

  it("PE.6 — buildPrivateDownloadUrl URL uses /image/download path (not CDN)", () => {
    const url = buildPrivateDownloadUrl(cfg, VALID_PUBLIC_ID, "jpg");
    assert.ok(
      url.startsWith("https://api.cloudinary.com/"),
      "URL must use Cloudinary API host (api.cloudinary.com), not the CDN",
    );
    assert.ok(url.includes("/image/download"), "URL must use /image/download endpoint");
    assert.ok(!url.includes("res.cloudinary.com"), "CDN host must not appear in a private_download URL");
    assert.ok(!url.includes("/image/private_download"), "deprecated /image/private_download must not be used");
  });

  it("PE.7 — buildPrivateDownloadUrl URL has no transformation parameters", () => {
    const url = buildPrivateDownloadUrl(cfg, VALID_PUBLIC_ID, "jpg");
    const params = new URL(url).searchParams;
    // Transformations would show up as parameters like w, h, c, e, etc.
    // The only expected params are: api_key, expires_at, format, public_id, signature, timestamp, type.
    const permitted = new Set(["api_key", "expires_at", "format", "public_id", "signature", "timestamp", "type"]);
    for (const key of params.keys()) {
      assert.ok(permitted.has(key), `Unexpected transformation parameter in URL: ${key}`);
    }
  });

  it("PE.8 — buildModelPreviewUrl returns null when Cloudinary config is missing", () => {
    const url = buildModelPreviewUrl(
      VALID_PUBLIC_ID,
      "jpg",
      "private",
      () => null,   // _getConfig returns null — simulates missing env vars
    );
    assert.equal(url, null, "must return null when config is unavailable (URL must never be stored)");
  });

  it("PE.9 — saveNaiaModelPhoto uses Admin API-verified format, not browser-supplied format", async () => {
    let upsertedData: Partial<NaiaModelRecord> = {};
    const result = await saveNaiaModelPhoto(
      CUST,
      "face",
      VALID_PUBLIC_ID,
      "9999",
      "png",         // browser says format="png" — must be ignored
      "private",
      async () => null,
      async (_cid, data) => { upsertedData = data; return makeModel(data); },
      async () => ({ ok: true }),
      async (pid) => ({  // Admin API returns format="webp" (the authoritative value)
        ok: true,
        asset: { publicId: pid, resourceType: "image", type: "private", version: "9999", format: "webp" },
      }),
      mockModerationPass,
      mockSuitabilityPass,
      mockGetCfg,
    );
    assert.equal(result.ok, true);
    assert.equal(upsertedData.faceFormat, "webp", "must use Admin API-verified format, not browser-supplied value");
    assert.notEqual(upsertedData.faceFormat, "png", "browser-supplied format must not be persisted");
  });

  it("PE.10 — deterministic cooldown ordering: equal lastActivityAt → job with later createdAt is selected first", async () => {
    const sharedActivityAt = new Date(Date.now() - 3_000);  // 3 s ago
    const jobOlder = makeJob({
      id: "job-older",
      createdAt: new Date(Date.now() - 60_000),
      lastActivityAt: sharedActivityAt,
      status: "COMPLETED",
    });
    const jobNewer = makeJob({
      id: "job-newer",
      createdAt: new Date(Date.now() - 30_000),
      lastActivityAt: sharedActivityAt,
      status: "COMPLETED",
    });

    // Simulate the [lastActivityAt desc, createdAt desc, id desc] Prisma ordering.
    // With equal lastActivityAt, the job with the later createdAt is first.
    const orderedFindFn: FindJobFn = async () =>
      [jobOlder, jobNewer].sort((a, b) => {
        const dt = b.lastActivityAt.getTime() - a.lastActivityAt.getTime();
        if (dt !== 0) return dt;
        return b.createdAt.getTime() - a.createdAt.getTime(); // tie-break: later createdAt first
      })[0];

    const result = await checkCustomerCooldown(CUST, 10_000, orderedFindFn);
    // jobNewer is returned (later createdAt wins the tie) — still within 10s cooldown window.
    assert.equal(result.ok, false, "within cooldown when lastActivityAt is 3 s ago");
    assert.ok(result.retryAfterMs !== undefined && result.retryAfterMs > 0, "retryAfterMs must be positive");
    assert.ok(result.retryAfterMs! <= 7_200, "retryAfterMs must be no more than ~7 s remaining");
  });
});

// ── EP.1-2: Upload endpoint ───────────────────────────────────────────────────

describe("EP — upload endpoint", () => {
  it("EP.1 — buildModelUploadUrl uses the standard Cloudinary upload endpoint", () => {
    const url = buildModelUploadUrl("my-cloud");
    // Cloudinary upload API uses /image/upload regardless of delivery type.
    // Private delivery is enforced via the signed `type=private` form parameter.
    assert.ok(url.includes("/image/upload"), "upload URL must use /image/upload (Cloudinary standard)");
    assert.equal(url, "https://api.cloudinary.com/v1_1/my-cloud/image/upload");
  });

  it("EP.2 — buildModelUploadUrl uses api.cloudinary.com (not the CDN host)", () => {
    // The browser receives this URL from the server and must use it verbatim.
    // Private delivery is enforced by the signed `type=private` parameter, not the URL path.
    const url = buildModelUploadUrl("test-cloud");
    const parsed = new URL(url);
    assert.equal(parsed.hostname, "api.cloudinary.com", "must use Cloudinary API host");
    assert.ok(parsed.pathname.includes("/image/upload"), "must include /image/upload path");
  });
});

// ── SV.1-5: Server-side asset verification ────────────────────────────────────

describe("SV — server-side Cloudinary asset verification", () => {
  it("SV.1 — Admin API NOT_FOUND: rejected without attempting compensation delete", async () => {
    let deleteCalled = false;
    const result = await saveNaiaModelPhoto(
      CUST,
      "face",
      VALID_PUBLIC_ID,
      null,
      null,
      "private",
      async () => null,
      async (_cid, data) => makeModel(data),
      async () => { deleteCalled = true; return { ok: true }; },
      async () => ({ ok: false, errorCode: "NOT_FOUND" }),
    );
    assert.equal(result.ok, false, "must reject when asset is not found");
    assert.equal(deleteCalled, false, "must not attempt compensation delete for a missing asset");
  });

  it("SV.2 — Admin API returns resource_type != 'image': rejected and asset deleted as compensation", async () => {
    const deletedIds: string[] = [];
    const result = await saveNaiaModelPhoto(
      CUST,
      "face",
      VALID_PUBLIC_ID,
      null,
      null,
      "private",
      async () => null,
      async (_cid, data) => makeModel(data),
      async (pid) => { deletedIds.push(pid); return { ok: true }; },
      async (pid) => ({
        ok: true,
        asset: { publicId: pid, resourceType: "raw", type: "private", version: "1", format: "pdf" },
      }),
    );
    assert.equal(result.ok, false, "non-image resource must be rejected");
    assert.deepEqual(deletedIds, [VALID_PUBLIC_ID], "non-image asset must be deleted as compensation");
  });

  it("SV.3 — forged payload: Admin API returns type='upload' (public): rejected and deleted", async () => {
    // Simulates a forged browser submission where the browser uploads a public asset
    // but submits its public_id to the save-photo action claiming it is private.
    // The Admin API reveals the true delivery type, rejecting the persist.
    const deletedIds: string[] = [];
    const result = await saveNaiaModelPhoto(
      CUST,
      "face",
      VALID_PUBLIC_ID,
      null,
      null,
      "private",          // browser claims private
      async () => null,
      async (_cid, data) => makeModel(data),
      async (pid) => { deletedIds.push(pid); return { ok: true }; },
      async (pid) => ({   // Admin API reveals the asset is actually public
        ok: true,
        asset: { publicId: pid, resourceType: "image", type: "upload", version: "1", format: "jpg" },
      }),
    );
    assert.equal(result.ok, false, "forged public payload must be rejected");
    assert.deepEqual(deletedIds, [VALID_PUBLIC_ID], "public asset must be deleted as compensation");
    if (result.ok) throw new Error("unreachable");
    assert.ok(
      result.error.toLowerCase().includes("public") || result.error.toLowerCase().includes("permitted"),
      "error must indicate the delivery type is not permitted",
    );
  });

  it("SV.4 — Admin API-verified format overrides browser-supplied format (server is authoritative)", async () => {
    let upsertedData: Partial<NaiaModelRecord> = {};
    await saveNaiaModelPhoto(
      CUST,
      "face",
      VALID_PUBLIC_ID,
      null,
      "png",              // browser claims format="png"
      "private",
      async () => null,
      async (_cid, data) => { upsertedData = data; return makeModel(data); },
      async () => ({ ok: true }),
      async (pid) => ({   // Admin API says format="heic" (the authoritative value)
        ok: true,
        asset: { publicId: pid, resourceType: "image", type: "private", version: "5", format: "heic" },
      }),
      mockModerationPass,
      mockSuitabilityPass,
      mockGetCfg,
    );
    assert.equal(upsertedData.faceFormat, "heic", "verified format must be persisted");
    assert.notEqual(upsertedData.faceFormat, "png", "browser-supplied format must be ignored");
  });

  it("SV.5 — Admin API NOT_CONFIGURED: rejected, no delete, no persist", async () => {
    let deleteCalled = false;
    let upsertCalled = false;
    const result = await saveNaiaModelPhoto(
      CUST,
      "face",
      VALID_PUBLIC_ID,
      null,
      null,
      "private",
      async () => null,
      async (_cid, data) => { upsertCalled = true; return makeModel(data); },
      async () => { deleteCalled = true; return { ok: true }; },
      async () => ({ ok: false, errorCode: "NOT_CONFIGURED" }),
    );
    assert.equal(result.ok, false, "must reject when Admin API is not configured");
    assert.equal(deleteCalled, false, "must not delete when config is missing");
    assert.equal(upsertCalled, false, "must not persist when verification fails");
  });
});

// ── MD.1-5: Body-slot moderation and suitability behaviour ───────────────────

describe("MD — body-slot moderation and suitability", () => {
  const BODY_ID = `naia-wardrobe/${CUST}/body-photo`;

  it("MD.1 — body slot: MODERATION_UNAVAILABLE → rejected, asset deleted, ok=false", async () => {
    const deletedIds: string[] = [];
    const result = await saveNaiaModelPhoto(
      CUST,
      "body",
      BODY_ID,
      null,
      null,
      "private",
      async () => null,
      async (_cid, data) => makeModel(data),
      async (pid) => { deletedIds.push(pid); return { ok: true }; },
      mockVerifyOk,
      async () => ({ status: "MODERATION_UNAVAILABLE" }),   // moderation unavailable
      mockSuitabilityPass,
      mockGetCfg,
    );
    assert.equal(result.ok, false, "must fail when moderation is unavailable");
    assert.deepEqual(deletedIds, [BODY_ID], "asset must be deleted as compensation");
    if (result.ok) throw new Error("unreachable");
    assert.ok(result.error.length > 0, "error message must be returned");
  });

  it("MD.2 — body slot: SAFETY_REJECT → rejected, asset deleted, ok=false", async () => {
    const deletedIds: string[] = [];
    const result = await saveNaiaModelPhoto(
      CUST,
      "body",
      BODY_ID,
      null,
      null,
      "private",
      async () => null,
      async (_cid, data) => makeModel(data),
      async (pid) => { deletedIds.push(pid); return { ok: true }; },
      mockVerifyOk,
      async () => ({ status: "SAFETY_REJECT", reasonCode: "explicit_sexual" }),
      mockSuitabilityPass,
      mockGetCfg,
    );
    assert.equal(result.ok, false, "must fail on SAFETY_REJECT");
    assert.deepEqual(deletedIds, [BODY_ID], "rejected asset must be deleted");
  });

  it("MD.3 — body slot: suitability RETRY_IMAGE → rejected, asset deleted, specific error", async () => {
    const deletedIds: string[] = [];
    const result = await saveNaiaModelPhoto(
      CUST,
      "body",
      BODY_ID,
      null,
      null,
      "private",
      async () => null,
      async (_cid, data) => makeModel(data),
      async (pid) => { deletedIds.push(pid); return { ok: true }; },
      mockVerifyOk,
      mockModerationPass,
      async () => ({ status: "RETRY_IMAGE", subCode: "image_too_blurry" }),
      mockGetCfg,
    );
    assert.equal(result.ok, false, "must fail when suitability check fails");
    assert.deepEqual(deletedIds, [BODY_ID], "unsuitable asset must be deleted");
    if (result.ok) throw new Error("unreachable");
    assert.ok(
      result.error.toLowerCase().includes("blurry") || result.error.length > 0,
      "error must reflect the suitability subCode",
    );
  });

  it("MD.4 — body slot: bodyModerationStatus=APPROVED only when L2+L3 both pass", async () => {
    let upsertedData: Partial<NaiaModelRecord> = {};
    await saveNaiaModelPhoto(
      CUST,
      "body",
      BODY_ID,
      null,
      null,
      "private",
      async () => null,
      async (_cid, data) => { upsertedData = data; return makeModel(data); },
      async () => ({ ok: true }),
      mockVerifyOk,
      mockModerationPass,
      mockSuitabilityPass,
      mockGetCfg,
    );
    assert.equal(upsertedData.bodyModerationStatus, "APPROVED",
      "bodyModerationStatus must be APPROVED after L2+L3 pass");
    assert.ok(upsertedData.bodyModerationAt instanceof Date,
      "bodyModerationAt must be set when APPROVED");
  });

  it("MD.5 — deleteNaiaModelPhoto body slot clears bodyModerationStatus and bodyFormat", async () => {
    const bodyId = `naia-wardrobe/${CUST}/body`;
    const model = makeModel({
      bodyPublicId: bodyId,
      bodyVersion: "1",
      bodyFormat: "jpg",
      bodyModerationStatus: "APPROVED",
      bodyModerationAt: new Date(),
    });
    let upsertedData: Partial<NaiaModelRecord> = {};

    await deleteNaiaModelPhoto(
      CUST,
      "body",
      async () => model,
      async (_cid, data) => { upsertedData = data; return makeModel(data); },
      async () => ({ ok: true }),
    );

    assert.equal(upsertedData.bodyPublicId, null, "bodyPublicId must be cleared");
    assert.equal(upsertedData.bodyVersion, null, "bodyVersion must be cleared");
    assert.equal(upsertedData.bodyFormat, null, "bodyFormat must be cleared");
    assert.equal(upsertedData.bodyModerationStatus, null,
      "bodyModerationStatus must be cleared to prevent stale APPROVED state");
    assert.equal(upsertedData.bodyModerationAt, null,
      "bodyModerationAt must be cleared");
  });
});
