// app/lib/cloudinary-orphan-sweep.server.test.ts
//
// Behavioral tests for the abandoned-upload sweep. $transaction is mocked
// to invoke its callback against the SAME mocked prisma object (acting as
// the transaction client) — these tests prove the sweep's reference-check
// and claim logic are correct and that it never calls deleteCloudinaryAsset
// for a referenced or too-recent asset; they cannot (and nothing in this
// environment can) prove real concurrent Postgres Serializable behavior —
// see entitlement-reservation.test.ts's own header for the same caveat,
// which applies identically here.

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPrisma = vi.hoisted(() => {
  const p: any = {
    closetItem: { findMany: vi.fn() },
    buyOrSkipAnalysis: { findMany: vi.fn() },
    naiaModel: { findUnique: vi.fn() },
    selfieAnalysis: { findUnique: vi.fn() },
    pendingCloudinaryDeletion: { upsert: vi.fn(), updateMany: vi.fn() },
    cloudinarySweepRun: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    customer: { findMany: vi.fn() },
    $transaction: vi.fn(),
  };
  p.$transaction.mockImplementation(async (fn: any) => fn(p));
  return p;
});

vi.mock("~/db.server", () => ({ default: mockPrisma }));

vi.mock("~/lib/cloudinary-admin.server", () => ({
  listCloudinaryAssetsByPrefix: vi.fn(),
  deleteCloudinaryAsset: vi.fn(),
}));

import { listCloudinaryAssetsByPrefix, deleteCloudinaryAsset } from "~/lib/cloudinary-admin.server";
import { sweepCustomer, sweepCustomerForErasure, runBoundedSweep } from "./cloudinary-orphan-sweep.server";

const CUSTOMER_ID = "cust-sweep-test";
const NOW = Date.now();
const RECENT = new Date(NOW - 60_000).toISOString(); // 1 minute ago
const OLD = new Date(NOW - 48 * 60 * 60 * 1000).toISOString(); // 48h ago

function emptyRefs() {
  mockPrisma.closetItem.findMany.mockResolvedValue([]);
  mockPrisma.buyOrSkipAnalysis.findMany.mockResolvedValue([]);
  mockPrisma.naiaModel.findUnique.mockResolvedValue(null);
  mockPrisma.selfieAnalysis.findUnique.mockResolvedValue(null);
}

function onePage(assets: any[]) {
  (listCloudinaryAssetsByPrefix as any)
    .mockResolvedValueOnce({ ok: true, assets, nextCursor: null, rateLimitRemaining: 100 })
    .mockResolvedValue({ ok: true, assets: [], nextCursor: null, rateLimitRemaining: 100 }); // the other delivery type (authenticated)
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.$transaction.mockImplementation(async (fn: any) => fn(mockPrisma));
  (deleteCloudinaryAsset as any).mockResolvedValue({ ok: true });
  emptyRefs();
});

describe("sweepCustomer — reference protection across all five live fields", () => {
  it("never deletes an asset referenced by ClosetItem.imagePublicId", async () => {
    mockPrisma.closetItem.findMany.mockResolvedValue([{ imagePublicId: "naia-wardrobe/cust-sweep-test/a" }]);
    onePage([{ publicId: "naia-wardrobe/cust-sweep-test/a", resourceType: "image", type: "private", format: "jpg", createdAt: OLD }]);

    const outcome = await sweepCustomer(CUSTOMER_ID, { minAgeMs: 0, dryRun: false });

    expect(deleteCloudinaryAsset).not.toHaveBeenCalled();
    expect(outcome.skippedReferenced).toBe(1);
    expect(outcome.deleted).toBe(0);
  });

  it("never deletes an asset referenced by BuyOrSkipAnalysis.imagePublicId", async () => {
    mockPrisma.buyOrSkipAnalysis.findMany.mockResolvedValue([{ imagePublicId: "naia-wardrobe/cust-sweep-test/b" }]);
    onePage([{ publicId: "naia-wardrobe/cust-sweep-test/b", resourceType: "image", type: "private", format: "jpg", createdAt: OLD }]);

    const outcome = await sweepCustomer(CUSTOMER_ID, { minAgeMs: 0, dryRun: false });
    expect(deleteCloudinaryAsset).not.toHaveBeenCalled();
    expect(outcome.skippedReferenced).toBe(1);
  });

  it("never deletes NaiaModel.facePublicId or bodyPublicId — the VTO photo this app must never lose to an orphan sweep", async () => {
    mockPrisma.naiaModel.findUnique.mockResolvedValue({ facePublicId: "naia-wardrobe/cust-sweep-test/face", bodyPublicId: "naia-wardrobe/cust-sweep-test/body" });
    onePage([
      { publicId: "naia-wardrobe/cust-sweep-test/face", resourceType: "image", type: "authenticated", format: "jpg", createdAt: OLD },
      { publicId: "naia-wardrobe/cust-sweep-test/body", resourceType: "image", type: "private", format: "jpg", createdAt: OLD },
    ]);

    const outcome = await sweepCustomer(CUSTOMER_ID, { minAgeMs: 0, dryRun: false });
    expect(deleteCloudinaryAsset).not.toHaveBeenCalled();
    expect(outcome.skippedReferenced).toBe(2);
  });

  it("never deletes SelfieAnalysis.photoPublicId", async () => {
    mockPrisma.selfieAnalysis.findUnique.mockResolvedValue({ photoPublicId: "naia-wardrobe/cust-sweep-test/selfie" });
    onePage([{ publicId: "naia-wardrobe/cust-sweep-test/selfie", resourceType: "image", type: "private", format: "jpg", createdAt: OLD }]);

    const outcome = await sweepCustomer(CUSTOMER_ID, { minAgeMs: 0, dryRun: false });
    expect(deleteCloudinaryAsset).not.toHaveBeenCalled();
    expect(outcome.skippedReferenced).toBe(1);
  });

  it("lists BOTH delivery types (private and authenticated) under the customer's own prefix", async () => {
    (listCloudinaryAssetsByPrefix as any).mockResolvedValue({ ok: true, assets: [], nextCursor: null, rateLimitRemaining: 100 });
    await sweepCustomer(CUSTOMER_ID, { minAgeMs: 0, dryRun: false });
    expect(listCloudinaryAssetsByPrefix).toHaveBeenCalledWith(`naia-wardrobe/${CUSTOMER_ID}/`, "private", expect.anything());
    expect(listCloudinaryAssetsByPrefix).toHaveBeenCalledWith(`naia-wardrobe/${CUSTOMER_ID}/`, "authenticated", expect.anything());
  });
});

describe("sweepCustomer — age threshold", () => {
  it("preserves a recently-uploaded, unreferenced asset regardless of reference state (minAgeMs > 0)", async () => {
    onePage([{ publicId: "naia-wardrobe/cust-sweep-test/fresh", resourceType: "image", type: "private", format: "jpg", createdAt: RECENT }]);

    const outcome = await sweepCustomer(CUSTOMER_ID, { minAgeMs: 24 * 60 * 60 * 1000, dryRun: false });

    expect(deleteCloudinaryAsset).not.toHaveBeenCalled();
    expect(outcome.skippedRecent).toBe(1);
    expect(outcome.deleted).toBe(0);
  });

  it("deletes a genuinely old, unreferenced orphan once past the age threshold", async () => {
    onePage([{ publicId: "naia-wardrobe/cust-sweep-test/orphan", resourceType: "image", type: "private", format: "jpg", createdAt: OLD }]);

    const outcome = await sweepCustomer(CUSTOMER_ID, { minAgeMs: 24 * 60 * 60 * 1000, dryRun: false });

    expect(deleteCloudinaryAsset).toHaveBeenCalledWith("naia-wardrobe/cust-sweep-test/orphan", "private");
    expect(outcome.deleted).toBe(1);
    expect(mockPrisma.pendingCloudinaryDeletion.upsert).toHaveBeenCalled();
    expect(mockPrisma.pendingCloudinaryDeletion.updateMany).toHaveBeenCalledWith({
      where: { publicId: "naia-wardrobe/cust-sweep-test/orphan" },
      data: { resolvedAt: expect.any(Date) },
    });
  });

  it("account-erasure mode (minAgeMs: 0) deletes an orphan immediately, no grace period — sweepCustomerForErasure", async () => {
    onePage([{ publicId: "naia-wardrobe/cust-sweep-test/just-uploaded", resourceType: "image", type: "private", format: "jpg", createdAt: new Date(NOW - 5_000).toISOString() }]);

    const outcome = await sweepCustomerForErasure(CUSTOMER_ID);

    expect(deleteCloudinaryAsset).toHaveBeenCalledWith("naia-wardrobe/cust-sweep-test/just-uploaded", "private");
    expect(outcome.deleted).toBe(1);
  });
});

describe("sweepCustomer — Cloudinary failure and retry", () => {
  it("records a failed destroy call via the claim row, never throws, and does not mark it resolved", async () => {
    onePage([{ publicId: "naia-wardrobe/cust-sweep-test/flaky", resourceType: "image", type: "private", format: "jpg", createdAt: OLD }]);
    (deleteCloudinaryAsset as any).mockResolvedValue({ ok: false, errorCode: "PROVIDER_ERROR" });

    const outcome = await sweepCustomer(CUSTOMER_ID, { minAgeMs: 0, dryRun: false });

    expect(outcome.failedAssets).toEqual(["naia-wardrobe/cust-sweep-test/flaky"]);
    expect(mockPrisma.pendingCloudinaryDeletion.updateMany).toHaveBeenCalledWith({
      where: { publicId: "naia-wardrobe/cust-sweep-test/flaky" },
      data: { attemptCount: { increment: 1 }, lastAttemptAt: expect.any(Date), lastError: "PROVIDER_ERROR" },
    });
    expect(mockPrisma.pendingCloudinaryDeletion.updateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: { resolvedAt: expect.any(Date) } }),
    );
  });

  it("a second sweep run after the provider recovers succeeds and resolves the claim — retry recovery", async () => {
    onePage([{ publicId: "naia-wardrobe/cust-sweep-test/flaky", resourceType: "image", type: "private", format: "jpg", createdAt: OLD }]);
    (deleteCloudinaryAsset as any).mockResolvedValueOnce({ ok: false, errorCode: "PROVIDER_ERROR" });
    await sweepCustomer(CUSTOMER_ID, { minAgeMs: 0, dryRun: false });

    vi.clearAllMocks();
    mockPrisma.$transaction.mockImplementation(async (fn: any) => fn(mockPrisma));
    emptyRefs();
    onePage([{ publicId: "naia-wardrobe/cust-sweep-test/flaky", resourceType: "image", type: "private", format: "jpg", createdAt: OLD }]);
    (deleteCloudinaryAsset as any).mockResolvedValue({ ok: true });

    const outcome = await sweepCustomer(CUSTOMER_ID, { minAgeMs: 0, dryRun: false });
    expect(outcome.deleted).toBe(1);
    expect(mockPrisma.pendingCloudinaryDeletion.updateMany).toHaveBeenCalledWith({
      where: { publicId: "naia-wardrobe/cust-sweep-test/flaky" },
      data: { resolvedAt: expect.any(Date) },
    });
  });
});

describe("sweepCustomer — pagination and rate limiting", () => {
  it("follows nextCursor across multiple pages for the same delivery type", async () => {
    (listCloudinaryAssetsByPrefix as any)
      .mockResolvedValueOnce({ ok: true, assets: [{ publicId: "naia-wardrobe/cust-sweep-test/p1", resourceType: "image", type: "private", format: "jpg", createdAt: OLD }], nextCursor: "cursor-2", rateLimitRemaining: 100 })
      .mockResolvedValueOnce({ ok: true, assets: [{ publicId: "naia-wardrobe/cust-sweep-test/p2", resourceType: "image", type: "private", format: "jpg", createdAt: OLD }], nextCursor: null, rateLimitRemaining: 99 })
      .mockResolvedValue({ ok: true, assets: [], nextCursor: null, rateLimitRemaining: 99 });

    const outcome = await sweepCustomer(CUSTOMER_ID, { minAgeMs: 0, dryRun: false });
    expect(outcome.checked).toBe(2);
    expect(outcome.deleted).toBe(2);
    expect(listCloudinaryAssetsByPrefix).toHaveBeenCalledWith(`naia-wardrobe/${CUSTOMER_ID}/`, "private", expect.objectContaining({ cursor: "cursor-2" }));
  });

  it("stops paginating and flags rateLimited once remaining quota drops below the safety floor", async () => {
    (listCloudinaryAssetsByPrefix as any).mockResolvedValue({
      ok: true,
      assets: [{ publicId: "naia-wardrobe/cust-sweep-test/p1", resourceType: "image", type: "private", format: "jpg", createdAt: OLD }],
      nextCursor: "cursor-2",
      rateLimitRemaining: 5,
    });

    const outcome = await sweepCustomer(CUSTOMER_ID, { minAgeMs: 0, dryRun: false });
    expect(outcome.rateLimited).toBe(true);
  });

  it("a partial failure on one asset does not block processing the rest of the page", async () => {
    onePage([
      { publicId: "naia-wardrobe/cust-sweep-test/ok1", resourceType: "image", type: "private", format: "jpg", createdAt: OLD },
      { publicId: "naia-wardrobe/cust-sweep-test/fails", resourceType: "image", type: "private", format: "jpg", createdAt: OLD },
      { publicId: "naia-wardrobe/cust-sweep-test/ok2", resourceType: "image", type: "private", format: "jpg", createdAt: OLD },
    ]);
    (deleteCloudinaryAsset as any).mockImplementation(async (publicId: string) =>
      publicId.includes("fails") ? { ok: false, errorCode: "PROVIDER_ERROR" } : { ok: true },
    );

    const outcome = await sweepCustomer(CUSTOMER_ID, { minAgeMs: 0, dryRun: false });
    expect(outcome.deleted).toBe(2);
    expect(outcome.failedAssets).toEqual(["naia-wardrobe/cust-sweep-test/fails"]);
  });
});

describe("sweepCustomer — dry run", () => {
  it("never calls deleteCloudinaryAsset and never writes a claim row", async () => {
    onePage([{ publicId: "naia-wardrobe/cust-sweep-test/orphan", resourceType: "image", type: "private", format: "jpg", createdAt: OLD }]);

    const outcome = await sweepCustomer(CUSTOMER_ID, { minAgeMs: 0, dryRun: true });

    expect(deleteCloudinaryAsset).not.toHaveBeenCalled();
    expect(mockPrisma.pendingCloudinaryDeletion.upsert).not.toHaveBeenCalled();
    expect(outcome.deleted).toBe(1); // "would delete"
  });
});

describe("sweepCustomer — customer isolation", () => {
  it("customer A's sweep only ever lists/claims under A's own prefix, never B's", async () => {
    (listCloudinaryAssetsByPrefix as any).mockResolvedValue({ ok: true, assets: [], nextCursor: null, rateLimitRemaining: 100 });
    await sweepCustomer("cust-A", { minAgeMs: 0, dryRun: false });
    for (const call of (listCloudinaryAssetsByPrefix as any).mock.calls) {
      expect(call[0]).toBe("naia-wardrobe/cust-A/");
      expect(call[0]).not.toContain("cust-B");
    }
  });

  it("the reference check for customer A only queries rows scoped to A's customerId", async () => {
    onePage([{ publicId: "naia-wardrobe/cust-A/x", resourceType: "image", type: "private", format: "jpg", createdAt: OLD }]);
    await sweepCustomer("cust-A", { minAgeMs: 0, dryRun: false });
    expect(mockPrisma.closetItem.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ customerId: "cust-A" }) }));
    expect(mockPrisma.naiaModel.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { customerId: "cust-A" } }));
  });
});

describe("runBoundedSweep — overlap guard and resumability", () => {
  it("refuses to start a second run while one is already RUNNING (not stale)", async () => {
    mockPrisma.cloudinarySweepRun.findFirst.mockResolvedValueOnce({ id: "run-active", startedAt: new Date() });

    const result = await runBoundedSweep({ mode: "ADMIN", dryRun: true });
    expect(result.stoppedReason).toBe("ALREADY_RUNNING");
    expect(mockPrisma.cloudinarySweepRun.create).not.toHaveBeenCalled();
  });

  it("allows a new run when the only RUNNING row is stale (crashed invocation)", async () => {
    mockPrisma.cloudinarySweepRun.findFirst.mockResolvedValueOnce(null); // no RECENT running row matches the stale-exclusion filter
    mockPrisma.cloudinarySweepRun.findFirst.mockResolvedValueOnce(null); // no prior run to resume from
    mockPrisma.cloudinarySweepRun.create.mockResolvedValue({ id: "run-new" });
    mockPrisma.customer.findMany.mockResolvedValue([]);

    const result = await runBoundedSweep({ mode: "ADMIN", dryRun: true });
    expect(result.startedExisting).toBe(false);
    expect(mockPrisma.cloudinarySweepRun.create).toHaveBeenCalled();
  });

  it("persists a cursor and stoppedReason=CUSTOMER_CAP when the per-run customer limit is hit, for the next run to resume from", async () => {
    mockPrisma.cloudinarySweepRun.findFirst.mockResolvedValueOnce(null);
    mockPrisma.cloudinarySweepRun.findFirst.mockResolvedValueOnce(null);
    mockPrisma.cloudinarySweepRun.create.mockResolvedValue({ id: "run-cap" });
    mockPrisma.customer.findMany.mockResolvedValue([{ id: "cust-1" }, { id: "cust-2" }]);
    (listCloudinaryAssetsByPrefix as any).mockResolvedValue({ ok: true, assets: [], nextCursor: null, rateLimitRemaining: 100 });

    const result = await runBoundedSweep({ mode: "ADMIN", dryRun: true, maxCustomers: 2 });
    expect(result.stoppedReason).toBe("CUSTOMER_CAP");
    expect(result.cursorCustomerId).toBe("cust-2");
    expect(mockPrisma.cloudinarySweepRun.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ cursorCustomerId: "cust-2", stoppedReason: "CUSTOMER_CAP" }),
    }));
  });

  it("resumes from the prior run's cursor instead of restarting from the first customer", async () => {
    mockPrisma.cloudinarySweepRun.findFirst.mockResolvedValueOnce(null); // not currently running
    mockPrisma.cloudinarySweepRun.findFirst.mockResolvedValueOnce({ stoppedReason: "CUSTOMER_CAP", cursorCustomerId: "cust-2" });
    mockPrisma.cloudinarySweepRun.create.mockResolvedValue({ id: "run-resumed" });
    mockPrisma.customer.findMany.mockResolvedValue([]);

    await runBoundedSweep({ mode: "ADMIN", dryRun: true });
    expect(mockPrisma.customer.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: { gt: "cust-2" } } }));
  });
});
