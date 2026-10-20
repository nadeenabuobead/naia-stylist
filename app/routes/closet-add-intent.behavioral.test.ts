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
    closetItem: { create: vi.fn() },
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
import { checkEntitlement } from "~/lib/plan/entitlement.server";
import { action } from "./closet._index";

const mockGetCustomer = () => getCurrentNaiaCustomer as ReturnType<typeof vi.fn>;
const mockFindCustomer = () => (prisma as any).customer.findUnique as ReturnType<typeof vi.fn>;
const mockVerify = () => verifyCloudinaryAsset as ReturnType<typeof vi.fn>;
const mockDelete = () => deleteCloudinaryAsset as ReturnType<typeof vi.fn>;
const mockEntitlement = () => checkEntitlement as ReturnType<typeof vi.fn>;

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

    expect(mockEntitlement()).toHaveBeenCalledWith(CUSTOMER_A.id, CUSTOMER_A.membershipStatus, "closet");
    expect(res.init.status).toBe(403);
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
