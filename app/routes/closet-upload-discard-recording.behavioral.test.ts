// app/routes/closet-upload-discard-recording.behavioral.test.ts
//
// 2026-11-17 — H7 (Nov 12 privacy/breach audit): "Abandoned-upload orphan
// risk (Cloudinary assets orphaned on incomplete uploads/deletions) —
// confirmed to apply structurally across every per-feature deletion helper,
// not just one consolidated gap."
//
// closet._index.tsx's action was the single largest cluster of that finding:
// 35 places discarding a rejected or superseded Cloudinary upload, every one
// of them throwing away the deletion result. Because deleteCloudinaryAsset
// does NOT throw on a provider rejection (it returns { ok:false, errorCode }),
// a failed delete left no trace at all — and in every one of these cases no
// DB row references the asset, so nothing pointed at the orphaned private
// photo and nothing recorded that it still needed deleting.
//
// BEHAVIORAL coverage (not source-text): drives the real action and asserts a
// PendingCloudinaryDeletion row is actually written, so the retry sweep
// (sweepPendingCloudinaryDeletions) can drain it. The companion source-text
// invariants live in closet-image-security.test.ts, closet-photo-consent.test.ts
// and customer-routes.test.ts.
//
// Mock setup is modelled on closet-replace.behavioral.test.ts:
// validatePublicIdOwnership is the REAL, pure implementation; everything
// touching Cloudinary, Prisma, or an AI provider is mocked. No real network
// call, no real database.
//
// Run: npx vitest run app/routes/closet-upload-discard-recording.behavioral.test.ts

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/db.server", () => ({
  default: {
    customer: { findUnique: vi.fn() },
    closetItem: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    outfitItem: { count: vi.fn().mockResolvedValue(0) },
    savedLookItem: { count: vi.fn().mockResolvedValue(0) },
    journeyEvent: { create: vi.fn().mockResolvedValue({}) },
    // The H7 recording target.
    pendingCloudinaryDeletion: { upsert: vi.fn().mockResolvedValue({}) },
  },
}));

vi.mock("~/lib/naia-session.server", () => ({
  getCurrentNaiaCustomer: vi.fn(),
  requireCurrentNaiaCustomer: vi.fn(),
}));

vi.mock("~/lib/cloudinary-admin.server", async () => {
  const actual = await vi.importActual<typeof import("~/lib/cloudinary-admin.server")>(
    "~/lib/cloudinary-admin.server",
  );
  return {
    // Real implementation — pure, no I/O. Ownership must genuinely pass for
    // the action to reach the consent check that performs the discard.
    validatePublicIdOwnership: actual.validatePublicIdOwnership,
    getCloudinaryConfig: vi.fn().mockReturnValue({ cloudName: "test", apiKey: "test", apiSecret: "test" }),
    verifyCloudinaryAsset: vi.fn(),
    buildPrivateDownloadUrl: vi.fn().mockReturnValue("https://example.invalid/download"),
    deleteCloudinaryAsset: vi.fn(),
  };
});

vi.mock("~/lib/plan/entitlement.server", () => ({
  checkEntitlement: vi.fn().mockResolvedValue({ allowed: true }),
  reserveClosetSlot: vi.fn(),
}));

vi.mock("~/lib/closet-item-deletion.server", () => ({ deleteClosetItemWithImage: vi.fn() }));
vi.mock("~/lib/image-moderation.server", () => ({ moderateImageContent: vi.fn() }));
vi.mock("~/lib/image-suitability.server", () => ({ screenGarmentSuitability: vi.fn() }));
vi.mock("~/lib/ai/closet-garment-analysis.server", () => ({ analyzeClosetGarment: vi.fn().mockResolvedValue(undefined) }));
vi.mock("~/lib/ai/journey-events.server", () => ({
  emitClosetItemAdded: vi.fn().mockReturnValue({}),
  recordJourneyEventAwaited: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("~/lib/ai/taste-extraction.server", () => ({ extractClosetEvidence: vi.fn().mockReturnValue([]) }));
vi.mock("~/lib/ai/taste-reconcile.server", () => ({ writeSourceEvidence: vi.fn().mockResolvedValue(undefined) }));
vi.mock("~/lib/ai/my-naia-model.server", () => ({
  loadNaiaModel: vi.fn().mockResolvedValue(null),
  computeModelReadinessFromRecord: vi.fn().mockReturnValue({ isReadyForTryOn: false }),
}));

import prisma from "~/db.server";
import { getCurrentNaiaCustomer } from "~/lib/naia-session.server";
import { deleteCloudinaryAsset, verifyCloudinaryAsset } from "~/lib/cloudinary-admin.server";
import { moderateImageContent } from "~/lib/image-moderation.server";
import { screenGarmentSuitability } from "~/lib/image-suitability.server";
import { action } from "./closet._index";

const mockGetCustomer = () => getCurrentNaiaCustomer as ReturnType<typeof vi.fn>;
const mockFindCustomer = () => (prisma as any).customer.findUnique as ReturnType<typeof vi.fn>;
const mockFindFirstItem = () => (prisma as any).closetItem.findFirst as ReturnType<typeof vi.fn>;
const mockDeleteAsset = () => deleteCloudinaryAsset as ReturnType<typeof vi.fn>;
const mockVerify = () => verifyCloudinaryAsset as ReturnType<typeof vi.fn>;
const mockModeration = () => moderateImageContent as ReturnType<typeof vi.fn>;
const mockSuitability = () => screenGarmentSuitability as ReturnType<typeof vi.fn>;
const pendingUpsert = () => (prisma as any).pendingCloudinaryDeletion.upsert as ReturnType<typeof vi.fn>;

const CUSTOMER = { id: "customer-A", membershipStatus: "NONE" };
const PUBLIC_ID = `naia-wardrobe/${CUSTOMER.id}/beige-tote.jpg`;

// The consent rejection is the earliest discard in the add flow — it runs
// immediately after the ownership check, before any Cloudinary verification
// or moderation, so it isolates the discard behaviour with the fewest moving
// parts. All 35 discard sites in this action funnel through the same
// discardUpload helper, so this exercises the shared path.
function addRequestWithoutConsent(overrides: Record<string, string> = {}) {
  mockGetCustomer().mockResolvedValueOnce(CUSTOMER);
  mockFindCustomer().mockResolvedValueOnce(CUSTOMER);
  const form = new URLSearchParams({
    intent: "add",
    category: "TOPS",
    publicId: PUBLIC_ID,
    name: "Beige Tote",
    colors: JSON.stringify(["Beige"]),
    occasions: "[]",
    seasons: "[]",
    garmentRelationships: "[]",
    photoConsentGiven: "false", // the rejection under test
    ...overrides,
  });
  return new Request("https://example.invalid/closet", {
    method: "POST",
    body: form,
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
}

const runAction = (request: Request) =>
  action({ request, params: {}, context: {} } as any) as Promise<any>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  pendingUpsert().mockResolvedValue({});
  mockFindFirstItem().mockResolvedValue(null);
  mockVerify().mockResolvedValue({
    ok: true,
    asset: { type: "private", resourceType: "image", format: "jpg", bytes: 100_000, width: 800, height: 800 },
  });
  mockModeration().mockResolvedValue({ status: "PASS" });
  mockSuitability().mockResolvedValue({ status: "PASS" });
});

describe("H7 — a rejected closet upload whose cleanup FAILS is durably recorded", () => {
  it("records an unresolved PendingCloudinaryDeletion row when the provider REJECTS (ok:false, which does not throw)", async () => {
    mockDeleteAsset().mockResolvedValue({ ok: false, errorCode: "PROVIDER_ERROR" });

    const res = await runAction(addRequestWithoutConsent());

    // The customer-facing rejection is unchanged.
    expect(res.init?.status ?? res.status).toBe(400);
    // And the orphaned upload is now tracked.
    expect(pendingUpsert()).toHaveBeenCalledTimes(1);
    const arg = pendingUpsert().mock.calls[0][0];
    expect(arg.where).toEqual({ publicId: PUBLIC_ID });
    expect(arg.create.customerId).toBe(CUSTOMER.id);
    expect(arg.create.publicId).toBe(PUBLIC_ID);
    expect(arg.create.deliveryType).toBe("private");
    expect(arg.create.lastError).toBe("PROVIDER_ERROR");
    // Unresolved: the retry sweep selects on resolvedAt: null.
    expect(arg.create.resolvedAt).toBeUndefined();
  });

  it("records a THROWN cleanup error too, and still returns the ordinary 400 rather than a 500", async () => {
    mockDeleteAsset().mockRejectedValue(new Error("socket hang up"));

    const res = await runAction(addRequestWithoutConsent());

    expect(res.init?.status ?? res.status).toBe(400);
    expect(pendingUpsert()).toHaveBeenCalledTimes(1);
    expect(pendingUpsert().mock.calls[0][0].create.lastError).toBe("socket hang up");
  });

  it("records nothing when the cleanup succeeds", async () => {
    mockDeleteAsset().mockResolvedValue({ ok: true });

    const res = await runAction(addRequestWithoutConsent());

    expect(res.init?.status ?? res.status).toBe(400);
    expect(mockDeleteAsset()).toHaveBeenCalledWith(PUBLIC_ID, "private");
    expect(pendingUpsert()).not.toHaveBeenCalled();
  });

  it("never records when the bookkeeping write itself fails — a cleanup problem must not become a 500", async () => {
    mockDeleteAsset().mockResolvedValue({ ok: false, errorCode: "PROVIDER_ERROR" });
    pendingUpsert().mockRejectedValue(new Error("db down"));

    const res = await runAction(addRequestWithoutConsent());

    expect(res.init?.status ?? res.status).toBe(400);
  });

  it("does not delete or record another customer's asset on a forged publicId — ownership is checked BEFORE the discard", async () => {
    // Ordering invariant that predates H7 and must survive it: a guessed
    // publicId plus withheld consent must never become a way to delete
    // someone else's photo, nor to claim it via a pending-deletion row
    // (an unresolved row makes assertPublicIdAvailable refuse new references).
    mockDeleteAsset().mockResolvedValue({ ok: false, errorCode: "PROVIDER_ERROR" });

    const res = await runAction(
      addRequestWithoutConsent({ publicId: "naia-wardrobe/customer-OTHER/victim.jpg" }),
    );

    expect(res.init?.status ?? res.status).toBe(400);
    expect(mockDeleteAsset()).not.toHaveBeenCalled();
    expect(pendingUpsert()).not.toHaveBeenCalled();
  });

  it("the recorded row is retry-sweep compatible: publicId-keyed, concrete delivery type, not the reserved VTO context", async () => {
    mockDeleteAsset().mockResolvedValue({ ok: false, errorCode: "PROVIDER_ERROR" });

    await runAction(addRequestWithoutConsent());

    const arg = pendingUpsert().mock.calls[0][0];
    // publicId is @unique, so a repeat failure bumps attemptCount rather than
    // stacking a duplicate row.
    expect(arg.where).toEqual({ publicId: PUBLIC_ID });
    expect(arg.update.attemptCount).toEqual({ increment: 1 });
    // Concrete, so retryPendingCloudinaryDeletion never has to probe the
    // Admin API to re-resolve an "unknown" type.
    expect(arg.create.deliveryType).toBe("private");
    // "vto-sweep-obligation" dispatches to a completely different retry
    // handler (a per-customer VTO enumeration), so it must never appear here.
    expect(arg.create.context).not.toBe("vto-sweep-obligation");
    expect(typeof arg.create.context).toBe("string");
    expect(arg.create.context.length).toBeGreaterThan(0);
  });
});

describe("H7 — no raw, unrecorded Cloudinary discard is left in this route", () => {
  it("closet._index.tsx contains zero direct deleteCloudinaryAsset calls", async () => {
    // Regression guard for the whole 35-site cluster: a newly added rejection
    // path must go through discardUpload, not reintroduce a silent discard.
    // Counting call expressions, not the bare substring — the substring also
    // matches prose in this file's own explanatory comments.
    const { readFileSync } = await import("node:fs");
    const { join, dirname } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const here = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(join(here, "closet._index.tsx"), "utf8");

    const rawCalls = src.match(/\bdeleteCloudinaryAsset\(/g) ?? [];
    expect(rawCalls).toHaveLength(0);

    // And the wrapper is genuinely in use across both flows.
    const wrapped = src.match(/\bdiscardUpload\(/g) ?? [];
    // 35 call sites + the helper's own definition is not a call, so expect
    // the full cluster to be present.
    expect(wrapped.length).toBeGreaterThanOrEqual(35);
    expect(src).toContain("deleteCloudinaryAssetOrRecord");
  });
});
