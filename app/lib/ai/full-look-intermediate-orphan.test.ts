// app/lib/ai/full-look-intermediate-orphan.test.ts
//
// 2026-11-17 — H7 regression test (Nov 12 privacy/breach audit).
//
// H7: "Abandoned-upload orphan risk (Cloudinary assets orphaned on
// incomplete uploads/deletions) — confirmed to apply structurally across
// every per-feature deletion helper, not just one consolidated gap."
//
// The structural finding is accurate and most of it is out of scope for one
// commit. This file pins the fix for the one path where a dropped deletion
// failure was genuinely UNRECOVERABLE rather than merely delayed:
//
//   - Most per-feature paths leave the asset unreferenced under
//     `naia-wardrobe/`, which the bounded orphan sweep
//     (cloudinary-orphan-sweep.server.ts) eventually reclaims.
//   - Full-look intermediate step assets live under
//     `naia-tryon-fulllook-intermediate/`, a prefix that sweep never lists,
//     and cleanupIntermediateStepResults runs exactly once per chain with no
//     retry. A failure there produced a permanently orphaned derivative of a
//     customer's body image: no reference, no pending row, no sweep.
//
// Both failure modes were silent. The thrown case was swallowed by a bare
// `catch {}`; the far easier one to miss is that deleteCloudinaryAsset does
// NOT throw on a provider rejection — it returns { ok: false, errorCode },
// and that return value was discarded entirely.
//
// Tested through sweepAbandonedFullLookPauses, the exported seam that takes
// an injectable _deleteAsset and funnels into cleanupIntermediateStepResults.
// Fully mocked: no real DB, no real network, no real Cloudinary/FASHN
// credentials.
//
// Run: npx vitest run app/lib/ai/full-look-intermediate-orphan.test.ts

import { describe, it, expect, vi, beforeEach } from "vitest";

const { upsertMock } = vi.hoisted(() => ({ upsertMock: vi.fn() }));

vi.mock("../../db.server.js", () => ({
  default: { pendingCloudinaryDeletion: { upsert: upsertMock } },
}));

vi.mock("./my-naia-model.server.js", () => ({
  checkCustomerCooldown: vi.fn(),
  createOrFindTryOnJob: vi.fn(),
  advanceTryOnJob: vi.fn(),
}));

vi.mock("./fashn-try-on.server.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./fashn-try-on.server.js")>();
  return { ...actual, submitTryOnToProvider: vi.fn() };
});

vi.mock("./fashn-tryon-service.server.js", () => ({
  downloadModelPhotoAsDataUrl: vi.fn(),
  uploadTryOnResult: vi.fn(),
  buildTryOnResultUrl: vi.fn(),
}));

vi.mock("../cloudinary-admin.server.js", () => ({
  uploadCloudinaryPrivate: vi.fn(),
  buildPrivateDownloadUrl: vi.fn(
    (_cfg: unknown, publicId: string) => `https://cloudinary.mock/download?public_id=${publicId}`,
  ),
  getCloudinaryConfig: vi.fn(() => ({ cloudName: "mock", apiKey: "mock", apiSecret: "mock" })),
  deleteCloudinaryAsset: vi.fn(async () => ({ ok: true })),
}));

const { sweepAbandonedFullLookPauses, deriveIntermediateStepPublicId, REAL_PRODUCT_HANDLE_PREFIX } =
  await import("./full-look-tryon-real.server.js");

const CUSTOMER_ID = "cust-h7";
const PRIOR_JOB_ID = "trousers-h7";
const JOB_ID = "shirt-h7";

// Mirrors the shape the existing sweep tests use (full-look-tryon-real.
// server.test.ts's shirtJobWithTrousers): the continue window is measured
// from completedAt, and the sweep parses its own step index out of the
// productHandle, so the handle must really say "step2". 45 minutes stale =
// expired and never continued, which is the one state the sweep acts on.
function abandonedJob() {
  return {
    id: JOB_ID,
    customerId: CUSTOMER_ID,
    naiaModelId: "model-1",
    productHandle: `${REAL_PRODUCT_HANDLE_PREFIX}:step2:Blue Chambray Button-Up Shirt`,
    provider: "FASHN",
    predictionId: null,
    status: "COMPLETED",
    virtualTryOnConsentAt: new Date("2026-01-01T00:00:00.000Z"),
    consentPolicyVersion: "v1",
    saveTryOnResultConsentAt: null,
    idempotencyKey: `fulllook-real-step:${PRIOR_JOB_ID}:1`,
    requestFingerprint: null,
    errorCode: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    completedAt: new Date(Date.now() - 45 * 60 * 1000),
    lastActivityAt: new Date(),
  } as never;
}

const findAbandoned = () => Promise.resolve([abandonedJob()]);
const findNoSuccessor = () => Promise.resolve(null);

beforeEach(() => {
  vi.clearAllMocks();
  upsertMock.mockResolvedValue({ id: "pending-1" });
});

describe("H7 — a failed full-look intermediate cleanup is recorded, not dropped", () => {
  it("records a PendingCloudinaryDeletion row when the provider REJECTS the delete (ok: false, no throw)", async () => {
    // The easy-to-miss mode: deleteCloudinaryAsset resolves normally with
    // ok: false. The old code discarded this entirely.
    const deleteAsset = vi.fn(async () => ({ ok: false, errorCode: "RATE_LIMITED" }));

    const result = await sweepAbandonedFullLookPauses(
      findAbandoned,
      findNoSuccessor,
      deleteAsset as never,
    );

    expect(result.cleanedChains).toBe(1);
    expect(deleteAsset).toHaveBeenCalled();
    expect(upsertMock).toHaveBeenCalled();

    const args = upsertMock.mock.calls[0][0];
    expect(args.create).toMatchObject({
      customerId: CUSTOMER_ID,
      resourceType: "image",
      deliveryType: "private",
      context: "full-look-intermediate-cleanup-failed",
      attemptCount: 1,
      lastError: "RATE_LIMITED",
    });
  });

  it("records a row when the delete THROWS", async () => {
    const deleteAsset = vi.fn(async () => {
      throw new Error("socket hang up");
    });

    await sweepAbandonedFullLookPauses(findAbandoned, findNoSuccessor, deleteAsset as never);

    expect(upsertMock).toHaveBeenCalled();
    expect(upsertMock.mock.calls[0][0].create).toMatchObject({
      context: "full-look-intermediate-cleanup-failed",
      lastError: "socket hang up",
    });
  });

  it("the recorded publicId is the intermediate asset's real id, under the unswept prefix", async () => {
    const deleteAsset = vi.fn(async () => ({ ok: false, errorCode: "NOT_ALLOWED" }));

    await sweepAbandonedFullLookPauses(findAbandoned, findNoSuccessor, deleteAsset as never);

    const expected = deriveIntermediateStepPublicId(CUSTOMER_ID, JOB_ID);
    const recorded = upsertMock.mock.calls.map((c) => c[0].where.publicId);

    expect(recorded).toContain(expected);
    // The whole reason this path needed a durable row rather than relying on
    // the orphan sweep: this prefix is not one the sweep lists.
    expect(expected).toContain("naia-tryon-fulllook-intermediate");
  });

  it("keys the upsert on publicId so a repeat failure increments rather than duplicating", async () => {
    const deleteAsset = vi.fn(async () => ({ ok: false, errorCode: "RATE_LIMITED" }));

    await sweepAbandonedFullLookPauses(findAbandoned, findNoSuccessor, deleteAsset as never);

    // The sweep cleans [priorJobId, job.id] in that order, so the first
    // upsert is the prior (trousers) step, not the abandoned (shirt) one.
    const args = upsertMock.mock.calls[0][0];
    expect(args.where).toEqual({
      publicId: deriveIntermediateStepPublicId(CUSTOMER_ID, PRIOR_JOB_ID),
    });
    // publicId is @unique on PendingCloudinaryDeletion — dedup-safe.
    expect(args.update).toMatchObject({ attemptCount: { increment: 1 } });
  });

  it("records every failed asset in the chain, not just the first", async () => {
    // The sweep cleans both the prior step and the abandoned step.
    const deleteAsset = vi.fn(async () => ({ ok: false, errorCode: "RATE_LIMITED" }));

    await sweepAbandonedFullLookPauses(findAbandoned, findNoSuccessor, deleteAsset as never);

    expect(deleteAsset).toHaveBeenCalledTimes(2);
    expect(upsertMock).toHaveBeenCalledTimes(2);
    const recorded = upsertMock.mock.calls.map((c) => c[0].where.publicId);
    expect(new Set(recorded).size).toBe(2);
  });

  it("writes NO row when the delete succeeds", async () => {
    const deleteAsset = vi.fn(async () => ({ ok: true }));

    const result = await sweepAbandonedFullLookPauses(
      findAbandoned,
      findNoSuccessor,
      deleteAsset as never,
    );

    expect(result.cleanedChains).toBe(1);
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it("never throws out of the sweep, even if recording the failure itself fails", async () => {
    // A cleanup problem must not derail a chain that reached its terminal
    // state — including when the bookkeeping write is the thing that breaks.
    const deleteAsset = vi.fn(async () => ({ ok: false, errorCode: "RATE_LIMITED" }));
    upsertMock.mockRejectedValue(new Error("db unavailable"));

    await expect(
      sweepAbandonedFullLookPauses(findAbandoned, findNoSuccessor, deleteAsset as never),
    ).resolves.toMatchObject({ cleanedChains: 1 });
  });

  it("a delete that throws still does not throw out of the sweep", async () => {
    const deleteAsset = vi.fn(async () => {
      throw new Error("socket hang up");
    });

    await expect(
      sweepAbandonedFullLookPauses(findAbandoned, findNoSuccessor, deleteAsset as never),
    ).resolves.toMatchObject({ cleanedChains: 1 });
  });
});

describe("H7 — the recorded row is drainable by the existing retry sweep", () => {
  it("uses a concrete deliveryType, not \"unknown\", so no delivery-type probe is needed", async () => {
    // retryPendingCloudinaryDeletion (cloudinary-deletion-claim.server.ts)
    // dispatches on context only for the "vto-sweep-obligation" sentinel;
    // every other context falls through to the generic
    // deleteCloudinaryAsset(publicId, deliveryType) path. A row with
    // deliveryType "unknown" would force an extra Admin API probe and can
    // fail with DELIVERY_TYPE_UNKNOWN — intermediate assets are always
    // uploaded private, so state that outright.
    const deleteAsset = vi.fn(async () => ({ ok: false, errorCode: "RATE_LIMITED" }));

    await sweepAbandonedFullLookPauses(findAbandoned, findNoSuccessor, deleteAsset as never);

    expect(upsertMock.mock.calls[0][0].create.deliveryType).toBe("private");
  });

  it("does not use the reserved \"vto-sweep-obligation\" context", async () => {
    // That context routes to retryVtoSweepObligation, which enumerates a
    // customer's VTO results from a sentinel publicId — entirely wrong
    // handling for a single concrete intermediate asset.
    const deleteAsset = vi.fn(async () => ({ ok: false, errorCode: "RATE_LIMITED" }));

    await sweepAbandonedFullLookPauses(findAbandoned, findNoSuccessor, deleteAsset as never);

    expect(upsertMock.mock.calls[0][0].create.context).not.toBe("vto-sweep-obligation");
  });
});
