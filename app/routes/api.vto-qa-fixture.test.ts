// app/routes/api.vto-qa-fixture.test.ts
//
// Covers the authorization gate (all four independent checks must hold),
// the eligibility computation (slot priority, dress-excludes-top/bottom,
// 5-garment cap, resolvable-image filtering), the "insufficient categories
// -> nothing created" path, and the happy-path creation shape. No real
// Prisma — closetItem/stylingSession/outfitSuggestion/outfitItem/$transaction
// are all mocked.
//
// Run: npx vitest run app/routes/api.vto-qa-fixture.test.ts

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockFindMany = vi.fn();
const mockSessionCreate = vi.fn();
const mockSuggestionCreate = vi.fn();
const mockItemCreate = vi.fn();
const mockSuggestionFindUnique = vi.fn();
const mockVtoJobCount = vi.fn();
const mockVtoJobFindMany = vi.fn();
const mockSuggestionCount = vi.fn();
const mockItemDeleteMany = vi.fn();
const mockSuggestionDelete = vi.fn();
const mockSessionDelete = vi.fn();

// 2026-11-17: this previously mocked "~/lib/prisma.server", a module that
// does not exist in this codebase — the real route imports its default
// export from "~/db.server" (db.server.js, a direct `new PrismaClient()`,
// confirmed by reading it). That mismatch meant NONE of this file's actual
// business-logic assertions were ever exercised against the mock; every
// test that touched a real Prisma call silently fell through to the real
// client and failed with a datasource-validation error (confirmed via a
// clean `npx vitest run` on the unmodified file: 13 of 32 tests failed —
// every one that wasn't a pure authorization-gate check returning before
// any Prisma call). The commit history's claimed pass counts for this file
// were never actually reproduced. Fixed here, not just worked around.
vi.mock("~/db.server", () => ({
  default: {
    closetItem: { findMany: (...args: unknown[]) => mockFindMany(...args) },
    outfitSuggestion: {
      findUnique: (...args: unknown[]) => mockSuggestionFindUnique(...args),
      count: (...args: unknown[]) => mockSuggestionCount(...args),
      delete: (...args: unknown[]) => mockSuggestionDelete(...args),
    },
    outfitItem: { deleteMany: (...args: unknown[]) => mockItemDeleteMany(...args) },
    stylingSession: { delete: (...args: unknown[]) => mockSessionDelete(...args) },
    virtualTryOnJob: { count: (...args: unknown[]) => mockVtoJobCount(...args), findMany: (...args: unknown[]) => mockVtoJobFindMany(...args) },
    // $transaction has two call shapes in the real code: a callback (the
    // POST action, creation) and a plain array of promises (the DELETE
    // cleanup action below) — mirrors both, same as the real Prisma client.
    $transaction: async (arg: unknown) => {
      if (Array.isArray(arg)) return Promise.all(arg);
      return (arg as (tx: unknown) => unknown)({
        stylingSession: { create: (...args: unknown[]) => mockSessionCreate(...args) },
        outfitSuggestion: { create: (...args: unknown[]) => mockSuggestionCreate(...args) },
        outfitItem: { create: (...args: unknown[]) => mockItemCreate(...args) },
      });
    },
  },
}));

const mockLoadNaiaModel = vi.fn();
vi.mock("~/lib/ai/my-naia-model.server", () => ({
  loadNaiaModel: (...args: unknown[]) => mockLoadNaiaModel(...args),
  computeModelReadinessFromRecord: (model: unknown) => ({
    hasFacePhoto: false,
    hasFullBodyPhoto: Boolean(model),
    isReadyForTryOn: Boolean(model),
  }),
}));

// getCloudinaryConfig is real code with real env-var reads — mocked here so
// the GET loader's call into the real selectFullLookGarments resolves
// images via the plain imageUrl fallback deterministically in tests,
// without needing real Cloudinary credentials.
vi.mock("~/lib/cloudinary-admin.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/lib/cloudinary-admin.server")>();
  return { ...actual, getCloudinaryConfig: () => null };
});

import { action, loader, checkFashnCredits } from "./api.vto-qa-fixture";

const QA_ID = "qa-disposable-customer-1";
const ORIGINAL_ENV = { ...process.env };

function closetItem(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: `item-${Math.random().toString(36).slice(2)}`,
    name: "Test Item",
    category: "TOPS",
    subcategory: null,
    imagePublicId: "naia-wardrobe/x/y",
    imageFormat: "jpg",
    imageUrl: null,
    ...overrides,
  };
}

function req(body: unknown, headers: Record<string, string> = {}) {
  return {
    method: "POST",
    headers: new Headers(headers),
    json: async () => body,
  } as unknown as Request;
}

function deleteReq(body: unknown, headers: Record<string, string> = {}) {
  return {
    method: "DELETE",
    headers: new Headers(headers),
    json: async () => body,
  } as unknown as Request;
}

function fixtureSuggestion(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "suggestion-1",
    moodDescription: null,
    sessionId: "session-1",
    session: { customerId: QA_ID },
    ...overrides,
  };
}

function setAuthorizedEnv() {
  process.env.VERCEL_ENV = "preview";
  process.env.NAIA_PROJECT_VARIANT = "staging";
  process.env.VTO_QA_FIXTURE_SECRET = "the-real-secret";
  process.env.QA_OVERRIDE_CUSTOMER_ID = QA_ID;
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.VERCEL_ENV;
  delete process.env.NAIA_PROJECT_VARIANT;
  delete process.env.VTO_QA_FIXTURE_SECRET;
  delete process.env.QA_OVERRIDE_CUSTOMER_ID;
  mockSessionCreate.mockResolvedValue({ id: "session-1" });
  mockSuggestionCreate.mockResolvedValue({ id: "suggestion-1" });
  mockItemCreate.mockResolvedValue({ id: "outfititem-1" });
  mockVtoJobCount.mockResolvedValue(0);
  mockVtoJobFindMany.mockResolvedValue([]);
  mockSuggestionCount.mockResolvedValue(1);
  mockItemDeleteMany.mockResolvedValue({ count: 1 });
  mockSuggestionDelete.mockResolvedValue({ id: "suggestion-1" });
  mockSessionDelete.mockResolvedValue({ id: "session-1" });
  mockLoadNaiaModel.mockResolvedValue({ bodyPublicId: "p", bodyFormat: "jpg", saveModelConsentAt: new Date() });
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("api.vto-qa-fixture action — authorization gate", () => {
  it("rejects a non-POST method", async () => {
    setAuthorizedEnv();
    const getReq = { method: "GET", headers: new Headers(), json: async () => ({}) } as unknown as Request;
    const res = await action({ request: getReq } as any);
    expect(res.init?.status).toBe(405);
  });

  it("rejects when VERCEL_ENV is production, even with everything else correct", async () => {
    setAuthorizedEnv();
    process.env.VERCEL_ENV = "production";
    const res = await action({
      request: req({ customerId: QA_ID }, { "x-vto-qa-fixture-secret": "the-real-secret" }),
    } as any);
    expect(res.init?.status).toBe(403);
    expect(mockFindMany).not.toHaveBeenCalled();
  });

  it("rejects when VERCEL_ENV is unset", async () => {
    setAuthorizedEnv();
    delete process.env.VERCEL_ENV;
    const res = await action({
      request: req({ customerId: QA_ID }, { "x-vto-qa-fixture-secret": "the-real-secret" }),
    } as any);
    expect(res.init?.status).toBe(403);
  });

  it("rejects when NAIA_PROJECT_VARIANT is not \"staging\"", async () => {
    setAuthorizedEnv();
    process.env.NAIA_PROJECT_VARIANT = "production";
    const res = await action({
      request: req({ customerId: QA_ID }, { "x-vto-qa-fixture-secret": "the-real-secret" }),
    } as any);
    expect(res.init?.status).toBe(403);
  });

  it("rejects a missing or wrong secret header", async () => {
    setAuthorizedEnv();
    const res1 = await action({ request: req({ customerId: QA_ID }, {}) } as any);
    expect(res1.init?.status).toBe(403);
    const res2 = await action({
      request: req({ customerId: QA_ID }, { "x-vto-qa-fixture-secret": "wrong-secret" }),
    } as any);
    expect(res2.init?.status).toBe(403);
    expect(mockFindMany).not.toHaveBeenCalled();
  });

  it("rejects when QA_OVERRIDE_CUSTOMER_ID is unset, even with a correct secret and a customerId", async () => {
    setAuthorizedEnv();
    delete process.env.QA_OVERRIDE_CUSTOMER_ID;
    const res = await action({
      request: req({ customerId: QA_ID }, { "x-vto-qa-fixture-secret": "the-real-secret" }),
    } as any);
    expect(res.init?.status).toBe(403);
  });

  it("rejects a customerId that does not match QA_OVERRIDE_CUSTOMER_ID — never acts on an unrelated customer", async () => {
    setAuthorizedEnv();
    const res = await action({
      request: req({ customerId: "some-other-customer" }, { "x-vto-qa-fixture-secret": "the-real-secret" }),
    } as any);
    expect(res.init?.status).toBe(403);
    expect(mockFindMany).not.toHaveBeenCalled();
  });

  it("rejects a missing customerId in the body", async () => {
    setAuthorizedEnv();
    const res = await action({
      request: req({}, { "x-vto-qa-fixture-secret": "the-real-secret" }),
    } as any);
    expect(res.init?.status).toBe(403);
  });

  it("rejects malformed JSON bodies", async () => {
    setAuthorizedEnv();
    const badReq = {
      method: "POST",
      headers: new Headers({ "x-vto-qa-fixture-secret": "the-real-secret" }),
      json: async () => {
        throw new SyntaxError("bad json");
      },
    } as unknown as Request;
    const res = await action({ request: badReq } as any);
    expect(res.init?.status).toBe(400);
  });
});

describe("api.vto-qa-fixture action — eligibility and creation", () => {
  function authedReq() {
    return req({ customerId: QA_ID }, { "x-vto-qa-fixture-secret": "the-real-secret" });
  }

  it("creates nothing and reports insufficient categories when fewer than 3 eligible slots exist", async () => {
    setAuthorizedEnv();
    mockFindMany.mockResolvedValue([
      closetItem({ category: "TOPS" }),
      closetItem({ category: "BOTTOMS" }),
    ]);
    const res = await action({ request: authedReq() } as any);
    const json = res.data as any;
    expect(json.ok).toBe(false);
    expect(json.code).toBe("insufficient_eligible_categories");
    expect(json.eligibleCategoriesFound).toEqual(["top", "bottom"]);
    expect(mockSessionCreate).not.toHaveBeenCalled();
    expect(mockSuggestionCreate).not.toHaveBeenCalled();
    expect(mockItemCreate).not.toHaveBeenCalled();
  });

  it("ignores closet items with no resolvable image when counting eligibility", async () => {
    setAuthorizedEnv();
    mockFindMany.mockResolvedValue([
      closetItem({ category: "TOPS" }),
      closetItem({ category: "BOTTOMS" }),
      closetItem({ category: "SHOES", imagePublicId: null, imageFormat: null, imageUrl: null }), // unresolvable
    ]);
    const res = await action({ request: authedReq() } as any);
    const json = res.data as any;
    expect(json.ok).toBe(false);
    expect(json.code).toBe("insufficient_eligible_categories");
  });

  it("accepts a plain imageUrl as a resolvable image, not only Cloudinary publicId+format", async () => {
    setAuthorizedEnv();
    mockFindMany.mockResolvedValue([
      closetItem({ category: "TOPS", imagePublicId: null, imageFormat: null, imageUrl: "https://cdn/legacy.jpg" }),
      closetItem({ category: "BOTTOMS" }),
      closetItem({ category: "SHOES" }),
    ]);
    const res = await action({ request: authedReq() } as any);
    const json = res.data as any;
    expect(json.ok).toBe(true);
    expect(json.totalEligibleCategoriesAvailable).toBe(3);
  });

  it("creates a StylingSession + OutfitSuggestion + OutfitItem rows for exactly the eligible categories, one item per slot, correct itemType mapping", async () => {
    setAuthorizedEnv();
    const top = closetItem({ category: "TOPS" });
    const bottom = closetItem({ category: "BOTTOMS" });
    const shoes = closetItem({ category: "SHOES" });
    mockFindMany.mockResolvedValue([top, bottom, shoes]);

    const res = await action({ request: authedReq() } as any);
    const json = res.data as any;

    expect(json.ok).toBe(true);
    expect(json.sessionId).toBe("session-1");
    expect(json.suggestionId).toBe("suggestion-1");
    expect(mockSessionCreate).toHaveBeenCalledWith({ data: { customerId: QA_ID }, select: { id: true } });
    expect(mockSuggestionCreate).toHaveBeenCalledWith({ data: { sessionId: "session-1" }, select: { id: true } });
    expect(mockItemCreate).toHaveBeenCalledTimes(3);
    expect(mockItemCreate).toHaveBeenCalledWith({
      data: { suggestionId: "suggestion-1", itemType: "TOP", closetItemId: top.id },
    });
    expect(mockItemCreate).toHaveBeenCalledWith({
      data: { suggestionId: "suggestion-1", itemType: "BOTTOM", closetItemId: bottom.id },
    });
    expect(mockItemCreate).toHaveBeenCalledWith({
      data: { suggestionId: "suggestion-1", itemType: "SHOES", closetItemId: shoes.id },
    });
    // moodDescription is never set — the created suggestion must not count
    // toward the real StyleMe monthly quota (qualifyingStyleMeWhere requires
    // a non-null moodDescription).
    expect(mockSuggestionCreate.mock.calls[0][0].data).not.toHaveProperty("moodDescription");
  });

  it("a DRESS excludes TOP and BOTTOM from selection, same as the real engine's floor logic", async () => {
    setAuthorizedEnv();
    const dress = closetItem({ category: "DRESSES" });
    const top = closetItem({ category: "TOPS" });
    const bottom = closetItem({ category: "BOTTOMS" });
    const shoes = closetItem({ category: "SHOES" });
    const bag = closetItem({ category: "BAGS" });
    mockFindMany.mockResolvedValue([dress, top, bottom, shoes, bag]);

    const res = await action({ request: authedReq() } as any);
    const json = res.data as any;

    expect(json.ok).toBe(true);
    const slots = json.chosenItems.map((c: { slot: string }) => c.slot);
    expect(slots).toContain("dress");
    expect(slots).not.toContain("top");
    expect(slots).not.toContain("bottom");
  });

  it("caps at 5 garments even when more eligible categories exist", async () => {
    setAuthorizedEnv();
    mockFindMany.mockResolvedValue([
      closetItem({ category: "TOPS" }),
      closetItem({ category: "BOTTOMS" }),
      closetItem({ category: "OUTERWEAR" }),
      closetItem({ category: "SHOES" }),
      closetItem({ category: "ACCESSORIES" }),
      closetItem({ category: "BAGS" }),
      closetItem({ category: "JEWELRY" }),
    ]);
    const res = await action({ request: authedReq() } as any);
    const json = res.data as any;
    expect(json.ok).toBe(true);
    expect(json.chosenItems).toHaveLength(5);
    expect(mockItemCreate).toHaveBeenCalledTimes(5);
  });

  it("picks only one item per slot when multiple closet items share the same category", async () => {
    setAuthorizedEnv();
    const firstTop = closetItem({ category: "TOPS", name: "First Top" });
    const secondTop = closetItem({ category: "TOPS", name: "Second Top" });
    mockFindMany.mockResolvedValue([firstTop, secondTop, closetItem({ category: "BOTTOMS" }), closetItem({ category: "SHOES" })]);

    const res = await action({ request: authedReq() } as any);
    const json = res.data as any;
    expect(json.ok).toBe(true);
    const topEntries = json.chosenItems.filter((c: { slot: string }) => c.slot === "top");
    expect(topEntries).toHaveLength(1);
  });

  it("never queries or acts on a customer other than QA_OVERRIDE_CUSTOMER_ID", async () => {
    setAuthorizedEnv();
    mockFindMany.mockResolvedValue([closetItem({ category: "TOPS" }), closetItem({ category: "BOTTOMS" }), closetItem({ category: "SHOES" })]);
    await action({ request: authedReq() } as any);
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { customerId: QA_ID } }),
    );
  });
});

describe("api.vto-qa-fixture loader (GET) — read-only verification, no duplicate creation", () => {
  function getReq(params: Record<string, string>, headers: Record<string, string> = {}) {
    const url = new URL("https://example.test/api/vto-qa-fixture");
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    return { url: url.toString(), headers: new Headers(headers) } as unknown as Request;
  }

  function outfitItem(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      itemType: "TOP",
      productTitle: null,
      closetItemId: "closet-1",
      shopifyProductId: null,
      productImageUrl: null,
      closetItem: { name: "Top", imageUrl: "https://cdn/top.jpg", imagePublicId: null, imageFormat: null, category: "TOPS" },
      ...overrides,
    };
  }

  it("rejects when unauthorized, identical gate to the POST action — never queries the DB", async () => {
    const res = await loader({
      request: getReq({ customerId: QA_ID, suggestionId: "sugg-1" }, { "x-vto-qa-fixture-secret": "wrong" }),
    } as any);
    expect(res.init?.status).toBe(403);
    expect(mockSuggestionFindUnique).not.toHaveBeenCalled();
  });

  it("rejects with a missing suggestionId even when otherwise authorized", async () => {
    setAuthorizedEnv();
    const res = await loader({
      request: getReq({ customerId: QA_ID }, { "x-vto-qa-fixture-secret": "the-real-secret" }),
    } as any);
    expect(res.init?.status).toBe(403);
  });

  it("returns not_found (never distinguishing from a wrong-customer suggestion) when the suggestion doesn't belong to the designated customer", async () => {
    setAuthorizedEnv();
    mockSuggestionFindUnique.mockResolvedValue({
      id: "sugg-1",
      session: { id: "session-1", customerId: "someone-else" },
      items: [],
    });
    const res = await loader({
      request: getReq({ customerId: QA_ID, suggestionId: "sugg-1" }, { "x-vto-qa-fixture-secret": "the-real-secret" }),
    } as any);
    expect(res.init?.status).toBe(404);
  });

  it("returns not_found when the suggestion doesn't exist at all", async () => {
    setAuthorizedEnv();
    mockSuggestionFindUnique.mockResolvedValue(null);
    const res = await loader({
      request: getReq({ customerId: QA_ID, suggestionId: "does-not-exist" }, { "x-vto-qa-fixture-secret": "the-real-secret" }),
    } as any);
    expect(res.init?.status).toBe(404);
  });

  it("confirms ownership, session id, and real Full-Look eligibility (re-running the actual selection logic) for an existing suggestion — creates nothing", async () => {
    setAuthorizedEnv();
    mockSuggestionFindUnique.mockResolvedValue({
      id: "sugg-1",
      session: { id: "session-1", customerId: QA_ID },
      items: [
        outfitItem({ itemType: "TOP", closetItemId: "c1", closetItem: { name: "Shirt", imageUrl: "https://cdn/1.jpg", imagePublicId: null, imageFormat: null, category: "TOPS" } }),
        outfitItem({ itemType: "BOTTOM", closetItemId: "c2", closetItem: { name: "Jeans", imageUrl: "https://cdn/2.jpg", imagePublicId: null, imageFormat: null, category: "BOTTOMS" } }),
        outfitItem({ itemType: "SHOES", closetItemId: "c3", closetItem: { name: "Sneakers", imageUrl: "https://cdn/3.jpg", imagePublicId: null, imageFormat: null, category: "SHOES" } }),
      ],
    });

    const res = await loader({
      request: getReq({ customerId: QA_ID, suggestionId: "sugg-1" }, { "x-vto-qa-fixture-secret": "the-real-secret" }),
    } as any);
    const json = res.data as any;

    expect(json.ok).toBe(true);
    expect(json.sessionId).toBe("session-1");
    expect(json.suggestionId).toBe("sugg-1");
    expect(json.belongsToCustomerId).toBe(QA_ID);
    expect(json.fullLookEligible).toBe(true);
    expect(json.eligibleGarmentCount).toBe(3);
    expect(json.eligibleGarmentLabels).toEqual(["Shirt", "Jeans", "Sneakers"]);
    expect(json.naiaModelReadyForTryOn).toBe(true);
    expect(json.priorVirtualTryOnJobsOnThisSuggestion).toBe(0);
    // Read-only: nothing created, same mocks from the action describe block untouched.
    expect(mockSessionCreate).not.toHaveBeenCalled();
    expect(mockSuggestionCreate).not.toHaveBeenCalled();
    expect(mockItemCreate).not.toHaveBeenCalled();
  });

  it("reports naiaModelReadyForTryOn: false when the customer has no ready model, and surfaces a nonzero prior job count", async () => {
    setAuthorizedEnv();
    mockLoadNaiaModel.mockResolvedValue(null);
    mockVtoJobFindMany.mockResolvedValue([
      { id: "job-1", productHandle: "h1", status: "FAILED", predictionId: null, errorCode: "PROVIDER_FAILED", isTest: false, createdAt: new Date(), updatedAt: new Date(), completedAt: null, lastActivityAt: new Date() },
      { id: "job-2", productHandle: "h2", status: "FAILED", predictionId: null, errorCode: "PROVIDER_FAILED", isTest: false, createdAt: new Date(), updatedAt: new Date(), completedAt: null, lastActivityAt: new Date() },
    ]);
    mockSuggestionFindUnique.mockResolvedValue({
      id: "sugg-3",
      session: { id: "session-3", customerId: QA_ID },
      items: [
        outfitItem({ itemType: "TOP" }),
        outfitItem({ itemType: "BOTTOM" }),
        outfitItem({ itemType: "SHOES" }),
      ],
    });
    const res = await loader({
      request: getReq({ customerId: QA_ID, suggestionId: "sugg-3" }, { "x-vto-qa-fixture-secret": "the-real-secret" }),
    } as any);
    const json = res.data as any;
    expect(json.ok).toBe(true);
    expect(json.naiaModelReadyForTryOn).toBe(false);
    expect(json.priorVirtualTryOnJobsOnThisSuggestion).toBe(2);
    expect(json.priorJobs).toHaveLength(2);
    expect(json.priorJobs[0].errorCode).toBe("PROVIDER_FAILED");
    expect(json.priorJobs[0].status).toBe("FAILED");
  });

  it("reports fullLookEligible: false when the persisted items don't actually clear the real 3-category floor", async () => {
    setAuthorizedEnv();
    mockSuggestionFindUnique.mockResolvedValue({
      id: "sugg-2",
      session: { id: "session-2", customerId: QA_ID },
      items: [outfitItem({ itemType: "TOP" })],
    });
    const res = await loader({
      request: getReq({ customerId: QA_ID, suggestionId: "sugg-2" }, { "x-vto-qa-fixture-secret": "the-real-secret" }),
    } as any);
    const json = res.data as any;
    expect(json.ok).toBe(true);
    expect(json.fullLookEligible).toBe(false);
    expect(json.eligibleGarmentCount).toBe(0);
  });
});

// ── checkFashnCredits — read-only balance check (2026-11-17) ───────────────
// GET https://api.fashn.ai/v1/credits using the real FASHN_API_KEY, never
// submits anything, never costs anything. Verified directly here with an
// injected _fetch; the loader-level tests below prove the auth gate and
// mode=credits routing without needing a real network call either.

describe("checkFashnCredits — direct unit tests", () => {
  const ORIGINAL_KEY = process.env.FASHN_API_KEY;
  afterEach(() => {
    if (ORIGINAL_KEY === undefined) delete process.env.FASHN_API_KEY;
    else process.env.FASHN_API_KEY = ORIGINAL_KEY;
  });

  it("returns the credits object on a successful response, using the real Bearer-token request shape", async () => {
    process.env.FASHN_API_KEY = "real-fashn-key";
    let capturedUrl = "";
    let capturedAuth = "";
    const _fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      capturedUrl = url.toString();
      capturedAuth = (init?.headers as Record<string, string>)?.Authorization ?? "";
      return new Response(JSON.stringify({ credits: { total: 100, subscription: 0, on_demand: 100 } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    const res = await checkFashnCredits(_fetch);
    const json = res.data as any;

    expect(capturedUrl).toBe("https://api.fashn.ai/v1/credits");
    expect(capturedAuth).toBe("Bearer real-fashn-key");
    expect(json.ok).toBe(true);
    expect(json.credits).toEqual({ total: 100, subscription: 0, on_demand: 100 });
  });

  it("never reveals the API key itself anywhere in the response", async () => {
    process.env.FASHN_API_KEY = "super-secret-key-value";
    const _fetch = (async () =>
      new Response(JSON.stringify({ credits: { total: 5, subscription: 0, on_demand: 5 } }), { status: 200 })) as typeof fetch;
    const res = await checkFashnCredits(_fetch);
    const serialized = JSON.stringify(res.data);
    expect(serialized).not.toContain("super-secret-key-value");
  });

  it("reports not_configured when FASHN_API_KEY is unset, without attempting a network call", async () => {
    delete process.env.FASHN_API_KEY;
    const _fetch = vi.fn();
    const res = await checkFashnCredits(_fetch as unknown as typeof fetch);
    const json = res.data as any;
    expect(json.ok).toBe(false);
    expect(json.code).toBe("not_configured");
    expect(_fetch).not.toHaveBeenCalled();
  });

  it("reports fashn_error with the status code when FASHN itself rejects the check (e.g. invalid key)", async () => {
    process.env.FASHN_API_KEY = "some-key";
    const _fetch = (async () => new Response("Unauthorized", { status: 401 })) as typeof fetch;
    const res = await checkFashnCredits(_fetch);
    const json = res.data as any;
    expect(json.ok).toBe(false);
    expect(json.code).toBe("fashn_error");
    expect(json.httpStatus).toBe(401);
  });

  it("reports network_error on a thrown fetch failure, never crashes", async () => {
    process.env.FASHN_API_KEY = "some-key";
    const _fetch = (async () => {
      throw new Error("ECONNRESET");
    }) as typeof fetch;
    const res = await checkFashnCredits(_fetch);
    const json = res.data as any;
    expect(json.ok).toBe(false);
    expect(json.code).toBe("network_error");
  });
});

describe("api.vto-qa-fixture loader — mode=credits routing", () => {
  const ORIGINAL_KEY = process.env.FASHN_API_KEY;
  afterEach(() => {
    if (ORIGINAL_KEY === undefined) delete process.env.FASHN_API_KEY;
    else process.env.FASHN_API_KEY = ORIGINAL_KEY;
  });

  function creditsReq(params: Record<string, string>, headers: Record<string, string> = {}) {
    const url = new URL("https://example.test/api/vto-qa-fixture");
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    return { url: url.toString(), headers: new Headers(headers) } as unknown as Request;
  }

  it("rejects an unauthorized request for mode=credits exactly like every other action — never calls fetch", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    try {
      const res = await loader({
        request: creditsReq({ customerId: QA_ID, mode: "credits" }, { "x-vto-qa-fixture-secret": "wrong" }),
      } as any);
      expect(res.init?.status).toBe(403);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("an authorized mode=credits request reaches FASHN's real credits endpoint and returns the balance, never touching the DB", async () => {
    setAuthorizedEnv();
    process.env.FASHN_API_KEY = "real-key";
    const fetchSpy = vi.fn(async () =>
      new Response(JSON.stringify({ credits: { total: 100, subscription: 0, on_demand: 100 } }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchSpy);
    try {
      const res = await loader({
        request: creditsReq({ customerId: QA_ID, mode: "credits" }, { "x-vto-qa-fixture-secret": "the-real-secret" }),
      } as any);
      const json = res.data as any;
      expect(json.ok).toBe(true);
      expect(json.credits.total).toBe(100);
      expect(fetchSpy).toHaveBeenCalledWith("https://api.fashn.ai/v1/credits", expect.any(Object));
      expect(mockSuggestionFindUnique).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("mode=credits does not require a suggestionId — unlike the normal suggestion-lookup mode", async () => {
    setAuthorizedEnv();
    process.env.FASHN_API_KEY = "real-key";
    const fetchSpy = vi.fn(async () =>
      new Response(JSON.stringify({ credits: { total: 1, subscription: 0, on_demand: 1 } }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchSpy);
    try {
      const res = await loader({
        request: creditsReq({ customerId: QA_ID, mode: "credits" }, { "x-vto-qa-fixture-secret": "the-real-secret" }),
      } as any);
      const json = res.data as any;
      expect(json.ok).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

// ── DELETE — cleanup of exactly one fixture-created suggestion ─────────────
describe("api.vto-qa-fixture action — DELETE cleanup", () => {
  const AUTH_HEADERS = { "x-vto-qa-fixture-secret": "the-real-secret" };

  it("rejects the same four-check authorization gate as POST — wrong secret", async () => {
    setAuthorizedEnv();
    const res = await action({
      request: deleteReq({ customerId: QA_ID, suggestionId: "s1" }, { "x-vto-qa-fixture-secret": "wrong" }),
    } as any);
    expect(res.init?.status).toBe(403);
    expect(mockSuggestionFindUnique).not.toHaveBeenCalled();
  });

  it("rejects a missing suggestionId before ever looking anything up", async () => {
    setAuthorizedEnv();
    const res = await action({ request: deleteReq({ customerId: QA_ID }, AUTH_HEADERS) } as any);
    expect(res.init?.status).toBe(400);
    expect(mockSuggestionFindUnique).not.toHaveBeenCalled();
  });

  it("not-found and wrong-customer are indistinguishable — same convention as the GET loader", async () => {
    setAuthorizedEnv();
    mockSuggestionFindUnique.mockResolvedValueOnce(null);
    const res1 = await action({
      request: deleteReq({ customerId: QA_ID, suggestionId: "does-not-exist" }, AUTH_HEADERS),
    } as any);
    expect(res1.init?.status).toBe(404);

    mockSuggestionFindUnique.mockResolvedValueOnce(fixtureSuggestion({ session: { customerId: "someone-else" } }));
    const res2 = await action({
      request: deleteReq({ customerId: QA_ID, suggestionId: "suggestion-1" }, AUTH_HEADERS),
    } as any);
    expect(res2.init?.status).toBe(404);
    expect(mockSuggestionDelete).not.toHaveBeenCalled();
  });

  it("refuses a real (non-null moodDescription) suggestion — can never become a generic delete primitive", async () => {
    setAuthorizedEnv();
    mockSuggestionFindUnique.mockResolvedValueOnce(fixtureSuggestion({ moodDescription: "cozy and considered" }));
    const res = await action({
      request: deleteReq({ customerId: QA_ID, suggestionId: "suggestion-1" }, AUTH_HEADERS),
    } as any);
    expect(res.init?.status).toBe(403);
    expect((res.data as any).code).toBe("not_a_fixture_suggestion");
    expect(mockSuggestionDelete).not.toHaveBeenCalled();
  });

  it("refuses when the session has more than this one suggestion — never touches a session it didn't exclusively create", async () => {
    setAuthorizedEnv();
    mockSuggestionFindUnique.mockResolvedValueOnce(fixtureSuggestion());
    mockSuggestionCount.mockResolvedValueOnce(2);
    const res = await action({
      request: deleteReq({ customerId: QA_ID, suggestionId: "suggestion-1" }, AUTH_HEADERS),
    } as any);
    expect(res.init?.status).toBe(409);
    expect((res.data as any).code).toBe("session_not_isolated");
    expect(mockSessionDelete).not.toHaveBeenCalled();
  });

  it("refuses when a real VirtualTryOnJob references this suggestion — never cascades into a table it wasn't asked to manage", async () => {
    setAuthorizedEnv();
    mockSuggestionFindUnique.mockResolvedValueOnce(fixtureSuggestion());
    mockVtoJobCount.mockResolvedValueOnce(1);
    const res = await action({
      request: deleteReq({ customerId: QA_ID, suggestionId: "suggestion-1" }, AUTH_HEADERS),
    } as any);
    expect(res.init?.status).toBe(409);
    expect((res.data as any).code).toBe("has_dependent_jobs");
    expect(mockSuggestionDelete).not.toHaveBeenCalled();
    expect(mockSessionDelete).not.toHaveBeenCalled();
  });

  it("happy path — deletes OutfitItem rows, the OutfitSuggestion, and the StylingSession, in that order, nothing else", async () => {
    setAuthorizedEnv();
    mockSuggestionFindUnique.mockResolvedValueOnce(fixtureSuggestion());
    const res = await action({
      request: deleteReq({ customerId: QA_ID, suggestionId: "suggestion-1" }, AUTH_HEADERS),
    } as any);
    expect(res.data).toEqual({ ok: true, deletedSuggestionId: "suggestion-1", deletedSessionId: "session-1" });
    expect(mockItemDeleteMany).toHaveBeenCalledWith({ where: { suggestionId: "suggestion-1" } });
    expect(mockSuggestionDelete).toHaveBeenCalledWith({ where: { id: "suggestion-1" } });
    expect(mockSessionDelete).toHaveBeenCalledWith({ where: { id: "session-1" } });
  });

  it("never touches a customer other than QA_OVERRIDE_CUSTOMER_ID, even with a correct secret", async () => {
    setAuthorizedEnv();
    const res = await action({
      request: deleteReq({ customerId: "some-other-customer", suggestionId: "suggestion-1" }, AUTH_HEADERS),
    } as any);
    expect(res.init?.status).toBe(403);
    expect(mockSuggestionFindUnique).not.toHaveBeenCalled();
  });
});
