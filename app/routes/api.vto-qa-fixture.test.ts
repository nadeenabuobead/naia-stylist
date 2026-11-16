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

vi.mock("~/lib/prisma.server", () => ({
  prisma: {
    closetItem: { findMany: (...args: unknown[]) => mockFindMany(...args) },
    outfitSuggestion: { findUnique: (...args: unknown[]) => mockSuggestionFindUnique(...args) },
    $transaction: async (fn: (tx: unknown) => unknown) =>
      fn({
        stylingSession: { create: (...args: unknown[]) => mockSessionCreate(...args) },
        outfitSuggestion: { create: (...args: unknown[]) => mockSuggestionCreate(...args) },
        outfitItem: { create: (...args: unknown[]) => mockItemCreate(...args) },
      }),
  },
}));

// getCloudinaryConfig is real code with real env-var reads — mocked here so
// the GET loader's call into the real selectFullLookGarments resolves
// images via the plain imageUrl fallback deterministically in tests,
// without needing real Cloudinary credentials.
vi.mock("~/lib/cloudinary-admin.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/lib/cloudinary-admin.server")>();
  return { ...actual, getCloudinaryConfig: () => null };
});

import { action, loader } from "./api.vto-qa-fixture";

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
    // Read-only: nothing created, same mocks from the action describe block untouched.
    expect(mockSessionCreate).not.toHaveBeenCalled();
    expect(mockSuggestionCreate).not.toHaveBeenCalled();
    expect(mockItemCreate).not.toHaveBeenCalled();
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
