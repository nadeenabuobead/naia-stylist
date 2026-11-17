// app/lib/closet-item-deletion.test.ts
//
// 2026-11-17 — H7 (Nov 12 privacy/breach audit): "Abandoned-upload orphan
// risk — confirmed to apply structurally across every per-feature deletion
// helper, not just one consolidated gap."
//
// deleteClosetItemWithImage had no unit test of its own before this (it was
// only reached indirectly, via source-invariant assertions in
// taste-evidence-deletion.test.ts). This file covers its Cloudinary-failure
// behaviour directly, which is the H7 site.
//
// Why a dropped failure mattered here specifically: the ClosetItem row is
// deleted immediately after the Cloudinary call, so a failed delete leaves
// the asset UNREFERENCED with nothing recording that it still needs
// deleting. The only thing that would ever have reclaimed it is the bounded
// orphan sweep, which enumerates the whole naia-wardrobe/{customerId}/
// folder — and that sweep has no scheduled trigger (runBoundedSweep is
// reachable only from a human clicking /admin/maintenance).
//
// The subtlety worth pinning: deleteCloudinaryAsset does NOT throw when the
// provider rejects the call — it returns { ok:false, errorCode }. A
// try/catch around the call would still have dropped the common case.
//
// Mirrors closet-photo-privacy.test.ts's conventions (vitest, mocked
// ~/db.server). No real DB, no real Cloudinary, no credentials.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/db.server", () => ({
  default: {
    closetItem: { findFirst: vi.fn(), delete: vi.fn().mockResolvedValue({}) },
    pendingCloudinaryDeletion: { upsert: vi.fn().mockResolvedValue({}) },
  },
}));

vi.mock("~/lib/cloudinary-admin.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/lib/cloudinary-admin.server")>();
  return { ...actual, deleteCloudinaryAsset: vi.fn() };
});

// NOTE: taste-reconcile.server is deliberately NOT mocked here. It is behind
// the taste-engine import boundary enforced by
// taste-evidence-consumer-boundary.test.ts, whose allowlist exists to keep
// incidental importers out — and this file has nothing to say about taste
// evidence. deleteClosetItemWithImage already calls writeSourceEvidence
// inside its own try/catch, so leaving it unmocked cannot fail these tests,
// and the evidence-cleanup wiring for this exact call site is already covered
// by taste-evidence-deletion.test.ts.

import prisma from "~/db.server";
import { deleteCloudinaryAsset } from "~/lib/cloudinary-admin.server";
import { deleteClosetItemWithImage } from "./closet-item-deletion.server";

const pendingUpsert = () => (prisma as any).pendingCloudinaryDeletion.upsert;
const PUBLIC_ID = "naia-wardrobe/cust-A/item-1";

beforeEach(() => {
  vi.clearAllMocks();
  (deleteCloudinaryAsset as any).mockResolvedValue({ ok: true });
  pendingUpsert().mockResolvedValue({});
  (prisma.closetItem.delete as any).mockResolvedValue({});
});

describe("deleteClosetItemWithImage — ownership and ordering (pre-existing contract)", () => {
  it("returns NOT_FOUND for another customer's item and deletes nothing", async () => {
    (prisma.closetItem.findFirst as any).mockResolvedValue(null);

    const result = await deleteClosetItemWithImage("item-1", "cust-A");

    expect(result).toEqual({ deleted: false, errorCode: "NOT_FOUND" });
    expect(deleteCloudinaryAsset).not.toHaveBeenCalled();
    expect(prisma.closetItem.delete).not.toHaveBeenCalled();
    expect(pendingUpsert()).not.toHaveBeenCalled();
  });

  it("scopes the lookup to id AND customerId together — ownership is enforced at the query", async () => {
    (prisma.closetItem.findFirst as any).mockResolvedValue({ id: "item-1", imagePublicId: PUBLIC_ID });

    await deleteClosetItemWithImage("item-1", "cust-A");

    expect(prisma.closetItem.findFirst).toHaveBeenCalledWith({
      where: { id: "item-1", customerId: "cust-A" },
      select: { id: true, imagePublicId: true },
    });
  });

  it("attempts the Cloudinary deletion BEFORE removing the DB record", async () => {
    (prisma.closetItem.findFirst as any).mockResolvedValue({ id: "item-1", imagePublicId: PUBLIC_ID });
    const order: string[] = [];
    (deleteCloudinaryAsset as any).mockImplementation(async () => { order.push("cloudinary"); return { ok: true }; });
    (prisma.closetItem.delete as any).mockImplementation(async () => { order.push("db"); return {}; });

    await deleteClosetItemWithImage("item-1", "cust-A");

    expect(order).toEqual(["cloudinary", "db"]);
  });

  it("skips Cloudinary entirely for an item with no imagePublicId", async () => {
    (prisma.closetItem.findFirst as any).mockResolvedValue({ id: "item-1", imagePublicId: null });

    const result = await deleteClosetItemWithImage("item-1", "cust-A");

    expect(result).toEqual({ deleted: true });
    expect(deleteCloudinaryAsset).not.toHaveBeenCalled();
    expect(pendingUpsert()).not.toHaveBeenCalled();
  });
});

describe("H7 — a failed Cloudinary deletion is recorded for the retry sweep", () => {
  it("records an unresolved row when the provider REJECTS (ok:false, no throw)", async () => {
    (prisma.closetItem.findFirst as any).mockResolvedValue({ id: "item-1", imagePublicId: PUBLIC_ID });
    (deleteCloudinaryAsset as any).mockResolvedValue({ ok: false, errorCode: "PROVIDER_ERROR" });

    await deleteClosetItemWithImage("item-1", "cust-A");

    expect(pendingUpsert()).toHaveBeenCalledTimes(1);
    const arg = pendingUpsert().mock.calls[0][0];
    expect(arg.where).toEqual({ publicId: PUBLIC_ID });
    expect(arg.create.customerId).toBe("cust-A");
    expect(arg.create.publicId).toBe(PUBLIC_ID);
    expect(arg.create.deliveryType).toBe("private");
    expect(arg.create.lastError).toBe("PROVIDER_ERROR");
    // Unresolved — the retry sweep selects on resolvedAt: null.
    expect(arg.create.resolvedAt).toBeUndefined();
  });

  it("records a THROWN deletion error too, without propagating it", async () => {
    (prisma.closetItem.findFirst as any).mockResolvedValue({ id: "item-1", imagePublicId: PUBLIC_ID });
    (deleteCloudinaryAsset as any).mockRejectedValue(new Error("socket hang up"));

    await expect(deleteClosetItemWithImage("item-1", "cust-A")).resolves.toEqual({ deleted: true });
    expect(pendingUpsert()).toHaveBeenCalledTimes(1);
    expect(pendingUpsert().mock.calls[0][0].create.lastError).toBe("socket hang up");
  });

  it("still removes the DB record after a failed deletion — the customer's closet is never left stuck", async () => {
    // This is the pre-existing, deliberate tradeoff the module documents; the
    // H7 fix must not regress it into a blocked delete.
    (prisma.closetItem.findFirst as any).mockResolvedValue({ id: "item-1", imagePublicId: PUBLIC_ID });
    (deleteCloudinaryAsset as any).mockResolvedValue({ ok: false, errorCode: "PROVIDER_ERROR" });

    const result = await deleteClosetItemWithImage("item-1", "cust-A");

    expect(result).toEqual({ deleted: true });
    expect(prisma.closetItem.delete).toHaveBeenCalledWith({ where: { id: "item-1" } });
  });

  it("records nothing when the deletion succeeds", async () => {
    (prisma.closetItem.findFirst as any).mockResolvedValue({ id: "item-1", imagePublicId: PUBLIC_ID });

    await deleteClosetItemWithImage("item-1", "cust-A");

    expect(pendingUpsert()).not.toHaveBeenCalled();
  });

  it("does not throw when the recorder's own DB write fails", async () => {
    (prisma.closetItem.findFirst as any).mockResolvedValue({ id: "item-1", imagePublicId: PUBLIC_ID });
    (deleteCloudinaryAsset as any).mockResolvedValue({ ok: false, errorCode: "PROVIDER_ERROR" });
    pendingUpsert().mockRejectedValue(new Error("db down"));

    await expect(deleteClosetItemWithImage("item-1", "cust-A")).resolves.toEqual({ deleted: true });
  });

  it("records a row that the retry sweep can act on — publicId-keyed, concrete type, not the reserved VTO context", async () => {
    (prisma.closetItem.findFirst as any).mockResolvedValue({ id: "item-1", imagePublicId: PUBLIC_ID });
    (deleteCloudinaryAsset as any).mockResolvedValue({ ok: false, errorCode: "PROVIDER_ERROR" });

    await deleteClosetItemWithImage("item-1", "cust-A");

    const arg = pendingUpsert().mock.calls[0][0];
    expect(arg.where).toEqual({ publicId: PUBLIC_ID });
    expect(arg.update.attemptCount).toEqual({ increment: 1 });
    expect(arg.create.deliveryType).toBe("private");
    expect(arg.create.context).not.toBe("vto-sweep-obligation");
  });

  it("passes an injected _deleteAsset through, so callers can still substitute the deleter", async () => {
    (prisma.closetItem.findFirst as any).mockResolvedValue({ id: "item-1", imagePublicId: PUBLIC_ID });
    const injected = vi.fn().mockResolvedValue({ ok: false, errorCode: "INJECTED" });

    await deleteClosetItemWithImage("item-1", "cust-A", injected);

    expect(injected).toHaveBeenCalledWith(PUBLIC_ID, "private");
    expect(deleteCloudinaryAsset).not.toHaveBeenCalled();
    expect(pendingUpsert().mock.calls[0][0].create.lastError).toBe("INJECTED");
  });
});
