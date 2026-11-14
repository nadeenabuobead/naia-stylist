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
    closetItem: {
      findMany: vi.fn(),
    },
    buyOrSkipAnalysis: {
      findMany: vi.fn(),
    },
    // Backs customerHasOutstandingVtoSweepObligation's fail-closed check
    // (2026-11 privacy fix) — null by default, so these pre-existing tests
    // keep their original "no obligation outstanding" behavior unchanged.
    pendingCloudinaryDeletion: {
      findUnique: vi.fn().mockResolvedValue(null),
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

vi.mock("~/lib/ai/naia-catalog", () => ({
  getProductByHandle: vi.fn(),
}));

import prisma from "~/db.server";
import { deleteCloudinaryAsset } from "~/lib/cloudinary-admin.server";
import { getProductByHandle } from "~/lib/ai/naia-catalog";
import {
  deleteOneVtoResult,
  listCustomerVtoPreviews,
  deriveTryOnResultPublicId,
} from "~/lib/ai/fashn-tryon-service.server";
import { FULL_LOOK_INTERMEDIATE_HANDLE_PREFIXES } from "~/lib/ai/full-look-handle-constants";

beforeEach(() => {
  vi.clearAllMocks();
  (deleteCloudinaryAsset as any).mockResolvedValue({ ok: true });
  (prisma.closetItem.findMany as any).mockResolvedValue([]);
  (prisma.buyOrSkipAnalysis.findMany as any).mockResolvedValue([]);
  (getProductByHandle as any).mockReturnValue(undefined);
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
  it("lists only COMPLETED jobs for this customer, newest first, excluding Full-Look intermediate steps", async () => {
    (prisma.virtualTryOnJob.findMany as any).mockResolvedValue([]);
    await listCustomerVtoPreviews("cust-A");
    expect(prisma.virtualTryOnJob.findMany).toHaveBeenCalledWith({
      where: {
        customerId: "cust-A",
        status: "COMPLETED",
        NOT: FULL_LOOK_INTERMEDIATE_HANDLE_PREFIXES.map((prefix) => ({ productHandle: { startsWith: prefix } })),
      },
      select: { id: true, productHandle: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    });
  });

  describe("Full-Look VTO intermediate-step exclusion", () => {
    // 2026-11-14 — a completed outfit writes one COMPLETED row per garment
    // step (fulllook-real:step1:, :step2:, :step3:...). Only the final step
    // is a real, customer-facing try-on; the rest must never surface here,
    // or one outfit would render as N separate preview cards.
    it("surfaces the final Full-Look step as a normal preview card, same shape as any other result", async () => {
      const createdAt = new Date("2026-11-14T00:00:00.000Z");
      (prisma.virtualTryOnJob.findMany as any).mockResolvedValue([
        { id: "job-final", productHandle: "fulllook-real:step3:suggestion-1", createdAt },
      ]);
      const result = await listCustomerVtoPreviews("cust-A");
      expect(result).toEqual([
        {
          jobId: "job-final",
          label: "Virtual Try-On",
          createdAt,
          previewUrl: expect.stringContaining("api.cloudinary.com"),
        },
      ]);
    });

    it("a single-item VTO's plain NADINE/closet/buyskip handle is never matched by the Full-Look prefixes", async () => {
      (prisma.virtualTryOnJob.findMany as any).mockResolvedValue([
        { id: "job-1", productHandle: "collar-shirt", createdAt: new Date() },
        { id: "job-2", productHandle: "closet:item-1", createdAt: new Date() },
      ]);
      const result = await listCustomerVtoPreviews("cust-A");
      expect(result).toHaveLength(2);
    });
  });

  it("builds a fresh signed preview URL per job, derived the same way the VTO experience itself renders a result", async () => {
    const createdAt = new Date("2026-10-01T00:00:00.000Z");
    (prisma.virtualTryOnJob.findMany as any).mockResolvedValue([
      { id: "job-1", productHandle: "collar-shirt", createdAt },
    ]);
    (getProductByHandle as any).mockReturnValue({ parsed: { identity: { verifiedTitle: "Collar Shirt" } } });
    const result = await listCustomerVtoPreviews("cust-A");
    expect(result).toEqual([
      { jobId: "job-1", label: "Collar Shirt", createdAt, previewUrl: expect.stringContaining("api.cloudinary.com") },
    ]);
  });

  it("never exposes internal storage identifiers — only jobId, label, createdAt, and the signed URL are returned", async () => {
    (prisma.virtualTryOnJob.findMany as any).mockResolvedValue([
      { id: "job-1", productHandle: "collar-shirt", createdAt: new Date() },
    ]);
    const result = await listCustomerVtoPreviews("cust-A");
    const keys = Object.keys(result[0]);
    expect(keys.sort()).toEqual(["createdAt", "jobId", "label", "previewUrl"]);
  });

  it("returns an empty list (not an error) for a customer with no completed jobs", async () => {
    (prisma.virtualTryOnJob.findMany as any).mockResolvedValue([]);
    const result = await listCustomerVtoPreviews("cust-A");
    expect(result).toEqual([]);
  });

  it("fails closed: returns an empty list, never querying jobs at all, while a VTO-sweep cleanup obligation is outstanding for this customer", async () => {
    (prisma.pendingCloudinaryDeletion.findUnique as any).mockResolvedValue({ resolvedAt: null });
    (prisma.virtualTryOnJob.findMany as any).mockResolvedValue([
      { id: "job-1", productHandle: "collar-shirt", createdAt: new Date() },
    ]);

    const result = await listCustomerVtoPreviews("cust-A");

    expect(result).toEqual([]);
    expect(prisma.virtualTryOnJob.findMany).not.toHaveBeenCalled();
  });

  it("does NOT fail closed once the obligation is resolved", async () => {
    (prisma.pendingCloudinaryDeletion.findUnique as any).mockResolvedValue({ resolvedAt: new Date() });
    (prisma.virtualTryOnJob.findMany as any).mockResolvedValue([
      { id: "job-1", productHandle: "collar-shirt", createdAt: new Date() },
    ]);

    const result = await listCustomerVtoPreviews("cust-A");

    expect(result.length).toBe(1);
  });

  it("resolves a closet-sourced job's label to the Closet item's real name — never the raw 'closet:id' handle", async () => {
    (prisma.virtualTryOnJob.findMany as any).mockResolvedValue([
      { id: "job-1", productHandle: "closet:item-1", createdAt: new Date() },
    ]);
    (prisma.closetItem.findMany as any).mockResolvedValue([{ id: "item-1", name: "Beige Tailored Blazer" }]);
    const result = await listCustomerVtoPreviews("cust-A");
    expect(prisma.closetItem.findMany).toHaveBeenCalledWith({
      where: { id: { in: ["item-1"] }, customerId: "cust-A" },
      select: { id: true, name: true },
    });
    expect(result[0].label).toBe("Beige Tailored Blazer");
    expect(result[0].label).not.toContain("closet:");
    expect(result[0].label).not.toContain("item-1");
  });

  it("resolves a buyskip-sourced job's label to the analysis's productName — never the raw 'buyskip:id' handle", async () => {
    (prisma.virtualTryOnJob.findMany as any).mockResolvedValue([
      { id: "job-1", productHandle: "buyskip:analysis-1", createdAt: new Date() },
    ]);
    (prisma.buyOrSkipAnalysis.findMany as any).mockResolvedValue([{ id: "analysis-1", productName: "Denim Jacket" }]);
    const result = await listCustomerVtoPreviews("cust-A");
    expect(prisma.buyOrSkipAnalysis.findMany).toHaveBeenCalledWith({
      where: { id: { in: ["analysis-1"] }, customerId: "cust-A" },
      select: { id: true, productName: true },
    });
    expect(result[0].label).toBe("Denim Jacket");
    expect(result[0].label).not.toContain("buyskip:");
  });

  it("falls back to a neutral label when the source record is missing (deleted Closet item / analysis) — never the raw id", async () => {
    (prisma.virtualTryOnJob.findMany as any).mockResolvedValue([
      { id: "job-1", productHandle: "closet:deleted-item", createdAt: new Date() },
      { id: "job-2", productHandle: "buyskip:deleted-analysis", createdAt: new Date() },
    ]);
    (prisma.closetItem.findMany as any).mockResolvedValue([]); // item no longer exists
    (prisma.buyOrSkipAnalysis.findMany as any).mockResolvedValue([]);
    const result = await listCustomerVtoPreviews("cust-A");
    expect(result[0].label).toBe("Virtual Try-On");
    expect(result[1].label).toBe("Virtual Try-On");
  });

  it("resolves a NADINE catalog handle via the verified catalog title", async () => {
    (prisma.virtualTryOnJob.findMany as any).mockResolvedValue([
      { id: "job-1", productHandle: "modern-blazer", createdAt: new Date() },
    ]);
    (getProductByHandle as any).mockReturnValue({ parsed: { identity: { verifiedTitle: "The Modern Blazer" } } });
    const result = await listCustomerVtoPreviews("cust-A");
    expect(getProductByHandle).toHaveBeenCalledWith("modern-blazer");
    expect(result[0].label).toBe("The Modern Blazer");
  });

  it("falls back to a neutral label for an unresolvable NADINE handle", async () => {
    (prisma.virtualTryOnJob.findMany as any).mockResolvedValue([
      { id: "job-1", productHandle: "retired-handle", createdAt: new Date() },
    ]);
    (getProductByHandle as any).mockReturnValue(undefined);
    const result = await listCustomerVtoPreviews("cust-A");
    expect(result[0].label).toBe("Virtual Try-On");
  });

  it("never looks up another customer's Closet item or Buy-or-Skip analysis — the id lookup is scoped by customerId", async () => {
    (prisma.virtualTryOnJob.findMany as any).mockResolvedValue([
      { id: "job-1", productHandle: "closet:item-1", createdAt: new Date() },
    ]);
    await listCustomerVtoPreviews("cust-A");
    const call = (prisma.closetItem.findMany as any).mock.calls[0][0];
    expect(call.where.customerId).toBe("cust-A");
  });
});
