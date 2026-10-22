// app/routes/closet-replace.behavioral.test.ts
//
// Behavioral (not source-text) coverage for closet._index.tsx's action,
// intent="add" with replaceItemId set — the "Different Piece + Replace"
// safeguards added 2026-10-23: a history-aware guard before ever hard-deleting
// the original item, a replace-aware capacity check that still works when the
// customer is exactly at their Closet limit, and idempotency so a duplicate
// submission never creates a second item or mis-reports a prior partial
// failure. validatePublicIdOwnership is the REAL, pure implementation —
// everything else that touches Cloudinary, Prisma, or an AI provider is
// mocked. No real network call, no real database.
//
// deleteClosetItemWithImage is mocked directly rather than re-simulating its
// internal Prisma calls — this file's job is to verify closet._index.tsx's
// own contract with it (call it only when safe; react correctly to
// deleted:true, deleted:false, and a thrown error), not to re-test its own
// already-reviewed implementation.
//
// Run: npx vitest run app/routes/closet-replace.behavioral.test.ts

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/db.server", () => ({
  default: {
    customer: { findUnique: vi.fn() },
    closetItem: { findFirst: vi.fn(), create: vi.fn() },
    outfitItem: { count: vi.fn().mockResolvedValue(0) },
    savedLookItem: { count: vi.fn().mockResolvedValue(0) },
    journeyEvent: { create: vi.fn().mockResolvedValue({}) },
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
    // validatePublicIdOwnership is the REAL implementation — pure, no I/O.
    validatePublicIdOwnership: actual.validatePublicIdOwnership,
    getCloudinaryConfig: vi.fn().mockReturnValue({ cloudName: "test", apiKey: "test", apiSecret: "test" }),
    verifyCloudinaryAsset: vi.fn(),
    buildPrivateDownloadUrl: vi.fn().mockReturnValue("https://example.invalid/download"),
    deleteCloudinaryAsset: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock("~/lib/plan/entitlement.server", () => ({
  checkEntitlement: vi.fn().mockResolvedValue({ allowed: true }),
}));

vi.mock("~/lib/closet-item-deletion.server", () => ({
  deleteClosetItemWithImage: vi.fn(),
}));

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
import { verifyCloudinaryAsset, deleteCloudinaryAsset } from "~/lib/cloudinary-admin.server";
import { moderateImageContent } from "~/lib/image-moderation.server";
import { screenGarmentSuitability } from "~/lib/image-suitability.server";
import { checkEntitlement } from "~/lib/plan/entitlement.server";
import { deleteClosetItemWithImage } from "~/lib/closet-item-deletion.server";
import { action } from "./closet._index";

const mockGetCustomer = () => getCurrentNaiaCustomer as ReturnType<typeof vi.fn>;
const mockFindCustomer = () => (prisma as any).customer.findUnique as ReturnType<typeof vi.fn>;
const mockFindFirstItem = () => (prisma as any).closetItem.findFirst as ReturnType<typeof vi.fn>;
const mockCreateItem = () => (prisma as any).closetItem.create as ReturnType<typeof vi.fn>;
const mockOutfitCount = () => (prisma as any).outfitItem.count as ReturnType<typeof vi.fn>;
const mockSavedLookCount = () => (prisma as any).savedLookItem.count as ReturnType<typeof vi.fn>;
const mockVerify = () => verifyCloudinaryAsset as ReturnType<typeof vi.fn>;
const mockDeleteAsset = () => deleteCloudinaryAsset as ReturnType<typeof vi.fn>;
const mockModeration = () => moderateImageContent as ReturnType<typeof vi.fn>;
const mockSuitability = () => screenGarmentSuitability as ReturnType<typeof vi.fn>;
const mockCheckEntitlement = () => checkEntitlement as ReturnType<typeof vi.fn>;
const mockDeleteItem = () => deleteClosetItemWithImage as ReturnType<typeof vi.fn>;

const CUSTOMER_A = { id: "customer-A", membershipStatus: "NONE" };
const CUSTOMER_B = { id: "customer-B", membershipStatus: "NONE" };
const OLD_ITEM_ID = "item-old-1";

function publicIdFor(customer: typeof CUSTOMER_A, name: string) {
  return `naia-wardrobe/${customer.id}/${name}.jpg`;
}

function mockFullPipelinePass() {
  mockVerify().mockResolvedValue({
    ok: true,
    asset: { type: "private", resourceType: "image", format: "jpg", bytes: 100_000, width: 800, height: 800 },
  });
  mockModeration().mockResolvedValue({ status: "PASS" });
  mockSuitability().mockResolvedValue({ status: "PASS" });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
}

function replaceRequest(fields: Record<string, string>) {
  mockGetCustomer().mockResolvedValueOnce(CUSTOMER_A);
  mockFindCustomer().mockResolvedValueOnce(CUSTOMER_A);
  const newPublicId = fields.publicId ?? publicIdFor(CUSTOMER_A, "beige-tote");
  const form = new URLSearchParams({
    intent: "add", category: "TOPS", publicId: newPublicId,
    colors: JSON.stringify(["Beige"]), occasions: "[]", seasons: "[]",
    garmentRelationships: "[]", photoConsentGiven: "true", name: "Beige Tote",
    ...fields,
  });
  return new Request("https://example.invalid/closet", {
    method: "POST", body: form, headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  mockOutfitCount().mockResolvedValue(0);
  mockSavedLookCount().mockResolvedValue(0);
  mockCheckEntitlement().mockResolvedValue({ allowed: true });
});

describe("closet._index action (add, replace) — happy path: no history", () => {
  it("replaces cleanly: creates the new item, removes the old one, reports replace:'replaced'", async () => {
    mockFullPipelinePass();
    mockFindFirstItem()
      .mockResolvedValueOnce(null)                 // existingByPublicId — fresh request
      .mockResolvedValueOnce({ id: OLD_ITEM_ID });  // replaceTarget — found, owned
    mockCreateItem().mockResolvedValueOnce({ id: "item-new-2", category: "TOPS", tryOnEligibility: "pending-assessment" });
    mockDeleteItem().mockResolvedValueOnce({ deleted: true });

    const res: any = await action({
      request: replaceRequest({ replaceItemId: OLD_ITEM_ID }), params: {}, context: {},
    } as any);

    expect(mockCreateItem()).toHaveBeenCalledTimes(1);
    expect(mockDeleteItem()).toHaveBeenCalledWith(OLD_ITEM_ID, CUSTOMER_A.id);
    expect(res.data).toEqual({ success: true, replace: "replaced" });
  });

  it("an old item already removed by a prior attempt (NOT_FOUND) still counts as 'replaced', not failed", async () => {
    mockFullPipelinePass();
    mockFindFirstItem()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: OLD_ITEM_ID });
    mockCreateItem().mockResolvedValueOnce({ id: "item-new-2", category: "TOPS", tryOnEligibility: "pending-assessment" });
    mockDeleteItem().mockResolvedValueOnce({ deleted: false, errorCode: "NOT_FOUND" });

    const res: any = await action({
      request: replaceRequest({ replaceItemId: OLD_ITEM_ID }), params: {}, context: {},
    } as any);

    expect(res.data).toEqual({ success: true, replace: "replaced" });
  });

  it("Keep Both (no replaceItemId) is completely unaffected — old item never looked up, replace is null", async () => {
    mockFullPipelinePass();
    mockFindFirstItem().mockResolvedValueOnce(null); // existingByPublicId only
    mockCreateItem().mockResolvedValueOnce({ id: "item-new-2", category: "TOPS", tryOnEligibility: "pending-assessment" });

    const res: any = await action({ request: replaceRequest({}), params: {}, context: {} } as any);

    expect(mockFindFirstItem()).toHaveBeenCalledTimes(1); // only the idempotency check — no replaceTarget lookup
    expect(mockDeleteItem()).not.toHaveBeenCalled();
    expect(res.data).toEqual({ success: true, replace: null });
  });
});

describe("closet._index action (add, replace) — SAVED-OUTFIT HISTORY: never silently changed to Keep Both, never hard-deleted", () => {
  it("old item has OutfitItem history → never deleted, new item still created, reports 'kept-history'", async () => {
    mockFullPipelinePass();
    mockFindFirstItem()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: OLD_ITEM_ID });
    mockOutfitCount().mockResolvedValueOnce(1);
    mockCreateItem().mockResolvedValueOnce({ id: "item-new-2", category: "TOPS", tryOnEligibility: "pending-assessment" });

    const res: any = await action({
      request: replaceRequest({ replaceItemId: OLD_ITEM_ID }), params: {}, context: {},
    } as any);

    expect(mockDeleteItem()).not.toHaveBeenCalled();
    expect(mockCreateItem()).toHaveBeenCalledTimes(1);
    expect(res.data).toEqual({ success: true, replace: "kept-history" });
  });

  it("old item has SavedLookItem history → never deleted, reports 'kept-history'", async () => {
    mockFullPipelinePass();
    mockFindFirstItem()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: OLD_ITEM_ID });
    mockSavedLookCount().mockResolvedValueOnce(1);
    mockCreateItem().mockResolvedValueOnce({ id: "item-new-2", category: "TOPS", tryOnEligibility: "pending-assessment" });

    const res: any = await action({
      request: replaceRequest({ replaceItemId: OLD_ITEM_ID }), params: {}, context: {},
    } as any);

    expect(mockDeleteItem()).not.toHaveBeenCalled();
    expect(res.data).toEqual({ success: true, replace: "kept-history" });
  });
});

describe("closet._index action (add, replace) — PARTIAL FAILURE: never report successful replacement", () => {
  it("removal throws after the new item is created → reports 'kept-failed', new item is NOT rolled back", async () => {
    mockFullPipelinePass();
    mockFindFirstItem()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: OLD_ITEM_ID });
    mockCreateItem().mockResolvedValueOnce({ id: "item-new-2", category: "TOPS", tryOnEligibility: "pending-assessment" });
    mockDeleteItem().mockRejectedValueOnce(new Error("connection pool exhausted"));

    const res: any = await action({
      request: replaceRequest({ replaceItemId: OLD_ITEM_ID }), params: {}, context: {},
    } as any);

    expect(mockCreateItem()).toHaveBeenCalledTimes(1); // new item kept — never undone
    expect(res.data.success).toBe(true);
    expect(res.data.replace).toBe("kept-failed");
    expect(res.data.replace).not.toBe("replaced"); // must never be reported as a clean success
  });

  it("a duplicate submission (retry) after a partial failure re-attempts removal without creating a second item", async () => {
    mockFullPipelinePass();
    const newPublicId = publicIdFor(CUSTOMER_A, "beige-tote-retry");
    // This exact publicId already became a ClosetItem on the first attempt —
    // the retry's idempotency check finds it, and the old item is still there
    // (the first attempt's removal failed) — so the retry must only retry
    // the removal, not create anything new.
    mockFindFirstItem()
      .mockResolvedValueOnce({ id: "item-new-2", category: "TOPS", garmentRelationships: [], updatedAt: new Date(), tryOnEligibility: null })
      .mockResolvedValueOnce({ id: OLD_ITEM_ID });
    mockDeleteItem().mockResolvedValueOnce({ deleted: true });

    const res: any = await action({
      request: replaceRequest({ publicId: newPublicId, replaceItemId: OLD_ITEM_ID }), params: {}, context: {},
    } as any);

    expect(mockCreateItem()).not.toHaveBeenCalled(); // no second item
    expect(mockCheckEntitlement()).not.toHaveBeenCalled(); // nothing new being created — no capacity question to re-ask
    expect(mockDeleteItem()).toHaveBeenCalledWith(OLD_ITEM_ID, CUSTOMER_A.id);
    expect(res.data).toEqual({ success: true, replace: "replaced" });
  });

  it("a duplicate submission where everything already fully succeeded is a harmless no-op, not an error", async () => {
    const newPublicId = publicIdFor(CUSTOMER_A, "beige-tote-done");
    // New item exists (first attempt created it); old item is gone too (first
    // attempt's removal already succeeded) — replaceTarget resolves to null,
    // but that must not be treated as the fresh-request "not found" error.
    mockFindFirstItem()
      .mockResolvedValueOnce({ id: "item-new-2", category: "TOPS", garmentRelationships: [], updatedAt: new Date(), tryOnEligibility: null })
      .mockResolvedValueOnce(null);

    const res: any = await action({
      request: replaceRequest({ publicId: newPublicId, replaceItemId: OLD_ITEM_ID }), params: {}, context: {},
    } as any);

    expect(mockCreateItem()).not.toHaveBeenCalled();
    expect(mockDeleteItem()).not.toHaveBeenCalled(); // nothing left to remove
    expect(res.init?.status ?? 200).not.toBe(404); // must not be treated as a fresh invalid-target error
    expect(res.data).toEqual({ success: true, replace: null });
  });
});

describe("closet._index action (add, replace) — CAPACITY: works at exactly the Closet limit", () => {
  it("at capacity, replacing an item with no history excludes the old item from the count and succeeds", async () => {
    mockFullPipelinePass();
    mockFindFirstItem()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: OLD_ITEM_ID });
    mockCreateItem().mockResolvedValueOnce({ id: "item-new-2", category: "TOPS", tryOnEligibility: "pending-assessment" });
    mockDeleteItem().mockResolvedValueOnce({ deleted: true });

    const res: any = await action({
      request: replaceRequest({ replaceItemId: OLD_ITEM_ID }), params: {}, context: {},
    } as any);

    expect(mockCheckEntitlement()).toHaveBeenCalledWith(
      CUSTOMER_A.id, CUSTOMER_A.membershipStatus, "closet", { excludeItemId: OLD_ITEM_ID },
    );
    expect(res.data).toEqual({ success: true, replace: "replaced" });
  });

  it("at capacity, replacing an item that HAS history does not exclude it, and the existing 'closet full' rejection still applies", async () => {
    mockFullPipelinePass();
    mockFindFirstItem()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: OLD_ITEM_ID });
    mockOutfitCount().mockResolvedValueOnce(1);
    mockCheckEntitlement().mockResolvedValueOnce({ allowed: false, reason: "at_capacity" });

    const res: any = await action({
      request: replaceRequest({ replaceItemId: OLD_ITEM_ID }), params: {}, context: {},
    } as any);

    expect(mockCheckEntitlement()).toHaveBeenCalledWith(
      CUSTOMER_A.id, CUSTOMER_A.membershipStatus, "closet", undefined,
    );
    expect(res.init.status).toBe(403);
    expect(mockCreateItem()).not.toHaveBeenCalled();
    expect(mockDeleteItem()).not.toHaveBeenCalled(); // old item untouched when the swap is blocked
  });

  it("ordinary add (no replace) is unaffected — capacity check still passes no exclusion", async () => {
    mockFullPipelinePass();
    mockFindFirstItem().mockResolvedValueOnce(null);
    mockCreateItem().mockResolvedValueOnce({ id: "item-new-2", category: "TOPS", tryOnEligibility: "pending-assessment" });

    await action({ request: replaceRequest({}), params: {}, context: {} } as any);

    expect(mockCheckEntitlement()).toHaveBeenCalledWith(
      CUSTOMER_A.id, CUSTOMER_A.membershipStatus, "closet", undefined,
    );
  });
});

describe("closet._index action (add, replace) — ownership", () => {
  it("a replaceItemId that doesn't belong to this customer is rejected on a fresh request, no delete attempted, upload cleaned up", async () => {
    mockFindFirstItem()
      .mockResolvedValueOnce(null)   // existingByPublicId — fresh request
      .mockResolvedValueOnce(null);  // replaceTarget — not found/not owned
    const newPublicId = publicIdFor(CUSTOMER_A, "beige-tote-forged-replace");

    const res: any = await action({
      request: replaceRequest({ publicId: newPublicId, replaceItemId: "someone-elses-item" }), params: {}, context: {},
    } as any);

    expect(res.init.status).toBe(404);
    expect(mockDeleteAsset()).toHaveBeenCalledWith(newPublicId, "private");
    expect(mockDeleteItem()).not.toHaveBeenCalled();
    expect(mockCreateItem()).not.toHaveBeenCalled();
  });
});
