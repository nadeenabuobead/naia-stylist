// app/lib/clerk-cleanup.test.ts
//
// Durable record + retry for a Clerk user deletion that failed after this
// account's own nAia data was already erased — see clerk-cleanup.server.ts's
// own header comment. Run: npx vitest run app/lib/clerk-cleanup.test.ts

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../db.server", () => ({
  default: {
    pendingClerkCleanup: {
      upsert: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

import prisma from "../db.server";
import { recordPendingClerkCleanup, listPendingClerkCleanups, retryPendingClerkCleanup, sweepPendingClerkCleanups, CLERK_CLEANUP_SWEEP_BATCH_SIZE } from "./clerk-cleanup.server";

const mockUpsert = () => (prisma as any).pendingClerkCleanup.upsert as ReturnType<typeof vi.fn>;
const mockFindMany = () => (prisma as any).pendingClerkCleanup.findMany as ReturnType<typeof vi.fn>;
const mockFindUnique = () => (prisma as any).pendingClerkCleanup.findUnique as ReturnType<typeof vi.fn>;
const mockUpdate = () => (prisma as any).pendingClerkCleanup.update as ReturnType<typeof vi.fn>;

beforeEach(() => vi.clearAllMocks());

describe("recordPendingClerkCleanup", () => {
  it("upserts keyed on clerkUserId, with the error message (never the raw error object) as lastError", async () => {
    await recordPendingClerkCleanup("clerk_1", "cust-1", new Error("network timeout"));

    expect(mockUpsert()).toHaveBeenCalledWith({
      where: { clerkUserId: "clerk_1" },
      create: { clerkUserId: "clerk_1", customerId: "cust-1", lastError: "network timeout" },
      update: { lastError: "network timeout", attemptCount: { increment: 1 }, lastAttemptAt: expect.any(Date) },
    });
  });

  it("handles a non-Error thrown value without crashing", async () => {
    await recordPendingClerkCleanup("clerk_1", "cust-1", { code: "unexpected" });
    const call = mockUpsert().mock.calls[0][0];
    expect(call.create.lastError).toContain("unexpected");
  });
});

describe("listPendingClerkCleanups", () => {
  it("lists only unresolved rows, oldest first", async () => {
    mockFindMany().mockResolvedValue([]);
    await listPendingClerkCleanups();
    expect(mockFindMany()).toHaveBeenCalledWith({
      where: { resolvedAt: null },
      orderBy: { createdAt: "asc" },
      take: 50,
    });
  });
});

describe("retryPendingClerkCleanup", () => {
  it("not-found when no row exists for this id", async () => {
    mockFindUnique().mockResolvedValue(null);
    const result = await retryPendingClerkCleanup("missing-id");
    expect(result).toEqual({ status: "not-found" });
  });

  it("already-resolved when the row was already resolved (e.g. by a previous retry) — never re-runs", async () => {
    mockFindUnique().mockResolvedValue({ id: "row-1", clerkUserId: "clerk_1", resolvedAt: new Date() });
    const client = { users: { deleteUser: vi.fn() } };
    const result = await retryPendingClerkCleanup("row-1", { _clerkClient: client as any });
    expect(result).toEqual({ status: "already-resolved" });
    expect(client.users.deleteUser).not.toHaveBeenCalled();
  });

  it("a successful retry deletes the Clerk user and marks the row resolved", async () => {
    mockFindUnique().mockResolvedValue({ id: "row-1", clerkUserId: "clerk_1", resolvedAt: null });
    const client = { users: { deleteUser: vi.fn().mockResolvedValue(undefined) } };

    const result = await retryPendingClerkCleanup("row-1", { _clerkClient: client as any });

    expect(client.users.deleteUser).toHaveBeenCalledWith("clerk_1");
    expect(mockUpdate()).toHaveBeenCalledWith({ where: { id: "row-1" }, data: { resolvedAt: expect.any(Date) } });
    expect(result).toEqual({ status: "resolved" });
  });

  it("a retry that fails again updates lastError/attemptCount and reports failed-again, never silently succeeds", async () => {
    mockFindUnique().mockResolvedValue({ id: "row-1", clerkUserId: "clerk_1", resolvedAt: null });
    const client = { users: { deleteUser: vi.fn().mockRejectedValue(new Error("still misconfigured")) } };

    const result = await retryPendingClerkCleanup("row-1", { _clerkClient: client as any });

    expect(mockUpdate()).toHaveBeenCalledWith({
      where: { id: "row-1" },
      data: { lastError: "still misconfigured", attemptCount: { increment: 1 }, lastAttemptAt: expect.any(Date) },
    });
    expect(result).toEqual({ status: "failed-again", error: "still misconfigured" });
  });
});

describe("sweepPendingClerkCleanups (2026-11-17, launch-readiness audit)", () => {
  // Before this existed, the ONLY path that ever retried a pending row was
  // a human manually clicking it on /admin/maintenance — there was no
  // automated option at all. See api.clerk-cleanup-sweep.ts for the actual
  // external trigger this function is meant to be called from.

  it("a clean sweep with nothing pending checks zero rows, calls Clerk zero times", async () => {
    mockFindMany().mockResolvedValue([]);
    const client = { users: { deleteUser: vi.fn() } };

    const result = await sweepPendingClerkCleanups({ _clerkClient: client as any });

    expect(mockFindMany()).toHaveBeenCalledWith({
      where: { resolvedAt: null },
      orderBy: { createdAt: "asc" },
      take: CLERK_CLEANUP_SWEEP_BATCH_SIZE + 1,
    });
    expect(client.users.deleteUser).not.toHaveBeenCalled();
    expect(result).toEqual({ checked: 0, resolved: 0, failed: 0, more: false });
  });

  it("resolves every row it can, counts a per-row failure without aborting the rest of the batch", async () => {
    mockFindMany().mockResolvedValue([
      { id: "row-1", clerkUserId: "clerk_1", resolvedAt: null },
      { id: "row-2", clerkUserId: "clerk_2", resolvedAt: null },
      { id: "row-3", clerkUserId: "clerk_3", resolvedAt: null },
    ]);
    // retryPendingClerkCleanup looks the row up again by id internally —
    // mock findUnique to return each row in turn, matching what a real DB
    // would (the sweep's own findMany result isn't re-used directly).
    const rowsById: Record<string, { id: string; clerkUserId: string; resolvedAt: null }> = {
      "row-1": { id: "row-1", clerkUserId: "clerk_1", resolvedAt: null },
      "row-2": { id: "row-2", clerkUserId: "clerk_2", resolvedAt: null },
      "row-3": { id: "row-3", clerkUserId: "clerk_3", resolvedAt: null },
    };
    mockFindUnique().mockImplementation(async ({ where: { id } }: any) => rowsById[id] ?? null);
    const deleteUser = vi.fn()
      .mockResolvedValueOnce(undefined)      // row-1 succeeds
      .mockRejectedValueOnce(new Error("x")) // row-2 fails
      .mockResolvedValueOnce(undefined);     // row-3 succeeds
    const client = { users: { deleteUser } };

    const result = await sweepPendingClerkCleanups({ _clerkClient: client as any });

    expect(deleteUser).toHaveBeenCalledTimes(3);
    expect(result).toEqual({ checked: 3, resolved: 2, failed: 1, more: false });
  });

  it("is bounded per call and reports more:true when a backlog exceeds one batch", async () => {
    const oversized = Array.from({ length: CLERK_CLEANUP_SWEEP_BATCH_SIZE + 1 }, (_, i) => ({
      id: `row-${i}`,
      clerkUserId: `clerk_${i}`,
      resolvedAt: null,
    }));
    mockFindMany().mockResolvedValue(oversized);
    mockFindUnique().mockImplementation(async ({ where: { id } }: any) =>
      oversized.find((r) => r.id === id) ?? null,
    );
    const client = { users: { deleteUser: vi.fn().mockResolvedValue(undefined) } };

    const result = await sweepPendingClerkCleanups({ _clerkClient: client as any });

    // Only the batch-sized slice is actually processed, even though the
    // mock returned one more than that.
    expect(client.users.deleteUser).toHaveBeenCalledTimes(CLERK_CLEANUP_SWEEP_BATCH_SIZE);
    expect(result).toEqual({
      checked: CLERK_CLEANUP_SWEEP_BATCH_SIZE,
      resolved: CLERK_CLEANUP_SWEEP_BATCH_SIZE,
      failed: 0,
      more: true,
    });
  });
});
