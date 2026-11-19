// app/routes/closet-add-intent.behavioral.test.ts
//
// Behavioral (not source-text) coverage for closet._index.tsx's action,
// intent="add" — the real server-side consent/ownership gate behind the
// Closet upload UI. Follows the same two-synthetic-customer house pattern
// as phase1-synthetic-integration.test.ts / settings-behavioral.test.ts.
// validatePublicIdOwnership is the REAL, pure function (synchronous
// string-prefix check, no I/O) — not mocked. Everything that touches
// Cloudinary, Prisma, or an AI provider is mocked; no real network call,
// no real database.
//
// Closes a real defect found while writing these tests: the consent-
// rejection branch called deleteCloudinaryAsset BEFORE the ownership check
// ran — the same bug found in api.closet-preview-analyze.ts, in the same
// shape. Fixed by reordering the two checks (see closet._index.tsx) — the
// regression test is "a forged publicId + withheld consent is rejected on
// ownership, and the asset is never deleted" below.
//
// Run: npx vitest run app/routes/closet-add-intent.behavioral.test.ts

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/db.server", () => ({
  default: {
    customer: { findUnique: vi.fn() },
    // findFirst defaults to null (not a duplicate submission) — this file's own
    // tests predate the replace/idempotency check and never exercise it directly;
    // see closet-replace.behavioral.test.ts for that behaviour.
    closetItem: { findFirst: vi.fn().mockResolvedValue(null), create: vi.fn() },
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
  checkEntitlement: vi.fn(),
  reserveClosetSlot: vi.fn(),
}));

vi.mock("~/lib/image-moderation.server", () => ({ moderateImageContent: vi.fn() }));
vi.mock("~/lib/image-suitability.server", () => ({ screenGarmentSuitability: vi.fn() }));
vi.mock("~/lib/ai/closet-garment-analysis.server", () => ({ analyzeClosetGarment: vi.fn().mockResolvedValue(undefined) }));
vi.mock("~/lib/ai/journey-events.server", () => ({
  emitClosetItemAdded: vi.fn().mockReturnValue({}),
  recordJourneyEventAwaited: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("~/lib/ai/taste-extraction.server", () => ({ extractClosetEvidence: vi.fn() }));
vi.mock("~/lib/ai/taste-reconcile.server", () => ({ writeSourceEvidence: vi.fn().mockResolvedValue(undefined) }));
vi.mock("~/lib/ai/my-naia-model.server", () => ({
  loadNaiaModel: vi.fn().mockResolvedValue(null),
  computeModelReadinessFromRecord: vi.fn().mockReturnValue({ isReadyForTryOn: false }),
}));

import prisma from "~/db.server";
import { getCurrentNaiaCustomer } from "~/lib/naia-session.server";
import { verifyCloudinaryAsset, deleteCloudinaryAsset } from "~/lib/cloudinary-admin.server";
import { checkEntitlement, reserveClosetSlot } from "~/lib/plan/entitlement.server";
import { moderateImageContent } from "~/lib/image-moderation.server";
import { screenGarmentSuitability } from "~/lib/image-suitability.server";
import { action } from "./closet._index";

const mockGetCustomer = () => getCurrentNaiaCustomer as ReturnType<typeof vi.fn>;
const mockFindCustomer = () => (prisma as any).customer.findUnique as ReturnType<typeof vi.fn>;
const mockVerify = () => verifyCloudinaryAsset as ReturnType<typeof vi.fn>;
const mockDelete = () => deleteCloudinaryAsset as ReturnType<typeof vi.fn>;
const mockEntitlement = () => checkEntitlement as ReturnType<typeof vi.fn>;
const mockReserve = () => reserveClosetSlot as ReturnType<typeof vi.fn>;

const CUSTOMER_A = { id: "customer-A", membershipStatus: "NONE" };
const CUSTOMER_B = { id: "customer-B", membershipStatus: "NONE" };

function ownPublicId(customer: typeof CUSTOMER_A) {
  return `naia-wardrobe/${customer.id}/synthetic-asset.jpg`;
}

function addRequestAs(customer: typeof CUSTOMER_A | null, fields: Record<string, string>) {
  mockGetCustomer().mockResolvedValueOnce(customer);
  if (customer) mockFindCustomer().mockResolvedValueOnce(customer);
  const form = new URLSearchParams({ intent: "add", category: "TOPS", colors: "[]", occasions: "[]", seasons: "[]", garmentRelationships: "[]", ...fields });
  return new Request("https://example.invalid/closet", {
    method: "POST",
    body: form,
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("closet._index action (add) — authentication", () => {
  it("rejects an unauthenticated request with 401 before any Cloudinary/consent/ownership logic", async () => {
    const res: any = await action({ request: addRequestAs(null, {}), params: {}, context: {} } as any);
    expect(res.init.status).toBe(401);
    expect(mockVerify()).not.toHaveBeenCalled();
    expect(mockDelete()).not.toHaveBeenCalled();
  });
});

describe("closet._index action (add) — ownership enforced before any deletion", () => {
  it("a forged publicId belonging to another customer is rejected on ownership, and NEVER deleted", async () => {
    const forgedPublicId = ownPublicId(CUSTOMER_A);
    const res: any = await action({
      request: addRequestAs(CUSTOMER_B, { publicId: forgedPublicId, photoConsentGiven: "false" }),
      params: {},
      context: {},
    } as any);
    expect(res.init.status).toBe(400);
    expect(res.data.error).toBe("Photo does not belong to this account.");
    expect(mockDelete()).not.toHaveBeenCalled();
  });

  it("a forged publicId is rejected even when consent IS given — ownership still comes first", async () => {
    const forgedPublicId = ownPublicId(CUSTOMER_A);
    const res: any = await action({
      request: addRequestAs(CUSTOMER_B, { publicId: forgedPublicId, photoConsentGiven: "true" }),
      params: {},
      context: {},
    } as any);
    expect(res.init.status).toBe(400);
    expect(res.data.error).toBe("Photo does not belong to this account.");
    expect(mockEntitlement()).not.toHaveBeenCalled();
  });
});

describe("closet._index action (add) — consent enforced server-side, not just the frontend checkbox", () => {
  it("withheld consent on the customer's OWN asset is rejected, and that asset IS deleted (no orphan)", async () => {
    const ownId = ownPublicId(CUSTOMER_A);
    const res: any = await action({
      request: addRequestAs(CUSTOMER_A, { publicId: ownId, photoConsentGiven: "false" }),
      params: {},
      context: {},
    } as any);
    expect(res.init.status).toBe(400);
    expect(res.data.error).toBe("Photo consent is required to add an item.");
    expect(mockDelete()).toHaveBeenCalledWith(ownId, "private");
    expect(mockEntitlement()).not.toHaveBeenCalled();
  });

  it("omitting photoConsentGiven from the form entirely is treated as no consent", async () => {
    const ownId = ownPublicId(CUSTOMER_A);
    const res: any = await action({
      request: addRequestAs(CUSTOMER_A, { publicId: ownId }),
      params: {},
      context: {},
    } as any);
    expect(res.data.error).toBe("Photo consent is required to add an item.");
  });

  it("consent given on the customer's own asset proceeds past the consent gate to capacity enforcement", async () => {
    const ownId = ownPublicId(CUSTOMER_A);
    mockEntitlement().mockResolvedValue({ allowed: false, reason: "at_capacity" });

    const res: any = await action({
      request: addRequestAs(CUSTOMER_A, { publicId: ownId, photoConsentGiven: "true" }),
      params: {},
      context: {},
    } as any);

    // 4th arg is the replace-aware exclusion option (2026-10-23) — undefined for an
    // ordinary add with no replaceItemId; see closet-replace.behavioral.test.ts.
    expect(mockEntitlement()).toHaveBeenCalledWith(CUSTOMER_A.id, CUSTOMER_A.membershipStatus, "closet", undefined);
    expect(res.init.status).toBe(403);
    expect(mockDelete()).not.toHaveBeenCalled();
  });

  // Behavioral coverage for dd67ed9's FINAL atomic-upload path specifically —
  // distinct from cb10c6c/397dc37's earlier preview-analyze checkpoint
  // (see api.closet-preview-analyze.behavioral.test.ts), which is a
  // different file on a different code path. entitlement.test.ts's ENT-14c
  // already proves the limit===0 branch exists in this file's SOURCE TEXT;
  // these two tests prove it behaviorally, by actually invoking the real
  // action — still with no live HTTP request, no real database, no real
  // Cloudinary/AI call. Live-HTTP verification of this exact path remains
  // open (see the launch checklist) — these tests strengthen local
  // confidence while that stays unexercised.
  it("limit===0 (zero Closet allowance) gets the upgrade-oriented message, and the asset is NOT deleted — dd67ed9's final path, behaviorally", async () => {
    const ownId = ownPublicId(CUSTOMER_A);
    mockEntitlement().mockResolvedValue({ allowed: false, reason: "at_capacity", limit: 0 });

    const res: any = await action({
      request: addRequestAs(CUSTOMER_A, { publicId: ownId, photoConsentGiven: "true" }),
      params: {},
      context: {},
    } as any);

    expect(res.init.status).toBe(403);
    expect(res.data.error).toBe("Closet access is included with nAia Membership. Subscribe to start adding pieces.");
    // Intentional asymmetry with the early preview-analyze checkpoint, which
    // DOES delete on rejection (see its own header comment) — this final
    // path deliberately preserves the asset so the customer can free
    // capacity and resubmit without re-uploading. A regression here would
    // silently break that resubmit flow.
    expect(mockDelete()).not.toHaveBeenCalled();
    expect(mockVerify()).not.toHaveBeenCalled();
  });

  it("a genuinely full (non-zero limit) member gets the distinct 'closet is full' message, not the upgrade message — same branch as the early checkpoint", async () => {
    const ownId = ownPublicId(CUSTOMER_A);
    mockEntitlement().mockResolvedValue({ allowed: false, reason: "at_capacity", limit: 250 });

    const res: any = await action({
      request: addRequestAs(CUSTOMER_A, { publicId: ownId, photoConsentGiven: "true" }),
      params: {},
      context: {},
    } as any);

    expect(res.init.status).toBe(403);
    expect(res.data.error).toBe("Your closet is full. Remove some items to add new ones.");
    expect(mockDelete()).not.toHaveBeenCalled();
  });
});

describe("closet._index action (add) — failure paths, no real database or image provider contacted", () => {
  it("missing publicId is rejected with 400 before consent/ownership/entitlement are ever checked", async () => {
    const res: any = await action({
      request: addRequestAs(CUSTOMER_A, { photoConsentGiven: "true" }),
      params: {},
      context: {},
    } as any);
    expect(res.init.status).toBe(400);
    expect(res.data.error).toBe("Image upload reference required.");
    expect(mockEntitlement()).not.toHaveBeenCalled();
  });

  it("missing category is rejected with 400", async () => {
    const res: any = await action({
      request: addRequestAs(CUSTOMER_A, { category: "", publicId: ownPublicId(CUSTOMER_A) }),
      params: {},
      context: {},
    } as any);
    expect(res.init.status).toBe(400);
    expect(res.data.error).toBe("Category required");
  });

  it("the abandoned-upload sweep having claimed this exact publicId blocks the add and asks for a fresh upload, WITHOUT this route calling deleteCloudinaryAsset itself (the sweep owns that asset's cleanup)", async () => {
    const ownId = ownPublicId(CUSTOMER_A);
    mockVerify().mockResolvedValue({
      ok: true,
      asset: { type: "private", resourceType: "image", format: "jpg", bytes: 1000, width: 400, height: 400 },
    });
    // The magic-byte check fetches buildPrivateDownloadUrl's (mocked)
    // "https://example.invalid/download" — stub global fetch so this
    // doesn't attempt a real network call; an ok:false response makes the
    // route skip its inner byte-signature check entirely (see
    // closet._index.tsx step 6), which is enough to reach moderation/
    // suitability/entitlement below.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    (moderateImageContent as ReturnType<typeof vi.fn>).mockResolvedValue({ status: "PASS" });
    (screenGarmentSuitability as ReturnType<typeof vi.fn>).mockResolvedValue({ status: "PASS" });
    mockEntitlement().mockResolvedValue({ allowed: true });
    mockReserve().mockResolvedValue({ allowed: false, reason: "asset_pending_deletion" });

    const res: any = await action({
      request: addRequestAs(CUSTOMER_A, { publicId: ownId, photoConsentGiven: "true" }),
      params: {},
      context: {},
    } as any);

    expect(res.init.status).toBe(409);
    expect(res.data.error).toBe("This image could not be saved. Please upload again.");
    expect(mockDelete()).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  // Behavioral coverage for the ATOMIC reservation's at_capacity branch
  // specifically — distinct from every test above this point, which only
  // ever exercises the early, non-atomic checkEntitlement check (mocked to
  // reject before Cloudinary verify/moderation/suitability ever run). Here
  // the early check is mocked to ALLOW (as it would for a concurrent
  // request that loses a genuine race at the last slot), so the route
  // proceeds through verify/moderation/suitability — real work against a
  // real, now-moderated upload — before reserveClosetSlot's own atomic
  // re-check inside the Serializable transaction is what actually blocks
  // it. This is the scenario closet._index.tsx's own comment calls out:
  // "A concurrent upload won the race since the early check above — this
  // asset was already verified/moderated but must not be kept orphaned."
  // Unlike the early-checkpoint rejection (which deliberately preserves the
  // asset for resubmission) and unlike asset_pending_deletion (which must
  // not double-delete against the sweep), this branch must call
  // discardUpload so the already-verified asset is not orphaned in storage.
  it("the ATOMIC reserveClosetSlot at_capacity rejection (a concurrent request won the race after the early check passed) deletes the already-verified asset — no orphan, genuinely full member", async () => {
    const ownId = ownPublicId(CUSTOMER_A);
    mockEntitlement().mockResolvedValue({ allowed: true, limit: 250 });
    mockVerify().mockResolvedValue({
      ok: true,
      asset: { type: "private", resourceType: "image", format: "jpg", bytes: 1000, width: 400, height: 400 },
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    (moderateImageContent as ReturnType<typeof vi.fn>).mockResolvedValue({ status: "PASS" });
    (screenGarmentSuitability as ReturnType<typeof vi.fn>).mockResolvedValue({ status: "PASS" });
    mockReserve().mockResolvedValue({ allowed: false, reason: "at_capacity", limit: 250 });

    const res: any = await action({
      request: addRequestAs(CUSTOMER_A, { publicId: ownId, photoConsentGiven: "true" }),
      params: {},
      context: {},
    } as any);

    expect(res.init.status).toBe(403);
    expect(res.data.error).toBe("Your closet is full. Remove some items to add new ones.");
    expect(mockDelete()).toHaveBeenCalledWith(ownId, "private");
    vi.unstubAllGlobals();
  });

  it("the ATOMIC reserveClosetSlot at_capacity rejection with limit===0 still deletes the already-verified asset and uses the upgrade-oriented message", async () => {
    const ownId = ownPublicId(CUSTOMER_A);
    mockEntitlement().mockResolvedValue({ allowed: true, limit: 0 });
    mockVerify().mockResolvedValue({
      ok: true,
      asset: { type: "private", resourceType: "image", format: "jpg", bytes: 1000, width: 400, height: 400 },
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    (moderateImageContent as ReturnType<typeof vi.fn>).mockResolvedValue({ status: "PASS" });
    (screenGarmentSuitability as ReturnType<typeof vi.fn>).mockResolvedValue({ status: "PASS" });
    mockReserve().mockResolvedValue({ allowed: false, reason: "at_capacity", limit: 0 });

    const res: any = await action({
      request: addRequestAs(CUSTOMER_A, { publicId: ownId, photoConsentGiven: "true" }),
      params: {},
      context: {},
    } as any);

    expect(res.init.status).toBe(403);
    expect(res.data.error).toBe("Closet access is included with nAia Membership. Subscribe to start adding pieces.");
    expect(mockDelete()).toHaveBeenCalledWith(ownId, "private");
    vi.unstubAllGlobals();
  });

  it("a customer record that no longer exists (deleted mid-session) is rejected as unauthenticated, not a crash", async () => {
    mockGetCustomer().mockResolvedValueOnce(CUSTOMER_A);
    mockFindCustomer().mockResolvedValueOnce(null);
    const res: any = await action({
      request: new Request("https://example.invalid/closet", {
        method: "POST",
        body: new URLSearchParams({ intent: "add" }),
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      }),
      params: {},
      context: {},
    } as any);
    expect(res.init.status).toBe(401);
  });
});
