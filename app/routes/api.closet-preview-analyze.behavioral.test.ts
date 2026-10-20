// app/routes/api.closet-preview-analyze.behavioral.test.ts
//
// Behavioral (not source-text) coverage for POST /api/closet-preview-analyze,
// following the two-synthetic-customer house pattern established by
// phase1-synthetic-integration.test.ts / settings-behavioral.test.ts. The
// REAL action is invoked; validatePublicIdOwnership is the REAL, pure
// function (no mock needed — it is a synchronous string-prefix check with
// no I/O). Everything that touches Cloudinary or an AI provider is mocked;
// no real network call, no real database.
//
// Closes a real defect found while writing these tests: the consent-
// rejection branch called deleteCloudinaryAsset BEFORE the ownership check
// ran, so a forged/guessed publicId belonging to another customer, combined
// with withheld consent, would delete that other customer's asset without
// ever confirming ownership. Fixed by reordering the two checks (see
// api.closet-preview-analyze.ts) — the regression test for that fix is
// "a forged publicId + withheld consent is rejected on ownership, and the
// asset is never deleted" below.
//
// Run: npx vitest run app/routes/api.closet-preview-analyze.behavioral.test.ts

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/naia-session.server", () => ({
  getCurrentNaiaCustomer: vi.fn(),
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

vi.mock("~/lib/image-moderation.server", () => ({
  moderateImageContent: vi.fn(),
}));

vi.mock("~/lib/image-suitability.server", () => ({
  screenGarmentSuitability: vi.fn(),
}));

vi.mock("~/lib/ai/closet-preview-analysis.server", () => ({
  previewAnalyzeGarment: vi.fn(),
}));

import { getCurrentNaiaCustomer } from "~/lib/naia-session.server";
import {
  verifyCloudinaryAsset,
  deleteCloudinaryAsset,
} from "~/lib/cloudinary-admin.server";
import { moderateImageContent } from "~/lib/image-moderation.server";
import { screenGarmentSuitability } from "~/lib/image-suitability.server";
import { previewAnalyzeGarment } from "~/lib/ai/closet-preview-analysis.server";
import { action } from "./api.closet-preview-analyze";

const mockGetCustomer = () => getCurrentNaiaCustomer as ReturnType<typeof vi.fn>;
const mockVerify = () => verifyCloudinaryAsset as ReturnType<typeof vi.fn>;
const mockDelete = () => deleteCloudinaryAsset as ReturnType<typeof vi.fn>;
const mockModerate = () => moderateImageContent as ReturnType<typeof vi.fn>;
const mockSuitability = () => screenGarmentSuitability as ReturnType<typeof vi.fn>;
const mockPreview = () => previewAnalyzeGarment as ReturnType<typeof vi.fn>;

const CUSTOMER_A = { id: "customer-A" };
const CUSTOMER_B = { id: "customer-B" };

function ownPublicId(customer: typeof CUSTOMER_A) {
  return `naia-wardrobe/${customer.id}/synthetic-asset.jpg`;
}

function postAs(customer: typeof CUSTOMER_A | null, body: Record<string, unknown>) {
  mockGetCustomer().mockResolvedValueOnce(customer);
  return new Request("https://example.invalid/api/closet-preview-analyze", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("api.closet-preview-analyze action — authentication", () => {
  it("rejects an unauthenticated request with 401 before touching Cloudinary", async () => {
    const res: any = await action({ request: postAs(null, {}), params: {}, context: {} } as any);
    expect(res.init.status).toBe(401);
    expect(mockVerify()).not.toHaveBeenCalled();
    expect(mockDelete()).not.toHaveBeenCalled();
  });
});

describe("api.closet-preview-analyze action — ownership enforced before any deletion", () => {
  it("a forged publicId belonging to another customer is rejected on ownership, and NEVER deleted", async () => {
    const forgedPublicId = ownPublicId(CUSTOMER_A);
    const res: any = await action({
      request: postAs(CUSTOMER_B, { publicId: forgedPublicId, photoConsentGiven: false }),
      params: {},
      context: {},
    } as any);
    expect(res.init.status).toBe(400);
    expect(res.data.error).toBe("Photo does not belong to this account.");
    // The critical regression assertion: customer A's asset must never be
    // deleted as a side effect of customer B's request, consent or not.
    expect(mockDelete()).not.toHaveBeenCalled();
  });

  it("a forged publicId is rejected even when consent IS given — ownership still comes first", async () => {
    const forgedPublicId = ownPublicId(CUSTOMER_A);
    const res: any = await action({
      request: postAs(CUSTOMER_B, { publicId: forgedPublicId, photoConsentGiven: true }),
      params: {},
      context: {},
    } as any);
    expect(res.init.status).toBe(400);
    expect(res.data.error).toBe("Photo does not belong to this account.");
    expect(mockVerify()).not.toHaveBeenCalled();
  });
});

describe("api.closet-preview-analyze action — consent enforced server-side, not just the frontend checkbox", () => {
  it("withheld consent on the customer's OWN asset is rejected, and that asset IS deleted (no orphan)", async () => {
    const ownId = ownPublicId(CUSTOMER_A);
    const res: any = await action({
      request: postAs(CUSTOMER_A, { publicId: ownId, photoConsentGiven: false }),
      params: {},
      context: {},
    } as any);
    expect(res.init.status).toBe(400);
    expect(res.data.error).toBe("Photo consent is required before analysis.");
    expect(mockDelete()).toHaveBeenCalledWith(ownId, "private");
    // Never reaches moderation/suitability/AI — consent is the gate, not advisory.
    expect(mockVerify()).not.toHaveBeenCalled();
    expect(mockModerate()).not.toHaveBeenCalled();
  });

  it("missing photoConsentGiven entirely (not just false) is treated as no consent", async () => {
    const ownId = ownPublicId(CUSTOMER_A);
    const res: any = await action({
      request: postAs(CUSTOMER_A, { publicId: ownId }),
      params: {},
      context: {},
    } as any);
    expect(res.data.error).toBe("Photo consent is required before analysis.");
  });

  it("a truthy but non-boolean consent value (e.g. the string 'true') is rejected — only literal true counts", async () => {
    const ownId = ownPublicId(CUSTOMER_A);
    const res: any = await action({
      request: postAs(CUSTOMER_A, { publicId: ownId, photoConsentGiven: "true" }),
      params: {},
      context: {},
    } as any);
    expect(res.data.error).toBe("Photo consent is required before analysis.");
  });

  it("consent given on the customer's own asset proceeds past the consent gate to verification", async () => {
    const ownId = ownPublicId(CUSTOMER_A);
    mockVerify().mockResolvedValue({ ok: true, asset: { type: "private", format: "jpg" } });
    mockModerate().mockResolvedValue({ status: "SAFETY_PASS" });
    mockSuitability().mockResolvedValue({ status: "PASS" });
    mockPreview().mockResolvedValue({ category: "TOPS" });

    const res: any = await action({
      request: postAs(CUSTOMER_A, { publicId: ownId, photoConsentGiven: true }),
      params: {},
      context: {},
    } as any);

    expect(mockVerify()).toHaveBeenCalledWith(ownId, "private");
    expect(mockDelete()).not.toHaveBeenCalled();
    expect(res.data).toEqual({ category: "TOPS" });
  });
});

describe("api.closet-preview-analyze action — failure paths, no real provider contacted", () => {
  it("content-moderation rejection deletes the (owned) asset and signals requiresReupload", async () => {
    const ownId = ownPublicId(CUSTOMER_A);
    mockVerify().mockResolvedValue({ ok: true, asset: { type: "private", format: "jpg" } });
    mockModerate().mockResolvedValue({ status: "SAFETY_REJECT" });

    const res: any = await action({
      request: postAs(CUSTOMER_A, { publicId: ownId, photoConsentGiven: true }),
      params: {},
      context: {},
    } as any);

    expect(res.init.status).toBe(422);
    expect(res.data.requiresReupload).toBe(true);
    expect(mockDelete()).toHaveBeenCalledWith(ownId, "private");
  });

  it("moderation-service-unavailable deletes the asset and returns 503, never calls the AI analyzer", async () => {
    const ownId = ownPublicId(CUSTOMER_A);
    mockVerify().mockResolvedValue({ ok: true, asset: { type: "private", format: "jpg" } });
    mockModerate().mockResolvedValue({ status: "MODERATION_UNAVAILABLE" });

    const res: any = await action({
      request: postAs(CUSTOMER_A, { publicId: ownId, photoConsentGiven: true }),
      params: {},
      context: {},
    } as any);

    expect(res.init.status).toBe(503);
    expect(mockPreview()).not.toHaveBeenCalled();
  });

  it("an asset that fails Cloudinary verification is rejected without calling moderation", async () => {
    const ownId = ownPublicId(CUSTOMER_A);
    mockVerify().mockResolvedValue({ ok: false });

    const res: any = await action({
      request: postAs(CUSTOMER_A, { publicId: ownId, photoConsentGiven: true }),
      params: {},
      context: {},
    } as any);

    expect(res.init.status).toBe(400);
    expect(mockModerate()).not.toHaveBeenCalled();
  });

  it("a missing publicId is rejected with 400 before any auth-adjacent service call", async () => {
    const res: any = await action({
      request: postAs(CUSTOMER_A, { photoConsentGiven: true }),
      params: {},
      context: {},
    } as any);
    expect(res.init.status).toBe(400);
    expect(res.data.error).toBe("publicId required");
  });

  it("a malformed JSON body is rejected with 400, not a 500 crash", async () => {
    mockGetCustomer().mockResolvedValueOnce(CUSTOMER_A);
    const req = new Request("https://example.invalid/api/closet-preview-analyze", {
      method: "POST",
      body: "{not json",
    });
    const res: any = await action({ request: req, params: {}, context: {} } as any);
    expect(res.init.status).toBe(400);
  });
});
