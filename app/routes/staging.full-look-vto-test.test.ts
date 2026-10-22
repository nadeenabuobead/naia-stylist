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

import { getCurrentNaiaCustomer } from "~/lib/naia-session.server";
import { loadWardrobeIntelligence } from "~/lib/ai/wardrobe-intelligence.server";
import { loadNaiaModel, computeModelReadinessFromRecord } from "~/lib/ai/my-naia-model.server";
import { resolveOwnedWiGarments } from "~/lib/ai/poc-wi-combination-resolver.server";
import prisma from "~/db.server";
import { loader, action, isAuthorizedStagingTestAccount } from "./staging.full-look-vto-test";

const mockCustomer = () => getCurrentNaiaCustomer as ReturnType<typeof vi.fn>;
const mockLoadWI = () => loadWardrobeIntelligence as ReturnType<typeof vi.fn>;
const mockLoadModel = () => loadNaiaModel as ReturnType<typeof vi.fn>;
const mockReadiness = () => computeModelReadinessFromRecord as ReturnType<typeof vi.fn>;
const mockResolveOwned = () => resolveOwnedWiGarments as ReturnType<typeof vi.fn>;
const mockProfileFind = () => (prisma as unknown as { onboardingProfile: { findUnique: ReturnType<typeof vi.fn> } }).onboardingProfile.findUnique;

const SARA = { id: "sara-cust-1", shopifyCustomerId: "sara-shop-1" };

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
