// app/routes/wishlist-analyze.behavioral.test.ts
//
// Behavioral (not source-text) coverage for POST /api/wishlist?action=analyze
// — the real server-side consent/ownership gate behind the Buy or Skip
// upload UI (buyskip._index.tsx has no server action of its own; the actual
// analysis endpoint is this one). Follows the same two-synthetic-customer
// house pattern as phase1-synthetic-integration.test.ts.
// validatePublicIdOwnership is the REAL, pure function — not mocked.
//
// Unlike the Closet routes, this file's consent check was ALREADY correctly
// ordered before ownership is confirmed — and, critically, does NOT delete
// anything on rejection (its own comment explains why: "so the asset is NOT
// deleted here"). These tests are a positive regression guard confirming
// that stays true, not a fix.
//
// Run: npx vitest run app/routes/wishlist-analyze.behavioral.test.ts

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../lib/naia-session.server", () => ({
  getCurrentNaiaCustomer: vi.fn(),
}));

vi.mock("../db.server", () => ({
  default: {
    buyOrSkipAnalysis: { create: vi.fn(), findFirst: vi.fn() },
    journeyEvent: { create: vi.fn().mockResolvedValue({}) },
  },
}));

vi.mock("../lib/cloudinary-admin.server", async () => {
  const actual = await vi.importActual<typeof import("../lib/cloudinary-admin.server")>(
    "../lib/cloudinary-admin.server",
  );
  return {
    validatePublicIdOwnership: actual.validatePublicIdOwnership,
    getCloudinaryConfig: vi.fn().mockReturnValue({ cloudName: "test", apiKey: "test", apiSecret: "test" }),
    verifyCloudinaryAsset: vi.fn(),
    buildPrivateDownloadUrl: vi.fn().mockReturnValue("https://example.invalid/download"),
    deleteCloudinaryAsset: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock("../lib/plan/entitlement.server", () => ({ checkEntitlement: vi.fn() }));
vi.mock("../lib/image-moderation.server", () => ({ moderateImageContent: vi.fn() }));
vi.mock("../lib/image-suitability.server", () => ({ screenGarmentSuitability: vi.fn() }));
vi.mock("../lib/ai/taste-extraction.server", () => ({ extractBuySkipEvidence: vi.fn() }));
vi.mock("../lib/ai/taste-reconcile.server", () => ({ writeSourceEvidence: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../lib/ai/journey-events.server", () => ({
  emitBuySkipSubmitted: vi.fn().mockReturnValue({}),
  recordJourneyEventAwaited: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../lib/ai/wardrobe-intelligence.server", () => ({ loadWardrobeIntelligence: vi.fn().mockResolvedValue(null) }));
vi.mock("../lib/ai/customer-intelligence-resolver.server", () => ({ resolveCustomerIntelligence: vi.fn().mockResolvedValue(null) }));

import { getCurrentNaiaCustomer } from "../lib/naia-session.server";
import { verifyCloudinaryAsset, deleteCloudinaryAsset } from "../lib/cloudinary-admin.server";
import { action } from "./api.wishlist.jsx";

const mockGetCustomer = () => getCurrentNaiaCustomer as ReturnType<typeof vi.fn>;
const mockVerify = () => verifyCloudinaryAsset as ReturnType<typeof vi.fn>;
const mockDelete = () => deleteCloudinaryAsset as ReturnType<typeof vi.fn>;

const CUSTOMER_A = { id: "customer-A", shopifyCustomerId: "gid://shopify/Customer/A", membershipStatus: "NONE" };
const CUSTOMER_B = { id: "customer-B", shopifyCustomerId: "gid://shopify/Customer/B", membershipStatus: "NONE" };

function ownPublicId(customer: typeof CUSTOMER_A) {
  return `naia-wardrobe/${customer.id}/synthetic-asset.jpg`;
}

function analyzeRequestAs(customer: typeof CUSTOMER_A | null, body: Record<string, unknown>) {
  mockGetCustomer().mockResolvedValueOnce(customer);
  return new Request("https://example.invalid/api/wishlist?action=analyze", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("api.wishlist action=analyze — authentication", () => {
  it("rejects an unauthenticated request with 401 before touching Cloudinary", async () => {
    const res: any = await action({ request: analyzeRequestAs(null, {}), params: {}, context: {} } as any);
    expect(res.init.status).toBe(401);
    expect(mockVerify()).not.toHaveBeenCalled();
  });

  it("rejects the shared guest placeholder customer as unauthenticated", async () => {
    const GUEST = { id: "guest-id", shopifyCustomerId: "guest" };
    const res: any = await action({ request: analyzeRequestAs(GUEST as any, {}), params: {}, context: {} } as any);
    expect(res.init.status).toBe(401);
  });
});

describe("api.wishlist action=analyze — consent enforced server-side, never deletes on rejection", () => {
  it("withheld consent is rejected with 400, and NOTHING is deleted — not even the customer's own asset", async () => {
    const ownId = ownPublicId(CUSTOMER_A);
    const res: any = await action({
      request: analyzeRequestAs(CUSTOMER_A, { publicId: ownId, photoConsentGiven: false }),
      params: {},
      context: {},
    } as any);
    expect(res.init.status).toBe(400);
    expect(res.data.error).toBe("consent_required");
    expect(mockDelete()).not.toHaveBeenCalled();
    expect(mockVerify()).not.toHaveBeenCalled();
  });

  it("withheld consent on a FORGED publicId is still just rejected — no deletion, no ownership leak", async () => {
    const forgedPublicId = ownPublicId(CUSTOMER_A);
    const res: any = await action({
      request: analyzeRequestAs(CUSTOMER_B, { publicId: forgedPublicId, photoConsentGiven: false }),
      params: {},
      context: {},
    } as any);
    expect(res.init.status).toBe(400);
    expect(res.data.error).toBe("consent_required");
    expect(mockDelete()).not.toHaveBeenCalled();
  });
});

describe("api.wishlist action=analyze — ownership enforced from session identity, never the request body", () => {
  it("a forged publicId belonging to another customer is rejected with 403, once consent is given", async () => {
    const forgedPublicId = ownPublicId(CUSTOMER_A);
    const res: any = await action({
      request: analyzeRequestAs(CUSTOMER_B, { publicId: forgedPublicId, photoConsentGiven: true }),
      params: {},
      context: {},
    } as any);
    expect(res.init.status).toBe(403);
    expect(res.data.error).toBe("asset_not_owned");
    expect(mockVerify()).not.toHaveBeenCalled();
  });

  it("a client-supplied customerId in the body is ignored — ownership is derived from the session only", async () => {
    const forgedPublicId = ownPublicId(CUSTOMER_A);
    const res: any = await action({
      request: analyzeRequestAs(CUSTOMER_B, {
        publicId: forgedPublicId,
        photoConsentGiven: true,
        customerId: CUSTOMER_A.id, // attacker tries to claim A's identity in the body
      }),
      params: {},
      context: {},
    } as any);
    expect(res.init.status).toBe(403);
    expect(res.data.error).toBe("asset_not_owned");
  });

  it("the customer's own asset, with consent, passes ownership and proceeds to verification", async () => {
    const ownId = ownPublicId(CUSTOMER_A);
    mockVerify().mockResolvedValue({ ok: false, errorCode: "NOT_FOUND" }); // stop here deliberately
    const res: any = await action({
      request: analyzeRequestAs(CUSTOMER_A, { publicId: ownId, photoConsentGiven: true }),
      params: {},
      context: {},
    } as any);
    expect(mockVerify()).toHaveBeenCalledWith(ownId, "private");
    expect(res.data.error).toBe("asset_not_found");
  });
});

describe("api.wishlist action=analyze — failure paths, no real database or image provider contacted", () => {
  it("a missing publicId is rejected with 400 before consent is even checked", async () => {
    const res: any = await action({
      request: analyzeRequestAs(CUSTOMER_A, { photoConsentGiven: true }),
      params: {},
      context: {},
    } as any);
    expect(res.init.status).toBe(400);
    expect(res.data.error).toBe("image_required");
  });

  it("a malformed JSON body is rejected with 400, not a 500 crash", async () => {
    mockGetCustomer().mockResolvedValueOnce(CUSTOMER_A);
    const req = new Request("https://example.invalid/api/wishlist?action=analyze", {
      method: "POST",
      body: "{not json",
    });
    const res: any = await action({ request: req, params: {}, context: {} } as any);
    expect(res.init.status).toBe(400);
  });
});
