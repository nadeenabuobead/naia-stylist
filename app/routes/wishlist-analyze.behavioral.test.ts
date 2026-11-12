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
    customer: { findUnique: vi.fn().mockResolvedValue({ closetItems: [] }) },
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

vi.mock("../lib/plan/entitlement.server", () => ({ checkEntitlement: vi.fn(), reserveBuySkipSlot: vi.fn() }));
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
import { checkEntitlement, reserveBuySkipSlot } from "../lib/plan/entitlement.server";
import { moderateImageContent } from "../lib/image-moderation.server";
import { screenGarmentSuitability } from "../lib/image-suitability.server";
import { action } from "./api.wishlist.jsx";

const mockGetCustomer = () => getCurrentNaiaCustomer as ReturnType<typeof vi.fn>;
const mockVerify = () => verifyCloudinaryAsset as ReturnType<typeof vi.fn>;
const mockDelete = () => deleteCloudinaryAsset as ReturnType<typeof vi.fn>;
const mockModeration = () => moderateImageContent as ReturnType<typeof vi.fn>;
const mockSuitability = () => screenGarmentSuitability as ReturnType<typeof vi.fn>;

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
  // This file tests consent/ownership behavior, not entitlement enforcement
  // (covered separately in entitlement.test.ts) — enforcement is
  // unconditional now (fix/stripe-clerk-phase1-security), so these two need
  // a passing default or every test would fail at the quota guard before
  // ever reaching the behavior under test.
  (checkEntitlement as ReturnType<typeof vi.fn>).mockResolvedValue({ allowed: true });
  (reserveBuySkipSlot as ReturnType<typeof vi.fn>).mockResolvedValue({ allowed: true, record: { id: "mock-analysis" } });
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

// fix/cloudinary-asset-lifecycle + fix/stripe-clerk-phase1-security (merged
// 2026-11-12): reserveBuySkipSlot's own Serializable transaction now claim-
// checks the asset via assertPublicIdAvailable before creating the row. A
// route-level test (not just entitlement.test.ts's unit coverage of
// reserveBuySkipSlot itself) that this still surfaces as HTTP 409 all the
// way through the real action — the exact integration-reconciliation point
// in api.wishlist.jsx this file's merge touched.
describe("api.wishlist action=analyze — asset-claim conflict (asset_pending_deletion) surfaces as 409", () => {
  it("reserveBuySkipSlot returning asset_pending_deletion returns 409 asset_unavailable, all the way through the real action", async () => {
    mockVerify().mockResolvedValue({
      ok: true,
      asset: { type: "private", resourceType: "image", format: "jpg", bytes: 100_000, width: 800, height: 800 },
    });
    mockModeration().mockResolvedValue({ status: "PASS" });
    mockSuitability().mockResolvedValue({ status: "PASS" });
    // "ok: false" makes the magic-byte Range fetch a no-op (route only runs
    // the byte check when the fetch itself succeeds); the second URL is the
    // real Anthropic call this route makes with no SDK — see api.wishlist.jsx.
    vi.stubGlobal("fetch", vi.fn(async (url: any) => {
      if (typeof url === "string" && url.includes("api.anthropic.com")) {
        return {
          ok: true,
          json: async () => ({
            content: [{
              text: JSON.stringify({
                itemType: "Blouse",
                detectedColor: "BLUE",
                verdict: "BUY",
                confidence: 80,
                styleDNAMatch: "test",
                detailedAnalysis: { silhouette: "test", color: "test", versatility: "test", dressingRequirementsCheck: "test" },
                occasionFit: null,
                whatLikeEval: null,
                concernEval: null,
                closetPairings: [],
                fillsGap: null,
                occasions: [],
                productSnapshot: {
                  observedSilhouette: null, observedFitProfile: null, observedFormality: null,
                  observedSleeveLength: null, observedNecklineCoverage: null,
                  observedShoulderCoverage: null, observedMidriffExposed: null,
                  observedMaterial: null, observedPattern: null, observationConfidence: "low",
                },
                beforeYouBuy: ["a", "b"],
                buyIf: "x",
                skipIf: "y",
                betterDirection: null,
                finalThought: "z",
              }),
            }],
          }),
        };
      }
      return { ok: false };
    }));
    (reserveBuySkipSlot as ReturnType<typeof vi.fn>).mockResolvedValue({ allowed: false, reason: "asset_pending_deletion" });

    const ownId = ownPublicId(CUSTOMER_A);
    const res: any = await action({
      // "Accessory" is outside WARDROBE_CONTEXT_ELIGIBLE_CATEGORIES, keeping
      // this test from also having to mock loadWardrobeIntelligence's shape.
      request: analyzeRequestAs(CUSTOMER_A, { publicId: ownId, photoConsentGiven: true, category: "Accessory" }),
      params: {},
      context: {},
    } as any);

    expect(res.init.status).toBe(409);
    expect(res.data.error).toBe("asset_unavailable");
    expect(mockDelete()).not.toHaveBeenCalled();
  });
});
