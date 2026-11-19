// app/routes/api.cors-allowlist-hotfix-20261119.test.ts
//
// Follow-up to the 2026-11-16 CORS hotfix (api.outfit-history.jsx,
// api.outfit-rating.jsx — see api.outfit-security-hotfix-20261116.test.ts).
// A fresh audit of the same wildcard-CORS concern found 6 more authenticated
// customer-facing routes with the exact same unconditional
// "Access-Control-Allow-Origin: *", plus one staff-only internal dashboard
// (api.designer-dashboard.jsx) that had no legitimate cross-origin need at
// all and has had its CORS header removed entirely — not restricted,
// removed, matching every other requireStaffAccess-gated route's own
// convention (none of them set any CORS header).
//
// api.wardrobe-insights.jsx (the 6th customer-facing route found) exists
// only on main/production, not on this trunk lineage — not covered here;
// see the handoff note for that one.
//
// Same assertion shape as the 2026-11-16 file: production origin reflected
// back exactly, staging test-store origin reflected back exactly, an
// unrecognized origin gets NO Access-Control-Allow-Origin header (never a
// wildcard fallback), and a non-browser caller (no Origin header at all) is
// unaffected either way.
//
// Run: npx vitest run app/routes/api.cors-allowlist-hotfix-20261119.test.ts

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../customer-auth.server", () => ({
  authenticateCustomer: vi.fn(),
}));

vi.mock("../lib/naia-session.server", () => ({
  getCurrentNaiaCustomer: vi.fn(),
}));

vi.mock("../lib/staff-auth.server", () => ({
  requireStaffAccess: vi.fn(),
}));

vi.mock("../db.server", () => ({
  default: {
    closetItem: { findMany: vi.fn().mockResolvedValue([]) },
    postOutfitReview: { findMany: vi.fn().mockResolvedValue([]) },
    customer: { count: vi.fn().mockResolvedValue(0) },
    stylingEvent: { create: vi.fn().mockResolvedValue({}) },
  },
}));

// api.wishlist.jsx's full dependency graph — mocked the same way
// wishlist-analyze.behavioral.test.ts already does, since this test only
// exercises the plain (non ?action=analyze/outcome) loader/action path and
// never needs any of this logic, but the module still imports all of it at
// load time.
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
vi.mock("../lib/plan/entitlement.server", () => ({ checkEntitlement: vi.fn(), reserveBuySkipSlot: vi.fn(), reserveClosetSlot: vi.fn() }));
vi.mock("../lib/plan/plan-limits.server", () => ({ getMembershipAllowances: vi.fn().mockReturnValue({ closetItems: 50 }) }));
vi.mock("../lib/prisma-transient-retry.server", () => ({ isTransientDatabaseError: vi.fn().mockReturnValue(false) }));
vi.mock("../lib/closet-item-deletion.server.js", () => ({ deleteClosetItemWithImage: vi.fn() }));
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
vi.mock("../lib/photo-consent.server", () => ({ extractConsentGiven: vi.fn(), buildConsentStamp: vi.fn() }));

import { authenticateCustomer } from "../customer-auth.server";
import { getCurrentNaiaCustomer } from "../lib/naia-session.server";
import { requireStaffAccess } from "../lib/staff-auth.server";

import { loader as closetLoader, action as closetAction } from "./api.closet.jsx";
import { loader as confidenceDashboardLoader } from "./api.confidence-dashboard.jsx";
import { loader as customerProfileLoader } from "./api.customer-profile.jsx";
import { action as trackEventAction } from "./api.track_event.jsx";
import { loader as wishlistLoader, action as wishlistAction } from "./api.wishlist.jsx";
import { loader as designerDashboardLoader } from "./api.designer-dashboard.jsx";

const mockAuth = authenticateCustomer as unknown as ReturnType<typeof vi.fn>;
const mockNaiaCustomer = getCurrentNaiaCustomer as unknown as ReturnType<typeof vi.fn>;
const mockStaffAccess = requireStaffAccess as unknown as ReturnType<typeof vi.fn>;

const PROD_STOREFRONT_ORIGIN = "https://naiabynadine.com";
const STAGING_STOREFRONT_ORIGIN = "https://naia-test-store.myshopify.com";
const EVIL_ORIGIN = "https://evil.example.com";

function makeRequest(url: string, method: string, origin?: string) {
  const headers: Record<string, string> = {};
  if (origin) headers.Origin = origin;
  const init: RequestInit = { method, headers };
  if (method === "POST") {
    init.headers = { ...headers, "Content-Type": "application/json" };
    init.body = JSON.stringify({});
  }
  return { request: new Request(url, init), params: {}, context: {} } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({ customer: null }); // cheapest, unauthenticated path — all we need for a CORS-header check
  mockNaiaCustomer.mockResolvedValue(null);
  mockStaffAccess.mockRejectedValue(new Response("Forbidden", { status: 403 }));
});

// ── Routes restricted from wildcard to the approved allowlist ──────────────

const RESTRICTED_ROUTES: Array<{
  name: string;
  // Each route's real loader/action return type varies (some return a plain
  // Response, others react-router's DataWithResponseInit<T> via data()) —
  // every call site below immediately casts the result `as Response` before
  // reading .headers, so the array itself only needs to carry the call
  // through, not narrow its type.
  call: (origin?: string) => Promise<unknown>;
}> = [
  {
    name: "api.closet (GET)",
    call: (origin) => closetLoader(makeRequest("https://naia-stylist.vercel.app/api/closet", "GET", origin)),
  },
  {
    name: "api.closet (OPTIONS)",
    call: (origin) => closetAction(makeRequest("https://naia-stylist.vercel.app/api/closet", "OPTIONS", origin)),
  },
  {
    name: "api.confidence-dashboard",
    call: (origin) => confidenceDashboardLoader(makeRequest("https://naia-stylist.vercel.app/api/confidence-dashboard", "GET", origin)),
  },
  {
    name: "api.customer-profile",
    call: (origin) => customerProfileLoader(makeRequest("https://naia-stylist.vercel.app/api/customer-profile", "GET", origin)),
  },
  {
    name: "api.track_event",
    call: (origin) => trackEventAction(makeRequest("https://naia-stylist.vercel.app/api/track_event", "POST", origin)),
  },
  {
    name: "api.wishlist (GET, deprecated loader)",
    call: (origin) => wishlistLoader(makeRequest("https://naia-stylist.vercel.app/api/wishlist", "GET", origin)),
  },
  {
    name: "api.wishlist (POST action)",
    call: (origin) => wishlistAction(makeRequest("https://naia-stylist.vercel.app/api/wishlist", "POST", origin)),
  },
];

describe("CORS — 6 more routes restricted from wildcard to the approved allowlist (2026-11-19 follow-up)", () => {
  for (const route of RESTRICTED_ROUTES) {
    it(`${route.name}: a request from the production storefront origin gets that exact origin reflected back`, async () => {
      const res = (await route.call(PROD_STOREFRONT_ORIGIN)) as Response;
      expect(res.headers.get("Access-Control-Allow-Origin")).toBe(PROD_STOREFRONT_ORIGIN);
    });

    it(`${route.name}: a request from the approved staging test-store origin gets that exact origin reflected back`, async () => {
      const res = (await route.call(STAGING_STOREFRONT_ORIGIN)) as Response;
      expect(res.headers.get("Access-Control-Allow-Origin")).toBe(STAGING_STOREFRONT_ORIGIN);
    });

    it(`${route.name}: a request from an unrecognized origin gets NO Access-Control-Allow-Origin header — never a wildcard`, async () => {
      const res = (await route.call(EVIL_ORIGIN)) as Response;
      expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
      expect(res.headers.get("Access-Control-Allow-Origin")).not.toBe("*");
    });

    it(`${route.name}: a request with no Origin header at all (non-browser caller) gets no CORS header, and is otherwise unaffected`, async () => {
      const res = (await route.call(undefined)) as Response;
      expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
      expect(res.status).toBeLessThan(500); // still a normal, functioning response
    });
  }
});

// ── Staff-only route: CORS removed entirely, not restricted ────────────────

describe("CORS — api.designer-dashboard.jsx has NO Access-Control-Allow-Origin header at all, for any origin", () => {
  // These tests care about the loader's OWN final response — the one place
  // this fix actually touches — not an unrelated auth-rejection response, so
  // requireStaffAccess resolves successfully here, unlike the module-wide
  // default (rejected) used by the "still enforces" test below.
  beforeEach(() => {
    mockStaffAccess.mockResolvedValue({ shop: "test-shop.myshopify.com", accountOwner: true });
  });

  it("never sends a CORS header for the production storefront origin (this is a staff-only route, not a customer-facing one)", async () => {
    const res = (await designerDashboardLoader(
      makeRequest("https://naia-stylist.vercel.app/api/designer-dashboard", "GET", PROD_STOREFRONT_ORIGIN),
    )) as Response;
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("never sends a CORS header for any other origin either", async () => {
    const res = (await designerDashboardLoader(
      makeRequest("https://naia-stylist.vercel.app/api/designer-dashboard", "GET", EVIL_ORIGIN),
    )) as Response;
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("still enforces requireStaffAccess — removing CORS did not loosen authentication", async () => {
    mockStaffAccess.mockRejectedValueOnce(new Response("Forbidden", { status: 403 }));
    await expect(
      designerDashboardLoader(makeRequest("https://naia-stylist.vercel.app/api/designer-dashboard", "GET")),
    ).rejects.toBeInstanceOf(Response);
    expect(mockStaffAccess).toHaveBeenCalledTimes(1);
  });
});
