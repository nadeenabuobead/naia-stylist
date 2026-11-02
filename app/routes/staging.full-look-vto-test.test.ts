// app/routes/staging.full-look-vto-test.test.ts
//
// Fully mocked — zero real DB, zero real FASHN network call (the route's own
// internal mock fetch handles every FASHN interaction; this test file mocks
// only the session/WI-loader/model/ownership layers around it, same
// convention as settings-action-identity.test.ts).
//
// Run: npx vitest run app/routes/staging.full-look-vto-test.test.ts

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/naia-session.server", () => ({
  getCurrentNaiaCustomer: vi.fn(),
}));
vi.mock("~/lib/ai/wardrobe-intelligence.server", () => ({
  loadWardrobeIntelligence: vi.fn(),
}));
vi.mock("~/lib/ai/my-naia-model.server", () => ({
  loadNaiaModel: vi.fn(),
  computeModelReadinessFromRecord: vi.fn(),
}));
vi.mock("~/db.server", () => ({
  default: { onboardingProfile: { findUnique: vi.fn() } },
}));
vi.mock("~/lib/ai/poc-wi-combination-resolver.server", () => ({
  resolveOwnedWiGarments: vi.fn(),
}));
vi.mock("~/lib/ai/styleme-anchor.server", () => ({
  resolveClosetAnchor: vi.fn(),
}));
vi.mock("~/lib/image-suitability.server", () => ({
  screenGarmentSuitability: vi.fn(),
}));
vi.mock("~/lib/plan/plan-limits.server", () => ({
  getMembershipAllowances: vi.fn(),
}));
vi.mock("~/lib/plan/entitlement.server", () => ({
  getEntitlementSummary: vi.fn(),
}));

import { getCurrentNaiaCustomer } from "~/lib/naia-session.server";
import { loadWardrobeIntelligence } from "~/lib/ai/wardrobe-intelligence.server";
import { loadNaiaModel, computeModelReadinessFromRecord } from "~/lib/ai/my-naia-model.server";
import { resolveOwnedWiGarments } from "~/lib/ai/poc-wi-combination-resolver.server";
import { resolveClosetAnchor } from "~/lib/ai/styleme-anchor.server";
import { screenGarmentSuitability } from "~/lib/image-suitability.server";
import { getMembershipAllowances } from "~/lib/plan/plan-limits.server";
import { getEntitlementSummary } from "~/lib/plan/entitlement.server";
import prisma from "~/db.server";
import { loader, action, isAuthorizedStagingTestAccount } from "./staging.full-look-vto-test";

const mockCustomer = () => getCurrentNaiaCustomer as ReturnType<typeof vi.fn>;
const mockLoadWI = () => loadWardrobeIntelligence as ReturnType<typeof vi.fn>;
const mockLoadModel = () => loadNaiaModel as ReturnType<typeof vi.fn>;
const mockReadiness = () => computeModelReadinessFromRecord as ReturnType<typeof vi.fn>;
const mockResolveOwned = () => resolveOwnedWiGarments as ReturnType<typeof vi.fn>;
const mockResolveAnchor = () => resolveClosetAnchor as ReturnType<typeof vi.fn>;
const mockScreenSuitability = () => screenGarmentSuitability as ReturnType<typeof vi.fn>;
const mockAllowances = () => getMembershipAllowances as ReturnType<typeof vi.fn>;
const mockEntitlementSummary = () => getEntitlementSummary as ReturnType<typeof vi.fn>;
const mockProfileFind = () => (prisma as unknown as { onboardingProfile: { findUnique: ReturnType<typeof vi.fn> } }).onboardingProfile.findUnique;

const SARA = { id: "sara-cust-1", shopifyCustomerId: "sara-shop-1", membershipStatus: "MEMBER" };

function entitlementSummary(completed: number, inFlight: number) {
  return { vto: { monthlyCompleted: completed, monthlyInFlight: inFlight } };
}

const EXPECTED_PAIRING = {
  id: "pair-expected",
  reason: "A work look",
  garmentIds: ["g-blazer", "g-shirt", "g-trousers"],
};

const EXPECTED_RESOLVED = [
  { closetItemId: "g-blazer", name: "Beige Tailored Blazer", category: "OUTERWEAR", subcategory: null, slot: "outerwear" },
  { closetItemId: "g-shirt", name: "Blue Chambray Button-Up Shirt", category: "TOPS", subcategory: null, slot: "top" },
  { closetItemId: "g-trousers", name: "Beige Tailored Trousers", category: "BOTTOMS", subcategory: null, slot: "bottom" },
];

// A different, unrelated 3-garment Work candidate — used to prove the route
// never substitutes "whatever ranks" for the one named combination.
const OTHER_PAIRING = { id: "pair-other", reason: "Another work look", garmentIds: ["g-x", "g-y", "g-z"] };
const OTHER_RESOLVED = [
  { closetItemId: "g-x", name: "Black Pencil Skirt", category: "BOTTOMS", subcategory: null, slot: "bottom" },
  { closetItemId: "g-y", name: "White Silk Camisole", category: "TOPS", subcategory: null, slot: "top" },
  { closetItemId: "g-z", name: "Grey Wool Cardigan", category: "OUTERWEAR", subcategory: null, slot: "outerwear" },
];

const READY_MODEL = { id: "model-1", bodyModerationStatus: "APPROVED" };

function wiBundle(workPairings: Array<typeof EXPECTED_PAIRING> | undefined) {
  return { intelligence: { pairings: { bestByRegister: { work: workPairings } } } };
}

function formRequest(fields: Record<string, string> = {}) {
  const fd = new FormData();
  const withDefaults = {
    consent: "yes",
    virtualTryOnConsentAt: new Date().toISOString(),
    ...fields,
  };
  for (const [k, v] of Object.entries(withDefaults)) fd.set(k, v);
  return { formData: () => Promise.resolve(fd) } as unknown as Request;
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.NAIA_PROJECT_VARIANT;
  delete process.env.FULL_LOOK_VTO_TEST_CUSTOMER_IDS;
  mockProfileFind().mockResolvedValue(null);
  mockLoadModel().mockResolvedValue(READY_MODEL);
  mockReadiness().mockReturnValue({ hasFullBodyPhoto: true, isReadyForTryOn: true });
});

describe("isAuthorizedStagingTestAccount — pure gate", () => {
  it("GT.1 — false outside staging even when listed", () => {
    process.env.FULL_LOOK_VTO_TEST_CUSTOMER_IDS = "sara-shop-1";
    expect(isAuthorizedStagingTestAccount(SARA)).toBe(false);
  });
  it("GT.2 — false when the allowlist is unset, even in staging", () => {
    process.env.NAIA_PROJECT_VARIANT = "staging";
    expect(isAuthorizedStagingTestAccount(SARA)).toBe(false);
  });
  it("GT.3 — false when staging but not on the allowlist", () => {
    process.env.NAIA_PROJECT_VARIANT = "staging";
    process.env.FULL_LOOK_VTO_TEST_CUSTOMER_IDS = "someone-else";
    expect(isAuthorizedStagingTestAccount(SARA)).toBe(false);
  });
  it("GT.4 — true when staging and matched by shopifyCustomerId", () => {
    process.env.NAIA_PROJECT_VARIANT = "staging";
    process.env.FULL_LOOK_VTO_TEST_CUSTOMER_IDS = "someone-else, sara-shop-1";
    expect(isAuthorizedStagingTestAccount(SARA)).toBe(true);
  });
  it("GT.5 — true when staging and matched by internal id", () => {
    process.env.NAIA_PROJECT_VARIANT = "staging";
    process.env.FULL_LOOK_VTO_TEST_CUSTOMER_IDS = "sara-cust-1";
    expect(isAuthorizedStagingTestAccount(SARA)).toBe(true);
  });
  it("GT.16 — still false when NAIA_PROJECT_VARIANT is explicitly \"production\", not merely absent", () => {
    process.env.NAIA_PROJECT_VARIANT = "production";
    process.env.FULL_LOOK_VTO_TEST_CUSTOMER_IDS = "sara-shop-1, sara-cust-1";
    expect(isAuthorizedStagingTestAccount(SARA)).toBe(false);
  });
});

describe("loader — metadata + readiness only, never generation", () => {
  beforeEach(() => {
    process.env.NAIA_PROJECT_VARIANT = "staging";
    process.env.FULL_LOOK_VTO_TEST_CUSTOMER_IDS = "sara-shop-1";
    mockCustomer().mockResolvedValue(SARA);
  });

  it("GT.6 — 404s when not authenticated", async () => {
    mockCustomer().mockResolvedValue(null);
    await expect(loader({ request: {} as Request } as never)).rejects.toMatchObject({ status: 404 });
  });

  it("GT.7 — 404s when authenticated but not on the allowlist", async () => {
    mockCustomer().mockResolvedValue({ id: "stranger", shopifyCustomerId: "stranger-shop" });
    await expect(loader({ request: {} as Request } as never)).rejects.toMatchObject({ status: 404 });
  });

  it("GT.8 — returns the one named combination's garments, ownership-verified, sorted bottom→top→outerwear", async () => {
    mockLoadWI().mockResolvedValue(wiBundle([EXPECTED_PAIRING]));
    mockResolveOwned().mockResolvedValue(EXPECTED_RESOLVED);

    const res = await loader({ request: {} as Request } as never);
    const body = res.data;

    expect(body.ok).toBe(true);
    if (!body.ok) throw new Error("unreachable");
    expect(body.garments.map((g) => g.name)).toEqual([
      "Beige Tailored Trousers",
      "Blue Chambray Button-Up Shirt",
      "Beige Tailored Blazer",
    ]);
    expect(body.modelReady).toBe(true);
    expect(mockResolveOwned()).toHaveBeenCalledWith("sara-cust-1", EXPECTED_PAIRING.garmentIds);
    for (const g of body.garments) {
      expect("imageUrl" in g).toBe(false);
      expect("productImageUrl" in g).toBe(false);
    }
  });

  it("GT.9 — reports expected_combination_not_found when no Work pairing exists at all", async () => {
    mockLoadWI().mockResolvedValue(wiBundle(undefined));
    const res = await loader({ request: {} as Request } as never);
    const body = res.data;
    expect(body).toEqual({ ok: false, reason: "expected_combination_not_found" });
    expect(mockResolveOwned()).not.toHaveBeenCalled();
  });

  it("GT.17 — never substitutes a different-ranked Work outfit for the one named combination", async () => {
    // OTHER_PAIRING ranks first; the expected combination isn't present at all.
    mockLoadWI().mockResolvedValue(wiBundle([OTHER_PAIRING]));
    mockResolveOwned().mockResolvedValue(OTHER_RESOLVED);
    const res = await loader({ request: {} as Request } as never);
    const body = res.data;
    expect(body).toEqual({ ok: false, reason: "expected_combination_not_found" });
  });

  it("GT.18 — finds the named combination even when it isn't the top-ranked candidate", async () => {
    // OTHER_PAIRING ranks first (index 0); EXPECTED_PAIRING ranks second.
    mockLoadWI().mockResolvedValue(wiBundle([OTHER_PAIRING, EXPECTED_PAIRING]));
    mockResolveOwned().mockImplementation((_customerId: string, ids: string[]) =>
      Promise.resolve(ids === OTHER_PAIRING.garmentIds ? OTHER_RESOLVED : EXPECTED_RESOLVED),
    );
    const res = await loader({ request: {} as Request } as never);
    const body = res.data;
    expect(body.ok).toBe(true);
    if (!body.ok) throw new Error("unreachable");
    expect(body.garments.map((g) => g.name)).toContain("Beige Tailored Blazer");
  });

  it("GT.10 — fails closed when ownership re-verification doesn't match", async () => {
    mockLoadWI().mockResolvedValue(wiBundle([EXPECTED_PAIRING]));
    mockResolveOwned().mockResolvedValue(null);
    const res = await loader({ request: {} as Request } as never);
    const body = res.data;
    expect(body).toEqual({ ok: false, reason: "ownership_check_failed" });
  });
});

describe("action — the only path that generates anything", () => {
  beforeEach(() => {
    process.env.NAIA_PROJECT_VARIANT = "staging";
    process.env.FULL_LOOK_VTO_TEST_CUSTOMER_IDS = "sara-shop-1";
    mockCustomer().mockResolvedValue(SARA);
    mockLoadWI().mockResolvedValue(wiBundle([EXPECTED_PAIRING]));
    mockResolveOwned().mockResolvedValue(EXPECTED_RESOLVED);
    // Default: every garment resolves a real-shaped (but entirely mock) image
    // URL and passes screening. Individual tests below override these to
    // exercise each failure mode.
    mockResolveAnchor().mockImplementation((_customerId: string, closetItemId: string) =>
      Promise.resolve({ type: "closet", id: closetItemId, imageUrl: `https://mock.example/${closetItemId}.jpg` }),
    );
    mockScreenSuitability().mockResolvedValue({ status: "PASS" });
    // Default: plenty of room for the whole 3-step chain (MEMBER allowance,
    // zero prior usage). Individual tests below override these.
    mockAllowances().mockReturnValue({ vtoPerMonth: 10 });
    mockEntitlementSummary().mockResolvedValue(entitlementSummary(0, 0));
    delete process.env.VTO_MONTHLY_LIMIT_OVERRIDE;
  });

  it("GT.11 — refuses without consent=yes, and never even re-resolves ownership", async () => {
    const res = await action({ request: formRequest({ consent: "" }) } as never);
    expect(res.init?.status).toBe(400);
    const body = res.data;
    expect(body).toEqual({ ok: false, reason: "consent_required" });
    expect(mockResolveOwned()).not.toHaveBeenCalled();
  });

  it("GT.19 — refuses without a consent timestamp, even with consent=yes", async () => {
    const fd = new FormData();
    fd.set("consent", "yes"); // deliberately no virtualTryOnConsentAt
    const res = await action({ request: { formData: () => Promise.resolve(fd) } as unknown as Request } as never);
    expect(res.init?.status).toBe(400);
    expect(res.data).toEqual({ ok: false, reason: "consent_required" });
    expect(mockResolveOwned()).not.toHaveBeenCalled();
  });

  it("GT.20 — refuses an expired consent timestamp (older than 15 minutes)", async () => {
    const stale = new Date(Date.now() - 20 * 60 * 1000).toISOString();
    const res = await action({ request: formRequest({ virtualTryOnConsentAt: stale }) } as never);
    expect(res.init?.status).toBe(400);
    expect(res.data).toEqual({ ok: false, reason: "consent_expired" });
    expect(mockResolveOwned()).not.toHaveBeenCalled();
  });

  it("GT.21 — refuses a future-dated consent timestamp", async () => {
    const future = new Date(Date.now() + 60 * 1000).toISOString();
    const res = await action({ request: formRequest({ virtualTryOnConsentAt: future }) } as never);
    expect(res.init?.status).toBe(400);
    expect(res.data).toEqual({ ok: false, reason: "consent_expired" });
  });

  it("GT.22 — refuses when the nAia Model isn't configured", async () => {
    mockLoadModel().mockResolvedValue(null);
    const res = await action({ request: formRequest() } as never);
    expect(res.init?.status).toBe(400);
    expect(res.data).toEqual({ ok: false, reason: "model_not_configured" });
  });

  it("GT.23 — refuses when the nAia Model isn't ready for try-on", async () => {
    mockReadiness().mockReturnValue({ hasFullBodyPhoto: true, isReadyForTryOn: false });
    const res = await action({ request: formRequest() } as never);
    expect(res.init?.status).toBe(400);
    expect(res.data).toEqual({ ok: false, reason: "model_not_ready" });
  });

  it("GT.24 — refuses when the body photo hasn't been moderation-approved", async () => {
    mockLoadModel().mockResolvedValue({ id: "model-1", bodyModerationStatus: "PENDING" });
    const res = await action({ request: formRequest() } as never);
    expect(res.init?.status).toBe(400);
    expect(res.data).toEqual({ ok: false, reason: "model_not_moderated" });
  });

  it("GT.25 — refuses when a garment's category isn't VTO-eligible", async () => {
    mockResolveOwned().mockResolvedValue([
      ...EXPECTED_RESOLVED.slice(0, 2),
      { closetItemId: "g-trousers", name: "Beige Tailored Trousers", category: "SWIMWEAR", subcategory: null, slot: "bottom" },
    ]);
    const res = await action({ request: formRequest() } as never);
    expect(res.init?.status).toBe(400);
    expect(res.data).toEqual({ ok: false, reason: "garment_not_eligible" });
  });

  describe("GT.33-40 — Stage 2A quota pre-check for the full 3-step chain", () => {
    it("GT.33 — zero allowance (NONE tier) refuses before any image is touched", async () => {
      mockAllowances().mockReturnValue({ vtoPerMonth: 0 });
      mockEntitlementSummary().mockResolvedValue(entitlementSummary(0, 0));
      const res = await action({ request: formRequest() } as never);
      expect(res.init?.status).toBe(400);
      expect(res.data).toEqual({ ok: false, reason: "quota_insufficient_for_full_look" });
      expect(mockResolveAnchor()).not.toHaveBeenCalled();
      expect(mockScreenSuitability()).not.toHaveBeenCalled();
    });

    it("GT.34 — insufficient allowance (room for fewer than 3) refuses, even with room for 1 or 2", async () => {
      mockAllowances().mockReturnValue({ vtoPerMonth: 10 });
      mockEntitlementSummary().mockResolvedValue(entitlementSummary(8, 0)); // 2 remaining — not enough for 3
      const res = await action({ request: formRequest() } as never);
      expect(res.init?.status).toBe(400);
      expect(res.data).toEqual({ ok: false, reason: "quota_insufficient_for_full_look" });
    });

    it("GT.35 — exactly 3 remaining is sufficient (the boundary is inclusive)", async () => {
      mockAllowances().mockReturnValue({ vtoPerMonth: 10 });
      mockEntitlementSummary().mockResolvedValue(entitlementSummary(7, 0)); // exactly 3 remaining
      const res = await action({ request: formRequest() } as never);
      expect(res.data).toMatchObject({ ok: true });
    });

    it("GT.36 — sufficient allowance (plenty of room) proceeds to the image/suitability steps", async () => {
      mockAllowances().mockReturnValue({ vtoPerMonth: 10 });
      mockEntitlementSummary().mockResolvedValue(entitlementSummary(0, 0));
      const res = await action({ request: formRequest() } as never);
      expect(res.data).toMatchObject({ ok: true });
      expect(mockResolveAnchor()).toHaveBeenCalled();
    });

    it("GT.37 — in-flight (not just completed) jobs count against the chain's allowance", async () => {
      mockAllowances().mockReturnValue({ vtoPerMonth: 10 });
      mockEntitlementSummary().mockResolvedValue(entitlementSummary(0, 8)); // 8 in-flight, 2 remaining
      const res = await action({ request: formRequest() } as never);
      expect(res.data).toEqual({ ok: false, reason: "quota_insufficient_for_full_look" });
    });

    it("GT.38 — entitlement-override isolation: VTO_MONTHLY_LIMIT_OVERRIDE must NOT widen this check", async () => {
      // The standard allowance genuinely has no room (vtoPerMonth: 2), but a
      // staging override is set far above it. If this check incorrectly
      // routed through the override-aware path, it would wrongly pass.
      process.env.VTO_MONTHLY_LIMIT_OVERRIDE = "100";
      mockAllowances().mockReturnValue({ vtoPerMonth: 2 });
      mockEntitlementSummary().mockResolvedValue(entitlementSummary(0, 0));
      const res = await action({ request: formRequest() } as never);
      expect(res.data).toEqual({ ok: false, reason: "quota_insufficient_for_full_look" });
      delete process.env.VTO_MONTHLY_LIMIT_OVERRIDE;
    });

    it("GT.39 — entitlement-override isolation, the other direction: a low override must NOT narrow a genuinely sufficient standard allowance", async () => {
      process.env.VTO_MONTHLY_LIMIT_OVERRIDE = "1";
      mockAllowances().mockReturnValue({ vtoPerMonth: 10 });
      mockEntitlementSummary().mockResolvedValue(entitlementSummary(0, 0));
      const res = await action({ request: formRequest() } as never);
      expect(res.data).toMatchObject({ ok: true });
      delete process.env.VTO_MONTHLY_LIMIT_OVERRIDE;
    });

    it("GT.40 — fails closed, not open, when usage/membership cannot be established reliably", async () => {
      mockEntitlementSummary().mockRejectedValue(new Error("transient DB error"));
      const res = await action({ request: formRequest() } as never);
      expect(res.init?.status).toBe(400);
      expect(res.data).toEqual({ ok: false, reason: "quota_insufficient_for_full_look" });
    });

    it("GT.41 — enforced unconditionally, regardless of ENTITLEMENT_ENFORCEMENT", async () => {
      process.env.ENTITLEMENT_ENFORCEMENT = "false";
      mockAllowances().mockReturnValue({ vtoPerMonth: 0 });
      mockEntitlementSummary().mockResolvedValue(entitlementSummary(0, 0));
      const res = await action({ request: formRequest() } as never);
      expect(res.data).toEqual({ ok: false, reason: "quota_insufficient_for_full_look" });
      delete process.env.ENTITLEMENT_ENFORCEMENT;
    });

    it("GT.42 — the quota reason exposes no usage numbers, limits, or customer-identifying detail", async () => {
      mockAllowances().mockReturnValue({ vtoPerMonth: 0 });
      mockEntitlementSummary().mockResolvedValue(entitlementSummary(0, 0));
      const res = await action({ request: formRequest() } as never);
      const serialized = JSON.stringify(res.data);
      expect(serialized).not.toMatch(/sara|cust|\d/);
      expect(res.data).toEqual({ ok: false, reason: "quota_insufficient_for_full_look" });
    });
  });

  it("GT.26 — refuses when a garment's image is unresolvable (resolveClosetAnchor returns null), and never reaches the third garment", async () => {
    mockResolveAnchor().mockResolvedValueOnce({ type: "closet", id: "g-blazer", imageUrl: "https://mock.example/first.jpg" }); // 1st garment: resolves fine, screened
    mockResolveAnchor().mockResolvedValueOnce(null); // 2nd garment: no longer resolvable — removed/not owned at this exact moment
    const res = await action({ request: formRequest() } as never);
    expect(res.init?.status).toBe(400);
    expect(res.data).toEqual({ ok: false, reason: "garment_image_unavailable" });
    expect(mockResolveAnchor()).toHaveBeenCalledTimes(2); // fails on the 2nd — the 3rd garment is never even looked up
    expect(mockScreenSuitability()).toHaveBeenCalledTimes(1); // only the 1st garment, which resolved successfully, was screened
  });

  it("GT.27 — refuses when a garment resolves but has no image at all (imageUrl null)", async () => {
    mockResolveAnchor().mockResolvedValueOnce({ type: "closet", id: "g-trousers", imageUrl: "https://mock.example/g-trousers.jpg" });
    mockResolveAnchor().mockResolvedValueOnce({ type: "closet", id: "g-shirt", imageUrl: null });
    const res = await action({ request: formRequest() } as never);
    expect(res.init?.status).toBe(400);
    expect(res.data).toEqual({ ok: false, reason: "garment_image_unavailable" });
  });

  it("GT.28 — refuses when a garment's image fails suitability screening", async () => {
    mockScreenSuitability()
      .mockResolvedValueOnce({ status: "PASS" })
      .mockResolvedValueOnce({ status: "RETRY_IMAGE", subCode: "image_too_blurry" });
    const res = await action({ request: formRequest() } as never);
    expect(res.init?.status).toBe(400);
    expect(res.data).toEqual({ ok: false, reason: "garment_not_suitable" });
  });

  it("GT.29 — refuses when a garment's image is NEEDS_CLARIFICATION, not just RETRY_IMAGE", async () => {
    mockScreenSuitability()
      .mockResolvedValueOnce({ status: "PASS" })
      .mockResolvedValueOnce({ status: "PASS" })
      .mockResolvedValueOnce({ status: "NEEDS_CLARIFICATION", subCode: "category_mismatch" });
    const res = await action({ request: formRequest() } as never);
    expect(res.init?.status).toBe(400);
    expect(res.data).toEqual({ ok: false, reason: "garment_not_suitable" });
  });

  it("GT.30 — all three garments must individually pass screening — not sampled, not skipped", async () => {
    const res = await action({ request: formRequest() } as never);
    expect(res.data).toMatchObject({ ok: true });
    expect(mockResolveAnchor()).toHaveBeenCalledTimes(3);
    expect(mockScreenSuitability()).toHaveBeenCalledTimes(3);
    const screenedUrls = mockScreenSuitability().mock.calls.map((c: unknown[]) => c[0]);
    expect(new Set(screenedUrls).size).toBe(3); // three distinct garments, three distinct images screened
  });

  it("GT.31 — the real resolved image URL (not a placeholder) is what reaches suitability screening", async () => {
    mockResolveAnchor().mockImplementation((_customerId: string, closetItemId: string) =>
      Promise.resolve({ type: "closet", id: closetItemId, imageUrl: `https://real-signed-url.example/${closetItemId}` }),
    );
    await action({ request: formRequest() } as never);
    const screenedUrls = mockScreenSuitability().mock.calls.map((c: unknown[]) => c[0]);
    for (const url of screenedUrls) {
      expect(url).toMatch(/^https:\/\/real-signed-url\.example\//);
      expect(url).not.toMatch(/mock-product-image/);
    }
  });

  it("GT.32 — ownership is re-verified per garment at the image-resolution step too (defense in depth)", async () => {
    await action({ request: formRequest() } as never);
    for (const closetItemId of ["g-blazer", "g-shirt", "g-trousers"]) {
      expect(mockResolveAnchor()).toHaveBeenCalledWith("sara-cust-1", closetItemId);
    }
  });

  it("GT.12 — with every gate satisfied, runs the full 3-step mock chain and returns a final mock image", async () => {
    const res = await action({ request: formRequest() } as never);
    const body = res.data;
    expect(body.ok).toBe(true);
    if (!body.ok) throw new Error("unreachable");
    expect(body.mock).toBe(true);
    expect(body.creditsUsed).toBe(3);
    expect(body.steps.map((s: { label: string }) => s.label)).toEqual([
      "Beige Tailored Trousers",
      "Blue Chambray Button-Up Shirt",
      "Beige Tailored Blazer",
    ]);
    expect(typeof body.finalImageDataUrl).toBe("string");
    expect(body.finalImageDataUrl.startsWith("data:image/png;base64,")).toBe(true);
  });

  it("GT.13 — a simulated mid-chain failure halts before the next step and is reported clearly", async () => {
    const res = await action({
      request: formRequest({ __simulateFailureAtStep: "1" }),
    } as never);
    const body = res.data;
    expect(body.ok).toBe(false);
    if (body.ok) throw new Error("unreachable");
    expect(body.mock).toBe(true);
    expect(body.failedStepIndex).toBe(1);
    expect(body.creditsUsed).toBe(1); // only the first, succeeded step is "billed"
    expect(body.steps).toEqual([
      { label: "Beige Tailored Trousers", slot: "bottom", ok: true },
      { label: "Blue Chambray Button-Up Shirt", slot: "top", ok: false },
    ]);
  });

  it("GT.14 — re-verifies ownership independently on every POST (defense in depth)", async () => {
    mockResolveOwned().mockResolvedValue(null); // simulate: no longer owned/changed since the page loaded
    const res = await action({ request: formRequest() } as never);
    expect(res.init?.status).toBe(400);
    const body = res.data;
    expect(body).toEqual({ ok: false, reason: "ownership_check_failed" });
  });

  it("GT.15 — 404s for an unauthorized account even with consent supplied", async () => {
    mockCustomer().mockResolvedValue({ id: "stranger", shopifyCustomerId: "stranger-shop" });
    await expect(
      action({ request: formRequest() } as never),
    ).rejects.toMatchObject({ status: 404 });
  });
});
