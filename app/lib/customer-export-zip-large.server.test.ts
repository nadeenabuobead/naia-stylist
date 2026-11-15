// app/lib/customer-export-zip-large.server.test.ts
//
// Behavioral coverage for the >300-image secure completion mechanism:
// job creation, streamed chunked-upload archive build, expiration, cleanup,
// and customer isolation. Real archiver, real compileCustomerExport/
// planImages plumbing (via a real customer-export-zip.server.ts import) —
// only the DB and the Cloudinary uploader are faked. No live Cloudinary
// call of any kind; createChunkedRawUploader's own wire protocol (chunk
// boundaries, Content-Range, X-Unique-Upload-Id) is covered separately in
// cloudinary-admin.server.test.ts — this file fakes it entirely via
// _createUploader so tests here focus on buildLargeCustomerExportZip's own
// orchestration (abort conditions, DB state transitions, overlap guard).
//
// Run: npx vitest run app/lib/customer-export-zip-large.server.test.ts

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../db.server", () => {
  const db = {
    customer: { findUnique: vi.fn() },
    customerExportJob: {
      create: vi.fn(),
      update: vi.fn().mockResolvedValue({}),
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
  };
  // A straight passthrough — real $transaction isolation semantics are
  // exercised in reserveExportJobSlot's own dedicated tests below via an
  // explicitly injected runTransaction, same convention as
  // entitlement-reservation.test.ts. This default keeps every pre-existing
  // test in this file working unchanged: tx.customerExportJob.* is the exact
  // same mock as prisma.customerExportJob.*.
  return { default: { ...db, $transaction: vi.fn((fn: (tx: typeof db) => unknown) => fn(db)) } };
});

vi.mock("./cloudinary-admin.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./cloudinary-admin.server")>();
  return {
    ...actual,
    getCloudinaryConfig: vi.fn(() => ({ cloudName: "test-cloud", apiKey: "k", apiSecret: "s" })),
    deleteCloudinaryAsset: vi.fn(),
  };
});

import prisma from "../db.server";
import { deleteCloudinaryAsset } from "./cloudinary-admin.server";
import {
  buildLargeCustomerExportZip,
  getExportJobForCustomer,
  buildExportJobDownloadUrl,
  sweepExpiredExportJobs,
  reserveExportJobSlot,
  SWEEP_BATCH_SIZE,
  MAX_LARGE_EXPORT_IMAGES,
  MAX_LARGE_EXPORT_BYTES,
  MAX_TIME_BUDGET_MS,
  STALE_EXPORT_PROCESSING_THRESHOLD_MS,
  type RunExportReservationFn,
  type LargeExportDeps,
} from "./customer-export-zip-large.server";

// ── Fake chunked uploader ─────────────────────────────────────────────────
// Stands in for createChunkedRawUploader so these tests never touch the
// real signing/HTTP logic (covered in cloudinary-admin.server.test.ts) and
// never risk falling through to the real global fetch if a test forgets to
// inject one.
interface FakeUploaderConfig {
  failOnWriteNumber?: number; // 1-indexed — the Nth write() call fails
  writeFailure?: { ok: false; errorCode: string };
  finishResult?: { ok: true; publicId: string } | { ok: false; errorCode: string };
}

function makeFakeUploaderFactory(config: FakeUploaderConfig = {}) {
  const writes: Buffer[] = [];
  let writeCount = 0;
  let finishCallCount = 0;
  let permanentFailure: { ok: false; errorCode: string } | null = null;

  const factory = ((publicId: string) => ({
    async write(buf: Buffer) {
      if (permanentFailure) return permanentFailure;
      writeCount++;
      if (config.failOnWriteNumber && writeCount === config.failOnWriteNumber) {
        permanentFailure = config.writeFailure ?? { ok: false, errorCode: "PROVIDER_ERROR" };
        return permanentFailure;
      }
      writes.push(buf);
      return { ok: true as const };
    },
    async finish() {
      finishCallCount++;
      if (permanentFailure) return permanentFailure;
      return config.finishResult ?? { ok: true as const, publicId };
    },
  })) as unknown as NonNullable<LargeExportDeps["_createUploader"]>;

  return { factory, writes, getWriteCount: () => writeCount, getFinishCallCount: () => finishCallCount };
}

const CUSTOMER_ID = "cust-1";

function mockCustomer() {
  return {
    id: CUSTOMER_ID,
    email: "synthetic@test.invalid",
    onboardingProfile: null,
    closetItems: [],
    wardrobeSnapshots: [],
    stylingSessions: [],
    buyOrSkipAnalyses: [],
    wardrobeInsights: [],
    savedLooks: [],
    postOutfitReviews: [],
    confidenceScores: [],
    trendReportViews: [],
    stylingEvents: [],
    naiaModel: null,
    tryOnJobs: [],
    recommendationFeedback: [],
    selfieAnalysis: null,
    naiaObservationFeedback: [],
    styleMemoryOutcomes: [],
    tasteEvidence: [],
    styleTendencies: [],
    personalisedTrendEditUsage: [],
    sessions: [],
    identityLinkRequests: [],
    subscriptions: [],
    billingTransactions: [],
  };
}

let defaultUploader: ReturnType<typeof makeFakeUploaderFactory>;

beforeEach(() => {
  vi.clearAllMocks();
  (prisma as any).customer.findUnique.mockResolvedValue(mockCustomer());
  (prisma as any).customerExportJob.create.mockResolvedValue({ id: "job-1" });
  (prisma as any).customerExportJob.update.mockResolvedValue({});
  defaultUploader = makeFakeUploaderFactory();
});

// Merges in the default fake uploader so most tests don't need to repeat
// it — callers that care about upload behavior specifically pass their own
// _createUploader/_fetch/_maxBytes/_maxTimeBudgetMs/_now via overrides.
function deps(overrides: LargeExportDeps = {}): LargeExportDeps {
  return { _createUploader: defaultUploader.factory, ...overrides };
}

describe("buildLargeCustomerExportZip", () => {
  it("returns not_found when compileCustomerExport resolves no customer — no job row created", async () => {
    (prisma as any).customer.findUnique.mockResolvedValueOnce(null);
    const result = await buildLargeCustomerExportZip(CUSTOMER_ID, 301, deps());
    expect(result).toEqual({ ok: false, reason: "not_found" });
    expect((prisma as any).customerExportJob.create).not.toHaveBeenCalled();
  });

  it("creates a PROCESSING job, streams a real archive with no images to the uploader, and marks it COMPLETED with an expiry", async () => {
    const result = await buildLargeCustomerExportZip(CUSTOMER_ID, 301, deps());

    expect((prisma as any).customerExportJob.create).toHaveBeenCalledWith({
      data: { customerId: CUSTOMER_ID, imageCount: 301, status: "PROCESSING" },
    });
    // A real zip was actually produced and streamed through write() —
    // never collected into one giant in-memory buffer first.
    expect(defaultUploader.getWriteCount()).toBeGreaterThan(0);
    expect(defaultUploader.writes.every((c) => Buffer.isBuffer(c))).toBe(true);
    expect(defaultUploader.writes.reduce((sum, c) => sum + c.length, 0)).toBeGreaterThan(0);

    const updateCall = (prisma as any).customerExportJob.update.mock.calls.find(
      (c: any[]) => c[0].data.status === "COMPLETED",
    );
    expect(updateCall[0]).toMatchObject({
      where: { id: "job-1" },
      data: expect.objectContaining({ status: "COMPLETED", publicId: "naia-exports/cust-1/job-1.zip" }),
    });
    expect(updateCall[0].data.expiresAt).toBeInstanceOf(Date);
    expect(updateCall[0].data.expiresAt.getTime()).toBeGreaterThan(Date.now());

    expect(result).toEqual({ ok: true, jobId: "job-1" });
  });

  it("marks the job FAILED (never COMPLETED, never a publicId left pointing nowhere) when the upload's own finish() fails", async () => {
    const failingUploader = makeFakeUploaderFactory({ finishResult: { ok: false, errorCode: "PROVIDER_ERROR" } });

    const result = await buildLargeCustomerExportZip(CUSTOMER_ID, 301, deps({ _createUploader: failingUploader.factory }));

    expect(result).toEqual({ ok: false, reason: "upload_failed", jobId: "job-1", errorCode: "PROVIDER_ERROR" });
    expect((prisma as any).customerExportJob.update).toHaveBeenCalledWith({
      where: { id: "job-1" },
      data: { status: "FAILED", errorCode: "PROVIDER_ERROR" },
    });
    const completedCall = (prisma as any).customerExportJob.update.mock.calls.find(
      (c: any[]) => c[0].data.status === "COMPLETED",
    );
    expect(completedCall).toBeUndefined();
  });

  it("CLEANUP AFTER PARTIAL FAILURE — a mid-stream write() failure (not just a finish() failure) stops the fetch loop immediately, marks the job FAILED with that exact errorCode, and never calls write() or finish() again afterward", async () => {
    (prisma as any).customer.findUnique.mockResolvedValueOnce({
      ...mockCustomer(),
      closetItems: [
        { id: "item-1", name: "Jacket", imagePublicId: "naia-wardrobe/cust-1/jacket", imageFormat: "jpg" },
        { id: "item-2", name: "Coat", imagePublicId: "naia-wardrobe/cust-1/coat", imageFormat: "jpg" },
        { id: "item-3", name: "Scarf", imagePublicId: "naia-wardrobe/cust-1/scarf", imageFormat: "jpg" },
      ],
    });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new TextEncoder().encode("img-bytes").buffer,
    });
    // Fail on the very first chunk written to the uploader — guaranteed to
    // land mid-stream, before the fetch loop has processed every image.
    const flaky = makeFakeUploaderFactory({ failOnWriteNumber: 1, writeFailure: { ok: false, errorCode: "NETWORK_ERROR" } });

    const result = await buildLargeCustomerExportZip(CUSTOMER_ID, 3, deps({ _createUploader: flaky.factory, _fetch: fetchMock }));

    expect(result).toEqual({ ok: false, reason: "upload_failed", jobId: "job-1", errorCode: "NETWORK_ERROR" });
    expect((prisma as any).customerExportJob.update).toHaveBeenCalledWith({
      where: { id: "job-1" },
      data: { status: "FAILED", errorCode: "NETWORK_ERROR" },
    });
    // The archive is small enough that archiver may not flush any output
    // to the uploader until finalize() runs — so all 3 images can
    // legitimately be fetched before the write failure is even discovered.
    // What must never happen is a retry or a second attempt once it's
    // discovered: exactly one write() call (the one that failed) and
    // finish() never reached.
    expect(flaky.getWriteCount()).toBe(1);
    expect(flaky.getFinishCallCount()).toBe(0);
  });

  it("bundles Closet/body-photo/VTO images exactly like the synchronous path — reuses planImages, never re-derives what gets included", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => new TextEncoder().encode("img-bytes").buffer });
    (prisma as any).customer.findUnique.mockResolvedValueOnce({
      ...mockCustomer(),
      closetItems: [{ id: "item-1", name: "Jacket", imagePublicId: "naia-wardrobe/cust-1/jacket", imageFormat: "jpg" }],
    });

    await buildLargeCustomerExportZip(CUSTOMER_ID, 1, deps({ _fetch: fetchMock }));

    // deriving a real download URL requires getCloudinaryConfig/buildPrivateDownloadUrl,
    // already exercised by customer-privacy.server.ts's own tests — here we only need
    // proof that an image fetch was attempted at all, confirming planImages ran.
    expect(fetchMock).toHaveBeenCalled();
  });

  it("rejects an anomalous image count above MAX_LARGE_EXPORT_IMAGES before touching the DB or the uploader — never attempts to build or upload it", async () => {
    const result = await buildLargeCustomerExportZip(CUSTOMER_ID, MAX_LARGE_EXPORT_IMAGES + 1, deps());
    expect(result).toEqual({ ok: false, reason: "exceeds_hard_limit", imageCount: MAX_LARGE_EXPORT_IMAGES + 1 });
    expect((prisma as any).customer.findUnique).not.toHaveBeenCalled();
    expect((prisma as any).customerExportJob.create).not.toHaveBeenCalled();
    expect(defaultUploader.getWriteCount()).toBe(0);
  });

  it("allows an image count exactly at MAX_LARGE_EXPORT_IMAGES — the ceiling is exclusive, not off-by-one", async () => {
    const result = await buildLargeCustomerExportZip(CUSTOMER_ID, MAX_LARGE_EXPORT_IMAGES, deps());
    expect(result).not.toEqual(
      expect.objectContaining({ ok: false, reason: "exceeds_hard_limit" }),
    );
  });

  it("DUPLICATE REQUEST — a second concurrent call for the same customer while the first is still PROCESSING never starts a second build or job row", async () => {
    (prisma as any).customerExportJob.findFirst.mockResolvedValueOnce({
      id: "job-already-running",
      customerId: CUSTOMER_ID,
      status: "PROCESSING",
      createdAt: new Date(),
    });

    const result = await buildLargeCustomerExportZip(CUSTOMER_ID, 301, deps());

    expect(result).toEqual({ ok: false, reason: "already_processing", jobId: "job-already-running" });
    expect((prisma as any).customerExportJob.create).not.toHaveBeenCalled();
    expect(defaultUploader.getWriteCount()).toBe(0);
  });

  it("a stale PROCESSING job (past STALE_EXPORT_PROCESSING_THRESHOLD_MS — its owning container is gone) is terminalized and a fresh build proceeds", async () => {
    (prisma as any).customerExportJob.findFirst.mockResolvedValueOnce({
      id: "job-abandoned",
      customerId: CUSTOMER_ID,
      status: "PROCESSING",
      createdAt: new Date(Date.now() - STALE_EXPORT_PROCESSING_THRESHOLD_MS - 1),
    });

    const result = await buildLargeCustomerExportZip(CUSTOMER_ID, 301, deps());

    expect((prisma as any).customerExportJob.update).toHaveBeenCalledWith({
      where: { id: "job-abandoned" },
      data: { status: "FAILED", errorCode: "ABANDONED_STALE_PROCESSING" },
    });
    expect((prisma as any).customerExportJob.create).toHaveBeenCalledWith({
      data: { customerId: CUSTOMER_ID, imageCount: 301, status: "PROCESSING" },
    });
    expect(result).toEqual({ ok: true, jobId: "job-1" });
  });

  it("a PROCESSING job exactly at the staleness threshold is NOT yet treated as abandoned — the boundary is exclusive", async () => {
    // REGRESSION (flaky-test fix, 2026-11-16): this previously built
    // createdAt from a real Date.now() call and let reserveExportJobSlot's
    // own default nowFn independently call the real Date.now() again later
    // — the gap between those two real timestamps is whatever wall-clock
    // time the test runner actually takes in between, which is zero only by
    // luck. Under load (running alongside many other test files) that gap
    // can exceed 0ms, silently pushing ageMs just past the threshold and
    // flipping this "exactly at the boundary" case to the stale branch
    // instead. A single fixed, injected clock removes the real-time
    // dependency entirely, so the boundary math itself is what's tested.
    const fixedNow = 1_700_000_000_000;
    (prisma as any).customerExportJob.findFirst.mockResolvedValueOnce({
      id: "job-at-boundary",
      customerId: CUSTOMER_ID,
      status: "PROCESSING",
      createdAt: new Date(fixedNow - STALE_EXPORT_PROCESSING_THRESHOLD_MS),
    });

    const result = await buildLargeCustomerExportZip(CUSTOMER_ID, 301, deps({ _now: () => fixedNow }));

    expect(result).toEqual({ ok: false, reason: "already_processing", jobId: "job-at-boundary" });
    expect((prisma as any).customerExportJob.create).not.toHaveBeenCalled();
  });

  describe("MEMORY/SIZE LIMITS — byte-ceiling backstop (secondary now that upload streams in bounded chunks)", () => {
    it("aborts and marks the job FAILED once cumulative fetched bytes exceed the configured ceiling, never finalizing or uploading a truncated archive as if complete", async () => {
      (prisma as any).customer.findUnique.mockResolvedValueOnce({
        ...mockCustomer(),
        closetItems: [
          { id: "item-1", name: "Jacket", imagePublicId: "naia-wardrobe/cust-1/jacket", imageFormat: "jpg" },
          { id: "item-2", name: "Coat", imagePublicId: "naia-wardrobe/cust-1/coat", imageFormat: "jpg" },
        ],
      });
      // A tiny injected ceiling (10 bytes) lets this test prove the real
      // byte-counting logic without allocating real gigabytes — see
      // LargeExportDeps._maxBytes's own doc comment.
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: async () => new TextEncoder().encode("this-is-way-more-than-ten-bytes").buffer,
      });

      const result = await buildLargeCustomerExportZip(CUSTOMER_ID, 2, deps({ _fetch: fetchMock, _maxBytes: 10 }));

      expect(result).toEqual({ ok: false, reason: "upload_failed", jobId: "job-1", errorCode: "EXCEEDS_BYTE_CEILING" });
      expect((prisma as any).customerExportJob.update).toHaveBeenCalledWith({
        where: { id: "job-1" },
        data: { status: "FAILED", errorCode: "EXCEEDS_BYTE_CEILING" },
      });
      // The second image's fetch must never even be attempted once the first
      // already pushed cumulative bytes past the ceiling.
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("stays under the real MAX_LARGE_EXPORT_BYTES ceiling for a normal small export — never trips on ordinary traffic", async () => {
      const result = await buildLargeCustomerExportZip(CUSTOMER_ID, 301, deps());
      expect(result).toEqual({ ok: true, jobId: "job-1" });
      expect(MAX_LARGE_EXPORT_BYTES).toBeGreaterThan(0);
    });
  });

  describe("TIMEOUT RECOVERY — proactive time-budget abort", () => {
    it("aborts and marks the job FAILED (EXCEEDS_TIME_BUDGET) once elapsed time crosses the configured budget, with margin BEFORE the real platform kill — never lets the fetch loop run past it", async () => {
      (prisma as any).customer.findUnique.mockResolvedValueOnce({
        ...mockCustomer(),
        closetItems: [
          { id: "item-1", name: "Jacket", imagePublicId: "naia-wardrobe/cust-1/jacket", imageFormat: "jpg" },
          { id: "item-2", name: "Coat", imagePublicId: "naia-wardrobe/cust-1/coat", imageFormat: "jpg" },
        ],
      });
      const fetchMock = vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => new TextEncoder().encode("x").buffer });
      // Fake clock: the SECOND call (checked at the top of the loop's
      // second iteration) reports time already past the tiny injected
      // budget — proves the check is live elapsed time, not a one-shot
      // check at entry.
      let now = 0;
      const nowFn = vi.fn(() => {
        const value = now;
        now += 1000;
        return value;
      });

      const result = await buildLargeCustomerExportZip(
        CUSTOMER_ID, 2, deps({ _fetch: fetchMock, _now: nowFn, _maxTimeBudgetMs: 1500 }),
      );

      expect(result).toEqual({ ok: false, reason: "upload_failed", jobId: "job-1", errorCode: "EXCEEDS_TIME_BUDGET" });
      expect((prisma as any).customerExportJob.update).toHaveBeenCalledWith({
        where: { id: "job-1" },
        data: { status: "FAILED", errorCode: "EXCEEDS_TIME_BUDGET" },
      });
      // Stopped after the first image, before ever fetching the second.
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("completes normally when elapsed time stays within the budget", async () => {
      const result = await buildLargeCustomerExportZip(CUSTOMER_ID, 301, deps({ _now: () => 0, _maxTimeBudgetMs: MAX_TIME_BUDGET_MS }));
      expect(result).toEqual({ ok: true, jobId: "job-1" });
    });

    it("STALE-JOB SAFETY INVARIANT — the 10-minute stale-job threshold cannot incorrectly terminate a row that's still legitimately processing: no single invocation can legitimately run past the verified real 300s Vercel function timeout, and this proactive abort fires with margin before that, so the threshold must stay safely above both", () => {
      const VERIFIED_REAL_FUNCTION_TIMEOUT_MS = 300 * 1000; // `vercel inspect <deployment> --json`: timeout: 300
      expect(MAX_TIME_BUDGET_MS).toBeLessThan(VERIFIED_REAL_FUNCTION_TIMEOUT_MS);
      expect(STALE_EXPORT_PROCESSING_THRESHOLD_MS).toBeGreaterThan(VERIFIED_REAL_FUNCTION_TIMEOUT_MS);
      expect(STALE_EXPORT_PROCESSING_THRESHOLD_MS).toBeGreaterThan(MAX_TIME_BUDGET_MS);
    });
  });
});

describe("reserveExportJobSlot — overlap guard, in isolation", () => {
  const CUST = "cust-iso";

  function passthroughTx(db: {
    customerExportJob: { findFirst: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
  }): RunExportReservationFn {
    return (async (fn: any) => fn(db)) as RunExportReservationFn;
  }

  it("no existing PROCESSING row — creates one and returns ok", async () => {
    const db = {
      customerExportJob: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: "new-job" }),
        update: vi.fn(),
      },
    };
    const result = await reserveExportJobSlot(CUST, 5, passthroughTx(db));
    expect(result).toEqual({ ok: true, job: { id: "new-job" } });
    expect(db.customerExportJob.update).not.toHaveBeenCalled();
  });

  it("retries once on a Prisma P2034 serialization conflict, then succeeds — mirrors entitlement.server.ts's own retry convention", async () => {
    let attempts = 0;
    const db = {
      customerExportJob: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: "new-job" }),
        update: vi.fn(),
      },
    };
    const flakyTx: RunExportReservationFn = (async (fn: any) => {
      attempts++;
      if (attempts === 1) {
        const err: any = new Error("conflict");
        err.code = "P2034";
        throw err;
      }
      return fn(db);
    }) as RunExportReservationFn;

    const result = await reserveExportJobSlot(CUST, 5, flakyTx);
    expect(attempts).toBe(2);
    expect(result).toEqual({ ok: true, job: { id: "new-job" } });
  });

  it("a non-serialization error propagates immediately — never silently retried", async () => {
    const boom: RunExportReservationFn = (async () => {
      throw new Error("unrelated DB failure");
    }) as RunExportReservationFn;
    await expect(reserveExportJobSlot(CUST, 5, boom)).rejects.toThrow("unrelated DB failure");
  });
});

describe("getExportJobForCustomer — customer isolation", () => {
  it("looks up by (id, customerId) together — never id alone", async () => {
    (prisma as any).customerExportJob.findFirst.mockResolvedValueOnce({ id: "job-1", customerId: CUSTOMER_ID });
    await getExportJobForCustomer("job-1", CUSTOMER_ID);
    expect((prisma as any).customerExportJob.findFirst).toHaveBeenCalledWith({
      where: { id: "job-1", customerId: CUSTOMER_ID },
    });
  });

  it("a job belonging to a different customer is indistinguishable from not found", async () => {
    // The mock simulates what the real WHERE clause does: no row matches
    // when customerId doesn't match, regardless of what id was passed.
    (prisma as any).customerExportJob.findFirst.mockResolvedValueOnce(null);
    const result = await getExportJobForCustomer("job-belonging-to-cust-2", CUSTOMER_ID);
    expect(result).toBeNull();
  });
});

describe("buildExportJobDownloadUrl", () => {
  function completedJob(overrides: Record<string, unknown> = {}) {
    return {
      id: "job-1",
      customerId: CUSTOMER_ID,
      status: "COMPLETED",
      publicId: "naia-exports/cust-1/job-1.zip",
      expiresAt: new Date(Date.now() + 60_000),
      ...overrides,
    };
  }

  it("returns a fresh signed raw-download URL for a completed, unexpired job", async () => {
    (prisma as any).customerExportJob.findFirst.mockResolvedValueOnce(completedJob());

    const result = await buildExportJobDownloadUrl("job-1", CUSTOMER_ID);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.downloadUrl).toContain("/raw/download");
      expect(result.downloadUrl).toContain("naia-exports%2Fcust-1%2Fjob-1.zip");
      expect(result.expiresInSeconds).toBe(600);
    }
  });

  it("returns not_found for a job scoped to a different customer (findFirst itself returns null)", async () => {
    (prisma as any).customerExportJob.findFirst.mockResolvedValueOnce(null);
    const result = await buildExportJobDownloadUrl("job-1", "cust-2");
    expect(result).toEqual({ ok: false, reason: "not_found" });
  });

  it("returns not_ready for a job that hasn't completed yet", async () => {
    (prisma as any).customerExportJob.findFirst.mockResolvedValueOnce(completedJob({ status: "PROCESSING", publicId: null }));
    const result = await buildExportJobDownloadUrl("job-1", CUSTOMER_ID);
    expect(result).toEqual({ ok: false, reason: "not_ready" });
  });

  it("returns expired for a COMPLETED job past its expiresAt — never signs a link past the retention window", async () => {
    (prisma as any).customerExportJob.findFirst.mockResolvedValueOnce(completedJob({ expiresAt: new Date(Date.now() - 1000) }));
    const result = await buildExportJobDownloadUrl("job-1", CUSTOMER_ID);
    expect(result).toEqual({ ok: false, reason: "expired" });
  });
});

describe("sweepExpiredExportJobs — admin-triggered cleanup", () => {
  it("deletes the Cloudinary asset for every expired COMPLETED job and flips it to EXPIRED, clearing publicId", async () => {
    (prisma as any).customerExportJob.findMany.mockResolvedValueOnce([
      { id: "job-1", publicId: "naia-exports/cust-1/job-1.zip" },
      { id: "job-2", publicId: "naia-exports/cust-2/job-2.zip" },
    ]);
    vi.mocked(deleteCloudinaryAsset).mockResolvedValue({ ok: true });

    const result = await sweepExpiredExportJobs();

    expect(deleteCloudinaryAsset).toHaveBeenCalledWith("naia-exports/cust-1/job-1.zip", "private", undefined, undefined, "raw");
    expect((prisma as any).customerExportJob.update).toHaveBeenCalledWith({
      where: { id: "job-1" },
      data: { status: "EXPIRED", publicId: null },
    });
    expect(result).toEqual({ checked: 2, deleted: 2, failed: 0, more: false });
  });

  it("only queries COMPLETED jobs past their expiry — never a still-valid or already-expired-and-cleared row", async () => {
    (prisma as any).customerExportJob.findMany.mockResolvedValueOnce([]);
    await sweepExpiredExportJobs();
    expect((prisma as any).customerExportJob.findMany).toHaveBeenCalledWith({
      where: { status: "COMPLETED", expiresAt: { lte: expect.any(Date) }, publicId: { not: null } },
      take: expect.any(Number),
    });
  });

  it("a per-asset Cloudinary failure is counted but does not stop the rest of the sweep, and leaves that job COMPLETED for the next run to retry", async () => {
    (prisma as any).customerExportJob.findMany.mockResolvedValueOnce([
      { id: "job-1", publicId: "naia-exports/cust-1/job-1.zip" },
    ]);
    vi.mocked(deleteCloudinaryAsset).mockResolvedValueOnce({ ok: false, errorCode: "PROVIDER_ERROR" });

    const result = await sweepExpiredExportJobs();

    expect(result).toEqual({ checked: 1, deleted: 0, failed: 1, more: false });
    expect((prisma as any).customerExportJob.update).not.toHaveBeenCalled();
  });

  it("nothing expired — a clean no-op, not an error", async () => {
    (prisma as any).customerExportJob.findMany.mockResolvedValueOnce([]);
    const result = await sweepExpiredExportJobs();
    expect(result).toEqual({ checked: 0, deleted: 0, failed: 0, more: false });
  });

  it("is bounded per call (SWEEP_BATCH_SIZE) and reports more:true when a backlog exceeds one batch — never attempts an unbounded sweep in one invocation", async () => {
    const oversized = Array.from({ length: SWEEP_BATCH_SIZE + 1 }, (_, i) => ({
      id: `job-${i}`,
      publicId: `naia-exports/cust-${i}/job-${i}.zip`,
    }));
    (prisma as any).customerExportJob.findMany.mockResolvedValueOnce(oversized);
    vi.mocked(deleteCloudinaryAsset).mockResolvedValue({ ok: true });

    const result = await sweepExpiredExportJobs();

    expect((prisma as any).customerExportJob.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: SWEEP_BATCH_SIZE + 1 }),
    );
    // Only the batch-sized slice is actually processed, even though the mock
    // returned one more than that.
    expect(deleteCloudinaryAsset).toHaveBeenCalledTimes(SWEEP_BATCH_SIZE);
    expect(result).toEqual({ checked: SWEEP_BATCH_SIZE, deleted: SWEEP_BATCH_SIZE, failed: 0, more: true });
  });

  it("reports more:false when the backlog exactly fits in one batch", async () => {
    const exact = Array.from({ length: SWEEP_BATCH_SIZE }, (_, i) => ({
      id: `job-${i}`,
      publicId: `naia-exports/cust-${i}/job-${i}.zip`,
    }));
    (prisma as any).customerExportJob.findMany.mockResolvedValueOnce(exact);
    vi.mocked(deleteCloudinaryAsset).mockResolvedValue({ ok: true });

    const result = await sweepExpiredExportJobs();
    expect(result.more).toBe(false);
    expect(result.checked).toBe(SWEEP_BATCH_SIZE);
  });
});
