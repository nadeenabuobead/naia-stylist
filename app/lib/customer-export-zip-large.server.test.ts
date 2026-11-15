// app/lib/customer-export-zip-large.server.test.ts
//
// Behavioral coverage for the >300-image secure completion mechanism:
// job creation, archive build + raw upload, expiration, cleanup, and
// customer isolation. Real archiver, real compileCustomerExport/planImages
// plumbing (via a real customer-export-zip.server.ts import) — only the DB
// and Cloudinary I/O are mocked. No live Cloudinary call of any kind.
//
// Run: npx vitest run app/lib/customer-export-zip-large.server.test.ts

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../db.server", () => ({
  default: {
    customer: { findUnique: vi.fn() },
    customerExportJob: {
      create: vi.fn(),
      update: vi.fn().mockResolvedValue({}),
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
  },
}));

vi.mock("./cloudinary-admin.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./cloudinary-admin.server")>();
  return {
    ...actual,
    getCloudinaryConfig: vi.fn(() => ({ cloudName: "test-cloud", apiKey: "k", apiSecret: "s" })),
    uploadCloudinaryRawPrivate: vi.fn(),
    deleteCloudinaryAsset: vi.fn(),
  };
});

import prisma from "../db.server";
import { uploadCloudinaryRawPrivate, deleteCloudinaryAsset } from "./cloudinary-admin.server";
import {
  buildLargeCustomerExportZip,
  getExportJobForCustomer,
  buildExportJobDownloadUrl,
  sweepExpiredExportJobs,
} from "./customer-export-zip-large.server";

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

beforeEach(() => {
  vi.clearAllMocks();
  (prisma as any).customer.findUnique.mockResolvedValue(mockCustomer());
  (prisma as any).customerExportJob.create.mockResolvedValue({ id: "job-1" });
  (prisma as any).customerExportJob.update.mockResolvedValue({});
  vi.mocked(uploadCloudinaryRawPrivate).mockResolvedValue({ ok: true, publicId: "naia-exports/cust-1/job-1.zip" });
});

describe("buildLargeCustomerExportZip", () => {
  it("returns not_found when compileCustomerExport resolves no customer — no job row created", async () => {
    (prisma as any).customer.findUnique.mockResolvedValueOnce(null);
    const result = await buildLargeCustomerExportZip(CUSTOMER_ID, 301);
    expect(result).toEqual({ ok: false, reason: "not_found" });
    expect((prisma as any).customerExportJob.create).not.toHaveBeenCalled();
  });

  it("creates a PROCESSING job, builds a real archive with no images, uploads it as a raw asset, and marks it COMPLETED with an expiry", async () => {
    const result = await buildLargeCustomerExportZip(CUSTOMER_ID, 301);

    expect((prisma as any).customerExportJob.create).toHaveBeenCalledWith({
      data: { customerId: CUSTOMER_ID, imageCount: 301, status: "PROCESSING" },
    });
    expect(uploadCloudinaryRawPrivate).toHaveBeenCalledWith(
      "naia-exports/cust-1/job-1.zip",
      expect.any(Buffer),
      "naia-data-export-job-1.zip",
      "private",
    );
    const uploadedBuffer = vi.mocked(uploadCloudinaryRawPrivate).mock.calls[0][1];
    expect(uploadedBuffer.length).toBeGreaterThan(0); // a real zip was actually produced

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

  it("marks the job FAILED (never COMPLETED, never a publicId left pointing nowhere) when the Cloudinary upload itself fails", async () => {
    vi.mocked(uploadCloudinaryRawPrivate).mockResolvedValueOnce({ ok: false, errorCode: "PROVIDER_ERROR" });

    const result = await buildLargeCustomerExportZip(CUSTOMER_ID, 301);

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

  it("bundles Closet/body-photo/VTO images exactly like the synchronous path — reuses planImages, never re-derives what gets included", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => new TextEncoder().encode("img-bytes").buffer });
    (prisma as any).customer.findUnique.mockResolvedValueOnce({
      ...mockCustomer(),
      closetItems: [{ id: "item-1", name: "Jacket", imagePublicId: "naia-wardrobe/cust-1/jacket", imageFormat: "jpg" }],
    });

    await buildLargeCustomerExportZip(CUSTOMER_ID, 1, { _fetch: fetchMock });

    // deriving a real download URL requires getCloudinaryConfig/buildPrivateDownloadUrl,
    // already exercised by customer-privacy.server.ts's own tests — here we only need
    // proof that an image fetch was attempted at all, confirming planImages ran.
    expect(fetchMock).toHaveBeenCalled();
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
    expect(result).toEqual({ checked: 2, deleted: 2, failed: 0 });
  });

  it("only queries COMPLETED jobs past their expiry — never a still-valid or already-expired-and-cleared row", async () => {
    (prisma as any).customerExportJob.findMany.mockResolvedValueOnce([]);
    await sweepExpiredExportJobs();
    expect((prisma as any).customerExportJob.findMany).toHaveBeenCalledWith({
      where: { status: "COMPLETED", expiresAt: { lte: expect.any(Date) }, publicId: { not: null } },
    });
  });

  it("a per-asset Cloudinary failure is counted but does not stop the rest of the sweep, and leaves that job COMPLETED for the next run to retry", async () => {
    (prisma as any).customerExportJob.findMany.mockResolvedValueOnce([
      { id: "job-1", publicId: "naia-exports/cust-1/job-1.zip" },
    ]);
    vi.mocked(deleteCloudinaryAsset).mockResolvedValueOnce({ ok: false, errorCode: "PROVIDER_ERROR" });

    const result = await sweepExpiredExportJobs();

    expect(result).toEqual({ checked: 1, deleted: 0, failed: 1 });
    expect((prisma as any).customerExportJob.update).not.toHaveBeenCalled();
  });

  it("nothing expired — a clean no-op, not an error", async () => {
    (prisma as any).customerExportJob.findMany.mockResolvedValueOnce([]);
    const result = await sweepExpiredExportJobs();
    expect(result).toEqual({ checked: 0, deleted: 0, failed: 0 });
  });
});
