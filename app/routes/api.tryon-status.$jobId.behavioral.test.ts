// app/routes/api.tryon-status.$jobId.behavioral.test.ts
//
// Behavioral (not source-text) coverage for the VTO deletion race-condition
// fix: a FASHN job can sit PROCESSING for minutes while the customer deletes
// their My nAia Model body photo. This file exercises the REAL loader with
// mocked DB/session/Cloudinary/FASHN deps to prove the result never becomes
// customer-accessible once the source photo is gone, covering:
//   - deletion during processing (pre-upload guard)
//   - late completion after the source is gone (same guard, different timing)
//   - duplicate callbacks/polls (guard re-runs safely every poll, idempotent)
//   - cleanup failure (orphan asset deletion fails → durable PendingCloudinaryDeletion)
//   - cross-customer access (ownership check still blocks before any FASHN call)
//
// checkResultOwnership and deriveTryOnResultPublicId are the REAL, pure
// implementations. isSourcePhotoStillValid, uploadTryOnResult,
// buildTryOnResultUrl, advanceTryOnJob, deleteCloudinaryAsset and the DB are
// mocked. No real network call, no real customer images.
//
// Run: npx vitest run app/routes/api.tryon-status.\$jobId.behavioral.test.ts

import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";

vi.mock("~/db.server", () => ({
  default: {
    virtualTryOnJob: { findUnique: vi.fn() },
    pendingCloudinaryDeletion: { upsert: vi.fn().mockResolvedValue({}) },
  },
}));

vi.mock("~/lib/naia-session.server", () => ({
  getCurrentNaiaCustomer: vi.fn(),
}));

vi.mock("~/lib/ai/fashn-tryon-service.server", async () => {
  const actual = await vi.importActual<typeof import("~/lib/ai/fashn-tryon-service.server")>(
    "~/lib/ai/fashn-tryon-service.server",
  );
  return {
    // Real, pure implementations — not the behavior under test here.
    checkResultOwnership: actual.checkResultOwnership,
    deriveTryOnResultPublicId: actual.deriveTryOnResultPublicId,
    // The race-condition guard itself — fully mocked per test.
    isSourcePhotoStillValid: vi.fn(),
    uploadTryOnResult: vi.fn(),
    buildTryOnResultUrl: vi.fn(),
  };
});

vi.mock("~/lib/ai/my-naia-model.server", () => ({
  advanceTryOnJob: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("~/lib/cloudinary-admin.server", () => ({
  deleteCloudinaryAsset: vi.fn(),
}));

import prisma from "~/db.server";
import { getCurrentNaiaCustomer } from "~/lib/naia-session.server";
import {
  isSourcePhotoStillValid,
  uploadTryOnResult,
  buildTryOnResultUrl,
  deriveTryOnResultPublicId,
} from "~/lib/ai/fashn-tryon-service.server";
import { advanceTryOnJob } from "~/lib/ai/my-naia-model.server";
import { deleteCloudinaryAsset } from "~/lib/cloudinary-admin.server";
import { loader } from "./api.tryon-status.$jobId";

const CUSTOMER_ID = "cust_001";
const OTHER_CUSTOMER_ID = "cust_999";
const JOB_ID = "job_001";
const MODEL_ID = "model_001";

function mockJob(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: JOB_ID,
    customerId: CUSTOMER_ID,
    naiaModelId: MODEL_ID,
    status: "PROCESSING",
    predictionId: "pred_001",
    ...overrides,
  };
}

function req() {
  return new Request(`http://localhost/api/tryon-status/${JOB_ID}`);
}

function args() {
  return { request: req(), params: { jobId: JOB_ID }, context: {} } as any;
}

const originalFetch = global.fetch;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.FASHN_API_KEY = "test-fashn-key";
  (getCurrentNaiaCustomer as any).mockResolvedValue({ id: CUSTOMER_ID });
  (buildTryOnResultUrl as any).mockReturnValue("https://example.invalid/signed-result");
  (deleteCloudinaryAsset as any).mockResolvedValue({ ok: true });
  global.fetch = vi.fn();
});

afterAll(() => {
  global.fetch = originalFetch;
});

function mockFashnCompleted(outputDataUrl = "data:image/png;base64,AAAA") {
  (global.fetch as any).mockResolvedValue({
    ok: true,
    json: async () => ({ status: "completed", output: [outputDataUrl] }),
  });
}

describe("cross-customer access — blocked before any FASHN call", () => {
  it("403s when the authenticated customer does not own the job, and never calls FASHN", async () => {
    (prisma.virtualTryOnJob.findUnique as any).mockResolvedValue(
      mockJob({ customerId: OTHER_CUSTOMER_ID }),
    );
    const res: any = await loader(args());
    expect(res.init.status).toBe(403);
    expect(res.data.status).toBe("FORBIDDEN");
    expect(global.fetch).not.toHaveBeenCalled();
    expect(isSourcePhotoStillValid).not.toHaveBeenCalled();
  });
});

describe("deletion during processing — pre-upload guard", () => {
  it("fails closed and never uploads when the source photo was deleted before FASHN completed", async () => {
    (prisma.virtualTryOnJob.findUnique as any).mockResolvedValue(mockJob());
    mockFashnCompleted();
    (isSourcePhotoStillValid as any).mockResolvedValue(false);

    const res: any = await loader(args());

    expect(isSourcePhotoStillValid).toHaveBeenCalledWith(MODEL_ID, CUSTOMER_ID);
    expect(uploadTryOnResult).not.toHaveBeenCalled();
    expect(advanceTryOnJob).toHaveBeenCalledWith(
      expect.objectContaining({ id: JOB_ID }),
      "FAILED",
      expect.objectContaining({ errorCode: "SOURCE_DELETED" }),
    );
    expect(res.data.status).toBe("FAILED");
    expect(res.data.resultUrl).toBeUndefined();
  });
});

describe("late completion — source gone by the time FASHN finally finishes", () => {
  it("behaves identically to an early deletion — same guard, later timing", async () => {
    (prisma.virtualTryOnJob.findUnique as any).mockResolvedValue(
      mockJob({ status: "PROCESSING" }),
    );
    mockFashnCompleted();
    (isSourcePhotoStillValid as any).mockResolvedValue(false);

    const res: any = await loader(args());

    expect(uploadTryOnResult).not.toHaveBeenCalled();
    expect(res.data.status).toBe("FAILED");
  });
});

describe("duplicate callbacks/polls — guard re-runs safely every time", () => {
  it("a second poll after the job already failed for SOURCE_DELETED stays FAILED without re-uploading", async () => {
    (prisma.virtualTryOnJob.findUnique as any).mockResolvedValue(
      mockJob({ status: "FAILED" }),
    );
    const res: any = await loader(args());
    expect(res.data.status).toBe("FAILED");
    expect(global.fetch).not.toHaveBeenCalled();
    expect(isSourcePhotoStillValid).not.toHaveBeenCalled();
    expect(uploadTryOnResult).not.toHaveBeenCalled();
  });

  it("two consecutive in-flight polls both re-check source validity independently (idempotent, no double-upload on repeated false)", async () => {
    (prisma.virtualTryOnJob.findUnique as any).mockResolvedValue(mockJob());
    mockFashnCompleted();
    (isSourcePhotoStillValid as any).mockResolvedValue(false);

    const res1: any = await loader(args());
    const res2: any = await loader(args());

    expect(res1.data.status).toBe("FAILED");
    expect(res2.data.status).toBe("FAILED");
    expect(uploadTryOnResult).not.toHaveBeenCalled();
    expect(isSourcePhotoStillValid).toHaveBeenCalledTimes(2);
  });
});

describe("cleanup failure — orphan asset created in the post-upload race window", () => {
  it("records a PendingCloudinaryDeletion when the orphan asset's deletion itself fails", async () => {
    (prisma.virtualTryOnJob.findUnique as any).mockResolvedValue(mockJob());
    mockFashnCompleted();
    // Pre-upload check passes, upload succeeds, then the source is found
    // deleted on the post-upload re-check — the narrow race window.
    (isSourcePhotoStillValid as any)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    (uploadTryOnResult as any).mockResolvedValue({ ok: true });
    (deleteCloudinaryAsset as any).mockResolvedValue({
      ok: false,
      errorCode: "PROVIDER_ERROR",
    });

    const res: any = await loader(args());

    const expectedPublicId = deriveTryOnResultPublicId(CUSTOMER_ID, JOB_ID);
    expect(deleteCloudinaryAsset).toHaveBeenCalledWith(expectedPublicId, "private");
    expect(prisma.pendingCloudinaryDeletion.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { publicId: expectedPublicId },
        create: expect.objectContaining({
          customerId: CUSTOMER_ID,
          publicId: expectedPublicId,
          context: "vto-race-condition-cleanup",
        }),
      }),
    );
    expect(advanceTryOnJob).toHaveBeenCalledWith(
      expect.objectContaining({ id: JOB_ID }),
      "FAILED",
      expect.objectContaining({ errorCode: "SOURCE_DELETED" }),
    );
    expect(res.data.status).toBe("FAILED");
    expect(res.data.resultUrl).toBeUndefined();
  });

  it("does not record a PendingCloudinaryDeletion when the orphan asset's deletion succeeds", async () => {
    (prisma.virtualTryOnJob.findUnique as any).mockResolvedValue(mockJob());
    mockFashnCompleted();
    (isSourcePhotoStillValid as any)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    (uploadTryOnResult as any).mockResolvedValue({ ok: true });
    (deleteCloudinaryAsset as any).mockResolvedValue({ ok: true });

    const res: any = await loader(args());

    expect(deleteCloudinaryAsset).toHaveBeenCalled();
    expect(prisma.pendingCloudinaryDeletion.upsert).not.toHaveBeenCalled();
    expect(res.data.status).toBe("FAILED");
  });
});

describe("happy path — unchanged when the source photo is still valid throughout", () => {
  it("uploads and returns COMPLETED with a signed resultUrl when both checks pass", async () => {
    (prisma.virtualTryOnJob.findUnique as any).mockResolvedValue(mockJob());
    mockFashnCompleted();
    (isSourcePhotoStillValid as any).mockResolvedValue(true);
    (uploadTryOnResult as any).mockResolvedValue({ ok: true });

    const res: any = await loader(args());

    expect(uploadTryOnResult).toHaveBeenCalledWith(CUSTOMER_ID, JOB_ID, "data:image/png;base64,AAAA");
    expect(deleteCloudinaryAsset).not.toHaveBeenCalled();
    expect(prisma.pendingCloudinaryDeletion.upsert).not.toHaveBeenCalled();
    expect(advanceTryOnJob).toHaveBeenCalledWith(
      expect.objectContaining({ id: JOB_ID }),
      "COMPLETED",
      expect.objectContaining({ predictionId: "pred_001" }),
    );
    expect(res.data.status).toBe("COMPLETED");
    expect(res.data.resultUrl).toBe("https://example.invalid/signed-result");
  });
});
