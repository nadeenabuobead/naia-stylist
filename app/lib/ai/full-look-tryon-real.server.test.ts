// app/lib/ai/full-look-tryon-real.server.test.ts
//
// Fully mocked — no real DB, no real network, no real FASHN/Cloudinary
// credentials anywhere in this file. checkCustomerCooldown/createOrFindTryOnJob/
// advanceTryOnJob, submitTryOnToProvider, downloadModelPhotoAsDataUrl/
// uploadTryOnResult/buildTryOnResultUrl, and the Cloudinary admin primitives
// are all vi.mock'd. global.fetch is mocked only for the two remaining raw
// HTTP call sites this module owns directly (the FASHN status GET, and the
// intermediate-image download GET) — never a real request.
//
// Run: npx vitest run app/lib/ai/full-look-tryon-real.server.test.ts

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./my-naia-model.server.js", () => ({
  checkCustomerCooldown: vi.fn(),
  createOrFindTryOnJob: vi.fn(),
  advanceTryOnJob: vi.fn(),
}));

vi.mock("./fashn-try-on.server.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./fashn-try-on.server.js")>();
  return { ...actual, submitTryOnToProvider: vi.fn() };
});

vi.mock("./fashn-tryon-service.server.js", () => ({
  downloadModelPhotoAsDataUrl: vi.fn(),
  uploadTryOnResult: vi.fn(),
  buildTryOnResultUrl: vi.fn(),
}));

vi.mock("../cloudinary-admin.server.js", () => ({
  uploadCloudinaryPrivate: vi.fn(),
  buildPrivateDownloadUrl: vi.fn((_cfg: unknown, publicId: string) => `https://cloudinary.mock/download?public_id=${publicId}`),
  getCloudinaryConfig: vi.fn(() => ({ cloudName: "mock", apiKey: "mock", apiSecret: "mock" })),
  deleteCloudinaryAsset: vi.fn(async () => ({ ok: true })),
}));

import { checkCustomerCooldown, createOrFindTryOnJob, advanceTryOnJob } from "./my-naia-model.server.js";
import { submitTryOnToProvider } from "./fashn-try-on.server.js";
import { downloadModelPhotoAsDataUrl, uploadTryOnResult, buildTryOnResultUrl } from "./fashn-tryon-service.server.js";
import { uploadCloudinaryPrivate, deleteCloudinaryAsset } from "../cloudinary-admin.server.js";
import {
  getFullLookStepIdempotencyKey,
  isCompatibleModelPhotoFormat,
  checkFashnPredictionStatus,
  walkFullLookChainJobs,
  submitFullLookRealStep,
  pollFullLookRealStep,
  advanceFullLookChain,
  startOrResumeFullLookChain,
  continueToFinalStep,
  sweepAbandonedFullLookPauses,
  sweepStaleFullLookSteps,
  reconcileStaleFullLookJobForCustomer,
  STALE_PROCESSING_THRESHOLD_MS,
  REAL_PRODUCT_HANDLE_PREFIX,
  recoverFailedUploadStep,
  getFullLookStepRecoveryIdempotencyKey,
  type FullLookChainContext,
} from "./full-look-tryon-real.server.js";
import { FULL_LOOK_FINAL_STEP_HANDLE_PREFIX } from "./full-look-handle-constants.js";
import type { VirtualTryOnConsent, VirtualTryOnJobRecord } from "./virtual-try-on.types.js";

const mockCooldown = () => checkCustomerCooldown as ReturnType<typeof vi.fn>;
const mockCreateOrFind = () => createOrFindTryOnJob as ReturnType<typeof vi.fn>;
const mockAdvance = () => advanceTryOnJob as ReturnType<typeof vi.fn>;
const mockSubmitProvider = () => submitTryOnToProvider as ReturnType<typeof vi.fn>;
const mockDownloadPhoto = () => downloadModelPhotoAsDataUrl as ReturnType<typeof vi.fn>;
const mockUploadResult = () => uploadTryOnResult as ReturnType<typeof vi.fn>;
const mockBuildResultUrl = () => buildTryOnResultUrl as ReturnType<typeof vi.fn>;
const mockUploadPrivate = () => uploadCloudinaryPrivate as ReturnType<typeof vi.fn>;
const mockDeleteAsset = () => deleteCloudinaryAsset as ReturnType<typeof vi.fn>;

const CONSENT: VirtualTryOnConsent = {
  virtualTryOnConsent: true,
  policyVersion: "1.0-staging-real-test",
  consentedAt: "2026-11-03T00:00:00.000Z",
};

const GARMENTS = [
  { label: "Beige Tailored Trousers", productImageUrl: "https://closet.example/trousers.jpg" },
  { label: "Blue Chambray Button-Up Shirt", productImageUrl: "https://closet.example/shirt.jpg" },
  { label: "Beige Tailored Blazer", productImageUrl: "https://closet.example/blazer.jpg" },
];

function baseCtx(): FullLookChainContext {
  return {
    customerId: "cust-1",
    naiaModelId: "model-1",
    bodyPublicId: "body-pub-1",
    bodyFormat: "jpg",
    deliveryType: "private",
    garments: GARMENTS,
    consent: CONSENT,
    outfitSuggestionId: "suggestion-1",
  };
}

// 2026-11-15 — dynamic chain length. A real outfit can submit 3-5 garments
// (see full-look-vto-orchestrator.server.ts's selectFullLookGarments);
// this builds a ctx with exactly `count` garments so the pause/final-step
// logic (now derived from ctx.garments.length, never a fixed constant) can
// be exercised at lengths other than 3.
function ctxWithGarmentCount(count: number): FullLookChainContext {
  const labels = ["Black Sweater", "Black Jeans", "Black Wool Shirt Jacket", "Brown Chelsea Boots", "Black Baseball Cap"];
  return {
    ...baseCtx(),
    garments: labels.slice(0, count).map((label) => ({ label, productImageUrl: `https://closet.example/${label}.jpg` })),
  };
}

function fakeJob(id: string, overrides: Partial<VirtualTryOnJobRecord> = {}): VirtualTryOnJobRecord {
  return {
    id,
    customerId: "cust-1",
    naiaModelId: "model-1",
    productHandle: `${REAL_PRODUCT_HANDLE_PREFIX}:step1:Beige Tailored Trousers`,
    provider: "FASHN",
    predictionId: null,
    status: "CREATED",
    virtualTryOnConsentAt: new Date(CONSENT.consentedAt),
    consentPolicyVersion: CONSENT.policyVersion,
    saveTryOnResultConsentAt: null,
    idempotencyKey: `key-${id}`,
    requestFingerprint: null,
    errorCode: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    completedAt: null,
    lastActivityAt: new Date(),
    ...overrides,
  } as VirtualTryOnJobRecord;
}

const PNG_DATA_URL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUA";

beforeEach(() => {
  vi.clearAllMocks();
  global.fetch = vi.fn();
  // pollFullLookRealStep's internal checkFashnPredictionStatus call uses the
  // real default _getApiKey (process.env.FASHN_API_KEY) since callers don't
  // thread DI through it — without this, every status check short-circuits
  // to {ok:false} before ever calling the mocked fetch above.
  process.env.FASHN_API_KEY = "mock-key";
});

// ── Pure helpers — no mocking needed ─────────────────────────────────────────

describe("getFullLookStepIdempotencyKey", () => {
  it("FL.1 — step 0 is a permanent, customer-scoped reservation (no scope escape hatch)", () => {
    const k1 = getFullLookStepIdempotencyKey("cust-1", 0, null);
    const k2 = getFullLookStepIdempotencyKey("cust-1", 0, null);
    expect(k1).toBe(k2);
    expect(k1).toContain("cust-1");
    expect(k1).not.toContain("fulllook-poc"); // never collides with the mock chain's namespace
  });

  it("FL.2 — steps 1/2 derive deterministically from the prior step's job id", () => {
    const k1 = getFullLookStepIdempotencyKey("cust-1", 1, "job-abc");
    const k2 = getFullLookStepIdempotencyKey("cust-1", 1, "job-abc");
    const k3 = getFullLookStepIdempotencyKey("cust-1", 1, "job-xyz");
    expect(k1).toBe(k2);
    expect(k1).not.toBe(k3);
  });
});

describe("isCompatibleModelPhotoFormat", () => {
  it("FL.3 — accepts jpg/jpeg/png/webp, rejects heic/heif", () => {
    expect(isCompatibleModelPhotoFormat("jpg")).toBe(true);
    expect(isCompatibleModelPhotoFormat("JPEG")).toBe(true);
    expect(isCompatibleModelPhotoFormat("png")).toBe(true);
    expect(isCompatibleModelPhotoFormat("webp")).toBe(true);
    expect(isCompatibleModelPhotoFormat("heic")).toBe(false);
    expect(isCompatibleModelPhotoFormat("heif")).toBe(false);
    expect(isCompatibleModelPhotoFormat(null)).toBe(true); // defaults to jpg, same as downloadModelPhotoAsDataUrl
  });
});

describe("checkFashnPredictionStatus", () => {
  it("FL.4 — returns the parsed body on a successful status check", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ status: "processing" }), { status: 200 }));
    const result = await checkFashnPredictionStatus("pred-1", fetchMock as unknown as typeof fetch, () => "key");
    expect(result).toEqual({ ok: true, body: { status: "processing" } });
  });

  it("FL.5 — network error and missing API key both surface as ok:false, never throw", async () => {
    const fetchMock = vi.fn(async () => { throw new Error("network down"); });
    const result = await checkFashnPredictionStatus("pred-1", fetchMock as unknown as typeof fetch, () => "key");
    expect(result).toEqual({ ok: false });

    const result2 = await checkFashnPredictionStatus("pred-1", fetchMock as unknown as typeof fetch, () => undefined);
    expect(result2).toEqual({ ok: false });
  });
});

describe("walkFullLookChainJobs", () => {
  it("FL.6 — no job for step 0 → empty chain", async () => {
    const _findJobFn = vi.fn(async () => null);
    const jobs = await walkFullLookChainJobs("cust-1", { _findJobFn });
    expect(jobs).toEqual([]);
  });

  it("FL.7 — stops at the first non-COMPLETED step", async () => {
    const job0 = fakeJob("job-0", { status: "COMPLETED" });
    const job1 = fakeJob("job-1", { status: "PROCESSING" });
    const _findJobFn = vi.fn(async (where: { idempotencyKey: string }) => {
      if (where.idempotencyKey === getFullLookStepIdempotencyKey("cust-1", 0, null)) return job0;
      if (where.idempotencyKey === getFullLookStepIdempotencyKey("cust-1", 1, "job-0")) return job1;
      return null;
    });
    const jobs = await walkFullLookChainJobs("cust-1", { _findJobFn });
    expect(jobs.map((j) => j.id)).toEqual(["job-0", "job-1"]);
  });

  it("FL.8 — all 3 COMPLETED returns all 3 jobs", async () => {
    const job0 = fakeJob("job-0", { status: "COMPLETED" });
    const job1 = fakeJob("job-1", { status: "COMPLETED" });
    const job2 = fakeJob("job-2", { status: "COMPLETED" });
    const _findJobFn = vi.fn(async (where: { idempotencyKey: string }) => {
      if (where.idempotencyKey === getFullLookStepIdempotencyKey("cust-1", 0, null)) return job0;
      if (where.idempotencyKey === getFullLookStepIdempotencyKey("cust-1", 1, "job-0")) return job1;
      if (where.idempotencyKey === getFullLookStepIdempotencyKey("cust-1", 2, "job-1")) return job2;
      return null;
    });
    const jobs = await walkFullLookChainJobs("cust-1", { _findJobFn });
    expect(jobs.map((j) => j.id)).toEqual(["job-0", "job-1", "job-2"]);
  });
});

// ── submitFullLookRealStep ───────────────────────────────────────────────────

describe("submitFullLookRealStep", () => {
  // 2026-11-15 REGRESSION — a caller passing a ctx with no garment for this
  // step (e.g. api.full-look-vto.tsx's GET loader, which used to pass
  // garments: [] on the mistaken belief that only start/submit ever reads
  // them — auto-advance mid-poll reads them too) used to throw a raw
  // TypeError ("Cannot read properties of undefined (reading 'label')"),
  // which crashed every poll once the chain's current step completed and
  // made every real attempt appear to hang forever. Must fail closed with
  // a normal result instead, with zero provider/DB I/O.
  it("FL.9b — a missing garment for this step index fails closed with missing_garment_for_step, never throws", async () => {
    const ctx = { ...baseCtx(), garments: [baseCtx().garments[0]] }; // only 1 garment; step 1 has none
    const result = await submitFullLookRealStep(ctx, 1, "job-0");
    expect(result).toEqual({ ok: false, reason: "missing_garment_for_step" });
    expect(mockCreateOrFind()).not.toHaveBeenCalled();
    expect(mockSubmitProvider()).not.toHaveBeenCalled();
  });

  it("FL.9 — step 0 downloads the real model photo, submits (POST-only), advances to PROCESSING", async () => {
    const job = fakeJob("job-0");
    mockCreateOrFind().mockResolvedValue({ ok: true, job, created: true });
    mockAdvance()
      .mockResolvedValueOnce({ ok: true, job: { ...job, status: "SUBMITTED" } }) // → SUBMITTED
      .mockResolvedValueOnce({ ok: true, job: { ...job, status: "PROCESSING", predictionId: "pred-0" } }); // → PROCESSING
    mockDownloadPhoto().mockResolvedValue({ ok: true, dataUrl: PNG_DATA_URL });
    mockSubmitProvider().mockResolvedValue({ ok: true, predictionId: "pred-0" });

    const result = await submitFullLookRealStep(baseCtx(), 0, null);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.alreadySubmitted).toBe(false);
      expect(result.job.predictionId).toBe("pred-0");
    }
    expect(mockDownloadPhoto()).toHaveBeenCalledWith("body-pub-1", "jpg", "private");
    expect(mockSubmitProvider()).toHaveBeenCalledTimes(1);
    const submittedInput = mockSubmitProvider().mock.calls[0][0];
    expect(submittedInput.productHandle).toContain(REAL_PRODUCT_HANDLE_PREFIX);
    expect(submittedInput.productHandle).not.toContain("fulllook-poc");
  });

  it("FL.10 — step N>0 downloads the PRIOR step's intermediate Cloudinary image, not the model photo", async () => {
    const job = fakeJob("job-1");
    mockCreateOrFind().mockResolvedValue({ ok: true, job, created: true });
    mockAdvance()
      .mockResolvedValueOnce({ ok: true, job: { ...job, status: "SUBMITTED" } })
      .mockResolvedValueOnce({ ok: true, job: { ...job, status: "PROCESSING", predictionId: "pred-1" } });
    // Intermediate download goes through global.fetch (buildPrivateDownloadUrl is mocked to a fixed URL).
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3]).buffer, { status: 200 }),
    );
    mockSubmitProvider().mockResolvedValue({ ok: true, predictionId: "pred-1" });

    const result = await submitFullLookRealStep(baseCtx(), 1, "job-0");

    expect(result.ok).toBe(true);
    expect(mockDownloadPhoto()).not.toHaveBeenCalled(); // never re-downloads the model photo for later steps
    expect(global.fetch).toHaveBeenCalled(); // fetched the prior step's stored output instead
  });

  it("FL.10b — REGRESSION: when the prior step's intermediate Cloudinary download fails, the HTTP status is preserved in the errorCode instead of a bare 'PROVIDER_ERROR' — distinguishes a 404 (expired/missing asset) from a 401/403 (auth) from a 429/5xx (transient)", async () => {
    const job = fakeJob("job-1");
    mockCreateOrFind().mockResolvedValue({ ok: true, job, created: true });
    mockAdvance().mockResolvedValueOnce({ ok: true, job: { ...job, status: "SUBMITTED" } });
    mockAdvance().mockResolvedValueOnce({ ok: true, job: { ...job, status: "FAILED" } }); // markFailedBestEffort
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(new Response(null, { status: 404 }));

    const result = await submitFullLookRealStep(baseCtx(), 1, "job-0");

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("PROVIDER_ERROR_404");
    expect(mockAdvance()).toHaveBeenCalledWith(expect.anything(), "FAILED", { errorCode: "PROVIDER_ERROR_404" });
  });

  it("FL.11 — duplicate request (job already exists) is idempotent: no second FASHN submission", async () => {
    const existing = fakeJob("job-0", { status: "PROCESSING", predictionId: "pred-0" });
    mockCreateOrFind().mockResolvedValue({ ok: true, job: existing, created: false });

    const result = await submitFullLookRealStep(baseCtx(), 0, null);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.alreadySubmitted).toBe(true);
    expect(mockSubmitProvider()).not.toHaveBeenCalled();
    expect(mockDownloadPhoto()).not.toHaveBeenCalled();
  });

  it("FL.12 — a provider rejection marks the job FAILED and never calls the provider again from this function", async () => {
    const job = fakeJob("job-0");
    mockCreateOrFind().mockResolvedValue({ ok: true, job, created: true });
    mockAdvance().mockResolvedValueOnce({ ok: true, job: { ...job, status: "SUBMITTED" } });
    mockAdvance().mockResolvedValueOnce({ ok: true, job: { ...job, status: "FAILED" } }); // markFailedBestEffort
    mockDownloadPhoto().mockResolvedValue({ ok: true, dataUrl: PNG_DATA_URL });
    mockSubmitProvider().mockResolvedValue({ ok: false, code: "PROVIDER_REJECTED", customerMessage: "no" });

    const result = await submitFullLookRealStep(baseCtx(), 0, null);

    expect(result.ok).toBe(false);
    expect(mockAdvance()).toHaveBeenCalledWith(expect.anything(), "FAILED", expect.objectContaining({ errorCode: "PROVIDER_REJECTED" }));
  });
});

// ── pollFullLookRealStep ──────────────────────────────────────────────────────

describe("pollFullLookRealStep", () => {
  it("FL.13 — still processing at FASHN → PROCESSING, no mutation", async () => {
    const job = fakeJob("job-0", { status: "PROCESSING", predictionId: "pred-0" });
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify({ status: "processing" }), { status: 200 }),
    );
    const result = await pollFullLookRealStep(baseCtx(), job, 0);
    expect(result.status).toBe("PROCESSING");
    expect(mockAdvance()).not.toHaveBeenCalled();
  });

  it("FL.14 — ambiguous/network status-check error stays PROCESSING, never advances or resubmits (not billable to retry)", async () => {
    const job = fakeJob("job-0", { status: "PROCESSING", predictionId: "pred-0" });
    (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("network blip"));
    const result = await pollFullLookRealStep(baseCtx(), job, 0);
    expect(result.status).toBe("PROCESSING");
    expect(mockAdvance()).not.toHaveBeenCalled();
    expect(mockSubmitProvider()).not.toHaveBeenCalled();
  });

  it("FL.15 — an intermediate step (not final) completing uploads to the INTERMEDIATE namespace, not the final-result one", async () => {
    const job = fakeJob("job-0", { status: "PROCESSING", predictionId: "pred-0" });
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify({ status: "completed", output: [PNG_DATA_URL] }), { status: 200 }),
    );
    mockUploadPrivate().mockResolvedValue({ ok: true, publicId: "x", format: "png", version: "1" });
    mockAdvance().mockResolvedValue({ ok: true, job: { ...job, status: "COMPLETED" } });

    const result = await pollFullLookRealStep(baseCtx(), job, 0); // stepIndex 0 of 3 — not final

    expect(result.status).toBe("STEP_COMPLETE");
    expect(mockUploadPrivate()).toHaveBeenCalledWith(
      expect.stringContaining("naia-tryon-fulllook-intermediate"),
      PNG_DATA_URL,
      "private",
      expect.anything(),
      expect.anything(),
    );
    expect(mockUploadResult()).not.toHaveBeenCalled();
  });

  it("FL.16 — the FINAL step completing persists via the real uploadTryOnResult/buildTryOnResultUrl mechanism", async () => {
    const job = fakeJob("job-2", { status: "PROCESSING", predictionId: "pred-2" });
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify({ status: "completed", output: [PNG_DATA_URL] }), { status: 200 }),
    );
    mockUploadResult().mockResolvedValue({ ok: true });
    mockAdvance().mockResolvedValue({ ok: true, job: { ...job, status: "COMPLETED" } });
    mockBuildResultUrl().mockReturnValue("https://signed.example/result.png");

    const result = await pollFullLookRealStep(baseCtx(), job, 2); // stepIndex 2 of 3 — final

    expect(result).toMatchObject({ status: "COMPLETED", resultUrl: "https://signed.example/result.png" });
    expect(mockUploadResult()).toHaveBeenCalledWith("cust-1", "job-2", PNG_DATA_URL);
    expect(mockUploadPrivate()).not.toHaveBeenCalled(); // never uses the intermediate namespace for the real deliverable
  });

  // 2026-11-16 CONFIRMED ROOT-CAUSE FIX — three real UPLOAD_FAILED
  // occurrences on the same garment image were all equally undiagnosable
  // after the fact because this exact branch discarded the real
  // errorCode uploadIntermediateStepResult/uploadTryOnResult already
  // returned, replacing it with a hardcoded "UPLOAD_FAILED" string before
  // it ever reached the DB. This had zero test coverage before this fix —
  // confirmed by grep, no pre-existing test asserted on this branch's
  // errorCode value at all.
  it("FL.15b — an intermediate-step Cloudinary upload failure persists the REAL errorCode (not a hardcoded string), never resubmits anything, and logs once without the raw customerId", async () => {
    const job = fakeJob("job-0", { status: "PROCESSING", predictionId: "pred-0" });
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify({ status: "completed", output: [PNG_DATA_URL] }), { status: 200 }),
    );
    // Simulates bbd953e's own real detail — a 413 (payload too large) is
    // exactly the kind of distinction the old hardcoded string erased.
    mockUploadPrivate().mockResolvedValueOnce({ ok: false, errorCode: "PROVIDER_ERROR_413" });
    mockAdvance().mockResolvedValueOnce({ ok: true, job: { ...job, status: "FAILED", errorCode: "PROVIDER_ERROR_413" } });
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await pollFullLookRealStep(baseCtx(), job, 0); // stepIndex 0 of 3 — intermediate, not final

    expect(result.status).toBe("FAILED");
    expect(mockAdvance()).toHaveBeenCalledWith(
      expect.objectContaining({ id: "job-0" }), "FAILED", { errorCode: "PROVIDER_ERROR_413" },
    );
    expect(mockSubmitProvider()).not.toHaveBeenCalled(); // no new FASHN call, under any circumstance
    expect(mockCreateOrFind()).not.toHaveBeenCalled();

    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    const loggedPayload = consoleErrorSpy.mock.calls[0][1] as Record<string, unknown>;
    expect(loggedPayload.errorCode).toBe("PROVIDER_ERROR_413");
    expect(loggedPayload.jobId).toBe("job-0");
    expect(loggedPayload.isFinal).toBe(false);
    expect(JSON.stringify(loggedPayload)).not.toContain("cust-1"); // hashed, never the raw customerId
    consoleErrorSpy.mockRestore();
  });

  it("FL.16b — the FINAL step's own Cloudinary upload failure ALSO persists the real errorCode, not a hardcoded string", async () => {
    const job = fakeJob("job-2", { status: "PROCESSING", predictionId: "pred-2" });
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify({ status: "completed", output: [PNG_DATA_URL] }), { status: 200 }),
    );
    mockUploadResult().mockResolvedValueOnce({ ok: false, errorCode: "NETWORK_ERROR" });
    mockAdvance().mockResolvedValueOnce({ ok: true, job: { ...job, status: "FAILED", errorCode: "NETWORK_ERROR" } });
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await pollFullLookRealStep(baseCtx(), job, 2); // stepIndex 2 of 3 — final

    expect(result.status).toBe("FAILED");
    expect(mockAdvance()).toHaveBeenCalledWith(
      expect.objectContaining({ id: "job-2" }), "FAILED", { errorCode: "NETWORK_ERROR" },
    );
    const loggedPayload = consoleErrorSpy.mock.calls[0][1] as Record<string, unknown>;
    expect(loggedPayload.isFinal).toBe(true);
    consoleErrorSpy.mockRestore();
  });

  it("FL.17 — FASHN-reported failure marks FAILED and is terminal — a later poll on the same job returns FAILED without any new FASHN call", async () => {
    const job = fakeJob("job-0", { status: "PROCESSING", predictionId: "pred-0" });
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify({ status: "failed", error: "provider error" }), { status: 200 }),
    );
    mockAdvance().mockResolvedValue({ ok: true, job: { ...job, status: "FAILED" } });

    const result = await pollFullLookRealStep(baseCtx(), job, 0);
    expect(result.status).toBe("FAILED");

    // Simulate a second poll against the now-FAILED job row — terminal, no FASHN call.
    (global.fetch as ReturnType<typeof vi.fn>).mockClear();
    const terminalJob = fakeJob("job-0", { status: "FAILED" });
    const second = await pollFullLookRealStep(baseCtx(), terminalJob, 0);
    expect(second.status).toBe("FAILED");
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

// ── recoverFailedUploadStep — reuse an existing FAILED step's completed
// prediction without ever submitting a new one (2026-11-16) ────────────────

describe("recoverFailedUploadStep", () => {
  function failedIntermediateJob(overrides: Partial<VirtualTryOnJobRecord> = {}): VirtualTryOnJobRecord {
    return fakeJob("job-original", {
      status: "FAILED",
      errorCode: "UPLOAD_FAILED",
      predictionId: "pred-real",
      productHandle: `${REAL_PRODUCT_HANDLE_PREFIX}:step1:Black Polo Ralph Lauren Crew Neck Sweater`,
      ...overrides,
    });
  }

  it("REC.1 — successful recovery: reuses the existing predictionId, creates exactly one new row under a distinct idempotency key, never calls submitTryOnToProvider", async () => {
    const failedJob = failedIntermediateJob();
    const recoveryJob = fakeJob("job-recovery", { status: "CREATED", predictionId: null });
    mockCreateOrFind().mockResolvedValueOnce({ ok: true, job: recoveryJob, created: true });
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify({ status: "completed", output: [PNG_DATA_URL] }), { status: 200 }),
    );
    mockUploadPrivate().mockResolvedValueOnce({ ok: true, publicId: "x", format: "png", version: "1" });
    mockAdvance()
      .mockResolvedValueOnce({ ok: true, job: { ...recoveryJob, status: "SUBMITTED", predictionId: "pred-real" } })
      .mockResolvedValueOnce({ ok: true, job: { ...recoveryJob, status: "COMPLETED", predictionId: "pred-real" } });

    const result = await recoverFailedUploadStep(baseCtx(), failedJob);

    expect(result).toEqual({ ok: true, job: expect.objectContaining({ status: "COMPLETED" }), alreadyRecovered: false });
    expect(mockCreateOrFind()).toHaveBeenCalledTimes(1);
    const createArgs = mockCreateOrFind().mock.calls[0][0];
    expect(createArgs.idempotencyKey).toBe(getFullLookStepRecoveryIdempotencyKey("cust-1", "job-original"));
    expect(createArgs.productHandle).toBe(failedJob.productHandle); // same garment, same role
    expect(mockAdvance()).toHaveBeenCalledWith(expect.anything(), "SUBMITTED", { predictionId: "pred-real" });
    expect(mockSubmitProvider()).not.toHaveBeenCalled(); // the one hard requirement — never a new prediction
  });

  it("REC.2 — repeat request (idempotent): a second call finds the SAME already-COMPLETED row, makes zero new DB rows and zero new FASHN calls", async () => {
    const failedJob = failedIntermediateJob();
    const alreadyRecovered = fakeJob("job-recovery", { status: "COMPLETED", predictionId: "pred-real" });
    mockCreateOrFind().mockResolvedValueOnce({ ok: true, job: alreadyRecovered, created: false });

    const result = await recoverFailedUploadStep(baseCtx(), failedJob);

    expect(result).toEqual({ ok: true, job: alreadyRecovered, alreadyRecovered: true });
    expect(global.fetch).not.toHaveBeenCalled(); // no FASHN status check even attempted — already done
    expect(mockAdvance()).not.toHaveBeenCalled();
    expect(mockSubmitProvider()).not.toHaveBeenCalled();
  });

  it("REC.3 — a repeat request while a PRIOR recovery attempt is still mid-flight (CREATED) continues the SAME row rather than starting a second one", async () => {
    const failedJob = failedIntermediateJob();
    const inFlightRecovery = fakeJob("job-recovery", { status: "CREATED", predictionId: null });
    mockCreateOrFind().mockResolvedValueOnce({ ok: true, job: inFlightRecovery, created: false });
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify({ status: "completed", output: [PNG_DATA_URL] }), { status: 200 }),
    );
    mockUploadPrivate().mockResolvedValueOnce({ ok: true, publicId: "x", format: "png", version: "1" });
    mockAdvance()
      .mockResolvedValueOnce({ ok: true, job: { ...inFlightRecovery, status: "SUBMITTED" } })
      .mockResolvedValueOnce({ ok: true, job: { ...inFlightRecovery, status: "COMPLETED" } });

    const result = await recoverFailedUploadStep(baseCtx(), failedJob);

    expect(result.ok).toBe(true);
    expect(mockCreateOrFind()).toHaveBeenCalledTimes(1); // never a second row
    expect(mockSubmitProvider()).not.toHaveBeenCalled();
  });

  it("REC.4 — a prior recovery attempt that already failed terminally is reported as such, never silently retried", async () => {
    const failedJob = failedIntermediateJob();
    const deadRecovery = fakeJob("job-recovery", { status: "FAILED", errorCode: "PREDICTION_NO_LONGER_AVAILABLE" });
    mockCreateOrFind().mockResolvedValueOnce({ ok: true, job: deadRecovery, created: false });

    const result = await recoverFailedUploadStep(baseCtx(), failedJob);

    expect(result).toEqual({ ok: false, reason: "PREDICTION_NO_LONGER_AVAILABLE" });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("REC.5 — unavailable/expired provider output: FASHN no longer reports 'completed' for this predictionId — marks the recovery row FAILED, never creates a new submission", async () => {
    const failedJob = failedIntermediateJob();
    const recoveryJob = fakeJob("job-recovery", { status: "CREATED", predictionId: null });
    mockCreateOrFind().mockResolvedValueOnce({ ok: true, job: recoveryJob, created: true });
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify({ status: "processing" }), { status: 200 }), // no longer "completed"
    );
    mockAdvance().mockResolvedValueOnce({ ok: true, job: { ...recoveryJob, status: "FAILED", errorCode: "PREDICTION_NO_LONGER_AVAILABLE" } });

    const result = await recoverFailedUploadStep(baseCtx(), failedJob);

    expect(result).toEqual({ ok: false, reason: "PREDICTION_NO_LONGER_AVAILABLE" });
    expect(mockAdvance()).toHaveBeenCalledWith(expect.anything(), "FAILED", { errorCode: "PREDICTION_NO_LONGER_AVAILABLE" });
    expect(mockSubmitProvider()).not.toHaveBeenCalled();
    expect(mockUploadPrivate()).not.toHaveBeenCalled();
  });

  it("REC.6 — invalid/missing output on an otherwise-'completed' status is treated the same as unavailable — FAILED, no submission", async () => {
    const failedJob = failedIntermediateJob();
    const recoveryJob = fakeJob("job-recovery", { status: "CREATED", predictionId: null });
    mockCreateOrFind().mockResolvedValueOnce({ ok: true, job: recoveryJob, created: true });
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify({ status: "completed", output: [] }), { status: 200 }),
    );
    mockAdvance().mockResolvedValueOnce({ ok: true, job: { ...recoveryJob, status: "FAILED", errorCode: "INVALID_OUTPUT" } });

    const result = await recoverFailedUploadStep(baseCtx(), failedJob);

    expect(result).toEqual({ ok: false, reason: "INVALID_OUTPUT" });
    expect(mockSubmitProvider()).not.toHaveBeenCalled();
  });

  it("REC.7 — a Cloudinary failure DURING recovery (the exact scenario this investigation started from) persists the real errorCode, never retries automatically, never submits a new prediction", async () => {
    const failedJob = failedIntermediateJob();
    const recoveryJob = fakeJob("job-recovery", { status: "CREATED", predictionId: null });
    mockCreateOrFind().mockResolvedValueOnce({ ok: true, job: recoveryJob, created: true });
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify({ status: "completed", output: [PNG_DATA_URL] }), { status: 200 }),
    );
    mockUploadPrivate().mockResolvedValueOnce({ ok: false, errorCode: "PROVIDER_ERROR_413" });
    mockAdvance()
      .mockResolvedValueOnce({ ok: true, job: { ...recoveryJob, status: "SUBMITTED", predictionId: "pred-real" } })
      .mockResolvedValueOnce({ ok: true, job: { ...recoveryJob, status: "FAILED", errorCode: "PROVIDER_ERROR_413" } });
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await recoverFailedUploadStep(baseCtx(), failedJob);

    expect(result).toEqual({ ok: false, reason: "PROVIDER_ERROR_413" });
    expect(mockAdvance()).toHaveBeenCalledWith(expect.anything(), "FAILED", { errorCode: "PROVIDER_ERROR_413" });
    expect(mockSubmitProvider()).not.toHaveBeenCalled();
    expect(consoleErrorSpy).toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });

  it("REC.8 — refuses a job that isn't FAILED at all (e.g. still PROCESSING) — recovery is only for terminal upload failures", async () => {
    const result = await recoverFailedUploadStep(baseCtx(), failedIntermediateJob({ status: "PROCESSING" }));
    expect(result).toEqual({ ok: false, reason: "NOT_FAILED" });
    expect(mockCreateOrFind()).not.toHaveBeenCalled();
  });

  it("REC.9 — refuses a FAILED job with no predictionId at all — nothing to reuse", async () => {
    const result = await recoverFailedUploadStep(baseCtx(), failedIntermediateJob({ predictionId: null }));
    expect(result).toEqual({ ok: false, reason: "NO_PREDICTION_TO_REUSE" });
    expect(mockCreateOrFind()).not.toHaveBeenCalled();
  });

  it("REC.10 — refuses PROVIDER_FAILED (FASHN's own prediction failed, not an upload problem) — there is no valid output to recover, and this must never be confused with an upload-class failure", async () => {
    const result = await recoverFailedUploadStep(baseCtx(), failedIntermediateJob({ errorCode: "PROVIDER_FAILED" }));
    expect(result).toEqual({ ok: false, reason: "NOT_AN_UPLOAD_FAILURE" });
    expect(mockCreateOrFind()).not.toHaveBeenCalled();
  });

  it("REC.11 — recognizes every upload-class errorCode shape, old and new: legacy UPLOAD_FAILED, NETWORK_ERROR, PROVIDER_REJECTED, and bbd953e's PROVIDER_ERROR_<status> codes", async () => {
    for (const errorCode of ["UPLOAD_FAILED", "NETWORK_ERROR", "PROVIDER_REJECTED", "PROVIDER_ERROR_404", "PROVIDER_ERROR_500"]) {
      mockCreateOrFind().mockResolvedValueOnce({
        ok: true, job: fakeJob("job-recovery", { status: "COMPLETED" }), created: false,
      });
      const result = await recoverFailedUploadStep(baseCtx(), failedIntermediateJob({ errorCode }));
      expect(result.ok).toBe(true); // reached the idempotency check at all — i.e. was NOT rejected as "not an upload failure"
    }
  });

  it("REC.12 — ownership mismatch (a failedJob belonging to a different customer) is refused before touching anything", async () => {
    const result = await recoverFailedUploadStep(baseCtx(), failedIntermediateJob({ customerId: "someone-else" }));
    expect(result).toEqual({ ok: false, reason: "OWNERSHIP_MISMATCH" });
    expect(mockCreateOrFind()).not.toHaveBeenCalled();
  });

  it("REC.13 — a FINAL step's own recovery uploads via uploadTryOnResult (the real-deliverable namespace), not the intermediate one — no duplicate-asset risk between the two paths", async () => {
    const failedFinal = failedIntermediateJob({
      productHandle: `${FULL_LOOK_FINAL_STEP_HANDLE_PREFIX}Beige Tailored Blazer`,
    });
    const recoveryJob = fakeJob("job-recovery-final", { status: "CREATED", predictionId: null });
    mockCreateOrFind().mockResolvedValueOnce({ ok: true, job: recoveryJob, created: true });
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify({ status: "completed", output: [PNG_DATA_URL] }), { status: 200 }),
    );
    mockUploadResult().mockResolvedValueOnce({ ok: true });
    mockAdvance()
      .mockResolvedValueOnce({ ok: true, job: { ...recoveryJob, status: "SUBMITTED" } })
      .mockResolvedValueOnce({ ok: true, job: { ...recoveryJob, status: "COMPLETED" } });

    const result = await recoverFailedUploadStep(baseCtx(), failedFinal);

    expect(result.ok).toBe(true);
    expect(mockUploadResult()).toHaveBeenCalledWith("cust-1", "job-recovery-final", PNG_DATA_URL);
    expect(mockUploadPrivate()).not.toHaveBeenCalled(); // never the intermediate namespace for the real deliverable
  });

  it("REC.14 — across every scenario above, checkFashnPredictionStatus is the ONLY possible FASHN call — submitTryOnToProvider is never imported-and-called by this function under any branch", async () => {
    // Static proof, not just behavioral: this function's own source never
    // references submitTryOnToProvider at all.
    const fs = await import("node:fs");
    const path = await import("node:path");
    const dir = path.dirname(new URL(import.meta.url).pathname);
    const source = fs.readFileSync(path.join(dir, "full-look-tryon-real.server.ts"), "utf8");
    const fnStart = source.indexOf("export async function recoverFailedUploadStep");
    const fnEnd = source.indexOf("\n// ── Top-level: advance the chain", fnStart);
    const fnBody = source.slice(fnStart, fnEnd === -1 ? undefined : fnEnd);
    const codeOnly = fnBody.replace(/\/\/.*$/gm, ""); // strip comments — this file's OWN explanatory comments mention the name too
    expect(codeOnly).not.toContain("submitTryOnToProvider");
  });
});

// ── advanceFullLookChain — refresh/recovery and end-to-end step progression ──

describe("advanceFullLookChain", () => {
  it("FL.18 — no chain started → NOT_STARTED", async () => {
    const _findJobFn = vi.fn(async () => null);
    const result = await advanceFullLookChain(baseCtx(), { _findJobFn });
    expect(result).toEqual({ status: "NOT_STARTED" });
  });

  it("FL.19 — refresh recovery: re-derives the exact same in-progress step from DB state alone, same result as before the refresh", async () => {
    const job0 = fakeJob("job-0", { status: "PROCESSING", predictionId: "pred-0" });
    const _findJobFn = vi.fn(async (where: { idempotencyKey: string }) =>
      where.idempotencyKey === getFullLookStepIdempotencyKey("cust-1", 0, null) ? job0 : null,
    );
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify({ status: "processing" }), { status: 200 }),
    );

    const first = await advanceFullLookChain(baseCtx(), { _findJobFn });
    const second = await advanceFullLookChain(baseCtx(), { _findJobFn }); // simulates a browser refresh

    expect(first).toEqual({ status: "PROCESSING", stepIndex: 0 });
    expect(second).toEqual({ status: "PROCESSING", stepIndex: 0 });
  });

  it("FL.20 — an intermediate step completing auto-submits the next step within the same call, capped at 3 total jobs", async () => {
    const job0 = fakeJob("job-0", { status: "PROCESSING", predictionId: "pred-0" });
    const _findJobFn = vi.fn(async (where: { idempotencyKey: string }) =>
      where.idempotencyKey === getFullLookStepIdempotencyKey("cust-1", 0, null) ? job0 : null,
    );
    // Two distinct real calls happen through global.fetch here: the FASHN
    // status check (/v1/status/...) and the prior step's intermediate-image
    // download (buildPrivateDownloadUrl's mocked URL) — each needs its OWN
    // fresh Response (a Response body can only be read once).
    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(async (url: string | URL | Request) => {
      const u = url.toString();
      if (u.includes("/v1/status/")) {
        return new Response(JSON.stringify({ status: "completed", output: [PNG_DATA_URL] }), { status: 200 });
      }
      return new Response(new Uint8Array([1, 2, 3]).buffer, { status: 200 }); // intermediate-image download
    });
    mockUploadPrivate().mockResolvedValue({ ok: true, publicId: "x", format: "png", version: "1" });
    mockAdvance().mockResolvedValueOnce({ ok: true, job: { ...job0, status: "COMPLETED" } }); // step 0 → COMPLETED

    const job1 = fakeJob("job-1");
    mockCreateOrFind().mockResolvedValue({ ok: true, job: job1, created: true });
    mockAdvance().mockResolvedValueOnce({ ok: true, job: { ...job1, status: "SUBMITTED" } });
    mockAdvance().mockResolvedValueOnce({ ok: true, job: { ...job1, status: "PROCESSING", predictionId: "pred-1" } });
    mockSubmitProvider().mockResolvedValue({ ok: true, predictionId: "pred-1" });

    // allowSubmitNext: true — this is now the explicitly-authorized path
    // (what startFullLookOutfit / the "advance" action pass); the default
    // (omitted) is covered separately in FL.20b/FL.20c below.
    const result = await advanceFullLookChain(baseCtx(), { _findJobFn }, undefined, { allowSubmitNext: true });

    expect(result).toEqual({ status: "PROCESSING", stepIndex: 1 });
    expect(mockSubmitProvider()).toHaveBeenCalledTimes(1); // exactly one new FASHN submission this call
  });

  // 2026-11-16 CONFIRMED DEFECT FIX — the exact gate this investigation
  // added: the SAME scenario as FL.20 (an intermediate step completing),
  // but with allowSubmitNext: false (what pollFullLookOutfit/GET always
  // passes now). The current step's result is still recovered and
  // persisted — that part is unconditional and free, the prediction was
  // already paid for — but the next step must NOT be submitted.
  it("FL.20b — with allowSubmitNext: false, the current step's result IS still recovered/persisted, but the next step is NEVER submitted", async () => {
    const job0 = fakeJob("job-0", { status: "PROCESSING", predictionId: "pred-0" });
    const _findJobFn = vi.fn(async (where: { idempotencyKey: string }) =>
      where.idempotencyKey === getFullLookStepIdempotencyKey("cust-1", 0, null) ? job0 : null,
    );
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify({ status: "completed", output: [PNG_DATA_URL] }), { status: 200 }),
    );
    mockUploadPrivate().mockResolvedValue({ ok: true, publicId: "x", format: "png", version: "1" });
    mockAdvance().mockResolvedValueOnce({ ok: true, job: { ...job0, status: "COMPLETED" } }); // step 0 → COMPLETED persisted

    const result = await advanceFullLookChain(baseCtx(), { _findJobFn }, undefined, { allowSubmitNext: false });

    expect(result).toEqual({ status: "STEP_COMPLETE_AWAITING_AUTHORIZATION", completedStepIndex: 0, nextStepIndex: 1 });
    // The recovery/persist call did happen (advanceTryOnJob → COMPLETED)...
    expect(mockAdvance()).toHaveBeenCalledWith(expect.objectContaining({ id: "job-0" }), "COMPLETED", expect.anything());
    // ...but nothing resembling a new submission for step 1 ever happened.
    expect(mockSubmitProvider()).not.toHaveBeenCalled();
    expect(mockCreateOrFind()).not.toHaveBeenCalled();
  });

  // 2026-11-16 — the EXACT real shape of the live Attempt C investigation:
  // a 5-garment chain, ONLY the first garment (index 0) ever submitted, its
  // job locally PROCESSING with a real predictionId FASHN now reports
  // "completed". Written to give a test-verified, precise answer to
  // "exactly what will reconciliation do to this job, the DB, and
  // Cloudinary" before anyone runs it live — not just a narrative
  // description of the code.
  it("FL.20d — PRECISE RECONCILIATION TRACE (Attempt C's real shape): recovers+persists step 1 with exactly one free FASHN status check, exactly one Cloudinary upload scoped to this job, exactly one DB status transition, and NOTHING else — no new submission, no cleanup, no deletion", async () => {
    const ctx = ctxWithGarmentCount(5);
    const attemptCJob = fakeJob("cmwhxjd0w0001l607s25kwvq1", {
      customerId: "cust-1",
      status: "PROCESSING",
      predictionId: "pred-real-attempt-c",
    });
    const _findJobFn = vi.fn(async (where: { idempotencyKey: string }) =>
      where.idempotencyKey === getFullLookStepIdempotencyKey("cust-1", 0, null) ? attemptCJob : null,
    );
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ status: "completed", output: [PNG_DATA_URL] }), { status: 200 }),
    );
    mockUploadPrivate().mockResolvedValue({ ok: true, publicId: "x", format: "png", version: "1" });
    mockAdvance().mockResolvedValueOnce({ ok: true, job: { ...attemptCJob, status: "COMPLETED" } });

    const result = await advanceFullLookChain(ctx, { _findJobFn }, undefined, { allowSubmitNext: false });

    // The one FASHN call: a plain status GET against the EXISTING
    // predictionId — documented elsewhere in this file as free/non-billable.
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // The one Cloudinary write: uploads the already-generated result,
    // scoped by construction to THIS job id and customer only — no other
    // customer's or job's assets are touched, and the deterministic
    // public_id means a retry would overwrite the same asset, never
    // accumulate duplicates.
    expect(mockUploadPrivate()).toHaveBeenCalledTimes(1);
    const [publicIdArg, , deliveryTypeArg] = mockUploadPrivate().mock.calls[0];
    expect(publicIdArg).toBe("naia-tryon-fulllook-intermediate/cust-1/cmwhxjd0w0001l607s25kwvq1");
    expect(deliveryTypeArg).toBe("private");

    // The one DB write: this exact job, PROCESSING -> COMPLETED. No other
    // row is ever touched by this call.
    expect(mockAdvance()).toHaveBeenCalledTimes(1);
    expect(mockAdvance()).toHaveBeenCalledWith(
      expect.objectContaining({ id: "cmwhxjd0w0001l607s25kwvq1" }), "COMPLETED", expect.anything(),
    );

    // Nothing else: no new FASHN prediction, no job creation, no asset
    // deletion/cleanup of any kind.
    expect(mockSubmitProvider()).not.toHaveBeenCalled();
    expect(mockCreateOrFind()).not.toHaveBeenCalled();
    expect(mockDeleteAsset()).not.toHaveBeenCalled();

    // The reported outcome: step 1 done and persisted, step 2 explicitly
    // NOT submitted, awaiting a separate authorized call.
    expect(result).toEqual({ status: "STEP_COMPLETE_AWAITING_AUTHORIZATION", completedStepIndex: 0, nextStepIndex: 1 });
  });

  // 2026-11-16 REVISED — the default flipped from true to false (fail-
  // closed). A second real instance of the confirmed GET-submits-paid-work
  // defect was found in staging.full-look-vto-real.tsx's loader, which
  // called this with no opts at all and inherited whatever the default
  // was. A function whose job is deciding whether to spend real money
  // should never silently default to "yes" for a caller that forgot to
  // say — every caller that actually wants to submit must say so
  // explicitly now.
  it("FL.20c — allowSubmitNext defaults to FALSE when omitted — a caller that forgets to opt in fails closed, not expensive", async () => {
    const job0 = fakeJob("job-0", { status: "PROCESSING", predictionId: "pred-0" });
    const _findJobFn = vi.fn(async (where: { idempotencyKey: string }) =>
      where.idempotencyKey === getFullLookStepIdempotencyKey("cust-1", 0, null) ? job0 : null,
    );
    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(async (url: string | URL | Request) => {
      const u = url.toString();
      if (u.includes("/v1/status/")) {
        return new Response(JSON.stringify({ status: "completed", output: [PNG_DATA_URL] }), { status: 200 });
      }
      return new Response(new Uint8Array([1, 2, 3]).buffer, { status: 200 });
    });
    mockUploadPrivate().mockResolvedValue({ ok: true, publicId: "x", format: "png", version: "1" });
    mockAdvance().mockResolvedValueOnce({ ok: true, job: { ...job0, status: "COMPLETED" } });

    // No 4th argument at all — exactly the shape of a caller that hasn't
    // been updated to know about this gate.
    const result = await advanceFullLookChain(baseCtx(), { _findJobFn });

    expect(result).toEqual({ status: "STEP_COMPLETE_AWAITING_AUTHORIZATION", completedStepIndex: 0, nextStepIndex: 1 });
    expect(mockSubmitProvider()).not.toHaveBeenCalled();
    expect(mockCreateOrFind()).not.toHaveBeenCalled();
  });

  it("FL.21 — a FAILED step reports FAILED with its step index, and is never auto-retried by a later call", async () => {
    const job0 = fakeJob("job-0", { status: "FAILED", errorCode: "PROVIDER_FAILED" });
    const _findJobFn = vi.fn(async (where: { idempotencyKey: string }) =>
      where.idempotencyKey === getFullLookStepIdempotencyKey("cust-1", 0, null) ? job0 : null,
    );

    const result = await advanceFullLookChain(baseCtx(), { _findJobFn });
    expect(result).toEqual({ status: "FAILED", failedStepIndex: 0, errorCode: "PROVIDER_FAILED" });
    expect(mockSubmitProvider()).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled(); // terminal job — no status check even attempted
  });

  it("FL.22 — all 3 steps COMPLETED → COMPLETED with a fresh signed result URL, secured via the real ownership-scoped mechanism", async () => {
    const job0 = fakeJob("job-0", { status: "COMPLETED" });
    const job1 = fakeJob("job-1", { status: "COMPLETED" });
    const job2 = fakeJob("job-2", { status: "COMPLETED" });
    const _findJobFn = vi.fn(async (where: { idempotencyKey: string }) => {
      if (where.idempotencyKey === getFullLookStepIdempotencyKey("cust-1", 0, null)) return job0;
      if (where.idempotencyKey === getFullLookStepIdempotencyKey("cust-1", 1, "job-0")) return job1;
      if (where.idempotencyKey === getFullLookStepIdempotencyKey("cust-1", 2, "job-1")) return job2;
      return null;
    });
    mockBuildResultUrl().mockReturnValue("https://signed.example/final.png");

    const result = await advanceFullLookChain(baseCtx(), { _findJobFn });
    expect(result).toEqual({ status: "COMPLETED", resultUrl: "https://signed.example/final.png" });
    expect(mockBuildResultUrl()).toHaveBeenCalledWith("cust-1", "job-2");
  });

  it("FL.26 — retention: the final step's fresh completion deletes both prior steps' intermediate assets exactly once", async () => {
    const job0 = fakeJob("job-0", { status: "COMPLETED" });
    const job1 = fakeJob("job-1", { status: "COMPLETED" });
    const job2 = fakeJob("job-2", { status: "PROCESSING", predictionId: "pred-2" });
    const _findJobFn = vi.fn(async (where: { idempotencyKey: string }) => {
      if (where.idempotencyKey === getFullLookStepIdempotencyKey("cust-1", 0, null)) return job0;
      if (where.idempotencyKey === getFullLookStepIdempotencyKey("cust-1", 1, "job-0")) return job1;
      if (where.idempotencyKey === getFullLookStepIdempotencyKey("cust-1", 2, "job-1")) return job2;
      return null;
    });
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify({ status: "completed", output: [PNG_DATA_URL] }), { status: 200 }),
    );
    // REGRESSION (2026-11-16): both were plain .mockResolvedValue (not
    // Once) — clearAllMocks() in beforeEach clears call history but NOT a
    // persisted implementation, so this leaked into whichever later test
    // happened to call advanceTryOnJob/uploadTryOnResult without setting
    // its own override first, silently returning THIS test's job id
    // instead. Matches the .mockResolvedValueOnce() convention every
    // other test in this file already uses for exactly this reason.
    mockUploadResult().mockResolvedValueOnce({ ok: true });
    mockAdvance().mockResolvedValueOnce({ ok: true, job: { ...job2, status: "COMPLETED" } });
    mockBuildResultUrl().mockReturnValue("https://signed.example/final.png");

    const result = await advanceFullLookChain(baseCtx(), { _findJobFn });

    expect(result).toEqual({ status: "COMPLETED", resultUrl: "https://signed.example/final.png" });
    expect(mockDeleteAsset()).toHaveBeenCalledTimes(2);
    expect(mockDeleteAsset()).toHaveBeenCalledWith(expect.stringContaining("job-0"), "private");
    expect(mockDeleteAsset()).toHaveBeenCalledWith(expect.stringContaining("job-1"), "private");
    // Never deletes the final step's own asset — that one is the real deliverable, uploaded via uploadTryOnResult.
    for (const call of mockDeleteAsset().mock.calls) {
      expect(String(call[0])).not.toContain("job-2");
    }

    // A SECOND poll against the now-terminal chain must not delete anything again.
    mockDeleteAsset().mockClear();
    const job2Completed = fakeJob("job-2", { status: "COMPLETED" });
    const _findJobFn2 = vi.fn(async (where: { idempotencyKey: string }) => {
      if (where.idempotencyKey === getFullLookStepIdempotencyKey("cust-1", 0, null)) return job0;
      if (where.idempotencyKey === getFullLookStepIdempotencyKey("cust-1", 1, "job-0")) return job1;
      if (where.idempotencyKey === getFullLookStepIdempotencyKey("cust-1", 2, "job-1")) return job2Completed;
      return null;
    });
    await advanceFullLookChain(baseCtx(), { _findJobFn: _findJobFn2 });
    expect(mockDeleteAsset()).not.toHaveBeenCalled();
  });

  it("FL.27 — retention: a fresh FAILED transition on a later step still cleans up the earlier, already-completed steps' intermediate assets", async () => {
    const job0 = fakeJob("job-0", { status: "COMPLETED" });
    const job1 = fakeJob("job-1", { status: "PROCESSING", predictionId: "pred-1" });
    const _findJobFn = vi.fn(async (where: { idempotencyKey: string }) => {
      if (where.idempotencyKey === getFullLookStepIdempotencyKey("cust-1", 0, null)) return job0;
      if (where.idempotencyKey === getFullLookStepIdempotencyKey("cust-1", 1, "job-0")) return job1;
      return null;
    });
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify({ status: "failed", error: "provider error" }), { status: 200 }),
    );
    mockAdvance().mockResolvedValue({ ok: true, job: { ...job1, status: "FAILED" } });

    const result = await advanceFullLookChain(baseCtx(), { _findJobFn });

    expect(result).toEqual({ status: "FAILED", failedStepIndex: 1, errorCode: null });
    expect(mockDeleteAsset()).toHaveBeenCalledTimes(1);
    expect(mockDeleteAsset()).toHaveBeenCalledWith(expect.stringContaining("job-0"), "private");
  });

  it("FL.28 — a delete failure during cleanup is swallowed — the chain's own COMPLETED/FAILED result is unaffected", async () => {
    const job0 = fakeJob("job-0", { status: "COMPLETED" });
    const job1 = fakeJob("job-1", { status: "PROCESSING", predictionId: "pred-1" });
    const _findJobFn = vi.fn(async (where: { idempotencyKey: string }) => {
      if (where.idempotencyKey === getFullLookStepIdempotencyKey("cust-1", 0, null)) return job0;
      if (where.idempotencyKey === getFullLookStepIdempotencyKey("cust-1", 1, "job-0")) return job1;
      return null;
    });
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify({ status: "failed", error: "provider error" }), { status: 200 }),
    );
    mockAdvance().mockResolvedValue({ ok: true, job: { ...job1, status: "FAILED" } });
    mockDeleteAsset().mockRejectedValue(new Error("cloudinary down"));

    const result = await advanceFullLookChain(baseCtx(), { _findJobFn });
    expect(result).toEqual({ status: "FAILED", failedStepIndex: 1, errorCode: null });
  });
});

describe("concurrency — the idempotency reservation, not a client-side lock, is what prevents a double submission", () => {
  it("FL.29 — two concurrent submitFullLookRealStep calls for the same step: only the one createOrFindTryOnJob reports created:true ever reaches the provider", async () => {
    // Simulates createOrFindTryOnJob's own Serializable-transaction race outcome:
    // whichever call wins gets created:true: the other sees the row the winner
    // just inserted. This module's OWN job is to never call submitTryOnToProvider
    // for the created:false branch — that guarantee is what this test checks.
    const winnerJob = fakeJob("job-0");
    let callCount = 0;
    mockCreateOrFind().mockImplementation(async () => {
      callCount += 1;
      if (callCount === 1) return { ok: true, job: winnerJob, created: true };
      return { ok: true, job: { ...winnerJob, status: "PROCESSING", predictionId: "pred-0" }, created: false };
    });
    mockAdvance()
      .mockResolvedValueOnce({ ok: true, job: { ...winnerJob, status: "SUBMITTED" } })
      .mockResolvedValueOnce({ ok: true, job: { ...winnerJob, status: "PROCESSING", predictionId: "pred-0" } });
    mockDownloadPhoto().mockResolvedValue({ ok: true, dataUrl: PNG_DATA_URL });
    mockSubmitProvider().mockResolvedValue({ ok: true, predictionId: "pred-0" });

    const [first, second] = await Promise.all([
      submitFullLookRealStep(baseCtx(), 0, null),
      submitFullLookRealStep(baseCtx(), 0, null),
    ]);

    const results = [first, second];
    const submitted = results.filter((r) => r.ok && !r.alreadySubmitted);
    const resumed = results.filter((r) => r.ok && r.alreadySubmitted);
    expect(submitted.length).toBe(1);
    expect(resumed.length).toBe(1);
    expect(mockSubmitProvider()).toHaveBeenCalledTimes(1); // exactly one real FASHN call, regardless of the race
  });
});

// ── startOrResumeFullLookChain ────────────────────────────────────────────────

describe("startOrResumeFullLookChain", () => {
  it("FL.23 — rejects a chain length other than MAX_CHAIN_LENGTH before any I/O", async () => {
    const ctx = { ...baseCtx(), garments: GARMENTS.slice(0, 2) };
    const result = await startOrResumeFullLookChain(ctx);
    expect(result).toEqual({ ok: false, reason: "invalid_chain_length" });
    expect(mockCooldown()).not.toHaveBeenCalled();
  });

  it("FL.24 — fresh start reconciles any stale job, checks cooldown exactly once, then submits step 0", async () => {
    const _findJobFn = vi.fn(async () => null);
    const _reconcileStale = vi.fn(async () => ({ reconciled: false }));
    mockCooldown().mockResolvedValue({ ok: true });
    const job = fakeJob("job-0");
    mockCreateOrFind().mockResolvedValue({ ok: true, job, created: true });
    mockAdvance()
      .mockResolvedValueOnce({ ok: true, job: { ...job, status: "SUBMITTED" } })
      .mockResolvedValueOnce({ ok: true, job: { ...job, status: "PROCESSING", predictionId: "pred-0" } });
    mockDownloadPhoto().mockResolvedValue({ ok: true, dataUrl: PNG_DATA_URL });
    mockSubmitProvider().mockResolvedValue({ ok: true, predictionId: "pred-0" });

    const result = await startOrResumeFullLookChain(baseCtx(), { _findJobFn }, _reconcileStale);
    expect(result).toEqual({ ok: true, stepIndex: 0 });
    expect(_reconcileStale).toHaveBeenCalledTimes(1);
    expect(_reconcileStale).toHaveBeenCalledWith("cust-1");
    expect(mockCooldown()).toHaveBeenCalledTimes(1);
  });

  it("FL.25 — a chain already in progress resumes without re-checking cooldown, reconciling, or resubmitting step 0 (duplicate-request safe)", async () => {
    const job0 = fakeJob("job-0", { status: "PROCESSING", predictionId: "pred-0" });
    const _findJobFn = vi.fn(async (where: { idempotencyKey: string }) =>
      where.idempotencyKey === getFullLookStepIdempotencyKey("cust-1", 0, null) ? job0 : null,
    );
    const _reconcileStale = vi.fn(async () => ({ reconciled: false }));

    const result = await startOrResumeFullLookChain(baseCtx(), { _findJobFn }, _reconcileStale);
    expect(result).toEqual({ ok: true, stepIndex: 0 });
    expect(_reconcileStale).not.toHaveBeenCalled();
    expect(mockCooldown()).not.toHaveBeenCalled();
    expect(mockSubmitProvider()).not.toHaveBeenCalled();
    expect(mockCreateOrFind()).not.toHaveBeenCalled();
  });

  it("FL.49 — a stale job that reconciliation resolves (TIMED_OUT) no longer blocks the fresh start via cooldown", async () => {
    const _findJobFn = vi.fn(async () => null);
    // Reconciliation itself timed out the old job — checkCustomerCooldown is
    // mocked directly here (its own unit tests cover the real staleness
    // logic), so this just asserts the ORDER: reconcile runs, then cooldown
    // is consulted (and, in this scenario, now correctly sees no active job).
    const callOrder: string[] = [];
    const _reconcileStale = vi.fn(async () => {
      callOrder.push("reconcile");
      return { reconciled: true, outcome: "TIMED_OUT" as const };
    });
    mockCooldown().mockImplementation(async () => {
      callOrder.push("cooldown");
      return { ok: true };
    });
    const job = fakeJob("job-0");
    mockCreateOrFind().mockResolvedValue({ ok: true, job, created: true });
    mockAdvance()
      .mockResolvedValueOnce({ ok: true, job: { ...job, status: "SUBMITTED" } })
      .mockResolvedValueOnce({ ok: true, job: { ...job, status: "PROCESSING", predictionId: "pred-0" } });
    mockDownloadPhoto().mockResolvedValue({ ok: true, dataUrl: PNG_DATA_URL });
    mockSubmitProvider().mockResolvedValue({ ok: true, predictionId: "pred-0" });

    const result = await startOrResumeFullLookChain(baseCtx(), { _findJobFn }, _reconcileStale);
    expect(result).toEqual({ ok: true, stepIndex: 0 });
    expect(callOrder).toEqual(["reconcile", "cooldown"]);
  });

  // ── PERMANENT FIX regression tests (2026-11-15) ───────────────────────────
  //
  // Root cause, confirmed live on staging: reconcileStaleFullLookJobForCustomer's
  // own TIMED_OUT write bumps that row's lastActivityAt to "now," which can
  // itself trip checkCustomerCooldown's 2-second anti-double-tap COOLDOWN
  // guard on the SAME request — a false rejection caused entirely by our
  // own cleanup, never a real customer action. The fix narrowly bypasses
  // COOLDOWN only when THIS request's own reconciliation call just
  // force-timed-out the EXACT row cooldown is now looking at (matched by
  // job id, never by errorCode alone — an errorCode match could belong to
  // an older, unrelated job from a past request and would incorrectly
  // bypass a genuine customer cooldown on a different job entirely).
  describe("permanent fix — self-generated COOLDOWN bypass is narrowly request-scoped", () => {
    it("FIX.1 — a self-generated COOLDOWN (same job id reconciliation just timed out) is bypassed; the fresh start proceeds", async () => {
      const _findJobFn = vi.fn(async () => null);
      const _reconcileStale = vi.fn(async () => ({ reconciled: true, outcome: "TIMED_OUT" as const, jobId: "job-stale" }));
      mockCooldown().mockResolvedValue({ ok: false, reason: "COOLDOWN", retryAfterMs: 1800 });
      const _findMostRecentJob = vi.fn(async () => fakeJob("job-stale", { status: "TIMED_OUT", errorCode: "ABANDONED_NO_POLL" }));
      const job = fakeJob("job-0");
      mockCreateOrFind().mockResolvedValue({ ok: true, job, created: true });
      mockAdvance()
        .mockResolvedValueOnce({ ok: true, job: { ...job, status: "SUBMITTED" } })
        .mockResolvedValueOnce({ ok: true, job: { ...job, status: "PROCESSING", predictionId: "pred-0" } });
      mockDownloadPhoto().mockResolvedValue({ ok: true, dataUrl: PNG_DATA_URL });
      mockSubmitProvider().mockResolvedValue({ ok: true, predictionId: "pred-0" });

      const result = await startOrResumeFullLookChain(baseCtx(), { _findJobFn }, _reconcileStale, _findMostRecentJob);

      expect(result).toEqual({ ok: true, stepIndex: 0 });
      expect(mockSubmitProvider()).toHaveBeenCalledTimes(1); // exactly one legitimate new submission
      expect(mockCreateOrFind()).toHaveBeenCalledTimes(1); // exactly one new job row — no duplicate
    });

    it("FIX.2 — a genuine double-tap COOLDOWN (reconciliation found nothing this request) is still correctly blocked", async () => {
      const _findJobFn = vi.fn(async () => null);
      const _reconcileStale = vi.fn(async () => ({ reconciled: false })); // nothing to reconcile — this really is just a rapid re-click
      mockCooldown().mockResolvedValue({ ok: false, reason: "COOLDOWN", retryAfterMs: 1200 });
      const _findMostRecentJob = vi.fn(async () => fakeJob("job-recent", { status: "COMPLETED" }));

      const result = await startOrResumeFullLookChain(baseCtx(), { _findJobFn }, _reconcileStale, _findMostRecentJob);

      expect(result).toEqual({ ok: false, reason: "COOLDOWN" });
      expect(mockSubmitProvider()).not.toHaveBeenCalled();
      expect(mockCreateOrFind()).not.toHaveBeenCalled();
    });

    it("FIX.3 — ACTIVE_JOB is NEVER bypassed, even if reconciliation just timed out a job this same request", async () => {
      const _findJobFn = vi.fn(async () => null);
      // Reconciliation resolved ONE stale job, but a DIFFERENT job is
      // genuinely still active (e.g. a second, independent in-flight
      // Full-Look chain under a different scope) — ACTIVE_JOB must still block.
      const _reconcileStale = vi.fn(async () => ({ reconciled: true, outcome: "TIMED_OUT" as const, jobId: "job-stale" }));
      mockCooldown().mockResolvedValue({ ok: false, reason: "ACTIVE_JOB" });
      const _findMostRecentJob = vi.fn(async () => fakeJob("job-stale", { status: "TIMED_OUT", errorCode: "ABANDONED_NO_POLL" }));

      const result = await startOrResumeFullLookChain(baseCtx(), { _findJobFn }, _reconcileStale, _findMostRecentJob);

      expect(result).toEqual({ ok: false, reason: "ACTIVE_JOB" });
      expect(mockSubmitProvider()).not.toHaveBeenCalled();
    });

    it("FIX.4 — a COOLDOWN on a DIFFERENT job than the one reconciliation just resolved is still correctly blocked (not matched by errorCode alone)", async () => {
      const _findJobFn = vi.fn(async () => null);
      const _reconcileStale = vi.fn(async () => ({ reconciled: true, outcome: "TIMED_OUT" as const, jobId: "job-stale-OLD" }));
      mockCooldown().mockResolvedValue({ ok: false, reason: "COOLDOWN", retryAfterMs: 500 });
      // The row cooldown is actually looking at is a DIFFERENT, more
      // recent job that merely shares the same errorCode by coincidence
      // (e.g. an older abandonment from a past, unrelated request) — must
      // never be treated as "this request's own cleanup."
      const _findMostRecentJob = vi.fn(async () => fakeJob("job-different", { status: "TIMED_OUT", errorCode: "ABANDONED_NO_POLL" }));

      const result = await startOrResumeFullLookChain(baseCtx(), { _findJobFn }, _reconcileStale, _findMostRecentJob);

      expect(result).toEqual({ ok: false, reason: "COOLDOWN" });
      expect(mockSubmitProvider()).not.toHaveBeenCalled();
    });

    it("FIX.5 — reconciliation outcome COMPLETED/FAILED (a genuine FASHN-reported result, not our own abandonment) never bypasses COOLDOWN — the anti-double-tap courtesy window still applies to a real completion", async () => {
      const _findJobFn = vi.fn(async () => null);
      const _reconcileStale = vi.fn(async () => ({ reconciled: true, outcome: "COMPLETED" as const, jobId: "job-stale" }));
      mockCooldown().mockResolvedValue({ ok: false, reason: "COOLDOWN", retryAfterMs: 1900 });
      const _findMostRecentJob = vi.fn(async () => fakeJob("job-stale", { status: "COMPLETED" }));

      const result = await startOrResumeFullLookChain(baseCtx(), { _findJobFn }, _reconcileStale, _findMostRecentJob);

      expect(result).toEqual({ ok: false, reason: "COOLDOWN" });
      expect(mockSubmitProvider()).not.toHaveBeenCalled();
    });

    it("FIX.6 — an already-in-progress chain (existing attempt, jobs.length > 0) never reaches cooldown or the bypass logic at all — resume path fully unaffected", async () => {
      const job0 = fakeJob("job-0", { status: "PROCESSING", predictionId: "pred-0" });
      const _findJobFn = vi.fn(async (where: { idempotencyKey: string }) =>
        where.idempotencyKey === getFullLookStepIdempotencyKey("cust-1", 0, null) ? job0 : null,
      );
      const _reconcileStale = vi.fn(async () => ({ reconciled: false }));
      const _findMostRecentJob = vi.fn();

      const result = await startOrResumeFullLookChain(baseCtx(), { _findJobFn }, _reconcileStale, _findMostRecentJob);

      expect(result).toEqual({ ok: true, stepIndex: 0 });
      expect(_reconcileStale).not.toHaveBeenCalled();
      expect(mockCooldown()).not.toHaveBeenCalled();
      expect(_findMostRecentJob).not.toHaveBeenCalled();
    });

    it("FIX.7 — single-item VTO isolation: a single-item job blocking COOLDOWN is never bypassed, even when reconciliation separately resolved an unrelated Full-Look job this same request", async () => {
      const _findJobFn = vi.fn(async () => null);
      // Reconciliation is scoped to productHandle "fulllook-real:" only
      // (defaultFindActiveFullLookJobForCustomer) — it can resolve a
      // Full-Look job, but can never find or touch a single-item VTO job.
      // Here it resolved its own (different) Full-Look job...
      const _reconcileStale = vi.fn(async () => ({ reconciled: true, outcome: "TIMED_OUT" as const, jobId: "fulllook-job" }));
      mockCooldown().mockResolvedValue({ ok: false, reason: "COOLDOWN", retryAfterMs: 1700 });
      // ...but the row checkCustomerCooldown is ACTUALLY blocking on is a
      // genuinely-recent SINGLE-ITEM VTO completion — checkCustomerCooldown
      // itself is customer-wide, not Full-Look-scoped, by design (shared
      // with single-item VTO, unmodified by this fix).
      const _findMostRecentJob = vi.fn(async () => fakeJob("single-item-job", { status: "COMPLETED", productHandle: "some-closet-item-handle" }));

      const result = await startOrResumeFullLookChain(baseCtx(), { _findJobFn }, _reconcileStale, _findMostRecentJob);

      expect(result).toEqual({ ok: false, reason: "COOLDOWN" });
      expect(mockSubmitProvider()).not.toHaveBeenCalled();
      // checkCustomerCooldown's own single-item VTO protection is completely untouched by this fix.
      expect(mockCooldown()).toHaveBeenCalledWith("cust-1");
    });
  });

});

// ── reconcileStaleFullLookJobForCustomer ────────────────────────────────────

describe("reconcileStaleFullLookJobForCustomer", () => {
  it("FL.50 — no active Full-Look job for this customer: no-op, no FASHN call", async () => {
    const _findActiveJob = vi.fn(async () => null);
    const _pollStep = vi.fn();
    const _timeoutJob = vi.fn();
    const _findById = vi.fn();
    const result = await reconcileStaleFullLookJobForCustomer(
      "cust-1", STALE_PROCESSING_THRESHOLD_MS, _findActiveJob, _pollStep, _timeoutJob, _findById,
    );
    expect(result).toEqual({ reconciled: false });
    expect(_pollStep).not.toHaveBeenCalled();
  });

  it("FL.51 — an active job younger than the threshold is left untouched (preserves real concurrent-generation blocking)", async () => {
    const freshJob = fakeJob("job-fresh", {
      status: "PROCESSING",
      predictionId: "pred-1",
      lastActivityAt: new Date(Date.now() - 60_000), // 1 minute old
    });
    const _findActiveJob = vi.fn(async () => freshJob);
    const _pollStep = vi.fn();
    const _timeoutJob = vi.fn();
    const _findById = vi.fn();
    const result = await reconcileStaleFullLookJobForCustomer(
      "cust-1", STALE_PROCESSING_THRESHOLD_MS, _findActiveJob, _pollStep, _timeoutJob, _findById,
    );
    expect(result).toEqual({ reconciled: false });
    expect(_pollStep).not.toHaveBeenCalled(); // never even checks FASHN for a genuinely fresh job
    expect(_timeoutJob).not.toHaveBeenCalled();
  });

  it("FL.52 — a stale job that FASHN reports as actually COMPLETED is recovered, not timed out", async () => {
    const staleJob = fakeJob("job-stale", {
      status: "PROCESSING",
      predictionId: "pred-1",
      productHandle: `${REAL_PRODUCT_HANDLE_PREFIX}:final:Blazer`,
      lastActivityAt: new Date(Date.now() - 20 * 60 * 1000), // 20 minutes old
    });
    const _findActiveJob = vi.fn(async () => staleJob);
    const _pollStep = vi.fn(async () => ({ status: "COMPLETED" as const, job: staleJob, resultUrl: "https://result.example/x" }));
    const _timeoutJob = vi.fn();
    const _findById = vi.fn();
    const result = await reconcileStaleFullLookJobForCustomer(
      "cust-1", STALE_PROCESSING_THRESHOLD_MS, _findActiveJob, _pollStep, _timeoutJob, _findById,
    );
    expect(result).toEqual({ reconciled: true, outcome: "COMPLETED", jobId: "job-stale" });
    expect(_timeoutJob).not.toHaveBeenCalled();
    // The synthetic ctx passed to pollStep must correctly encode "final" so
    // the real function's isFinal branch (stepIndex === garments.length-1)
    // evaluates true for this job's own role.
    const call = _pollStep.mock.calls[0] as unknown as [FullLookChainContext, VirtualTryOnJobRecord, number];
    const [passedCtx, , stepIndex] = call;
    expect(stepIndex).toBe(0);
    expect(passedCtx.garments.length - 1).toBe(stepIndex);
  });

  it("FL.53 — a stale job FASHN still reports in-flight is force-transitioned to TIMED_OUT via the atomic guard, with ancestor cleanup", async () => {
    const staleJob = fakeJob("job-stale", {
      status: "PROCESSING",
      predictionId: "pred-1",
      productHandle: `${REAL_PRODUCT_HANDLE_PREFIX}:final:Blazer`,
      idempotencyKey: "fulllook-real-step:prior-job-id:2",
      lastActivityAt: new Date(Date.now() - 20 * 60 * 1000),
    });
    const priorJob = fakeJob("prior-job-id", { status: "COMPLETED" });
    const _findActiveJob = vi.fn(async () => staleJob);
    const _pollStep = vi.fn(async () => ({ status: "PROCESSING" as const }));
    const _timeoutJob = vi.fn(async () => true);
    const _findById = vi.fn(async (id: string) => (id === "prior-job-id" ? priorJob : null));

    const result = await reconcileStaleFullLookJobForCustomer(
      "cust-1", STALE_PROCESSING_THRESHOLD_MS, _findActiveJob, _pollStep, _timeoutJob, _findById,
    );
    expect(result).toEqual({ reconciled: true, outcome: "TIMED_OUT", jobId: "job-stale" });
    expect(_timeoutJob).toHaveBeenCalledWith("job-stale");
    expect(mockDeleteAsset()).toHaveBeenCalled();
  });

  it("FL.54 — a race where a real poll resolves the job between find and timeout leaves that outcome untouched", async () => {
    const staleJob = fakeJob("job-stale", {
      status: "PROCESSING",
      predictionId: "pred-1",
      lastActivityAt: new Date(Date.now() - 20 * 60 * 1000),
    });
    const _findActiveJob = vi.fn(async () => staleJob);
    const _pollStep = vi.fn(async () => ({ status: "PROCESSING" as const }));
    const _timeoutJob = vi.fn(async () => false); // conditional update found 0 rows — already resolved elsewhere
    const _findById = vi.fn();

    const result = await reconcileStaleFullLookJobForCustomer(
      "cust-1", STALE_PROCESSING_THRESHOLD_MS, _findActiveJob, _pollStep, _timeoutJob, _findById,
    );
    expect(result).toEqual({ reconciled: false });
  });

  it("FL.55 — a stale job FASHN reports as failed is reported FAILED, not forced to TIMED_OUT", async () => {
    const staleJob = fakeJob("job-stale", {
      status: "PROCESSING",
      predictionId: "pred-1",
      lastActivityAt: new Date(Date.now() - 20 * 60 * 1000),
    });
    const _findActiveJob = vi.fn(async () => staleJob);
    const _pollStep = vi.fn(async () => ({ status: "FAILED" as const, job: staleJob }));
    const _timeoutJob = vi.fn();
    const _findById = vi.fn();

    const result = await reconcileStaleFullLookJobForCustomer(
      "cust-1", STALE_PROCESSING_THRESHOLD_MS, _findActiveJob, _pollStep, _timeoutJob, _findById,
    );
    expect(result).toEqual({ reconciled: true, outcome: "FAILED", jobId: "job-stale" });
    expect(_timeoutJob).not.toHaveBeenCalled();
  });
});

// ── End-to-end: a PLAIN REFRESH or "Check Again" recovers a stale chain ─────
//
// reconcileStaleFullLookJobForCustomer only ever runs from
// startOrResumeFullLookChain, which short-circuits as soon as a chain has
// ANY job under its own reservationScope (walkFullLookChainJobs returns
// jobs.length > 0) — exactly the case for a customer simply refreshing the
// result page (pollFullLookOutfit -> advanceAutomatically -> advanceFullLookChain,
// no cooldown check, no reconciliation call at all) or clicking the
// non-destructive "Check Again" (retry:false -> resolveCurrentAttemptScope
// resolves to the SAME scope -> startOrResumeFullLookChain's own
// jobs.length > 0 branch -> advanceAutomatically -> advanceFullLookChain,
// same path). Only an explicit "Try Again" (retry:true) computes a brand
// new scope and ever reaches checkCustomerCooldown/reconciliation.
// advanceFullLookChain's OWN staleness check (added alongside
// reconcileStaleFullLookJobForCustomer) is what makes THIS path recover
// too — these tests prove that path specifically, end to end, including
// the "no new FASHN submission" guarantee.
describe("advanceFullLookChain — stale-job self-healing via refresh/resume (no new FASHN submission)", () => {
  it("FL.56 — a refresh (advanceFullLookChain on the SAME scope) force-times-out a step FASHN still reports in flight, without creating or submitting a new job", async () => {
    const staleJob0 = fakeJob("job-0", {
      status: "PROCESSING",
      predictionId: "pred-0",
      lastActivityAt: new Date(Date.now() - 20 * 60 * 1000), // 20 min — well past the 10-min threshold
    });
    const _findJobFn = vi.fn(async (where: { idempotencyKey: string }) =>
      where.idempotencyKey === getFullLookStepIdempotencyKey("cust-1", 0, null) ? staleJob0 : null,
    );
    // FASHN still genuinely reports it in flight — not a recoverable result.
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify({ status: "processing" }), { status: 200 }),
    );
    const _timeoutJob = vi.fn(async () => true);
    const _findById = vi.fn(async () => null);

    const result = await advanceFullLookChain(baseCtx(), { _findJobFn }, {
      _timeoutJob, _findById, _deleteAsset: deleteCloudinaryAsset,
    });

    expect(result).toEqual({ status: "FAILED", failedStepIndex: 0, errorCode: "ABANDONED_NO_POLL" });
    expect(_timeoutJob).toHaveBeenCalledWith("job-0");
    // The customer recovers from a simple refresh/"Check Again" — never a
    // new provider call, never a new job row, never a second charge.
    expect(mockSubmitProvider()).not.toHaveBeenCalled();
    expect(mockCreateOrFind()).not.toHaveBeenCalled();
  });

  it("FL.57 — a refresh recovers a step FASHN actually completed (just never got polled in time), without forcing TIMED_OUT or submitting anything new", async () => {
    const staleJob0 = fakeJob("job-0", {
      status: "PROCESSING",
      predictionId: "pred-0",
      productHandle: `${REAL_PRODUCT_HANDLE_PREFIX}:step1:Beige Tailored Trousers`,
      lastActivityAt: new Date(Date.now() - 20 * 60 * 1000),
    });
    const _findJobFn = vi.fn(async (where: { idempotencyKey: string }) =>
      where.idempotencyKey === getFullLookStepIdempotencyKey("cust-1", 0, null) ? staleJob0 : null,
    );
    // Two distinct real calls happen through global.fetch: the FASHN status
    // check for step 0, and step 1's download of step 0's now-completed
    // intermediate image — each needs its own fresh Response (see the
    // identical pattern a few tests above this one, for a non-stale chain).
    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(async (url: string | URL | Request) => {
      const u = url.toString();
      if (u.includes("/v1/status/")) {
        return new Response(JSON.stringify({ status: "completed", output: [PNG_DATA_URL] }), { status: 200 });
      }
      return new Response(new Uint8Array([1, 2, 3]).buffer, { status: 200 });
    });
    mockUploadPrivate().mockResolvedValue({ ok: true, publicId: "x", format: "png", version: "1" });
    mockAdvance().mockResolvedValueOnce({ ok: true, job: { ...staleJob0, status: "COMPLETED" } }); // step 0 recovered → COMPLETED

    const job1 = fakeJob("job-1");
    mockCreateOrFind().mockResolvedValue({ ok: true, job: job1, created: true });
    mockAdvance().mockResolvedValueOnce({ ok: true, job: { ...job1, status: "SUBMITTED" } });
    mockAdvance().mockResolvedValueOnce({ ok: true, job: { ...job1, status: "PROCESSING", predictionId: "pred-1" } });
    mockSubmitProvider().mockResolvedValue({ ok: true, predictionId: "pred-1" });

    const _timeoutJob = vi.fn();
    const _findById = vi.fn();

    // allowSubmitNext: true — this test is about the authorized path
    // (the "advance"/startFullLookOutfit call that follows a recovery);
    // the title's "without... submitting anything new" refers to never
    // RESUBMITTING step 0 itself, not to step 1's own legitimate submission.
    const result = await advanceFullLookChain(baseCtx(), { _findJobFn }, {
      _timeoutJob, _findById, _deleteAsset: deleteCloudinaryAsset,
    }, { allowSubmitNext: true });

    expect(result).toEqual({ status: "PROCESSING", stepIndex: 1 }); // step 0 recovered; step 1 auto-submitted next
    expect(_timeoutJob).not.toHaveBeenCalled(); // never forced dead once FASHN proved it actually finished
    expect(mockSubmitProvider()).toHaveBeenCalledTimes(1); // the NEXT step's own legitimate submission, not a resubmission of step 0
  });

  it("FL.58 — calling advanceFullLookChain again after a forced TIMED_OUT reports the same FAILED state without re-checking FASHN or re-timing-out", async () => {
    const timedOutJob0 = fakeJob("job-0", { status: "TIMED_OUT", errorCode: "ABANDONED_NO_POLL" });
    const _findJobFn = vi.fn(async (where: { idempotencyKey: string }) =>
      where.idempotencyKey === getFullLookStepIdempotencyKey("cust-1", 0, null) ? timedOutJob0 : null,
    );
    const _timeoutJob = vi.fn();

    const result = await advanceFullLookChain(baseCtx(), { _findJobFn }, {
      _timeoutJob, _findById: vi.fn(), _deleteAsset: deleteCloudinaryAsset,
    });

    expect(result).toEqual({ status: "FAILED", failedStepIndex: 0, errorCode: "ABANDONED_NO_POLL" });
    expect(_timeoutJob).not.toHaveBeenCalled(); // already terminal — the early status check short-circuits before any FASHN I/O
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

// ── Prompt placement (2026-11-03) — final-step-only visual-fidelity tuning ──
//
// ctxWithFinalStepTuning carries finalStepPrompt/finalStepGenerationMode,
// unlike baseCtx() (which every test above this point already exercises
// WITHOUT these fields — real, continuous regression coverage that omitting
// them changes nothing). These tests confirm the one new behavior: the
// tuning reaches submitTryOnToProvider for the FINAL step only, and job
// tracking / retention cleanup are otherwise unaffected.

describe("prompt placement — final step only", () => {
  const FINAL_PROMPT = "Wear the beige tailored blazer open over the existing blue chambray shirt.";

  function ctxWithFinalStepTuning(): FullLookChainContext {
    return { ...baseCtx(), finalStepPrompt: FINAL_PROMPT, finalStepGenerationMode: "quality" };
  }

  it("FL.30 — step 0 (trousers) never receives the final-step prompt or generationMode, even though ctx carries them", async () => {
    const job = fakeJob("job-0");
    mockCreateOrFind().mockResolvedValue({ ok: true, job, created: true });
    mockAdvance()
      .mockResolvedValueOnce({ ok: true, job: { ...job, status: "SUBMITTED" } })
      .mockResolvedValueOnce({ ok: true, job: { ...job, status: "PROCESSING", predictionId: "pred-0" } });
    mockDownloadPhoto().mockResolvedValue({ ok: true, dataUrl: PNG_DATA_URL });
    mockSubmitProvider().mockResolvedValue({ ok: true, predictionId: "pred-0" });

    await submitFullLookRealStep(ctxWithFinalStepTuning(), 0, null);

    const submittedInput = mockSubmitProvider().mock.calls[0][0];
    expect(submittedInput.prompt).toBeUndefined();
    expect(submittedInput.generationMode).toBeUndefined();
  });

  it("FL.31 — step 1 (shirt) also never receives the final-step prompt or generationMode", async () => {
    const job = fakeJob("job-1");
    mockCreateOrFind().mockResolvedValue({ ok: true, job, created: true });
    mockAdvance()
      .mockResolvedValueOnce({ ok: true, job: { ...job, status: "SUBMITTED" } })
      .mockResolvedValueOnce({ ok: true, job: { ...job, status: "PROCESSING", predictionId: "pred-1" } });
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3]).buffer, { status: 200 }),
    );
    mockSubmitProvider().mockResolvedValue({ ok: true, predictionId: "pred-1" });

    await submitFullLookRealStep(ctxWithFinalStepTuning(), 1, "job-0");

    const submittedInput = mockSubmitProvider().mock.calls[0][0];
    expect(submittedInput.prompt).toBeUndefined();
    expect(submittedInput.generationMode).toBeUndefined();
  });

  it("FL.32 — step 2 (blazer, final) receives exactly ctx's finalStepPrompt and finalStepGenerationMode", async () => {
    const job = fakeJob("job-2");
    mockCreateOrFind().mockResolvedValue({ ok: true, job, created: true });
    mockAdvance()
      .mockResolvedValueOnce({ ok: true, job: { ...job, status: "SUBMITTED" } })
      .mockResolvedValueOnce({ ok: true, job: { ...job, status: "PROCESSING", predictionId: "pred-2" } });
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3]).buffer, { status: 200 }),
    );
    mockSubmitProvider().mockResolvedValue({ ok: true, predictionId: "pred-2" });

    await submitFullLookRealStep(ctxWithFinalStepTuning(), 2, "job-1");

    const submittedInput = mockSubmitProvider().mock.calls[0][0];
    expect(submittedInput.prompt).toBe(FINAL_PROMPT);
    expect(submittedInput.generationMode).toBe("quality");
  });

  it("FL.33 — a caller that never sets finalStepPrompt/finalStepGenerationMode (e.g. baseCtx()) still submits the final step with both undefined — no silent default is invented here", async () => {
    const job = fakeJob("job-2");
    mockCreateOrFind().mockResolvedValue({ ok: true, job, created: true });
    mockAdvance()
      .mockResolvedValueOnce({ ok: true, job: { ...job, status: "SUBMITTED" } })
      .mockResolvedValueOnce({ ok: true, job: { ...job, status: "PROCESSING", predictionId: "pred-2" } });
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3]).buffer, { status: 200 }),
    );
    mockSubmitProvider().mockResolvedValue({ ok: true, predictionId: "pred-2" });

    await submitFullLookRealStep(baseCtx(), 2, "job-1"); // baseCtx has no finalStep* fields

    const submittedInput = mockSubmitProvider().mock.calls[0][0];
    expect(submittedInput.prompt).toBeUndefined();
    expect(submittedInput.generationMode).toBeUndefined();
  });

  it("FL.34 — job tracking is unaffected: idempotency key and productHandle for the final step are identical with or without the prompt/mode tuning", async () => {
    const job = fakeJob("job-2");
    mockCreateOrFind().mockResolvedValue({ ok: true, job, created: true });
    mockAdvance()
      .mockResolvedValueOnce({ ok: true, job: { ...job, status: "SUBMITTED" } })
      .mockResolvedValueOnce({ ok: true, job: { ...job, status: "PROCESSING", predictionId: "pred-2" } });
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3]).buffer, { status: 200 }),
    );
    mockSubmitProvider().mockResolvedValue({ ok: true, predictionId: "pred-2" });

    await submitFullLookRealStep(ctxWithFinalStepTuning(), 2, "job-1");

    const createArgs = mockCreateOrFind().mock.calls[0][0];
    expect(createArgs.idempotencyKey).toBe(getFullLookStepIdempotencyKey("cust-1", 2, "job-1"));
    expect(createArgs.productHandle).toBe(`${REAL_PRODUCT_HANDLE_PREFIX}:final:Beige Tailored Blazer`);
  });

  it("FL.35 — retention cleanup still fires normally on a chain that used the final-step tuning", async () => {
    const job0 = fakeJob("job-0", { status: "COMPLETED" });
    const job1 = fakeJob("job-1", { status: "COMPLETED" });
    const job2 = fakeJob("job-2", { status: "PROCESSING", predictionId: "pred-2" });
    const _findJobFn = vi.fn(async (where: { idempotencyKey: string }) => {
      if (where.idempotencyKey === getFullLookStepIdempotencyKey("cust-1", 0, null)) return job0;
      if (where.idempotencyKey === getFullLookStepIdempotencyKey("cust-1", 1, "job-0")) return job1;
      if (where.idempotencyKey === getFullLookStepIdempotencyKey("cust-1", 2, "job-1")) return job2;
      return null;
    });
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify({ status: "completed", output: [PNG_DATA_URL] }), { status: 200 }),
    );
    // REGRESSION (2026-11-16): both were plain .mockResolvedValue (not
    // Once) — clearAllMocks() in beforeEach clears call history but NOT a
    // persisted implementation, so this leaked into whichever later test
    // happened to call advanceTryOnJob/uploadTryOnResult without setting
    // its own override first, silently returning THIS test's job id
    // instead. Matches the .mockResolvedValueOnce() convention every
    // other test in this file already uses for exactly this reason.
    mockUploadResult().mockResolvedValueOnce({ ok: true });
    mockAdvance().mockResolvedValueOnce({ ok: true, job: { ...job2, status: "COMPLETED" } });
    mockBuildResultUrl().mockReturnValue("https://signed.example/final.png");

    const result = await advanceFullLookChain(ctxWithFinalStepTuning(), { _findJobFn });

    expect(result).toEqual({ status: "COMPLETED", resultUrl: "https://signed.example/final.png" });
    expect(mockDeleteAsset()).toHaveBeenCalledTimes(2); // job-0 and job-1's intermediates, unchanged behavior
  });
});

// ── Duplicate/concurrent GET-equivalent requests — CONFIRMED DEFECT FIX ─────
// Requirement: page loads, polling, refreshes and duplicate requests must
// never trigger an unapproved paid FASHN prediction, and an existing
// completed provider result must be reused safely, not re-fetched or
// re-submitted.

describe("advanceFullLookChain — duplicate/concurrent polls with allowSubmitNext: false reuse the recovered result safely", () => {
  it("two consecutive calls (simulating a duplicate request or rapid refresh): the FIRST recovers+persists the completed step and reports AWAITING_AUTHORIZATION; the SECOND finds it already COMPLETED locally, makes ZERO additional FASHN calls, and reports the identical AWAITING_AUTHORIZATION — no re-fetch, no re-submission, no double charge", async () => {
    const job0 = fakeJob("job-0", { status: "PROCESSING", predictionId: "pred-0" });
    let currentJob0 = job0;
    const _findJobFn = vi.fn(async (where: { idempotencyKey: string }) =>
      where.idempotencyKey === getFullLookStepIdempotencyKey("cust-1", 0, null) ? currentJob0 : null,
    );
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockImplementation(async () =>
      new Response(JSON.stringify({ status: "completed", output: [PNG_DATA_URL] }), { status: 200 }),
    );
    mockUploadPrivate().mockResolvedValue({ ok: true, publicId: "x", format: "png", version: "1" });
    mockAdvance().mockResolvedValueOnce({ ok: true, job: { ...job0, status: "COMPLETED" } });

    const first = await advanceFullLookChain(baseCtx(), { _findJobFn }, undefined, { allowSubmitNext: false });
    expect(first).toEqual({ status: "STEP_COMPLETE_AWAITING_AUTHORIZATION", completedStepIndex: 0, nextStepIndex: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(1); // one real FASHN status check — already free/non-billable per its own contract

    // The "DB" now reflects what the first call just persisted — exactly
    // what a second, duplicate request would actually see.
    currentJob0 = { ...job0, status: "COMPLETED" };
    fetchMock.mockClear();
    mockSubmitProvider().mockClear();

    const second = await advanceFullLookChain(baseCtx(), { _findJobFn }, undefined, { allowSubmitNext: false });
    expect(second).toEqual({ status: "STEP_COMPLETE_AWAITING_AUTHORIZATION", completedStepIndex: 0, nextStepIndex: 1 });
    expect(fetchMock).not.toHaveBeenCalled(); // locally COMPLETED — pollFullLookRealStep's own short-circuit, no FASHN call at all
    expect(mockSubmitProvider()).not.toHaveBeenCalled(); // and definitely no new submission either way
  });
});

// ── QA pause checkpoint — fresh transition and stable re-poll ───────────────

describe("advanceFullLookChain — pause before the final (blazer) step", () => {
  it("FL.36 — a FRESH shirt completion returns AWAITING_CONTINUE instead of auto-submitting the blazer", async () => {
    const job0 = fakeJob("job-0", { status: "COMPLETED" });
    const job1 = fakeJob("job-1", { status: "PROCESSING", predictionId: "pred-1" });
    const _findJobFn = vi.fn(async (where: { idempotencyKey: string }) => {
      if (where.idempotencyKey === getFullLookStepIdempotencyKey("cust-1", 0, null)) return job0;
      if (where.idempotencyKey === getFullLookStepIdempotencyKey("cust-1", 1, "job-0")) return job1;
      return null;
    });
    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(async (url: string | URL | Request) => {
      const u = url.toString();
      if (u.includes("/v1/status/")) {
        return new Response(JSON.stringify({ status: "completed", output: [PNG_DATA_URL] }), { status: 200 });
      }
      return new Response(new Uint8Array([1, 2, 3]).buffer, { status: 200 });
    });
    mockUploadPrivate().mockResolvedValue({ ok: true, publicId: "x", format: "png", version: "1" });
    mockAdvance().mockResolvedValueOnce({ ok: true, job: { ...job1, status: "COMPLETED" } });

    const result = await advanceFullLookChain(baseCtx(), { _findJobFn });

    expect(result.status).toBe("AWAITING_CONTINUE");
    if (result.status === "AWAITING_CONTINUE") {
      expect(result.intermediates.map((p) => p.stepIndex)).toEqual([0, 1]);
      expect(result.intermediates[0].url).toContain("job-0");
      expect(result.intermediates[1].url).toContain("job-1");
    }
    expect(mockSubmitProvider()).not.toHaveBeenCalled(); // blazer NEVER auto-submitted
    expect(mockDeleteAsset()).not.toHaveBeenCalled(); // images still needed for review — not cleaned up yet
  });

  it("FL.37 — a repeated poll while paused returns the SAME AWAITING_CONTINUE, with zero FASHN calls (fast path)", async () => {
    const job0 = fakeJob("job-0", { status: "COMPLETED" });
    const job1 = fakeJob("job-1", { status: "COMPLETED" }); // already resolved by an earlier poll
    const _findJobFn = vi.fn(async (where: { idempotencyKey: string }) => {
      if (where.idempotencyKey === getFullLookStepIdempotencyKey("cust-1", 0, null)) return job0;
      if (where.idempotencyKey === getFullLookStepIdempotencyKey("cust-1", 1, "job-0")) return job1;
      return null;
    });

    const result = await advanceFullLookChain(baseCtx(), { _findJobFn });

    expect(result.status).toBe("AWAITING_CONTINUE");
    expect(global.fetch).not.toHaveBeenCalled(); // no FASHN status check — pure DB-derived fast path
    expect(mockSubmitProvider()).not.toHaveBeenCalled();
  });

  it("FL.47 — a pause well within the 30-minute window stays AWAITING_CONTINUE, not EXPIRED (boundary sanity)", async () => {
    const recentCompletedAt = new Date(Date.now() - 5 * 60 * 1000); // 5 minutes ago
    const job0 = fakeJob("job-0", { status: "COMPLETED", completedAt: recentCompletedAt });
    const job1 = fakeJob("job-1", { status: "COMPLETED", completedAt: recentCompletedAt });
    const _findJobFn = vi.fn(async (where: { idempotencyKey: string }) => {
      if (where.idempotencyKey === getFullLookStepIdempotencyKey("cust-1", 0, null)) return job0;
      if (where.idempotencyKey === getFullLookStepIdempotencyKey("cust-1", 1, "job-0")) return job1;
      return null;
    });

    const result = await advanceFullLookChain(baseCtx(), { _findJobFn });

    expect(result.status).toBe("AWAITING_CONTINUE");
    expect(mockDeleteAsset()).not.toHaveBeenCalled();
  });

  it("FL.48 — a pause older than 30 minutes returns EXPIRED and cleans up BOTH intermediate images", async () => {
    const staleCompletedAt = new Date(Date.now() - 31 * 60 * 1000); // 31 minutes ago
    const job0 = fakeJob("job-0", { status: "COMPLETED", completedAt: staleCompletedAt });
    const job1 = fakeJob("job-1", { status: "COMPLETED", completedAt: staleCompletedAt });
    const _findJobFn = vi.fn(async (where: { idempotencyKey: string }) => {
      if (where.idempotencyKey === getFullLookStepIdempotencyKey("cust-1", 0, null)) return job0;
      if (where.idempotencyKey === getFullLookStepIdempotencyKey("cust-1", 1, "job-0")) return job1;
      return null;
    });

    const result = await advanceFullLookChain(baseCtx(), { _findJobFn });

    expect(result).toEqual({ status: "EXPIRED" });
    expect(mockDeleteAsset()).toHaveBeenCalledTimes(2);
    expect(mockDeleteAsset()).toHaveBeenCalledWith(expect.stringContaining("job-0"), "private");
    expect(mockDeleteAsset()).toHaveBeenCalledWith(expect.stringContaining("job-1"), "private");
    expect(global.fetch).not.toHaveBeenCalled(); // never checked FASHN — expiry is purely timestamp-derived
    expect(mockSubmitProvider()).not.toHaveBeenCalled();
  });
});

// 2026-11-15 — the exact scenario the dynamic-length fix exists for: the
// founder's 5-item test outfit (sweater, jeans, jacket, boots, cap).
// Proves the pause-before-final, final-detection, and final-step handle
// tagging all generalize correctly for lengths other than the original
// fixed 3, not just that they still work at 3.
describe("advanceFullLookChain — dynamic chain length (4 and 5 garments)", () => {
  it("5-garment chain: AWAITING_CONTINUE fires before step 5 (0-based index 4), not before step 3", async () => {
    const ctx = ctxWithGarmentCount(5);
    const jobs = [0, 1, 2].map((i) => fakeJob(`job-${i}`, { status: "COMPLETED" }));
    const job3 = fakeJob("job-3", { status: "PROCESSING", predictionId: "pred-3" });
    const _findJobFn = vi.fn(async (where: { idempotencyKey: string }) => {
      if (where.idempotencyKey === getFullLookStepIdempotencyKey("cust-1", 0, null)) return jobs[0];
      if (where.idempotencyKey === getFullLookStepIdempotencyKey("cust-1", 1, "job-0")) return jobs[1];
      if (where.idempotencyKey === getFullLookStepIdempotencyKey("cust-1", 2, "job-1")) return jobs[2];
      if (where.idempotencyKey === getFullLookStepIdempotencyKey("cust-1", 3, "job-2")) return job3;
      return null;
    });
    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(async (url: string | URL | Request) => {
      const u = url.toString();
      if (u.includes("/v1/status/")) {
        return new Response(JSON.stringify({ status: "completed", output: [PNG_DATA_URL] }), { status: 200 });
      }
      return new Response(new Uint8Array([1, 2, 3]).buffer, { status: 200 });
    });
    mockUploadPrivate().mockResolvedValue({ ok: true, publicId: "x", format: "png", version: "1" });
    mockAdvance().mockResolvedValueOnce({ ok: true, job: { ...job3, status: "COMPLETED" } });

    const result = await advanceFullLookChain(ctx, { _findJobFn });

    expect(result.status).toBe("AWAITING_CONTINUE"); // one before the REAL final (index 4), not index 2
    expect(mockSubmitProvider()).not.toHaveBeenCalled();
  });

  it("5-garment chain: the final step's own productHandle is tagged 'final', not 'step5'", async () => {
    const ctx = ctxWithGarmentCount(5);
    const job3 = fakeJob("job-3", { status: "COMPLETED" });
    mockCreateOrFind().mockResolvedValue({ ok: true, job: fakeJob("job-4"), created: true });
    mockAdvance()
      .mockResolvedValueOnce({ ok: true, job: { ...fakeJob("job-4"), status: "SUBMITTED" } })
      .mockResolvedValueOnce({ ok: true, job: { ...fakeJob("job-4"), status: "PROCESSING", predictionId: "pred-4" } });
    mockDownloadPhoto().mockResolvedValue({ ok: true, dataUrl: PNG_DATA_URL });
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3]).buffer, { status: 200 }),
    );
    mockSubmitProvider().mockResolvedValue({ ok: true, predictionId: "pred-4" });

    await submitFullLookRealStep(ctx, 4, job3.id); // index 4 = final for a 5-garment chain

    const createArgs = mockCreateOrFind().mock.calls[0][0];
    expect(createArgs.productHandle).toBe(`${REAL_PRODUCT_HANDLE_PREFIX}:final:Black Baseball Cap`);
  });

  it("5-garment chain: COMPLETED is only detected at the real final step (index 4), not at index 2 where a 3-garment chain's final would be", async () => {
    const ctx = ctxWithGarmentCount(5);
    const jobs = [0, 1, 2, 3, 4].map((i) => fakeJob(`job-${i}`, { status: "COMPLETED" }));
    const _findJobFn = vi.fn(async (where: { idempotencyKey: string }) => {
      if (where.idempotencyKey === getFullLookStepIdempotencyKey("cust-1", 0, null)) return jobs[0];
      if (where.idempotencyKey === getFullLookStepIdempotencyKey("cust-1", 1, "job-0")) return jobs[1];
      if (where.idempotencyKey === getFullLookStepIdempotencyKey("cust-1", 2, "job-1")) return jobs[2];
      if (where.idempotencyKey === getFullLookStepIdempotencyKey("cust-1", 3, "job-2")) return jobs[3];
      if (where.idempotencyKey === getFullLookStepIdempotencyKey("cust-1", 4, "job-3")) return jobs[4];
      return null;
    });
    mockBuildResultUrl().mockReturnValue("https://signed/final-5.png");

    const result = await advanceFullLookChain(ctx, { _findJobFn });

    expect(result).toEqual({ status: "COMPLETED", resultUrl: "https://signed/final-5.png" });
  });

  it("4-garment chain: AWAITING_CONTINUE fires before step 4 (index 3), one position later than a 3-garment chain", async () => {
    const ctx = ctxWithGarmentCount(4);
    const job0 = fakeJob("job-0", { status: "COMPLETED" });
    const job1 = fakeJob("job-1", { status: "COMPLETED" });
    const job2 = fakeJob("job-2", { status: "COMPLETED" }); // already resolved by an earlier poll
    const _findJobFn = vi.fn(async (where: { idempotencyKey: string }) => {
      if (where.idempotencyKey === getFullLookStepIdempotencyKey("cust-1", 0, null)) return job0;
      if (where.idempotencyKey === getFullLookStepIdempotencyKey("cust-1", 1, "job-0")) return job1;
      if (where.idempotencyKey === getFullLookStepIdempotencyKey("cust-1", 2, "job-1")) return job2;
      return null;
    });

    const result = await advanceFullLookChain(ctx, { _findJobFn });

    expect(result.status).toBe("AWAITING_CONTINUE"); // fast path — no FASHN call needed to know this
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("invalid chain length (6 garments, above FULL_LOOK_MAX_GARMENTS) is refused before any FASHN I/O", async () => {
    const ctx = ctxWithGarmentCount(5);
    const sixthGarment = { label: "extra", productImageUrl: "https://x/extra.jpg" };
    const result = await startOrResumeFullLookChain({ ...ctx, garments: [...ctx.garments, sixthGarment] });
    expect(result).toEqual({ ok: false, reason: "invalid_chain_length" });
    expect(mockSubmitProvider()).not.toHaveBeenCalled();
  });

  it("invalid chain length (2 garments, below the 3-item floor) is refused before any FASHN I/O", async () => {
    const result = await startOrResumeFullLookChain(ctxWithGarmentCount(2));
    expect(result).toEqual({ ok: false, reason: "invalid_chain_length" });
    expect(mockSubmitProvider()).not.toHaveBeenCalled();
  });
});

// ── End-to-end: a full 5-garment chain, with a stateful in-memory job
// store standing in for the DB, driven exactly the way the orchestrator's
// own advanceAutomatically loop drives it (repeated advanceFullLookChain
// calls, auto-continuing past the one human-review pause) ─────────────────
describe("end-to-end — complete 5-garment Full-Look chain: progression, failure recovery, retry, credit accounting", () => {
  // Minimal in-memory stand-in for the VirtualTryOnJob table, keyed by
  // idempotencyKey exactly as the real _findJobFn query is. Lets this one
  // test drive createOrFindTryOnJob/advanceTryOnJob (both mocked at the
  // module boundary) with real persistence semantics across many calls,
  // without a live DB.
  function makeJobStore() {
    const byKey = new Map<string, VirtualTryOnJobRecord>();
    let counter = 0;
    const _findJobFn = async (where: { idempotencyKey: string }) => byKey.get(where.idempotencyKey) ?? null;
    mockCreateOrFind().mockImplementation(async (args: any) => {
      const existing = byKey.get(args.idempotencyKey);
      if (existing) return { ok: true, job: existing, created: false };
      const job = fakeJob(`job-${counter++}`, {
        customerId: args.customerId,
        productHandle: args.productHandle,
        idempotencyKey: args.idempotencyKey,
        outfitSuggestionId: args.outfitSuggestionId ?? null,
        status: "CREATED",
      });
      byKey.set(args.idempotencyKey, job);
      return { ok: true, job, created: true };
    });
    mockAdvance().mockImplementation(async (job: VirtualTryOnJobRecord, newStatus: string, fields: Record<string, unknown>) => {
      const updated = { ...job, status: newStatus, ...fields, lastActivityAt: new Date() } as VirtualTryOnJobRecord;
      for (const [key, existing] of byKey) {
        if (existing.id === job.id) {
          byKey.set(key, updated);
          break;
        }
      }
      return { ok: true, job: updated };
    });
    return { byKey, _findJobFn };
  }

  function mockAllFashnStepsCompleteImmediately() {
    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(async (url: string | URL | Request) => {
      const u = url.toString();
      if (u.includes("/v1/status/")) {
        return new Response(JSON.stringify({ status: "completed", output: [PNG_DATA_URL] }), { status: 200 });
      }
      return new Response(new Uint8Array([1, 2, 3]).buffer, { status: 200 }); // intermediate-image download
    });
  }

  it("E2E.1 — all 5 garments submit and complete in order, auto-continuing past the pause exactly once, to a single COMPLETED result", async () => {
    const ctx = ctxWithGarmentCount(5);
    const { byKey, _findJobFn } = makeJobStore();
    mockCooldown().mockResolvedValue({ ok: true });
    mockAllFashnStepsCompleteImmediately();
    mockDownloadPhoto().mockResolvedValue({ ok: true, dataUrl: PNG_DATA_URL });
    mockSubmitProvider().mockResolvedValue({ ok: true, predictionId: "pred-x" });
    mockUploadPrivate().mockResolvedValue({ ok: true, publicId: "x", format: "png", version: "1" });
    mockUploadResult().mockResolvedValue({ ok: true });
    mockBuildResultUrl().mockReturnValue("https://signed.example/final.png");

    const start = await startOrResumeFullLookChain(ctx, { _findJobFn }, async () => ({ reconciled: false }));
    expect(start).toEqual({ ok: true, stepIndex: 0 });

    // allowSubmitNext: true on every call — this simulates a fully
    // authorized session (what startFullLookOutfit / the explicitly
    // authorized "advance" action pass), repeatedly advancing. The
    // fail-closed default is covered by its own dedicated tests
    // (FL.20b/FL.20c) and is not what this end-to-end scenario is about.
    let result: Awaited<ReturnType<typeof advanceFullLookChain>> | undefined;
    for (let guard = 0; guard < 10 && (!result || result.status !== "COMPLETED"); guard++) {
      result = await advanceFullLookChain(ctx, { _findJobFn }, undefined, { allowSubmitNext: true });
      if (result.status === "AWAITING_CONTINUE") {
        const cont = await continueToFinalStep(ctx, { _findJobFn });
        expect(cont.ok).toBe(true);
      }
    }

    expect(result).toEqual({ status: "COMPLETED", resultUrl: "https://signed.example/final.png" });
    expect(mockSubmitProvider()).toHaveBeenCalledTimes(5); // exactly one real submission per garment — never duplicated

    const allJobs = [...byKey.values()];
    expect(allJobs).toHaveLength(5); // exactly 5 rows — one per garment, none extra
    const finalJobs = allJobs.filter((j) => j.productHandle.startsWith(`${REAL_PRODUCT_HANDLE_PREFIX}:final:`));
    expect(finalJobs).toHaveLength(1); // exactly one "final"-tagged row — the sole credit-eligible one
    expect(finalJobs[0].status).toBe("COMPLETED");
    const intermediateJobs = allJobs.filter((j) => j.productHandle.startsWith(`${REAL_PRODUCT_HANDLE_PREFIX}:step`));
    expect(intermediateJobs).toHaveLength(4); // steps 1-4, all excluded from credit counting by entitlement.server.ts
    expect(intermediateJobs.every((j) => j.status === "COMPLETED")).toBe(true);
  });

  it("E2E.2 — a mid-chain failure (step 3 of 5) stops the chain with no credit at risk; a retry under a new scope completes the SAME 5 garments and is the only attempt ever counted", async () => {
    const baseGarments = ctxWithGarmentCount(5).garments;

    // ── Attempt 1: fails at step index 2 (the 3rd garment) ──────────────────
    const attempt1 = { ...ctxWithGarmentCount(5), reservationScope: "attempt-1" };
    const store1 = makeJobStore();
    mockCooldown().mockResolvedValue({ ok: true });
    mockDownloadPhoto().mockResolvedValue({ ok: true, dataUrl: PNG_DATA_URL });
    mockSubmitProvider().mockResolvedValue({ ok: true, predictionId: "pred-x" });
    mockUploadPrivate().mockResolvedValue({ ok: true, publicId: "x", format: "png", version: "1" });

    let stepCallCount = 0;
    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(async (url: string | URL | Request) => {
      const u = url.toString();
      if (u.includes("/v1/status/")) {
        stepCallCount++;
        // The 3rd real FASHN status check (step index 2) reports failed.
        if (stepCallCount === 3) {
          return new Response(JSON.stringify({ status: "failed", error: "provider error" }), { status: 200 });
        }
        return new Response(JSON.stringify({ status: "completed", output: [PNG_DATA_URL] }), { status: 200 });
      }
      return new Response(new Uint8Array([1, 2, 3]).buffer, { status: 200 });
    });

    const start1 = await startOrResumeFullLookChain(attempt1, { _findJobFn: store1._findJobFn }, async () => ({ reconciled: false }));
    expect(start1).toEqual({ ok: true, stepIndex: 0 });

    // allowSubmitNext: true — same authorized-session simulation as E2E.1.
    let result1: Awaited<ReturnType<typeof advanceFullLookChain>> | undefined;
    for (let guard = 0; guard < 10 && (!result1 || (result1.status !== "COMPLETED" && result1.status !== "FAILED")); guard++) {
      result1 = await advanceFullLookChain(attempt1, { _findJobFn: store1._findJobFn }, undefined, { allowSubmitNext: true });
      if (result1.status === "AWAITING_CONTINUE") {
        await continueToFinalStep(attempt1, { _findJobFn: store1._findJobFn });
      }
    }
    expect(result1).toMatchObject({ status: "FAILED", failedStepIndex: 2 });

    // No credit at risk: nothing in this failed attempt ever reached a
    // "final"-tagged COMPLETED row — entitlement.server.ts's own counting
    // query (confirmed passing separately in entitlement-mock-vto-
    // exclusion.test.ts) can never see a completed outfit here.
    const attempt1Jobs = [...store1.byKey.values()];
    expect(attempt1Jobs.some((j) => j.productHandle.includes(":final:") && j.status === "COMPLETED")).toBe(false);
    expect(mockSubmitProvider()).toHaveBeenCalledTimes(3); // steps 0, 1, 2 submitted; 3 and 4 never reached

    // ── Retry under a NEW, independent scope — the customer's own retry,
    // never auto-triggered — completes clean through all 5 garments ──────
    mockSubmitProvider().mockClear();
    const attempt2 = { ...ctxWithGarmentCount(5), garments: baseGarments, reservationScope: "attempt-2" };
    const store2 = makeJobStore();
    mockAllFashnStepsCompleteImmediately();

    const start2 = await startOrResumeFullLookChain(attempt2, { _findJobFn: store2._findJobFn }, async () => ({ reconciled: false }));
    expect(start2).toEqual({ ok: true, stepIndex: 0 });

    let result2: Awaited<ReturnType<typeof advanceFullLookChain>> | undefined;
    for (let guard = 0; guard < 10 && (!result2 || result2.status !== "COMPLETED"); guard++) {
      result2 = await advanceFullLookChain(attempt2, { _findJobFn: store2._findJobFn }, undefined, { allowSubmitNext: true });
      if (result2.status === "AWAITING_CONTINUE") {
        await continueToFinalStep(attempt2, { _findJobFn: store2._findJobFn });
      }
    }

    expect(result2?.status).toBe("COMPLETED");
    // Attempt 2's own rows are completely independent of attempt 1's dead
    // ones — a brand-new, fresh set of 5, with exactly one "final" credit.
    const attempt2Jobs = [...store2.byKey.values()];
    expect(attempt2Jobs).toHaveLength(5);
    const attempt2Final = attempt2Jobs.filter((j) => j.productHandle.includes(":final:") && j.status === "COMPLETED");
    expect(attempt2Final).toHaveLength(1); // exactly one completed outfit — exactly one credit, across BOTH attempts combined
  });
});

describe("continueToFinalStep", () => {
  it("FL.38 — at the pause point, submits exactly the blazer step", async () => {
    const job0 = fakeJob("job-0", { status: "COMPLETED" });
    const job1 = fakeJob("job-1", { status: "COMPLETED" });
    const _findJobFn = vi.fn(async (where: { idempotencyKey: string }) => {
      if (where.idempotencyKey === getFullLookStepIdempotencyKey("cust-1", 0, null)) return job0;
      if (where.idempotencyKey === getFullLookStepIdempotencyKey("cust-1", 1, "job-0")) return job1;
      return null;
    });
    const job2 = fakeJob("job-2");
    mockCreateOrFind().mockResolvedValue({ ok: true, job: job2, created: true });
    mockAdvance()
      .mockResolvedValueOnce({ ok: true, job: { ...job2, status: "SUBMITTED" } })
      .mockResolvedValueOnce({ ok: true, job: { ...job2, status: "PROCESSING", predictionId: "pred-2" } });
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3]).buffer, { status: 200 }),
    );
    mockSubmitProvider().mockResolvedValue({ ok: true, predictionId: "pred-2" });

    const result = await continueToFinalStep(baseCtx(), { _findJobFn });

    expect(result).toEqual({ ok: true });
    expect(mockSubmitProvider()).toHaveBeenCalledTimes(1);
    const createArgs = mockCreateOrFind().mock.calls[0][0];
    expect(createArgs.idempotencyKey).toBe(getFullLookStepIdempotencyKey("cust-1", 2, "job-1"));
  });

  it("FL.39 — a duplicate click (job already exists for the final step) is idempotent — no second FASHN call", async () => {
    const job0 = fakeJob("job-0", { status: "COMPLETED" });
    const job1 = fakeJob("job-1", { status: "COMPLETED" });
    const _findJobFn = vi.fn(async (where: { idempotencyKey: string }) => {
      if (where.idempotencyKey === getFullLookStepIdempotencyKey("cust-1", 0, null)) return job0;
      if (where.idempotencyKey === getFullLookStepIdempotencyKey("cust-1", 1, "job-0")) return job1;
      return null;
    });
    const existingJob2 = fakeJob("job-2", { status: "PROCESSING", predictionId: "pred-2" });
    mockCreateOrFind().mockResolvedValue({ ok: true, job: existingJob2, created: false });

    const result = await continueToFinalStep(baseCtx(), { _findJobFn });

    expect(result).toEqual({ ok: true });
    expect(mockSubmitProvider()).not.toHaveBeenCalled();
  });

  it("FL.40 — called too early (shirt not yet completed) fails closed with zero I/O against FASHN or the provider", async () => {
    const job0 = fakeJob("job-0", { status: "COMPLETED" });
    const job1 = fakeJob("job-1", { status: "PROCESSING", predictionId: "pred-1" });
    const _findJobFn = vi.fn(async (where: { idempotencyKey: string }) => {
      if (where.idempotencyKey === getFullLookStepIdempotencyKey("cust-1", 0, null)) return job0;
      if (where.idempotencyKey === getFullLookStepIdempotencyKey("cust-1", 1, "job-0")) return job1;
      return null;
    });

    const result = await continueToFinalStep(baseCtx(), { _findJobFn });

    expect(result).toEqual({ ok: false, reason: "not_awaiting_continue" });
    expect(mockCreateOrFind()).not.toHaveBeenCalled();
    expect(mockSubmitProvider()).not.toHaveBeenCalled();
  });

  it("FL.41 — called after the blazer step already completed (chain fully done) fails closed, never resubmits", async () => {
    const job0 = fakeJob("job-0", { status: "COMPLETED" });
    const job1 = fakeJob("job-1", { status: "COMPLETED" });
    const job2 = fakeJob("job-2", { status: "COMPLETED" });
    const _findJobFn = vi.fn(async (where: { idempotencyKey: string }) => {
      if (where.idempotencyKey === getFullLookStepIdempotencyKey("cust-1", 0, null)) return job0;
      if (where.idempotencyKey === getFullLookStepIdempotencyKey("cust-1", 1, "job-0")) return job1;
      if (where.idempotencyKey === getFullLookStepIdempotencyKey("cust-1", 2, "job-1")) return job2;
      return null;
    });

    const result = await continueToFinalStep(baseCtx(), { _findJobFn });

    expect(result).toEqual({ ok: false, reason: "not_awaiting_continue" });
    expect(mockCreateOrFind()).not.toHaveBeenCalled();
    expect(mockSubmitProvider()).not.toHaveBeenCalled();
  });

  it("FL.42b — refuses an EXPIRED pause (>30 min since shirt completed) with zero FASHN or job-creation I/O — cannot unexpectedly resume billable generation", async () => {
    const staleCompletedAt = new Date(Date.now() - 45 * 60 * 1000); // 45 minutes ago
    const job0 = fakeJob("job-0", { status: "COMPLETED", completedAt: staleCompletedAt });
    const job1 = fakeJob("job-1", { status: "COMPLETED", completedAt: staleCompletedAt });
    const _findJobFn = vi.fn(async (where: { idempotencyKey: string }) => {
      if (where.idempotencyKey === getFullLookStepIdempotencyKey("cust-1", 0, null)) return job0;
      if (where.idempotencyKey === getFullLookStepIdempotencyKey("cust-1", 1, "job-0")) return job1;
      return null;
    });

    const result = await continueToFinalStep(baseCtx(), { _findJobFn });

    expect(result).toEqual({ ok: false, reason: "continue_window_expired" });
    expect(mockCreateOrFind()).not.toHaveBeenCalled();
    expect(mockSubmitProvider()).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("FL.42c — a pause well within the window still succeeds normally (regression against the new expiry check)", async () => {
    const recentCompletedAt = new Date(Date.now() - 2 * 60 * 1000); // 2 minutes ago
    const job0 = fakeJob("job-0", { status: "COMPLETED", completedAt: recentCompletedAt });
    const job1 = fakeJob("job-1", { status: "COMPLETED", completedAt: recentCompletedAt });
    const _findJobFn = vi.fn(async (where: { idempotencyKey: string }) => {
      if (where.idempotencyKey === getFullLookStepIdempotencyKey("cust-1", 0, null)) return job0;
      if (where.idempotencyKey === getFullLookStepIdempotencyKey("cust-1", 1, "job-0")) return job1;
      return null;
    });
    const job2 = fakeJob("job-2");
    mockCreateOrFind().mockResolvedValue({ ok: true, job: job2, created: true });
    mockAdvance()
      .mockResolvedValueOnce({ ok: true, job: { ...job2, status: "SUBMITTED" } })
      .mockResolvedValueOnce({ ok: true, job: { ...job2, status: "PROCESSING", predictionId: "pred-2" } });
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3]).buffer, { status: 200 }),
    );
    mockSubmitProvider().mockResolvedValue({ ok: true, predictionId: "pred-2" });

    const result = await continueToFinalStep(baseCtx(), { _findJobFn });

    expect(result).toEqual({ ok: true });
    expect(mockSubmitProvider()).toHaveBeenCalledTimes(1);
  });
});

// ── Second-(and-later)-test reservation scope ───────────────────────────────

describe("reservationScope — independent, non-destructive second-test mechanism", () => {
  it("FL.42 — omitted scope produces the exact original permanent key (regression)", () => {
    expect(getFullLookStepIdempotencyKey("cust-1", 0, null)).toBe(
      getFullLookStepIdempotencyKey("cust-1", 0, null, undefined),
    );
  });

  it("FL.43 — two different scopes for the same customer produce two different, independent step-0 keys", () => {
    const keyA = getFullLookStepIdempotencyKey("cust-1", 0, null, "qa-second-test-2026-11-04");
    const keyB = getFullLookStepIdempotencyKey("cust-1", 0, null, "qa-third-test-2026-11-10");
    const unscoped = getFullLookStepIdempotencyKey("cust-1", 0, null);
    expect(keyA).not.toBe(keyB);
    expect(keyA).not.toBe(unscoped);
    expect(keyB).not.toBe(unscoped);
  });

  it("FL.44 — scope does not affect step 1/2 key derivation (those are already unique via priorJobId)", () => {
    expect(getFullLookStepIdempotencyKey("cust-1", 1, "job-0", "any-scope")).toBe(
      getFullLookStepIdempotencyKey("cust-1", 1, "job-0"),
    );
  });

  it("FL.45 — starting a SCOPED chain for a customer whose UNSCOPED chain already completed does not touch, read, or require deleting the first chain's rows", async () => {
    // The unscoped reservation is already fully consumed (first test complete).
    // A scoped walk must never even query for it — it only ever looks up
    // keys that include the scope suffix.
    const scope = "qa-second-test-2026-11-04";
    const _findJobFn = vi.fn(async (where: { idempotencyKey: string }) => {
      // The unscoped key would be getFullLookStepIdempotencyKey("cust-1", 0, null)
      // (no scope) — if the walk ever queries that, this mock intentionally
      // returns a COMPLETED job, which would corrupt the scoped chain's view
      // if scope weren't actually isolating the two. Asserting it's never
      // queried is the real regression guard.
      const unscopedKey = getFullLookStepIdempotencyKey("cust-1", 0, null);
      if (where.idempotencyKey === unscopedKey) {
        throw new Error("regression: scoped walk queried the UNSCOPED key");
      }
      return null; // scoped chain genuinely hasn't started yet
    });

    const jobs = await walkFullLookChainJobs("cust-1", { _findJobFn }, scope);
    expect(jobs).toEqual([]);
    expect(_findJobFn).toHaveBeenCalledWith({ idempotencyKey: getFullLookStepIdempotencyKey("cust-1", 0, null, scope) });
  });

  it("FL.46 — startOrResumeFullLookChain with a scope starts a fresh chain even though the unscoped reservation is already claimed", async () => {
    const scope = "qa-second-test-2026-11-04";
    const _findJobFn = vi.fn(async () => null); // nothing exists yet under the scoped key
    mockCooldown().mockResolvedValue({ ok: true });
    const job = fakeJob("job-scoped-0");
    mockCreateOrFind().mockResolvedValue({ ok: true, job, created: true });
    mockAdvance()
      .mockResolvedValueOnce({ ok: true, job: { ...job, status: "SUBMITTED" } })
      .mockResolvedValueOnce({ ok: true, job: { ...job, status: "PROCESSING", predictionId: "pred-0" } });
    mockDownloadPhoto().mockResolvedValue({ ok: true, dataUrl: PNG_DATA_URL });
    mockSubmitProvider().mockResolvedValue({ ok: true, predictionId: "pred-0" });

    const ctx = { ...baseCtx(), reservationScope: scope };
    const _reconcileStale = vi.fn(async () => ({ reconciled: false }));
    const result = await startOrResumeFullLookChain(ctx, { _findJobFn }, _reconcileStale);

    expect(result).toEqual({ ok: true, stepIndex: 0 });
    const createArgs = mockCreateOrFind().mock.calls[0][0];
    expect(createArgs.idempotencyKey).toBe(getFullLookStepIdempotencyKey("cust-1", 0, null, scope));
  });
});

// ── sweepAbandonedFullLookPauses — independent cleanup ───────────────────────

describe("sweepAbandonedFullLookPauses", () => {
  function shirtJobWithTrousers(
    shirtId: string,
    trousersId: string,
    overrides: Partial<VirtualTryOnJobRecord> = {},
  ): VirtualTryOnJobRecord {
    return fakeJob(shirtId, {
      customerId: "cust-1",
      idempotencyKey: `fulllook-real-step:${trousersId}:1`,
      // Step index 1 (0-based) = "step2" (1-based label) — the sweep now
      // parses its own step index back out of the handle, not the
      // idempotencyKey, so this must actually say "step2", not fall back
      // to fakeJob's own default ("step1").
      productHandle: `${REAL_PRODUCT_HANDLE_PREFIX}:step2:Blue Chambray Button-Up Shirt`,
      status: "COMPLETED",
      ...overrides,
    });
  }

  it("SW.1 — a shirt job well within the window is skipped, no deletes", async () => {
    const recent = new Date(Date.now() - 5 * 60 * 1000);
    const shirt = shirtJobWithTrousers("shirt-1", "trousers-1", { completedAt: recent });
    const _findShirtJobs = vi.fn(async () => [shirt]);
    const _findJobFn = vi.fn(async () => null); // no blazer job exists

    const result = await sweepAbandonedFullLookPauses(_findShirtJobs, _findJobFn);

    expect(result).toEqual({ cleanedChains: 0, skippedActive: 1, skippedAlreadyAdvanced: 0 });
    expect(mockDeleteAsset()).not.toHaveBeenCalled();
    expect(_findJobFn).not.toHaveBeenCalled(); // never even checks for a blazer job on an active pause
  });

  it("SW.2 — an expired, never-continued shirt job is cleaned up (both trousers and shirt intermediates)", async () => {
    const stale = new Date(Date.now() - 45 * 60 * 1000);
    const shirt = shirtJobWithTrousers("shirt-1", "trousers-1", { completedAt: stale });
    const _findShirtJobs = vi.fn(async () => [shirt]);
    const _findJobFn = vi.fn(async () => null); // no blazer job — never continued

    const result = await sweepAbandonedFullLookPauses(_findShirtJobs, _findJobFn);

    expect(result).toEqual({ cleanedChains: 1, skippedActive: 0, skippedAlreadyAdvanced: 0 });
    expect(mockDeleteAsset()).toHaveBeenCalledTimes(2);
    expect(mockDeleteAsset()).toHaveBeenCalledWith(expect.stringContaining("trousers-1"), "private");
    expect(mockDeleteAsset()).toHaveBeenCalledWith(expect.stringContaining("shirt-1"), "private");
  });

  it("SW.3 — an expired shirt job that already has a blazer job (continued) is left completely alone", async () => {
    const stale = new Date(Date.now() - 45 * 60 * 1000);
    const shirt = shirtJobWithTrousers("shirt-1", "trousers-1", { completedAt: stale });
    const blazer = fakeJob("blazer-1");
    const _findShirtJobs = vi.fn(async () => [shirt]);
    const _findJobFn = vi.fn(async () => blazer); // chain already continued

    const result = await sweepAbandonedFullLookPauses(_findShirtJobs, _findJobFn);

    expect(result).toEqual({ cleanedChains: 0, skippedActive: 0, skippedAlreadyAdvanced: 1 });
    expect(mockDeleteAsset()).not.toHaveBeenCalled();
  });

  it("SW.4 — a mix of active, expired, and already-advanced chains is handled independently and correctly aggregated", async () => {
    const recent = new Date(Date.now() - 5 * 60 * 1000);
    const stale = new Date(Date.now() - 45 * 60 * 1000);
    const activeShirt = shirtJobWithTrousers("shirt-active", "trousers-active", { completedAt: recent });
    const expiredShirt = shirtJobWithTrousers("shirt-expired", "trousers-expired", { completedAt: stale });
    const advancedShirt = shirtJobWithTrousers("shirt-advanced", "trousers-advanced", { completedAt: stale });
    const _findShirtJobs = vi.fn(async () => [activeShirt, expiredShirt, advancedShirt]);
    const _findJobFn = vi.fn(async (where: { idempotencyKey: string }) =>
      where.idempotencyKey === "fulllook-real-step:shirt-advanced:2" ? fakeJob("blazer-advanced") : null,
    );

    const result = await sweepAbandonedFullLookPauses(_findShirtJobs, _findJobFn);

    expect(result).toEqual({ cleanedChains: 1, skippedActive: 1, skippedAlreadyAdvanced: 1 });
    expect(mockDeleteAsset()).toHaveBeenCalledTimes(2); // only the one genuinely-abandoned chain
    expect(mockDeleteAsset()).toHaveBeenCalledWith(expect.stringContaining("trousers-expired"), "private");
    expect(mockDeleteAsset()).toHaveBeenCalledWith(expect.stringContaining("shirt-expired"), "private");
  });

  // 2026-11-15 — the generalization this sweep needed for dynamic chain
  // length: an abandoned pause at step3 or step4 (4- and 5-garment chains)
  // is invisible to a sweep hardcoded to "step2:" alone. Proves the sweep
  // now finds and correctly resolves BOTH positions, not just step2.
  it("SW.6 — an abandoned pause at step3 (a 4-garment chain's pause-adjacent position, not step2) is found and cleaned up", async () => {
    const stale = new Date(Date.now() - 45 * 60 * 1000);
    const step3Job = fakeJob("step3-job", {
      customerId: "cust-1",
      idempotencyKey: "fulllook-real-step:step2-job:2",
      productHandle: `${REAL_PRODUCT_HANDLE_PREFIX}:step3:Black Wool Shirt Jacket`,
      status: "COMPLETED",
      completedAt: stale,
    });
    const _findPauseAdjacentJobs = vi.fn(async () => [step3Job]);
    const _findJobFn = vi.fn(async () => null); // no step4/final job — never continued

    const result = await sweepAbandonedFullLookPauses(_findPauseAdjacentJobs, _findJobFn);

    expect(result).toEqual({ cleanedChains: 1, skippedActive: 0, skippedAlreadyAdvanced: 0 });
    expect(_findJobFn).toHaveBeenCalledWith({ idempotencyKey: "fulllook-real-step:step3-job:3" });
    expect(mockDeleteAsset()).toHaveBeenCalledWith(expect.stringContaining("step2-job"), "private");
    expect(mockDeleteAsset()).toHaveBeenCalledWith(expect.stringContaining("step3-job"), "private");
  });

  it("SW.7 — a step3 job that DID continue (a step4 or final job exists) is left completely alone", async () => {
    const stale = new Date(Date.now() - 45 * 60 * 1000);
    const step3Job = fakeJob("step3-job", {
      idempotencyKey: "fulllook-real-step:step2-job:2",
      productHandle: `${REAL_PRODUCT_HANDLE_PREFIX}:step3:Black Wool Shirt Jacket`,
      status: "COMPLETED",
      completedAt: stale,
    });
    const _findPauseAdjacentJobs = vi.fn(async () => [step3Job]);
    const _findJobFn = vi.fn(async (where: { idempotencyKey: string }) =>
      where.idempotencyKey === "fulllook-real-step:step3-job:3" ? fakeJob("final-job") : null,
    );

    const result = await sweepAbandonedFullLookPauses(_findPauseAdjacentJobs, _findJobFn);

    expect(result).toEqual({ cleanedChains: 0, skippedActive: 0, skippedAlreadyAdvanced: 1 });
    expect(mockDeleteAsset()).not.toHaveBeenCalled();
  });

  it("SW.5 — never mutates any VirtualTryOnJob row — only Cloudinary deletes happen", async () => {
    const stale = new Date(Date.now() - 45 * 60 * 1000);
    const shirt = shirtJobWithTrousers("shirt-1", "trousers-1", { completedAt: stale });
    const _findShirtJobs = vi.fn(async () => [shirt]);
    const _findJobFn = vi.fn(async () => null);

    await sweepAbandonedFullLookPauses(_findShirtJobs, _findJobFn);

    expect(mockAdvance()).not.toHaveBeenCalled();
    expect(mockCreateOrFind()).not.toHaveBeenCalled();
    expect(mockSubmitProvider()).not.toHaveBeenCalled();
  });
});

// ── sweepStaleFullLookSteps — a mid-chain step the customer never polled
// again, left in PROCESSING forever ──────────────────────────────────────────

describe("sweepStaleFullLookSteps", () => {
  it("SS.1 — a stale PROCESSING job is marked TIMED_OUT via the status-guarded update and counted", async () => {
    const blazer = fakeJob("blazer-1", { status: "PROCESSING", idempotencyKey: "fulllook-real-step:shirt-1:2" });
    const _findStaleJobs = vi.fn(async () => [blazer]);
    const _findById = vi.fn(async () => null);
    const _timeoutJob = vi.fn(async () => true);

    const result = await sweepStaleFullLookSteps(10 * 60 * 1000, _findStaleJobs, _findById, _timeoutJob);

    expect(result).toEqual({ timedOut: 1, skippedRace: 0 });
    expect(_timeoutJob).toHaveBeenCalledWith("blazer-1");
  });

  it("SS.2 — a race (a real poll already resolved the job) is skipped, not counted as timed out, and never touches intermediate images", async () => {
    const blazer = fakeJob("blazer-1", { status: "PROCESSING", idempotencyKey: "fulllook-real-step:shirt-1:2" });
    const _findStaleJobs = vi.fn(async () => [blazer]);
    const _findById = vi.fn(async () => null);
    const _timeoutJob = vi.fn(async () => false); // conditional update found 0 rows — already resolved

    const result = await sweepStaleFullLookSteps(10 * 60 * 1000, _findStaleJobs, _findById, _timeoutJob);

    expect(result).toEqual({ timedOut: 0, skippedRace: 1 });
    expect(mockDeleteAsset()).not.toHaveBeenCalled();
  });

  it("SS.3 — a stale step-0 job (no earlier step exists) is timed out with no intermediate-image cleanup attempted", async () => {
    // Step 0's own idempotencyKey never starts with the step-chain prefix —
    // parsePriorJobIdFromStepKey correctly finds nothing to walk back to.
    const trousers = fakeJob("trousers-1", { status: "PROCESSING", idempotencyKey: "fulllook-real:cust-1" });
    const _findStaleJobs = vi.fn(async () => [trousers]);
    const _findById = vi.fn(async () => null);
    const _timeoutJob = vi.fn(async () => true);

    const result = await sweepStaleFullLookSteps(10 * 60 * 1000, _findStaleJobs, _findById, _timeoutJob);

    expect(result).toEqual({ timedOut: 1, skippedRace: 0 });
    expect(mockDeleteAsset()).not.toHaveBeenCalled();
  });

  it("SS.4 — a stale final (blazer) step walks the FULL chain back through both earlier steps and cleans up each one's intermediate image", async () => {
    const blazer = fakeJob("blazer-1", { customerId: "cust-1", status: "PROCESSING", idempotencyKey: "fulllook-real-step:shirt-1:2" });
    const shirt = fakeJob("shirt-1", { customerId: "cust-1", status: "COMPLETED", idempotencyKey: "fulllook-real-step:trousers-1:1" });
    const trousers = fakeJob("trousers-1", { customerId: "cust-1", status: "COMPLETED", idempotencyKey: "fulllook-real:cust-1" });
    const _findStaleJobs = vi.fn(async () => [blazer]);
    const _findById = vi.fn(async (id: string) => (id === "shirt-1" ? shirt : id === "trousers-1" ? trousers : null));
    const _timeoutJob = vi.fn(async () => true);

    const result = await sweepStaleFullLookSteps(10 * 60 * 1000, _findStaleJobs, _findById, _timeoutJob);

    expect(result).toEqual({ timedOut: 1, skippedRace: 0 });
    expect(mockDeleteAsset()).toHaveBeenCalledTimes(2);
    expect(mockDeleteAsset()).toHaveBeenCalledWith(expect.stringContaining("trousers-1"), "private");
    expect(mockDeleteAsset()).toHaveBeenCalledWith(expect.stringContaining("shirt-1"), "private");
    // Never cleans up the stale job's own image — it never produced one.
    expect(mockDeleteAsset()).not.toHaveBeenCalledWith(expect.stringContaining("blazer-1"), "private");
  });

  it("SS.5 — several stale jobs across different chains are each resolved and aggregated independently", async () => {
    const jobA = fakeJob("job-a", { status: "PROCESSING", idempotencyKey: "fulllook-real:cust-A" });
    const jobB = fakeJob("job-b", { status: "PROCESSING", idempotencyKey: "fulllook-real:cust-B" });
    const _findStaleJobs = vi.fn(async () => [jobA, jobB]);
    const _findById = vi.fn(async () => null);
    const _timeoutJob = vi.fn(async (id: string) => id === "job-a"); // only job-a wins its race

    const result = await sweepStaleFullLookSteps(10 * 60 * 1000, _findStaleJobs, _findById, _timeoutJob);

    expect(result).toEqual({ timedOut: 1, skippedRace: 1 });
  });

  it("SS.6 — the configured threshold is forwarded to the job-finder untouched", async () => {
    const _findStaleJobs = vi.fn(async () => []);
    const _findById = vi.fn(async () => null);
    const _timeoutJob = vi.fn(async () => true);

    await sweepStaleFullLookSteps(42, _findStaleJobs, _findById, _timeoutJob);

    expect(_findStaleJobs).toHaveBeenCalledWith(42);
  });
});
