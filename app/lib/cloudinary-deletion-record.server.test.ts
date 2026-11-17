// app/lib/cloudinary-deletion-record.server.test.ts
//
// 2026-11-17 — H7 (Nov 12 privacy/breach audit): "Abandoned-upload orphan
// risk — confirmed to apply structurally across every per-feature deletion
// helper, not just one consolidated gap."
//
// Covers the shared recorder every remaining H7 site now funnels through.
// The properties pinned here are the ones the per-file fixes rely on, so a
// regression here would silently re-open all of them at once:
//
//   - a provider REJECTION (ok:false, which does NOT throw) is recorded;
//   - a THROWN error is recorded too;
//   - success records nothing;
//   - the row is keyed on publicId via upsert, so it is dedup-safe;
//   - the recorder never throws, even when its own DB write fails;
//   - the reserved "vto-sweep-obligation" context is never produced by
//     default, since that string routes to a different retry handler.
//
// Fully mocked: no real DB, no real Cloudinary, no credentials.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/db.server", () => ({
  default: {
    pendingCloudinaryDeletion: { upsert: vi.fn().mockResolvedValue({}) },
  },
}));

vi.mock("~/lib/cloudinary-admin.server", () => ({
  deleteCloudinaryAsset: vi.fn(),
}));

import prisma from "~/db.server";
import {
  recordFailedCloudinaryDeletion,
  deleteCloudinaryAssetOrRecord,
} from "./cloudinary-deletion-record.server";

const upsert = () => (prisma as unknown as {
  pendingCloudinaryDeletion: { upsert: ReturnType<typeof vi.fn> };
}).pendingCloudinaryDeletion.upsert;

const CUSTOMER = "cust-h7-synthetic";
const PUBLIC_ID = "naia-wardrobe/cust-h7-synthetic/abc123";

beforeEach(() => {
  vi.clearAllMocks();
  upsert().mockResolvedValue({});
});

describe("recordFailedCloudinaryDeletion", () => {
  it("writes an unresolved PendingCloudinaryDeletion row keyed on publicId", async () => {
    await recordFailedCloudinaryDeletion({
      customerId: CUSTOMER,
      publicId: PUBLIC_ID,
      deliveryType: "private",
      context: "closet-item-deletion-failed",
      lastError: "PROVIDER_ERROR",
    });

    expect(upsert()).toHaveBeenCalledTimes(1);
    const arg = upsert().mock.calls[0][0];
    // Keyed on publicId (which is @unique) — this is what makes every call
    // site dedup-safe without any caller-side bookkeeping.
    expect(arg.where).toEqual({ publicId: PUBLIC_ID });
    expect(arg.create.customerId).toBe(CUSTOMER);
    expect(arg.create.publicId).toBe(PUBLIC_ID);
    expect(arg.create.deliveryType).toBe("private");
    expect(arg.create.context).toBe("closet-item-deletion-failed");
    expect(arg.create.lastError).toBe("PROVIDER_ERROR");
    // One attempt has already happened and already failed by the time this
    // is reached, so the row must not claim zero.
    expect(arg.create.attemptCount).toBe(1);
    // Never pre-resolved: the retry sweep selects on resolvedAt: null.
    expect(arg.create.resolvedAt).toBeUndefined();
  });

  it("defaults resourceType to image but honours an explicit one", async () => {
    await recordFailedCloudinaryDeletion({
      customerId: CUSTOMER, publicId: PUBLIC_ID, deliveryType: "private",
      context: "c", lastError: "e",
    });
    expect(upsert().mock.calls[0][0].create.resourceType).toBe("image");

    upsert().mockClear();
    await recordFailedCloudinaryDeletion({
      customerId: CUSTOMER, publicId: PUBLIC_ID, deliveryType: "private",
      context: "c", lastError: "e", resourceType: "raw",
    });
    expect(upsert().mock.calls[0][0].create.resourceType).toBe("raw");
  });

  it("increments rather than resetting attemptCount on a repeat failure", async () => {
    await recordFailedCloudinaryDeletion({
      customerId: CUSTOMER, publicId: PUBLIC_ID, deliveryType: "private",
      context: "c", lastError: "again",
    });
    const arg = upsert().mock.calls[0][0];
    expect(arg.update.attemptCount).toEqual({ increment: 1 });
    expect(arg.update.lastError).toBe("again");
    // The update branch must never clear resolvedAt-adjacent bookkeeping or
    // rewrite context — resolveClaim/the sweep own those.
    expect(arg.update.context).toBeUndefined();
  });

  it("truncates a pathological error message rather than letting the write fail", async () => {
    await recordFailedCloudinaryDeletion({
      customerId: CUSTOMER, publicId: PUBLIC_ID, deliveryType: "private",
      context: "c", lastError: "x".repeat(5000),
    });
    expect(upsert().mock.calls[0][0].create.lastError).toHaveLength(2000);
  });

  it("never throws when its own DB write fails — a cleanup problem must not become a 500", async () => {
    upsert().mockRejectedValue(new Error("db down"));
    await expect(
      recordFailedCloudinaryDeletion({
        customerId: CUSTOMER, publicId: PUBLIC_ID, deliveryType: "private",
        context: "c", lastError: "e",
      }),
    ).resolves.toBeUndefined();
  });

  it("preserves an 'unknown' delivery type verbatim instead of guessing one", async () => {
    // The retry path re-resolves this via the Admin API. Recording a guessed
    // concrete type here would make it delete against the wrong type.
    await recordFailedCloudinaryDeletion({
      customerId: CUSTOMER, publicId: PUBLIC_ID, deliveryType: "unknown",
      context: "c", lastError: "DELIVERY_TYPE_UNKNOWN",
    });
    expect(upsert().mock.calls[0][0].create.deliveryType).toBe("unknown");
  });
});

describe("deleteCloudinaryAssetOrRecord", () => {
  const okDelete = vi.fn().mockResolvedValue({ ok: true });

  it("records the provider-REJECTION path — the case a bare try/catch misses", async () => {
    // deleteCloudinaryAsset does not throw on a provider rejection; it
    // returns { ok:false, errorCode }. This was the dominant H7 failure mode.
    const rejecting = vi.fn().mockResolvedValue({ ok: false, errorCode: "PROVIDER_ERROR" });
    const record = vi.fn();

    const result = await deleteCloudinaryAssetOrRecord(
      { customerId: CUSTOMER, publicId: PUBLIC_ID, deliveryType: "private", context: "ctx" },
      rejecting,
      record,
    );

    expect(result.ok).toBe(false);
    expect(record).toHaveBeenCalledTimes(1);
    expect(record.mock.calls[0][0]).toMatchObject({
      customerId: CUSTOMER,
      publicId: PUBLIC_ID,
      deliveryType: "private",
      context: "ctx",
      lastError: "PROVIDER_ERROR",
    });
  });

  it("records the THROWN path and still does not propagate the throw", async () => {
    const throwing = vi.fn().mockRejectedValue(new Error("socket hang up"));
    const record = vi.fn();

    const result = await deleteCloudinaryAssetOrRecord(
      { customerId: CUSTOMER, publicId: PUBLIC_ID, deliveryType: "private", context: "ctx" },
      throwing,
      record,
    );

    expect(result).toEqual({ ok: false, errorCode: "THREW" });
    expect(record.mock.calls[0][0].lastError).toBe("socket hang up");
  });

  it("records nothing on success and returns the delete result unchanged", async () => {
    const record = vi.fn();
    const result = await deleteCloudinaryAssetOrRecord(
      { customerId: CUSTOMER, publicId: PUBLIC_ID, deliveryType: "private", context: "ctx" },
      okDelete,
      record,
    );
    expect(result).toEqual({ ok: true });
    expect(record).not.toHaveBeenCalled();
  });

  it("passes the asset's delivery type through to the real delete call", async () => {
    const spy = vi.fn().mockResolvedValue({ ok: true });
    await deleteCloudinaryAssetOrRecord(
      { customerId: CUSTOMER, publicId: PUBLIC_ID, deliveryType: "authenticated", context: "ctx" },
      spy,
      vi.fn(),
    );
    expect(spy).toHaveBeenCalledWith(PUBLIC_ID, "authenticated");
  });

  it("never emits the reserved vto-sweep-obligation context by default", async () => {
    // That string makes retryPendingCloudinaryDeletion re-run a per-customer
    // VTO enumeration instead of deleting this publicId.
    const record = vi.fn();
    await deleteCloudinaryAssetOrRecord(
      { customerId: CUSTOMER, publicId: PUBLIC_ID, deliveryType: "private", context: "closet-upload-rejected" },
      vi.fn().mockResolvedValue({ ok: false, errorCode: "X" }),
      record,
    );
    expect(record.mock.calls[0][0].context).not.toBe("vto-sweep-obligation");
  });

  it("an explicit lastError overrides the errorCode-derived default", async () => {
    const record = vi.fn();
    await deleteCloudinaryAssetOrRecord(
      {
        customerId: CUSTOMER, publicId: PUBLIC_ID, deliveryType: "private",
        context: "ctx", lastError: "deletion failed during account erasure",
      },
      vi.fn().mockResolvedValue({ ok: false, errorCode: "PROVIDER_ERROR" }),
      record,
    );
    expect(record.mock.calls[0][0].lastError).toBe("deletion failed during account erasure");
  });

  it("falls back to a concrete error string when the provider returns no errorCode", async () => {
    const record = vi.fn();
    await deleteCloudinaryAssetOrRecord(
      { customerId: CUSTOMER, publicId: PUBLIC_ID, deliveryType: "private", context: "ctx" },
      vi.fn().mockResolvedValue({ ok: false }),
      record,
    );
    // Never undefined — lastError is what an operator triages from.
    expect(record.mock.calls[0][0].lastError).toBe("Cloudinary deletion failed");
  });
});
