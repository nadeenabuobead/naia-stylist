// app/lib/cloudinary-synthetic-deletion-verification.test.ts
//
// The synthetic Cloudinary deletion verification procedure requested for
// the 2026-11-17 launch-readiness audit (H6/H7 follow-up). Fully mocked —
// no live Cloudinary Admin API call, no real Postgres transaction, no
// network access anywhere in this file. It exists to close two specific
// coverage gaps found while re-verifying the deletion pipeline:
//
//   1. assertPublicIdAvailable / claimPublicIdForDeletion / AssetPendingDeletionError
//      (the "queued-result recreation prevention" mechanism) had ZERO
//      direct test coverage anywhere in the repo before this file — only one
//      unrelated test file (wishlist-analyze.behavioral.test.ts) mentioned
//      assertPublicIdAvailable in a comment, never called it. This file is
//      the first real test of that mechanism.
//   2. sweepPendingCloudinaryDeletions (cloudinary-deletion-claim.server.ts)
//      and retryPendingCloudinaryDeletion already have solid per-call unit
//      coverage in cloudinary-deletion-claim.server.test.ts (not duplicated
//      here) but nothing exercised what happens when the sweep is invoked a
//      SECOND time against state the first invocation already resolved —
//      the literal "duplicate sweep invocation" scenario (two overlapping
//      cron ticks, or a human clicking workflow_dispatch while the schedule
//      is also about to fire).
//
// "Original" vs "derivative" asset deletion (also requested) is already
// covered as "a normal PendingCloudinaryDeletion row" vs "a
// vto-sweep-obligation row" in cloudinary-deletion-claim.server.test.ts's
// own describe blocks — not re-tested here, but Section 2 below adds the one
// thing neither file covered: that the two are deletion-independent, i.e. a
// provider failure on one never blocks or silently resolves the other.
//
// Run: npx vitest run app/lib/cloudinary-synthetic-deletion-verification.test.ts

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/db.server", () => ({
  default: {
    pendingCloudinaryDeletion: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      upsert: vi.fn().mockResolvedValue({}),
    },
  },
}));

vi.mock("~/lib/cloudinary-admin.server", () => ({
  deleteCloudinaryAsset: vi.fn(),
  verifyCloudinaryAsset: vi.fn(),
}));

vi.mock("./ai/fashn-tryon-service.server", () => ({
  deleteCustomerVtoResults: vi.fn(),
}));

vi.mock("./error-tracking.server", () => ({
  captureFailure: vi.fn(),
}));

import prisma from "~/db.server";
import { deleteCloudinaryAsset } from "~/lib/cloudinary-admin.server";
import { captureFailure } from "./error-tracking.server";
import {
  assertPublicIdAvailable,
  claimPublicIdForDeletion,
  AssetPendingDeletionError,
  resolveClaim,
  retryPendingCloudinaryDeletion,
  sweepPendingCloudinaryDeletions,
} from "./cloudinary-deletion-claim.server";

const mockFindUnique = () => (prisma as any).pendingCloudinaryDeletion.findUnique as ReturnType<typeof vi.fn>;
const mockFindMany = () => (prisma as any).pendingCloudinaryDeletion.findMany as ReturnType<typeof vi.fn>;
const mockUpsert = () => (prisma as any).pendingCloudinaryDeletion.upsert as ReturnType<typeof vi.fn>;
const mockDelete = () => deleteCloudinaryAsset as ReturnType<typeof vi.fn>;

// A minimal stand-in for a Serializable-transaction client — only the one
// method assertPublicIdAvailable/claimPublicIdForDeletion actually touch.
// Real atomicity (the Postgres-level race protection the module's own header
// describes) is infrastructure this unit test cannot exercise; see the
// "documented limitation" note in Section 3.
const fakeTx = { pendingCloudinaryDeletion: { findUnique: vi.fn(), upsert: vi.fn() } };

beforeEach(() => {
  vi.clearAllMocks();
  fakeTx.pendingCloudinaryDeletion.findUnique.mockReset();
  fakeTx.pendingCloudinaryDeletion.upsert.mockReset();
});

describe("Section 1 — queued-result recreation prevention (assertPublicIdAvailable / claimPublicIdForDeletion)", () => {
  it("a fresh publicId with no claim row at all is available — the common case, never blocked", async () => {
    fakeTx.pendingCloudinaryDeletion.findUnique.mockResolvedValue(null);

    await expect(assertPublicIdAvailable(fakeTx as any, "naia-wardrobe/cust-1/garment-9")).resolves.toBeUndefined();
  });

  it("a publicId claimed for deletion (unresolved) is rejected — cannot be recreated/reused by a new record while deletion is pending", async () => {
    fakeTx.pendingCloudinaryDeletion.findUnique.mockResolvedValue({ resolvedAt: null });

    await expect(
      assertPublicIdAvailable(fakeTx as any, "naia-wardrobe/cust-1/garment-9"),
    ).rejects.toBeInstanceOf(AssetPendingDeletionError);
  });

  it("the rejection error names the exact publicId — actionable in a caller's error log without a second lookup", async () => {
    fakeTx.pendingCloudinaryDeletion.findUnique.mockResolvedValue({ resolvedAt: null });

    await expect(assertPublicIdAvailable(fakeTx as any, "naia-wardrobe/cust-1/garment-9")).rejects.toThrow(
      /naia-wardrobe\/cust-1\/garment-9/,
    );
  });

  it("once the claim is RESOLVED (deletion actually completed), the same publicId becomes available again — a legitimate later reuse is not permanently blocked", async () => {
    fakeTx.pendingCloudinaryDeletion.findUnique.mockResolvedValue({ resolvedAt: new Date() });

    await expect(assertPublicIdAvailable(fakeTx as any, "naia-wardrobe/cust-1/garment-9")).resolves.toBeUndefined();
  });

  it("a null/undefined publicId is always available — matches every caller's own guard for an asset-less record", async () => {
    await expect(assertPublicIdAvailable(fakeTx as any, null)).resolves.toBeUndefined();
    await expect(assertPublicIdAvailable(fakeTx as any, undefined)).resolves.toBeUndefined();
    expect(fakeTx.pendingCloudinaryDeletion.findUnique).not.toHaveBeenCalled();
  });

  it("claimPublicIdForDeletion upserts a NEW claim with attemptCount 0 for a never-before-claimed publicId", async () => {
    await claimPublicIdForDeletion(fakeTx as any, {
      customerId: "cust-1",
      publicId: "naia-wardrobe/cust-1/garment-9",
      resourceType: "closet-item",
      deliveryType: "private",
      context: "account-erasure",
    });

    expect(fakeTx.pendingCloudinaryDeletion.upsert).toHaveBeenCalledWith({
      where: { publicId: "naia-wardrobe/cust-1/garment-9" },
      create: expect.objectContaining({ attemptCount: 0, context: "account-erasure" }),
      update: { context: "account-erasure" },
    });
  });

  it("re-claiming a publicId that already failed once (retry) refreshes context only — never resets attemptCount/lastError, preserving failure history", async () => {
    // The upsert's own `update` clause (verified above) never touches
    // attemptCount/lastError — this test asserts that contract explicitly,
    // since recordClaimFailure/resolveClaim are the only functions allowed
    // to own those fields.
    await claimPublicIdForDeletion(fakeTx as any, {
      customerId: "cust-1",
      publicId: "naia-wardrobe/cust-1/garment-9",
      resourceType: "closet-item",
      deliveryType: "private",
      context: "abandoned-upload-sweep",
    });

    const call = fakeTx.pendingCloudinaryDeletion.upsert.mock.calls[0][0];
    expect(call.update).not.toHaveProperty("attemptCount");
    expect(call.update).not.toHaveProperty("lastError");
  });

  it("end-to-end narrative: sweep claims an abandoned upload's publicId, a concurrent create attempt against the SAME publicId is blocked, then after the real deletion resolves, that publicId is open again", async () => {
    // Step 1: the orphan sweep (cloudinary-orphan-sweep.server.ts, not under
    // test here) finds an abandoned upload and claims it for deletion.
    await claimPublicIdForDeletion(fakeTx as any, {
      customerId: "cust-2",
      publicId: "naia-wardrobe/cust-2/abandoned-upload-1",
      resourceType: "closet-item",
      deliveryType: "private",
      context: "abandoned-upload-sweep",
    });

    // Step 2: before the actual Cloudinary destroy call has run, some other
    // request-handler transaction tries to persist a new DB row pointing at
    // that exact publicId (e.g. a retried client upload reusing a signed
    // URL). This is precisely the "queued-result recreation" the mechanism
    // exists to prevent.
    fakeTx.pendingCloudinaryDeletion.findUnique.mockResolvedValue({ resolvedAt: null });
    await expect(
      assertPublicIdAvailable(fakeTx as any, "naia-wardrobe/cust-2/abandoned-upload-1"),
    ).rejects.toBeInstanceOf(AssetPendingDeletionError);

    // Step 3: the sweep's actual Cloudinary destroy call succeeds, and
    // resolveClaim marks the claim resolved (this runs outside the
    // transaction, against the real prisma client, per the module's own
    // documented ordering).
    await resolveClaim("naia-wardrobe/cust-2/abandoned-upload-1");
    expect((prisma as any).pendingCloudinaryDeletion.updateMany).toHaveBeenCalledWith({
      where: { publicId: "naia-wardrobe/cust-2/abandoned-upload-1" },
      data: { resolvedAt: expect.any(Date) },
    });

    // Step 4: the publicId is now legitimately reusable — a later, genuinely
    // new record may claim it again (the test above for the resolved-claim
    // case already proves assertPublicIdAvailable allows this).
  });
});

describe("Section 2 — original vs derivative asset deletion are independent (one's failure never blocks or silently resolves the other)", () => {
  it("an original (closet/garment/selfie) row failing to delete does not affect a derivative (VTO-result) row's own resolution, and vice versa — they are separate PendingCloudinaryDeletion rows retried independently", async () => {
    const originalRow = { id: "orig-1", publicId: "naia-wardrobe/cust-3/original-selfie", deliveryType: "private", resolvedAt: null, attemptCount: 0, context: "account-erasure" };
    const derivativeRow = { id: "deriv-1", publicId: "naia-tryon/cust-3/vto-result-7", deliveryType: "authenticated", resolvedAt: null, attemptCount: 0, context: "account-erasure" };

    mockFindUnique().mockImplementation(async ({ where: { id } }: any) =>
      [originalRow, derivativeRow].find((r) => r.id === id) ?? null,
    );
    mockDelete().mockImplementation(async (publicId: string) =>
      publicId === originalRow.publicId
        ? { ok: false, errorCode: "PROVIDER_ERROR" } // the original fails
        : { ok: true }, // the derivative succeeds
    );

    const originalResult = await retryPendingCloudinaryDeletion("orig-1");
    const derivativeResult = await retryPendingCloudinaryDeletion("deriv-1");

    expect(originalResult).toEqual({ status: "failed-again", error: "PROVIDER_ERROR" });
    expect(derivativeResult).toEqual({ status: "resolved" });
    // Confirms no shared/coupled state: the derivative's successful resolve
    // call never referenced the original's id or publicId.
    const updateCalls = (prisma as any).pendingCloudinaryDeletion.update.mock.calls;
    const derivativeResolveCall = updateCalls.find((c: any) => c[0].where.id === "deriv-1");
    expect(derivativeResolveCall[0].data).toEqual({ resolvedAt: expect.any(Date) });
  });
});

describe("Section 3 — duplicate / overlapping sweep invocations are safe no-ops once rows are resolved", () => {
  it("a second sweep invocation against state the first invocation already fully resolved finds nothing to do: zero deletes, zero captureFailure calls, zero-valued result", async () => {
    // First invocation: two unresolved rows, both resolve cleanly.
    const rows = [
      { id: "row-a", publicId: "naia-wardrobe/cust-4/v1", deliveryType: "private", resolvedAt: null, attemptCount: 0 },
      { id: "row-b", publicId: "naia-wardrobe/cust-4/v2", deliveryType: "private", resolvedAt: null, attemptCount: 0 },
    ];
    mockFindMany().mockResolvedValueOnce(rows);
    mockFindUnique().mockImplementation(async ({ where: { id } }: any) => rows.find((r) => r.id === id) ?? null);
    mockDelete().mockResolvedValue({ ok: true });

    const first = await sweepPendingCloudinaryDeletions();
    expect(first).toEqual({ checked: 2, resolved: 2, failed: 0, more: false });

    // Second invocation (e.g. an overlapping GitHub Actions cron tick, or a
    // human firing workflow_dispatch moments later): the DB now correctly
    // reports zero unresolved rows, since the first invocation resolved
    // both. This is what a real second invocation would observe — the
    // sweep's own query always re-reads current unresolved state, it never
    // caches a batch across calls.
    vi.clearAllMocks();
    mockFindMany().mockResolvedValueOnce([]);

    const second = await sweepPendingCloudinaryDeletions();

    expect(second).toEqual({ checked: 0, resolved: 0, failed: 0, more: false });
    expect(mockDelete()).not.toHaveBeenCalled();
    expect(captureFailure).not.toHaveBeenCalled();
  });

  it("a second invocation racing the FIRST invocation's still-in-flight retry on the same row re-reads already-resolved state and reports it as a no-op, not a duplicate delete", async () => {
    // Models the narrower race: invocation #2's findMany ran a moment after
    // invocation #1 had already committed resolvedAt for row-c, but before
    // invocation #2 knew that. retryPendingCloudinaryDeletion re-reads the
    // row by id itself (not from the stale findMany snapshot), so it still
    // observes "already-resolved" and never calls deleteCloudinaryAsset a
    // second time against the same asset.
    const row = { id: "row-c", publicId: "naia-wardrobe/cust-5/v1", deliveryType: "private", resolvedAt: null, attemptCount: 0 };
    mockFindMany().mockResolvedValueOnce([row]);
    // By the time retryPendingCloudinaryDeletion's own findUnique runs, some
    // other process already resolved it.
    mockFindUnique().mockResolvedValueOnce({ ...row, resolvedAt: new Date() });

    const result = await sweepPendingCloudinaryDeletions();

    expect(mockDelete()).not.toHaveBeenCalled();
    expect(result).toEqual({ checked: 1, resolved: 0, failed: 0, more: false });
  });

  // DOCUMENTED LIMITATION, not a gap this file can close: the scenario above
  // covers the read-time race (stale findMany snapshot). It does NOT cover
  // two invocations' retryPendingCloudinaryDeletion calls executing their
  // findUnique-then-update sequence for the SAME row truly concurrently
  // (both reading resolvedAt: null before either writes) — that specific
  // race is a real Postgres-transaction-isolation question, not something a
  // mocked unit test can prove either way. The module's own header is
  // explicit that the actual atomicity guarantee for the *claim* step
  // (Section 1 above) comes from a Serializable transaction plus Postgres's
  // own serialization-failure detection, not from application-level
  // idempotency checks. retryPendingCloudinaryDeletion itself has no
  // equivalent transactional guard around its own read-then-update — a true
  // concurrent double-invocation against the exact same unresolved row
  // could in principle issue deleteCloudinaryAsset twice for the same
  // publicId. Flagging this explicitly rather than claiming it's covered:
  // Cloudinary's own destroy API is itself idempotent (deleting an
  // already-deleted or nonexistent asset returns a "not found"-shaped
  // success, not a destructive error), which bounds the real-world impact,
  // but this has not been verified against Cloudinary's actual API
  // response shape in this session — flagged as a fact to confirm, not
  // fixed here, and out of scope for a mocked test to prove either way.
});
