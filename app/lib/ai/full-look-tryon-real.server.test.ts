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
  buildPrivateDownloadUrl: vi.fn(() => "https://cloudinary.mock/download"),
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
  REAL_PRODUCT_HANDLE_PREFIX,
  type FullLookChainContext,
} from "./full-look-tryon-real.server.js";
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

    const result = await advanceFullLookChain(baseCtx(), { _findJobFn });

    expect(result).toEqual({ status: "PROCESSING", stepIndex: 1 });
    expect(mockSubmitProvider()).toHaveBeenCalledTimes(1); // exactly one new FASHN submission this call
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
    mockUploadResult().mockResolvedValue({ ok: true });
    mockAdvance().mockResolvedValue({ ok: true, job: { ...job2, status: "COMPLETED" } });
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

  it("FL.24 — fresh start checks cooldown exactly once, then submits step 0", async () => {
    const _findJobFn = vi.fn(async () => null);
    mockCooldown().mockResolvedValue({ ok: true });
    const job = fakeJob("job-0");
    mockCreateOrFind().mockResolvedValue({ ok: true, job, created: true });
    mockAdvance()
      .mockResolvedValueOnce({ ok: true, job: { ...job, status: "SUBMITTED" } })
      .mockResolvedValueOnce({ ok: true, job: { ...job, status: "PROCESSING", predictionId: "pred-0" } });
    mockDownloadPhoto().mockResolvedValue({ ok: true, dataUrl: PNG_DATA_URL });
    mockSubmitProvider().mockResolvedValue({ ok: true, predictionId: "pred-0" });

    const result = await startOrResumeFullLookChain(baseCtx(), { _findJobFn });
    expect(result).toEqual({ ok: true, stepIndex: 0 });
    expect(mockCooldown()).toHaveBeenCalledTimes(1);
  });

  it("FL.25 — a chain already in progress resumes without re-checking cooldown or resubmitting step 0 (duplicate-request safe)", async () => {
    const job0 = fakeJob("job-0", { status: "PROCESSING", predictionId: "pred-0" });
    const _findJobFn = vi.fn(async (where: { idempotencyKey: string }) =>
      where.idempotencyKey === getFullLookStepIdempotencyKey("cust-1", 0, null) ? job0 : null,
    );

    const result = await startOrResumeFullLookChain(baseCtx(), { _findJobFn });
    expect(result).toEqual({ ok: true, stepIndex: 0 });
    expect(mockCooldown()).not.toHaveBeenCalled();
    expect(mockSubmitProvider()).not.toHaveBeenCalled();
    expect(mockCreateOrFind()).not.toHaveBeenCalled();
  });
});
