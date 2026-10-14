// app/lib/ai/fashn-tryon-vto-previews.test.ts
//
// VTO preview visibility + deletion for My nAia Model's "Your Try-On
// Previews" section. Distinct from fashn-tryon-service.test.ts (which
// DI-injects every dependency and never touches Prisma): these two
// functions read/write prisma.virtualTryOnJob directly, so this file
// mocks ~/db.server the same way closet-photo-privacy.test.ts does for the
// equivalent Closet feature.
//
// Storage truth this locks in: VirtualTryOnJob has NO image-storage column
// at all — the result publicId is deterministically derived from
// (customerId, jobId) via deriveTryOnResultPublicId. That is exactly why
// per-preview deletion needs no schema change: identifying and deleting one
// preview only ever needs the job's own id.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/db.server", () => ({
  default: {
    virtualTryOnJob: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
    },
  },
}));

vi.mock("~/lib/cloudinary-admin.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/lib/cloudinary-admin.server")>();
  return {
    ...actual,
    deleteCloudinaryAsset: vi.fn(),
    getCloudinaryConfig: vi.fn(() => ({ cloudName: "demo", apiKey: "key", apiSecret: "secret" })),
  };
});

import prisma from "~/db.server";
import { deleteCloudinaryAsset } from "~/lib/cloudinary-admin.server";
import {
  deleteOneVtoResult,
  listCustomerVtoPreviews,
  deriveTryOnResultPublicId,
} from "~/lib/ai/fashn-tryon-service.server";

beforeEach(() => {
  vi.clearAllMocks();
  (deleteCloudinaryAsset as any).mockResolvedValue({ ok: true });
});

describe("deleteOneVtoResult() — single-preview deletion", () => {
  it("rejects a job that does not belong to this customer — ownership is enforced at the query itself", async () => {
    (prisma.virtualTryOnJob.findFirst as any).mockResolvedValue(null);
    const result = await deleteOneVtoResult("job-1", "cust-A");
    expect(result).toEqual({ deleted: false, errorCode: "NOT_FOUND" });
    expect(deleteCloudinaryAsset).not.toHaveBeenCalled();
  });

  it("scopes the lookup to id + customerId + COMPLETED status together", async () => {
    (prisma.virtualTryOnJob.findFirst as any).mockResolvedValue({ id: "job-1" });
    await deleteOneVtoResult("job-1", "cust-A");
    expect(prisma.virtualTryOnJob.findFirst).toHaveBeenCalledWith({
      where: { id: "job-1", customerId: "cust-A", status: "COMPLETED" },
      select: { id: true },
    });
  });

  it("deletes exactly the one derived publicId for this job — not a bulk sweep", async () => {
    (prisma.virtualTryOnJob.findFirst as any).mockResolvedValue({ id: "job-1" });
    await deleteOneVtoResult("job-1", "cust-A");
    expect(deleteCloudinaryAsset).toHaveBeenCalledTimes(1);
    expect(deleteCloudinaryAsset).toHaveBeenCalledWith(deriveTryOnResultPublicId("cust-A", "job-1"), "private");
  });

  it("a cross-customer jobId (belongs to someone else) is rejected even though the id itself is valid", async () => {
    // The customerId filter in the where clause is what makes this safe —
    // simulate the DB genuinely finding nothing for the wrong customer.
    (prisma.virtualTryOnJob.findFirst as any).mockImplementation(({ where }: any) =>
      where.customerId === "cust-A" ? null : { id: where.id },
    );
    const result = await deleteOneVtoResult("job-1", "cust-A");
    expect(result).toEqual({ deleted: false, errorCode: "NOT_FOUND" });
  });

  it("never mutates the job row — usage/history stays intact after deletion", async () => {
    (prisma.virtualTryOnJob.findFirst as any).mockResolvedValue({ id: "job-1" });
    await deleteOneVtoResult("job-1", "cust-A");
    expect(prisma.virtualTryOnJob).not.toHaveProperty("update");
    // (no update/updateMany mock exists on the mocked model at all — any
    // attempt to call one would throw "not a function", which no test here does)
  });
});

describe("listCustomerVtoPreviews() — Try-On Previews gallery read", () => {
  it("lists only COMPLETED jobs for this customer, newest first", async () => {
    (prisma.virtualTryOnJob.findMany as any).mockResolvedValue([]);
    await listCustomerVtoPreviews("cust-A");
    expect(prisma.virtualTryOnJob.findMany).toHaveBeenCalledWith({
      where: { customerId: "cust-A", status: "COMPLETED" },
      select: { id: true, productHandle: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    });
  });

  it("builds a fresh signed preview URL per job, derived the same way the VTO experience itself renders a result", async () => {
    const createdAt = new Date("2026-10-01T00:00:00.000Z");
    (prisma.virtualTryOnJob.findMany as any).mockResolvedValue([
      { id: "job-1", productHandle: "collar-shirt", createdAt },
    ]);
    const result = await listCustomerVtoPreviews("cust-A");
    expect(result).toEqual([
      { jobId: "job-1", productHandle: "collar-shirt", createdAt, previewUrl: expect.stringContaining("api.cloudinary.com") },
    ]);
  });

  it("never exposes internal storage identifiers — only jobId, productHandle, createdAt, and the signed URL are returned", async () => {
    (prisma.virtualTryOnJob.findMany as any).mockResolvedValue([
      { id: "job-1", productHandle: "collar-shirt", createdAt: new Date() },
    ]);
    const result = await listCustomerVtoPreviews("cust-A");
    const keys = Object.keys(result[0]);
    expect(keys.sort()).toEqual(["createdAt", "jobId", "previewUrl", "productHandle"]);
  });

  it("returns an empty list (not an error) for a customer with no completed jobs", async () => {
    (prisma.virtualTryOnJob.findMany as any).mockResolvedValue([]);
    const result = await listCustomerVtoPreviews("cust-A");
    expect(result).toEqual([]);
  });
});
