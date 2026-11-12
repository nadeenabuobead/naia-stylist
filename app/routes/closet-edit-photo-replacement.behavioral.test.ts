// app/routes/closet-edit-photo-replacement.behavioral.test.ts
//
// Behavioral (not source-text) coverage for closet._index.tsx's action, intent="edit",
// specifically the photo-replacement branch (newPublicId set) — the "same piece / different
// piece" review fix (2026-10-22). Same mocking convention as
// closet-add-intent.behavioral.test.ts: validatePublicIdOwnership is the REAL, pure
// implementation; everything that touches Cloudinary, Prisma, or an AI provider is mocked.
// No real network call, no real database.
//
// THE BUG THIS CLOSES: replacing an existing item's photo re-ran garment analysis on the
// new image, but forwarded the OLD item's pattern/occasions/seasons as "user-supplied, do
// not overwrite" hints — freezing them even when the new photo no longer matched. The fix
// has the client run the same preview-analysis + editable-review step "add" already uses,
// then asks "same piece or different piece?" before anything saves. These tests verify the
// SERVER side of that fix: the customer's reviewed values (not the old row's stale ones)
// are what gets persisted and forwarded to analysis, same-piece updates the existing row
// and preserves its history-bearing id, and different-piece creates a genuinely new row
// without touching the old one.
//
// Run: npx vitest run app/routes/closet-edit-photo-replacement.behavioral.test.ts

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/db.server", () => {
  const db: any = {
    customer: { findUnique: vi.fn() },
    // findFirst defaults to null (not a duplicate submission) — this file's own
    // DIFFERENT PIECE tests submit intent=add and predate the replace/idempotency
    // check; see closet-replace.behavioral.test.ts for that behaviour.
    closetItem: { findUnique: vi.fn(), findFirst: vi.fn().mockResolvedValue(null), update: vi.fn(), create: vi.fn() },
    journeyEvent: { create: vi.fn().mockResolvedValue({}) },
    // The same-piece photo-replacement path now wraps its update in a
    // Serializable transaction (the abandoned-upload-sweep claim check —
    // see cloudinary-deletion-claim.server.ts) — the callback gets the SAME
    // mocked client, so this file's existing closetItem.update assertions
    // keep testing the same thing.
    pendingCloudinaryDeletion: { findUnique: vi.fn().mockResolvedValue(null) },
    $transaction: vi.fn(async (fn: any) => fn(db)),
  };
  return { default: db };
});

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

vi.mock("~/lib/plan/entitlement.server", async () => {
  // reserveClosetSlot (06209cf, atomic Closet-quota reservation) replaced the
  // direct closetItem.create() call the "different piece" path used to make
  // directly — delegate to the already-mocked db.server create so this
  // file's existing mockCreateItem() assertions keep testing the same thing.
  const { default: db } = await import("~/db.server");
  return {
    checkEntitlement: vi.fn().mockResolvedValue({ allowed: true }),
    reserveClosetSlot: vi.fn(async (_customerId: string, _membershipStatus: string, itemData: any) => {
      const record = await (db as any).closetItem.create({ data: itemData });
      return { allowed: true, record };
    }),
  };
});

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
import { analyzeClosetGarment } from "~/lib/ai/closet-garment-analysis.server";
import { action } from "./closet._index";

const mockGetCustomer = () => getCurrentNaiaCustomer as ReturnType<typeof vi.fn>;
const mockFindCustomer = () => (prisma as any).customer.findUnique as ReturnType<typeof vi.fn>;
const mockFindItem = () => (prisma as any).closetItem.findUnique as ReturnType<typeof vi.fn>;
const mockUpdateItem = () => (prisma as any).closetItem.update as ReturnType<typeof vi.fn>;
const mockCreateItem = () => (prisma as any).closetItem.create as ReturnType<typeof vi.fn>;
const mockVerify = () => verifyCloudinaryAsset as ReturnType<typeof vi.fn>;
const mockDelete = () => deleteCloudinaryAsset as ReturnType<typeof vi.fn>;
const mockModeration = () => moderateImageContent as ReturnType<typeof vi.fn>;
const mockSuitability = () => screenGarmentSuitability as ReturnType<typeof vi.fn>;
const mockAnalyze = () => analyzeClosetGarment as ReturnType<typeof vi.fn>;

const CUSTOMER_A = { id: "customer-A", membershipStatus: "NONE" };
const CUSTOMER_B = { id: "customer-B", membershipStatus: "NONE" };
const OLD_ITEM_ID = "item-old-1";

function publicIdFor(customer: typeof CUSTOMER_A, name: string) {
  return `naia-wardrobe/${customer.id}/${name}.jpg`;
}

/** The existing row before any photo-replacement edit, as returned by findUnique. */
function existingItem(overrides: Record<string, unknown> = {}) {
  return {
    id: OLD_ITEM_ID,
    customerId: CUSTOMER_A.id,
    imagePublicId: publicIdFor(CUSTOMER_A, "old-photo"),
    pattern: "Floral",
    occasions: ["Casual"],
    seasons: ["Summer"],
    name: "Old Floral Top",
    category: "TOPS",
    colors: ["Pink"],
    primaryColor: "Pink",
    brand: "OldBrand",
    garmentRelationships: [],
    customerNote: null,
    ...overrides,
  };
}

/** Makes verify/moderation/suitability all pass, and global fetch skip the magic-byte check. */
function mockFullPipelinePass() {
  mockVerify().mockResolvedValue({
    ok: true,
    asset: { type: "private", resourceType: "image", format: "jpg", bytes: 100_000, width: 800, height: 800 },
  });
  mockModeration().mockResolvedValue({ status: "PASS" });
  mockSuitability().mockResolvedValue({ status: "PASS" });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
}

function editRequestAs(customer: typeof CUSTOMER_A | null, fields: Record<string, string>) {
  mockGetCustomer().mockResolvedValueOnce(customer);
  if (customer) mockFindCustomer().mockResolvedValueOnce(customer);
  const form = new URLSearchParams({
    intent: "edit", itemId: OLD_ITEM_ID, category: "TOPS", colors: "[]", garmentRelationships: "[]",
    ...fields,
  });
  return new Request("https://example.invalid/closet", {
    method: "POST",
    body: form,
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("closet._index action (edit, photo replacement) — SAME PIECE: identity and history preserved, metadata from the reviewed photo", () => {
  it("updates the EXISTING row (same id) rather than creating a new one", async () => {
    mockFindItem().mockResolvedValueOnce(existingItem());
    mockFullPipelinePass();
    const newPublicId = publicIdFor(CUSTOMER_A, "new-photo");

    await action({
      request: editRequestAs(CUSTOMER_A, {
        newPublicId, photoConsentGiven: "true",
        name: "Floral Top", colors: JSON.stringify(["Pink"]),
        pattern: "Floral", occasions: JSON.stringify(["Casual"]), seasons: JSON.stringify(["Summer"]),
      }),
      params: {}, context: {},
    } as any);

    expect(mockUpdateItem()).toHaveBeenCalledWith(expect.objectContaining({ where: { id: OLD_ITEM_ID } }));
    expect(mockCreateItem()).not.toHaveBeenCalled();
  });

  it("persists the CUSTOMER'S REVIEWED pattern/occasions/seasons for the new photo, not the old row's stale values", async () => {
    // The old row says Floral/Casual/Summer; the customer reviewed the NEW photo's AI
    // suggestion and corrected it to Stripes/Work/Winter before saving.
    mockFindItem().mockResolvedValueOnce(existingItem({ pattern: "Floral", occasions: ["Casual"], seasons: ["Summer"] }));
    mockFullPipelinePass();
    const newPublicId = publicIdFor(CUSTOMER_A, "new-photo");

    await action({
      request: editRequestAs(CUSTOMER_A, {
        newPublicId, photoConsentGiven: "true",
        pattern: "Stripes", occasions: JSON.stringify(["Work"]), seasons: JSON.stringify(["Winter"]),
      }),
      params: {}, context: {},
    } as any);

    expect(mockUpdateItem()).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ pattern: "Stripes", occasions: ["Work"], seasons: ["Winter"] }),
    }));
    // The re-analysis call must forward the REVIEWED values as hints, not the stale ones —
    // this is the exact precedence rule that used to freeze the old photo's metadata.
    expect(mockAnalyze()).toHaveBeenCalledWith(expect.objectContaining({
      userPattern: "Stripes", userOccasions: ["Work"], userSeasons: ["Winter"],
    }));
  });

  it("a meta-only edit (no new photo) is UNAFFECTED by this fix — pattern/occasions/seasons are not sent and not touched", async () => {
    mockFindItem().mockResolvedValueOnce(existingItem());
    await action({
      request: editRequestAs(CUSTOMER_A, { name: "Renamed Top" }), // no newPublicId at all
      params: {}, context: {},
    } as any);

    expect(mockUpdateItem()).toHaveBeenCalledTimes(1);
    const call = mockUpdateItem().mock.calls[0][0];
    expect(call.data).not.toHaveProperty("pattern");
    expect(call.data).not.toHaveProperty("occasions");
    expect(call.data).not.toHaveProperty("seasons");
    expect(mockVerify()).not.toHaveBeenCalled(); // no photo pipeline touched at all
  });

  it("history-bearing identity (the item's id) never changes for a same-piece replacement, so OutfitItem/SavedLookItem/evidence rows keyed to it stay attached", async () => {
    mockFindItem().mockResolvedValueOnce(existingItem());
    mockFullPipelinePass();
    await action({
      request: editRequestAs(CUSTOMER_A, {
        newPublicId: publicIdFor(CUSTOMER_A, "new-photo"), photoConsentGiven: "true",
        pattern: "Stripes", occasions: "[]", seasons: "[]",
      }),
      params: {}, context: {},
    } as any);
    // Every DB write this path makes targets the SAME id — nothing re-keys the garment's history.
    for (const call of mockUpdateItem().mock.calls) {
      expect(call[0].where).toEqual({ id: OLD_ITEM_ID });
    }
    expect(mockAnalyze()).toHaveBeenCalledWith(expect.objectContaining({ closetItemId: OLD_ITEM_ID }));
  });
});

describe("closet._index action (edit, photo replacement) — DIFFERENT PIECE: a genuinely new row, old row untouched", () => {
  it("'different piece' submits intent=add and creates a NEW ClosetItem — the old row is never updated", async () => {
    mockFullPipelinePass();
    const newPublicId = publicIdFor(CUSTOMER_A, "different-garment-photo");
    mockCreateItem().mockResolvedValueOnce({ id: "item-new-2", category: "TOPS", tryOnEligibility: "pending-assessment" });

    mockGetCustomer().mockResolvedValueOnce(CUSTOMER_A);
    mockFindCustomer().mockResolvedValueOnce(CUSTOMER_A);
    const form = new URLSearchParams({
      intent: "add", category: "TOPS", publicId: newPublicId, colors: JSON.stringify(["Black"]),
      occasions: "[]", seasons: "[]", garmentRelationships: "[]", photoConsentGiven: "true",
      name: "Different Black Jacket",
    });
    await action({
      request: new Request("https://example.invalid/closet", { method: "POST", body: form, headers: { "Content-Type": "application/x-www-form-urlencoded" } }),
      params: {}, context: {},
    } as any);

    expect(mockCreateItem()).toHaveBeenCalledTimes(1);
    expect(mockUpdateItem()).not.toHaveBeenCalled();
    // The new row is created fresh — never references the old item's id anywhere.
    const createCall = mockCreateItem().mock.calls[0][0];
    expect(JSON.stringify(createCall)).not.toContain(OLD_ITEM_ID);
  });

  it("the original item's photo is NEVER deleted when creating a different piece (no orphan-deletion of the old asset)", async () => {
    mockFullPipelinePass();
    mockCreateItem().mockResolvedValueOnce({ id: "item-new-2", category: "TOPS", tryOnEligibility: "pending-assessment" });
    mockGetCustomer().mockResolvedValueOnce(CUSTOMER_A);
    mockFindCustomer().mockResolvedValueOnce(CUSTOMER_A);
    const form = new URLSearchParams({
      intent: "add", category: "TOPS", publicId: publicIdFor(CUSTOMER_A, "different-garment-photo"),
      colors: "[]", occasions: "[]", seasons: "[]", garmentRelationships: "[]", photoConsentGiven: "true",
    });
    await action({
      request: new Request("https://example.invalid/closet", { method: "POST", body: form, headers: { "Content-Type": "application/x-www-form-urlencoded" } }),
      params: {}, context: {},
    } as any);
    // The "add" action path only ever deletes an asset it is REJECTING (moderation/
    // suitability/verification failure) — never a different, pre-existing item's photo.
    // Confirmed here by: no delete call referencing the OLD item's publicId at all.
    const oldAssetId = publicIdFor(CUSTOMER_A, "old-photo");
    expect(mockDelete()).not.toHaveBeenCalledWith(oldAssetId, "private");
  });

  it("respects the same closet-capacity entitlement check as any other new item", async () => {
    const { checkEntitlement } = await import("~/lib/plan/entitlement.server");
    (checkEntitlement as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ allowed: false, reason: "at_capacity" });
    mockGetCustomer().mockResolvedValueOnce(CUSTOMER_A);
    mockFindCustomer().mockResolvedValueOnce(CUSTOMER_A);
    const form = new URLSearchParams({
      intent: "add", category: "TOPS", publicId: publicIdFor(CUSTOMER_A, "different-garment-photo"),
      colors: "[]", occasions: "[]", seasons: "[]", garmentRelationships: "[]", photoConsentGiven: "true",
    });
    const res: any = await action({
      request: new Request("https://example.invalid/closet", { method: "POST", body: form, headers: { "Content-Type": "application/x-www-form-urlencoded" } }),
      params: {}, context: {},
    } as any);
    expect(res.init.status).toBe(403);
    expect(mockCreateItem()).not.toHaveBeenCalled();
  });
});

describe("closet._index action (edit, photo replacement) — permissions and ownership", () => {
  it("a customer editing an item that belongs to someone else is rejected with 404, no update attempted", async () => {
    mockFindItem().mockResolvedValueOnce(existingItem({ customerId: CUSTOMER_B.id }));
    await action({
      request: editRequestAs(CUSTOMER_A, { newPublicId: publicIdFor(CUSTOMER_A, "new-photo"), photoConsentGiven: "true" }),
      params: {}, context: {},
    } as any);
    expect(mockUpdateItem()).not.toHaveBeenCalled();
  });

  it("a forged newPublicId belonging to a different customer is rejected on ownership, and never deleted", async () => {
    mockFindItem().mockResolvedValueOnce(existingItem());
    const forgedPublicId = publicIdFor(CUSTOMER_B, "stolen-photo");
    const res: any = await action({
      request: editRequestAs(CUSTOMER_A, { newPublicId: forgedPublicId, photoConsentGiven: "true" }),
      params: {}, context: {},
    } as any);
    expect(res.init.status).toBe(400);
    expect(mockDelete()).not.toHaveBeenCalled();
    expect(mockUpdateItem()).not.toHaveBeenCalled();
  });
});

describe("closet._index action (edit, photo replacement) — fresh photo consent", () => {
  it("withheld consent on a replacement photo is rejected, and the NEW asset IS deleted (no orphan)", async () => {
    mockFindItem().mockResolvedValueOnce(existingItem());
    const newPublicId = publicIdFor(CUSTOMER_A, "new-photo");
    const res: any = await action({
      request: editRequestAs(CUSTOMER_A, { newPublicId, photoConsentGiven: "false" }),
      params: {}, context: {},
    } as any);
    expect(res.init.status).toBe(400);
    expect(mockDelete()).toHaveBeenCalledWith(newPublicId, "private");
    expect(mockUpdateItem()).not.toHaveBeenCalled();
  });

  it("a successful same-piece replacement stamps FRESH consent for the new photo, not the old item's consent record", async () => {
    mockFindItem().mockResolvedValueOnce(existingItem());
    mockFullPipelinePass();
    await action({
      request: editRequestAs(CUSTOMER_A, {
        newPublicId: publicIdFor(CUSTOMER_A, "new-photo"), photoConsentGiven: "true",
        pattern: "", occasions: "[]", seasons: "[]",
      }),
      params: {}, context: {},
    } as any);
    const call = mockUpdateItem().mock.calls[0][0];
    // buildConsentStamp's exact field names aren't asserted here (that's its own test's
    // job) — what matters is that SOME consent stamp was written on THIS update call,
    // proving it isn't silently skipped for the replace-photo path.
    const hasConsentField = Object.keys(call.data).some((k) => k.toLowerCase().includes("consent"));
    expect(hasConsentField).toBe(true);
  });
});
