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
const mockVtoJobDeleteMany = vi.fn();
const mockNaiaModelCreate = vi.fn();
const mockNaiaModelUpdate = vi.fn();
const mockNaiaModelUpdateMany = vi.fn();
const mockNaiaModelFindUnique = vi.fn();
const mockNaiaModelFindUniqueOrThrow = vi.fn();
const mockNaiaModelDelete = vi.fn();
const mockAdminAuditLogCreate = vi.fn();
const mockAdminAuditLogFindFirst = vi.fn();
const mockSuggestionCount = vi.fn();
const mockItemDeleteMany = vi.fn();
const mockSuggestionDelete = vi.fn();
const mockSessionDelete = vi.fn();
const mockClosetItemCreate = vi.fn();
const mockClosetItemDeleteMany = vi.fn();
const mockBosCreate = vi.fn();
const mockBosDeleteMany = vi.fn();

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
    closetItem: {
      findMany: (...args: unknown[]) => mockFindMany(...args),
      create: (...args: unknown[]) => mockClosetItemCreate(...args),
      deleteMany: (...args: unknown[]) => mockClosetItemDeleteMany(...args),
    },
    buyOrSkipAnalysis: {
      create: (...args: unknown[]) => mockBosCreate(...args),
      deleteMany: (...args: unknown[]) => mockBosDeleteMany(...args),
    },
    outfitSuggestion: {
      findUnique: (...args: unknown[]) => mockSuggestionFindUnique(...args),
      count: (...args: unknown[]) => mockSuggestionCount(...args),
      delete: (...args: unknown[]) => mockSuggestionDelete(...args),
    },
    outfitItem: { deleteMany: (...args: unknown[]) => mockItemDeleteMany(...args) },
    stylingSession: { delete: (...args: unknown[]) => mockSessionDelete(...args) },
    virtualTryOnJob: {
      count: (...args: unknown[]) => mockVtoJobCount(...args),
      findMany: (...args: unknown[]) => mockVtoJobFindMany(...args),
      deleteMany: (...args: unknown[]) => mockVtoJobDeleteMany(...args),
    },
    naiaModel: {
      create: (...args: unknown[]) => mockNaiaModelCreate(...args),
      update: (...args: unknown[]) => mockNaiaModelUpdate(...args),
      updateMany: (...args: unknown[]) => mockNaiaModelUpdateMany(...args),
      findUnique: (...args: unknown[]) => mockNaiaModelFindUnique(...args),
      findUniqueOrThrow: (...args: unknown[]) => mockNaiaModelFindUniqueOrThrow(...args),
      delete: (...args: unknown[]) => mockNaiaModelDelete(...args),
    },
    adminAuditLog: {
      create: (...args: unknown[]) => mockAdminAuditLogCreate(...args),
      findFirst: (...args: unknown[]) => mockAdminAuditLogFindFirst(...args),
    },
    // $transaction has two call shapes in the real code: a callback (the
    // POST action, creation) and a plain array of promises (the DELETE
    // cleanup action below) — mirrors both, same as the real Prisma client.
    $transaction: async (arg: unknown) => {
      if (Array.isArray(arg)) return Promise.all(arg);
      return (arg as (tx: unknown) => unknown)({
        stylingSession: { create: (...args: unknown[]) => mockSessionCreate(...args) },
        outfitSuggestion: { create: (...args: unknown[]) => mockSuggestionCreate(...args) },
        outfitItem: { create: (...args: unknown[]) => mockItemCreate(...args) },
        closetItem: { create: (...args: unknown[]) => mockClosetItemCreate(...args) },
        buyOrSkipAnalysis: { create: (...args: unknown[]) => mockBosCreate(...args) },
        naiaModel: {
          findUnique: (...args: unknown[]) => mockNaiaModelFindUnique(...args),
          findUniqueOrThrow: (...args: unknown[]) => mockNaiaModelFindUniqueOrThrow(...args),
          create: (...args: unknown[]) => mockNaiaModelCreate(...args),
          update: (...args: unknown[]) => mockNaiaModelUpdate(...args),
          updateMany: (...args: unknown[]) => mockNaiaModelUpdateMany(...args),
        },
        adminAuditLog: { create: (...args: unknown[]) => mockAdminAuditLogCreate(...args) },
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
  // Real value, not a fixture-specific placeholder — this fixture's own
  // comment explains why the written row must use the exact same constant
  // a real customer's consent record does.
  POLICY_VERSION: "1.0",
}));

// getCloudinaryConfig is real code with real env-var reads — mocked here so
// the GET loader's call into the real selectFullLookGarments resolves
// images via the plain imageUrl fallback deterministically in tests,
// without needing real Cloudinary credentials.
//
// 2026-11-20 — uploadCloudinaryPrivate is ALSO mocked here now (it was
// not before this fixture-photo-upload fix, because the route never
// called it before). Overriding the exported binding is required, not
// optional: the real uploadCloudinaryPrivate's own default _getConfig
// parameter closes over this SAME module's real (unmocked, env-var-
// reading) getCloudinaryConfig — not the overridden export above — so
// without this, every call would see no real CLOUDINARY_* env vars in
// the test process and fail closed with NOT_CONFIGURED, making every
// my-naia-model creation test fail the new upload step before ever
// reaching Prisma. Mirrors this file's own house style: a controllable
// vi.fn() standing in for the real Cloudinary network call, which must
// never actually happen in this suite.
const mockUploadCloudinaryPrivate = vi.fn();
vi.mock("~/lib/cloudinary-admin.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/lib/cloudinary-admin.server")>();
  return {
    ...actual,
    getCloudinaryConfig: () => null,
    uploadCloudinaryPrivate: (...args: unknown[]) => mockUploadCloudinaryPrivate(...args),
  };
});

// 2026-11-18 — the styleme-result-view fixture mode's real-session
// authorization path (resolveAuthorizedQaSessionCustomerId) calls the real
// getCurrentNaiaCustomer, which calls the real Clerk SDK. Mocked here the
// same way every other external boundary in this file is: a controllable
// vi.fn() standing in for "is there a real, authenticated Persona-A
// session attached to this request" — never the actual Clerk network call.
const mockGetCurrentNaiaCustomer = vi.fn();
vi.mock("~/lib/clerk-session.server", () => ({
  getCurrentNaiaCustomer: (...args: unknown[]) => mockGetCurrentNaiaCustomer(...args),
}));

import { action, loader, checkFashnCredits } from "./api.vto-qa-fixture";
import { readFileSync } from "node:fs";
import path from "node:path";

const QA_ID = "qa-disposable-customer-1";
const ORIGINAL_ENV = { ...process.env };

// ── Schema-driven guard against the class of defect this file's own
// history now includes (2026-11-18): a fixture's create() call omitting
// a field that prisma/schema.prisma declares required (no "?", no
// @default), surfacing only as a live 500 — never caught by typecheck
// (Prisma marks scalar-list fields optional in its generated CreateInput
// types regardless of whether a database-level default actually exists)
// and never caught by this file's own mocked Prisma (a mock has no NOT
// NULL constraint to violate). Parses the model's own field list directly
// out of the real schema file, so it also catches any FUTURE required
// field added to either model that a fixture forgets to supply — not
// just the one field (BuyOrSkipAnalysis.colors) that actually failed.
const SCHEMA_SOURCE = readFileSync(path.resolve("prisma/schema.prisma"), "utf8");
const SCALAR_BASE_TYPES = new Set(["String", "Int", "Float", "Boolean", "DateTime", "Json", "BigInt", "Decimal"]);

function getRequiredFieldsWithoutDefault(modelName: string): string[] {
  const modelMatch = SCHEMA_SOURCE.match(new RegExp(`model ${modelName} \\{([\\s\\S]*?)\\n\\}`));
  if (!modelMatch) {
    throw new Error(`model ${modelName} not found in prisma/schema.prisma — this test is out of date`);
  }
  const required: string[] = [];
  for (const rawLine of modelMatch[1].split("\n")) {
    const withoutComment = rawLine.split("//")[0].trim();
    if (!withoutComment || withoutComment.startsWith("@@")) continue;
    const fieldMatch = withoutComment.match(/^(\w+)\s+(\S+)(.*)$/);
    if (!fieldMatch) continue;
    const [, fieldName, fieldType, rest] = fieldMatch;
    if (fieldType.endsWith("?")) continue; // optional
    if (rest.includes("@relation")) continue; // FK-holder relation object field
    if (rest.includes("@default(")) continue; // has its own default
    if (rest.includes("@updatedAt")) continue; // managed by the query engine, not supplied by callers
    if (rest.includes("@id")) continue; // primary key
    const isArray = fieldType.endsWith("[]");
    const baseType = isArray ? fieldType.slice(0, -2) : fieldType;
    if (isArray && !SCALAR_BASE_TYPES.has(baseType)) continue; // back-relation list (e.g. OutfitItem[]), not a scalar
    required.push(fieldName);
  }
  return required;
}

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
    // Default marker matches styleme-result-view's own fixture items —
    // most existing tests exercise that kind. Full-Look-real-garments
    // tests override this explicitly with its own distinct marker.
    items: [{ shopifyProductId: "qa-fixture-not-a-real-product-id" }],
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
  mockVtoJobDeleteMany.mockResolvedValue({ count: 0 });
  mockNaiaModelCreate.mockResolvedValue({ id: "naiamodel-1", customerId: QA_ID, bodyPublicId: `naia-wardrobe/${QA_ID}/qa-fixture-synthetic-body` });
  mockNaiaModelUpdate.mockResolvedValue({ id: "naiamodel-1", customerId: QA_ID, bodyPublicId: `naia-wardrobe/${QA_ID}/qa-fixture-synthetic-body` });
  mockNaiaModelUpdateMany.mockResolvedValue({ count: 1 });
  mockNaiaModelFindUnique.mockResolvedValue(null);
  mockNaiaModelFindUniqueOrThrow.mockResolvedValue({ id: "naiamodel-1", bodyPublicId: `naia-wardrobe/${QA_ID}/qa-fixture-synthetic-body` });
  mockNaiaModelDelete.mockResolvedValue({ id: "naiamodel-1" });
  mockAdminAuditLogCreate.mockResolvedValue({ id: "auditlog-1" });
  mockAdminAuditLogFindFirst.mockResolvedValue(null);
  mockSuggestionCount.mockResolvedValue(1);
  mockItemDeleteMany.mockResolvedValue({ count: 1 });
  mockSuggestionDelete.mockResolvedValue({ id: "suggestion-1" });
  mockSessionDelete.mockResolvedValue({ id: "session-1" });
  mockClosetItemCreate.mockResolvedValue({ id: "closet-item-1" });
  mockClosetItemDeleteMany.mockResolvedValue({ count: 0 });
  mockBosCreate.mockResolvedValue({ id: "bos-1" });
  mockBosDeleteMany.mockResolvedValue({ count: 0 });
  mockLoadNaiaModel.mockResolvedValue({ bodyPublicId: "p", bodyFormat: "jpg", saveModelConsentAt: new Date() });
  // Default: the synthetic-photo upload succeeds, matching every existing
  // happy-path test's assumption that creation proceeds to write a
  // NaiaModel row. Individual tests override this to simulate an upload
  // failure.
  mockUploadCloudinaryPrivate.mockResolvedValue({
    ok: true,
    publicId: `naia-wardrobe/${QA_ID}/qa-fixture-synthetic-body`,
    format: "png",
    version: "1",
  });
  // Default: no real Clerk session attached — matches every existing test's
  // assumption that the real-session fallback does not kick in unless a
  // test explicitly sets up a session via mockGetCurrentNaiaCustomer.
  mockGetCurrentNaiaCustomer.mockResolvedValue(null);
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

describe("api.vto-qa-fixture action — fixtureKind: styleme-result-view (real-session auth, no secret)", () => {
  function styleMeReq(overrides: Record<string, unknown> = {}, headers: Record<string, string> = {}) {
    // Deliberately NO x-vto-qa-fixture-secret header — this mode is
    // authorized by a real Clerk session, never a secret. A test that
    // wants the happy path must set up mockGetCurrentNaiaCustomer, not a
    // header.
    return req({ fixtureKind: "styleme-result-view", ...overrides }, headers);
  }

  it("rejects with the same generic 403 when there is no real session attached (the no-session default)", async () => {
    setAuthorizedEnv();
    const res = await action({ request: styleMeReq() } as any);
    expect(res.init?.status).toBe(403);
    expect(mockSessionCreate).not.toHaveBeenCalled();
  });

  it("rejects with the same generic 403 when genuinely signed in, but as a DIFFERENT customer than QA_OVERRIDE_CUSTOMER_ID", async () => {
    setAuthorizedEnv();
    mockGetCurrentNaiaCustomer.mockResolvedValue({ id: "some-other-real-customer" });
    const res = await action({ request: styleMeReq() } as any);
    expect(res.init?.status).toBe(403);
    expect(mockSessionCreate).not.toHaveBeenCalled();
  });

  it("rejects even a genuinely-authenticated QA-account session when VERCEL_ENV is production — this can never reach a real environment", async () => {
    setAuthorizedEnv();
    process.env.VERCEL_ENV = "production";
    mockGetCurrentNaiaCustomer.mockResolvedValue({ id: QA_ID });
    const res = await action({ request: styleMeReq() } as any);
    expect(res.init?.status).toBe(403);
    expect(mockSessionCreate).not.toHaveBeenCalled();
  });

  it("ignores any customerId the body supplies — identity comes only from the verified session", async () => {
    setAuthorizedEnv();
    mockGetCurrentNaiaCustomer.mockResolvedValue({ id: QA_ID });
    // A client-supplied customerId claiming to be someone else must have
    // zero effect — the real session is the only source of truth.
    const res = await action({ request: styleMeReq({ customerId: "attacker-supplied-id" }) } as any);
    expect(res.init?.status).toBeUndefined(); // 200 default — succeeded
    expect(mockSessionCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { customerId: QA_ID } }),
    );
  });

  it("never touches closetItem.findMany — this fixture kind does not depend on the customer's real closet at all", async () => {
    setAuthorizedEnv();
    mockGetCurrentNaiaCustomer.mockResolvedValue({ id: QA_ID });
    await action({ request: styleMeReq() } as any);
    expect(mockFindMany).not.toHaveBeenCalled();
  });

  it("creates exactly one StylingSession, one OutfitSuggestion (moodDescription left null/default), and 3 OutfitItem rows", async () => {
    setAuthorizedEnv();
    mockGetCurrentNaiaCustomer.mockResolvedValue({ id: QA_ID });
    const res = await action({ request: styleMeReq() } as any);
    const payload = res.data as any;
    expect(payload.ok).toBe(true);
    expect(payload.fixtureKind).toBe("styleme-result-view");
    expect(payload.sessionId).toBe("session-1");
    expect(payload.suggestionId).toBe("suggestion-1");
    expect(payload.itemCount).toBe(3);

    expect(mockSessionCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { customerId: QA_ID } }),
    );
    // No moodDescription key at all — relies on the schema default (null),
    // the exact same convention the Full-Look fixture above already uses.
    const suggestionCreateArg = mockSuggestionCreate.mock.calls[0][0];
    expect(suggestionCreateArg.data).not.toHaveProperty("moodDescription");

    expect(mockItemCreate).toHaveBeenCalledTimes(3);
  });

  it("every created OutfitItem has closetItemId omitted (shop-style, not closet-sourced) and a clearly-fake, prefixed product identity", async () => {
    setAuthorizedEnv();
    mockGetCurrentNaiaCustomer.mockResolvedValue({ id: QA_ID });
    await action({ request: styleMeReq() } as any);
    for (const call of mockItemCreate.mock.calls) {
      const itemData = call[0].data;
      expect(itemData).not.toHaveProperty("closetItemId");
      expect(itemData.productTitle).toMatch(/^\[QA FIXTURE\]/);
      expect(itemData.shopifyProductId).toBe("qa-fixture-not-a-real-product-id");
      expect(itemData.productImageUrl).toBeNull();
    }
  });

  it("the existing DELETE cleanup action works against this fixture kind via the SAME real-session path, with no secret presented at all", async () => {
    setAuthorizedEnv();
    mockGetCurrentNaiaCustomer.mockResolvedValue({ id: QA_ID });
    mockSuggestionFindUnique.mockResolvedValueOnce(fixtureSuggestion());
    // No x-vto-qa-fixture-secret header at all — this is the whole point.
    const res = await action({ request: deleteReq({ suggestionId: "suggestion-1" }) } as any);
    const payload = res.data as any;
    expect(payload.ok).toBe(true);
    expect(mockItemDeleteMany).toHaveBeenCalledWith({ where: { suggestionId: "suggestion-1" } });
    expect(mockSuggestionDelete).toHaveBeenCalledWith({ where: { id: "suggestion-1" } });
    expect(mockSessionDelete).toHaveBeenCalledWith({ where: { id: "session-1" } });
  });
});


describe("api.vto-qa-fixture action — fixtureKind: closet-legacy-image-ownership (QA #36, real-session auth)", () => {
  function closetOwnershipReq(overrides: Record<string, unknown> = {}, headers: Record<string, string> = {}) {
    // Deliberately NO x-vto-qa-fixture-secret header — real-session auth only.
    return req({ fixtureKind: "closet-legacy-image-ownership", ...overrides }, headers);
  }
  function closetOwnershipDeleteReq(headers: Record<string, string> = {}) {
    return deleteReq({ fixtureKind: "closet-legacy-image-ownership" }, headers);
  }

  it("rejects with the same generic 403 when there is no real session attached", async () => {
    setAuthorizedEnv();
    const res = await action({ request: closetOwnershipReq() } as any);
    expect(res.init?.status).toBe(403);
    expect(mockClosetItemCreate).not.toHaveBeenCalled();
    expect(mockBosCreate).not.toHaveBeenCalled();
  });

  it("rejects with the same generic 403 when genuinely signed in as a DIFFERENT customer", async () => {
    setAuthorizedEnv();
    mockGetCurrentNaiaCustomer.mockResolvedValue({ id: "some-other-real-customer" });
    const res = await action({ request: closetOwnershipReq() } as any);
    expect(res.init?.status).toBe(403);
    expect(mockClosetItemCreate).not.toHaveBeenCalled();
  });

  it("rejects even a genuinely-authenticated QA-account session when VERCEL_ENV is production", async () => {
    setAuthorizedEnv();
    process.env.VERCEL_ENV = "production";
    mockGetCurrentNaiaCustomer.mockResolvedValue({ id: QA_ID });
    const res = await action({ request: closetOwnershipReq() } as any);
    expect(res.init?.status).toBe(403);
    expect(mockClosetItemCreate).not.toHaveBeenCalled();
  });

  it("creates exactly 2 ClosetItem rows and 2 BuyOrSkipAnalysis rows, all scoped to the session's own customerId", async () => {
    setAuthorizedEnv();
    mockGetCurrentNaiaCustomer.mockResolvedValue({ id: QA_ID });
    mockClosetItemCreate
      .mockResolvedValueOnce({ id: "closet-signed-priority" })
      .mockResolvedValueOnce({ id: "closet-ownership-rejection" });
    mockBosCreate
      .mockResolvedValueOnce({ id: "bos-signed-priority" })
      .mockResolvedValueOnce({ id: "bos-ownership-rejection" });

    const res = await action({ request: closetOwnershipReq() } as any);
    const payload = res.data as any;
    expect(payload.ok).toBe(true);
    expect(payload.fixtureKind).toBe("closet-legacy-image-ownership");
    expect(payload.closetItemIds).toEqual({ signedPriority: "closet-signed-priority", ownershipRejection: "closet-ownership-rejection" });
    expect(payload.buyOrSkipAnalysisIds).toEqual({ signedPriority: "bos-signed-priority", ownershipRejection: "bos-ownership-rejection" });

    expect(mockClosetItemCreate).toHaveBeenCalledTimes(2);
    expect(mockBosCreate).toHaveBeenCalledTimes(2);
    for (const call of [...mockClosetItemCreate.mock.calls, ...mockBosCreate.mock.calls]) {
      expect(call[0].data.customerId).toBe(QA_ID);
    }
  });

  it("the signed-priority row has BOTH imagePublicId+imageFormat AND a same-customer legacy imageUrl", async () => {
    setAuthorizedEnv();
    mockGetCurrentNaiaCustomer.mockResolvedValue({ id: QA_ID });
    await action({ request: closetOwnershipReq() } as any);
    const signedPriorityCall = mockClosetItemCreate.mock.calls[0][0].data;
    expect(signedPriorityCall.imagePublicId).toBe(`naia-wardrobe/${QA_ID}/qa-fixture-cloudinary-36-signed-priority`);
    expect(signedPriorityCall.imageFormat).toBe("jpg");
    expect(signedPriorityCall.imageUrl).toContain(`/naia-wardrobe/${QA_ID}/`);
    expect(signedPriorityCall.imageUrl).toContain("legacy-should-not-be-used");
  });

  it("the ownership-rejection row has NO imagePublicId/imageFormat and an imageUrl naming a DIFFERENT, non-real customer folder", async () => {
    setAuthorizedEnv();
    mockGetCurrentNaiaCustomer.mockResolvedValue({ id: QA_ID });
    await action({ request: closetOwnershipReq() } as any);
    const rejectionCall = mockClosetItemCreate.mock.calls[1][0].data;
    expect(rejectionCall.imagePublicId).toBeUndefined();
    expect(rejectionCall.imageFormat).toBeUndefined();
    expect(rejectionCall.imageUrl).not.toContain(`/naia-wardrobe/${QA_ID}/`);
    expect(rejectionCall.imageUrl).toContain("qa-fixture-other-customer-marker-not-a-real-customer");
    expect(rejectionCall.imageUrl).toContain("should-be-rejected");
  });

  it("ignores any customerId the body supplies — identity comes only from the verified session", async () => {
    setAuthorizedEnv();
    mockGetCurrentNaiaCustomer.mockResolvedValue({ id: QA_ID });
    await action({ request: closetOwnershipReq({ customerId: "attacker-supplied-id" }) } as any);
    for (const call of mockClosetItemCreate.mock.calls) {
      expect(call[0].data.customerId).toBe(QA_ID);
    }
  });

  it("DELETE removes only rows matching the QA image marker, scoped to the session's own customerId", async () => {
    setAuthorizedEnv();
    mockGetCurrentNaiaCustomer.mockResolvedValue({ id: QA_ID });
    mockClosetItemDeleteMany.mockResolvedValueOnce({ count: 2 });
    mockBosDeleteMany.mockResolvedValueOnce({ count: 2 });

    const res = await action({ request: closetOwnershipDeleteReq() } as any);
    const payload = res.data as any;
    expect(payload.ok).toBe(true);
    expect(payload.deletedClosetItemCount).toBe(2);
    expect(payload.deletedBuyOrSkipAnalysisCount).toBe(2);

    expect(mockClosetItemDeleteMany).toHaveBeenCalledWith({
      where: {
        customerId: QA_ID,
        OR: [
          { imagePublicId: { contains: "qa-fixture-cloudinary-36" } },
          { imageUrl: { contains: "qa-fixture-cloudinary-36" } },
        ],
      },
    });
    expect(mockBosDeleteMany).toHaveBeenCalledWith({
      where: {
        customerId: QA_ID,
        OR: [
          { imagePublicId: { contains: "qa-fixture-cloudinary-36" } },
          { imageUrl: { contains: "qa-fixture-cloudinary-36" } },
        ],
      },
    });
  });

  it("DELETE is idempotent — a second call with nothing left to delete still returns ok:true with count 0", async () => {
    setAuthorizedEnv();
    mockGetCurrentNaiaCustomer.mockResolvedValue({ id: QA_ID });
    // Defaults from beforeEach already resolve to { count: 0 } — simulates
    // calling cleanup again after the fixture was already removed.
    const res = await action({ request: closetOwnershipDeleteReq() } as any);
    const payload = res.data as any;
    expect(payload.ok).toBe(true);
    expect(payload.deletedClosetItemCount).toBe(0);
    expect(payload.deletedBuyOrSkipAnalysisCount).toBe(0);
  });

  it("DELETE rejects with 403 when there is no real session attached — cannot be invoked by secret alone", async () => {
    setAuthorizedEnv();
    const res = await action({ request: closetOwnershipDeleteReq({ "x-vto-qa-fixture-secret": "the-real-secret" }) } as any);
    expect(res.init?.status).toBe(403);
    expect(mockClosetItemDeleteMany).not.toHaveBeenCalled();
  });

  it("DELETE for this fixtureKind can never be scoped to a different customer — customerId always comes from the verified session, not the body", async () => {
    setAuthorizedEnv();
    mockGetCurrentNaiaCustomer.mockResolvedValue({ id: QA_ID });
    await action({ request: deleteReq({ fixtureKind: "closet-legacy-image-ownership", customerId: "attacker-supplied-id" }) } as any);
    expect(mockClosetItemDeleteMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ customerId: QA_ID }) }));
  });

  // 2026-11-18 — Five-Persona QA hit a live HTTP 500 on dpl_DC3RG7LiBsZUMyBxBVp2nsZJsFX6:
  // both BuyOrSkipAnalysis.create() calls omitted the required, no-default
  // `colors` field. Neither typecheck nor this file's own mocked Prisma
  // caught it — a mock has no NOT NULL constraint to violate, and Prisma's
  // generated CreateInput type marks scalar-list fields optional regardless
  // of whether a database-level default actually exists. These tests parse
  // the real schema instead of trusting the mock, so they also catch any
  // FUTURE required field either model gains that a fixture forgets.
  it("regression: every ClosetItem.create() call supplies every field prisma/schema.prisma declares required with no default", async () => {
    setAuthorizedEnv();
    mockGetCurrentNaiaCustomer.mockResolvedValue({ id: QA_ID });
    await action({ request: closetOwnershipReq() } as any);
    const requiredFields = getRequiredFieldsWithoutDefault("ClosetItem");
    expect(requiredFields.length).toBeGreaterThan(0);
    expect(mockClosetItemCreate.mock.calls.length).toBeGreaterThan(0);
    for (const call of mockClosetItemCreate.mock.calls) {
      for (const field of requiredFields) {
        expect(call[0].data, `ClosetItem.create() is missing required field "${field}"`).toHaveProperty(field);
      }
    }
  });

  it("regression: every BuyOrSkipAnalysis.create() call supplies every field prisma/schema.prisma declares required with no default", async () => {
    setAuthorizedEnv();
    mockGetCurrentNaiaCustomer.mockResolvedValue({ id: QA_ID });
    await action({ request: closetOwnershipReq() } as any);
    const requiredFields = getRequiredFieldsWithoutDefault("BuyOrSkipAnalysis");
    // Sanity check that the parser actually catches the exact field that
    // caused the live 500 — if this ever stops being true, the parser
    // itself has drifted from what it's meant to guard against.
    expect(requiredFields).toContain("colors");
    expect(mockBosCreate.mock.calls.length).toBeGreaterThan(0);
    for (const call of mockBosCreate.mock.calls) {
      for (const field of requiredFields) {
        expect(call[0].data, `BuyOrSkipAnalysis.create() is missing required field "${field}"`).toHaveProperty(field);
      }
    }
  });
});


describe("api.vto-qa-fixture action — fixtureKind: full-look-real-garments (real-session auth, real images, no secret)", () => {
  function fullLookReq(overrides: Record<string, unknown> = {}, headers: Record<string, string> = {}) {
    return req({ fixtureKind: "full-look-real-garments", ...overrides }, headers);
  }

  it("rejects with the same generic 403 when there is no real session attached", async () => {
    setAuthorizedEnv();
    const res = await action({ request: fullLookReq() } as any);
    expect(res.init?.status).toBe(403);
    expect(mockSessionCreate).not.toHaveBeenCalled();
  });

  it("rejects even a genuinely-authenticated QA-account session when VERCEL_ENV is production", async () => {
    setAuthorizedEnv();
    process.env.VERCEL_ENV = "production";
    mockGetCurrentNaiaCustomer.mockResolvedValue({ id: QA_ID });
    const res = await action({ request: fullLookReq() } as any);
    expect(res.init?.status).toBe(403);
  });

  it("ignores any customerId the body supplies — identity comes only from the verified session", async () => {
    setAuthorizedEnv();
    mockGetCurrentNaiaCustomer.mockResolvedValue({ id: QA_ID });
    const res = await action({ request: fullLookReq({ customerId: "attacker-supplied-id" }) } as any);
    expect(res.init?.status).toBeUndefined();
    expect(mockSessionCreate).toHaveBeenCalledWith(expect.objectContaining({ data: { customerId: QA_ID } }));
  });

  it("never touches closetItem.findMany — does not depend on the customer's real closet", async () => {
    setAuthorizedEnv();
    mockGetCurrentNaiaCustomer.mockResolvedValue({ id: QA_ID });
    await action({ request: fullLookReq() } as any);
    expect(mockFindMany).not.toHaveBeenCalled();
  });

  it("creates exactly one StylingSession, one OutfitSuggestion (moodDescription left null), and exactly 3 OutfitItem rows — TOP, BOTTOM, OUTERWEAR", async () => {
    setAuthorizedEnv();
    mockGetCurrentNaiaCustomer.mockResolvedValue({ id: QA_ID });
    const res = await action({ request: fullLookReq() } as any);
    const payload = res.data as any;
    expect(payload.ok).toBe(true);
    expect(payload.fixtureKind).toBe("full-look-real-garments");
    expect(payload.itemCount).toBe(3);

    const suggestionCreateArg = mockSuggestionCreate.mock.calls[0][0];
    expect(suggestionCreateArg.data).not.toHaveProperty("moodDescription");

    expect(mockItemCreate).toHaveBeenCalledTimes(3);
    const itemTypes = mockItemCreate.mock.calls.map((call) => call[0].data.itemType).sort();
    expect(itemTypes).toEqual(["BOTTOM", "OUTERWEAR", "TOP"]);
  });

  it("every created item has closetItemId omitted, a distinct fixture marker, a real https productImageUrl, and a [QA FIXTURE]-prefixed title", async () => {
    setAuthorizedEnv();
    mockGetCurrentNaiaCustomer.mockResolvedValue({ id: QA_ID });
    await action({ request: fullLookReq() } as any);
    for (const call of mockItemCreate.mock.calls) {
      const itemData = call[0].data;
      expect(itemData).not.toHaveProperty("closetItemId");
      expect(itemData.productTitle).toMatch(/^\[QA FIXTURE\]/);
      expect(itemData.shopifyProductId).toBe("qa-fixture-full-look-real-garment");
      expect(itemData.productImageUrl).toMatch(/^https:\/\/cdn\.shopify\.com\//);
    }
  });

  it("uses a DIFFERENT shopifyProductId marker than styleme-result-view, so the two fixture kinds are distinguishable for cleanup", async () => {
    setAuthorizedEnv();
    mockGetCurrentNaiaCustomer.mockResolvedValue({ id: QA_ID });
    await action({ request: fullLookReq() } as any);
    const marker = mockItemCreate.mock.calls[0][0].data.shopifyProductId;
    expect(marker).not.toBe("qa-fixture-not-a-real-product-id");
  });

  it("cleanup CASCADES through dependent VirtualTryOnJob rows for this fixture kind — the whole point of this fixture", async () => {
    setAuthorizedEnv();
    mockGetCurrentNaiaCustomer.mockResolvedValue({ id: QA_ID });
    mockSuggestionFindUnique.mockResolvedValueOnce(
      fixtureSuggestion({ items: [{ shopifyProductId: "qa-fixture-full-look-real-garment" }] }),
    );
    mockVtoJobCount.mockResolvedValueOnce(1); // a real job was created by a real Full-Look VTO run
    const res = await action({ request: deleteReq({ suggestionId: "suggestion-1" }) } as any);
    const payload = res.data as any;
    expect(payload.ok).toBe(true);
    expect(payload.deletedJobCount).toBe(1);
    expect(mockVtoJobDeleteMany).toHaveBeenCalledWith({ where: { outfitSuggestionId: "suggestion-1" } });
    expect(mockItemDeleteMany).toHaveBeenCalledWith({ where: { suggestionId: "suggestion-1" } });
    expect(mockSuggestionDelete).toHaveBeenCalledWith({ where: { id: "suggestion-1" } });
    expect(mockSessionDelete).toHaveBeenCalledWith({ where: { id: "session-1" } });
  });

  it("a styleme-result-view suggestion with a dependent job is still REFUSED — the cascade is scoped to this fixture kind only, not fixtures in general", async () => {
    setAuthorizedEnv();
    mockGetCurrentNaiaCustomer.mockResolvedValue({ id: QA_ID });
    // Default fixtureSuggestion() carries the styleme-result-view marker.
    mockSuggestionFindUnique.mockResolvedValueOnce(fixtureSuggestion());
    mockVtoJobCount.mockResolvedValueOnce(1);
    const res = await action({ request: deleteReq({ suggestionId: "suggestion-1" }) } as any);
    expect(res.init?.status).toBe(409);
    const payload = res.data as any;
    expect(payload.code).toBe("has_dependent_jobs");
    expect(mockVtoJobDeleteMany).not.toHaveBeenCalled();
    expect(mockSuggestionDelete).not.toHaveBeenCalled();
  });

  it("cleanup with zero dependent jobs never calls virtualTryOnJob.deleteMany at all (no-op, not an empty call)", async () => {
    setAuthorizedEnv();
    mockGetCurrentNaiaCustomer.mockResolvedValue({ id: QA_ID });
    mockSuggestionFindUnique.mockResolvedValueOnce(
      fixtureSuggestion({ items: [{ shopifyProductId: "qa-fixture-full-look-real-garment" }] }),
    );
    mockVtoJobCount.mockResolvedValueOnce(0);
    const res = await action({ request: deleteReq({ suggestionId: "suggestion-1" }) } as any);
    const payload = res.data as any;
    expect(payload.ok).toBe(true);
    expect(payload.deletedJobCount).toBe(0);
    expect(mockVtoJobDeleteMany).not.toHaveBeenCalled();
  });
});

describe("api.vto-qa-fixture action — fixtureKind: full-look-real-garments-max (FULL_LOOK_MAX_GARMENTS boundary, real images, no secret)", () => {
  function fullLookMaxReq(overrides: Record<string, unknown> = {}, headers: Record<string, string> = {}) {
    return req({ fixtureKind: "full-look-real-garments-max", ...overrides }, headers);
  }

  it("rejects with the same generic 403 when there is no real session attached", async () => {
    setAuthorizedEnv();
    const res = await action({ request: fullLookMaxReq() } as any);
    expect(res.init?.status).toBe(403);
    expect(mockSessionCreate).not.toHaveBeenCalled();
  });

  it("creates exactly one StylingSession, one OutfitSuggestion (moodDescription left null), and exactly 5 OutfitItem rows — 2 TOP, 1 BOTTOM, 2 OUTERWEAR", async () => {
    setAuthorizedEnv();
    mockGetCurrentNaiaCustomer.mockResolvedValue({ id: QA_ID });
    const res = await action({ request: fullLookMaxReq() } as any);
    const payload = res.data as any;
    expect(payload.ok).toBe(true);
    expect(payload.fixtureKind).toBe("full-look-real-garments-max");
    expect(payload.itemCount).toBe(5);

    const suggestionCreateArg = mockSuggestionCreate.mock.calls[0][0];
    expect(suggestionCreateArg.data).not.toHaveProperty("moodDescription");

    expect(mockItemCreate).toHaveBeenCalledTimes(5);
    const itemTypes = mockItemCreate.mock.calls.map((call) => call[0].data.itemType).sort();
    expect(itemTypes).toEqual(["BOTTOM", "OUTERWEAR", "OUTERWEAR", "TOP", "TOP"]);
  });

  it("every created item has closetItemId omitted, the MAX fixture's distinct marker (different from the 3-garment fixture's), a real https productImageUrl, and a [QA FIXTURE]-prefixed title", async () => {
    setAuthorizedEnv();
    mockGetCurrentNaiaCustomer.mockResolvedValue({ id: QA_ID });
    await action({ request: fullLookMaxReq() } as any);
    for (const call of mockItemCreate.mock.calls) {
      const itemData = call[0].data;
      expect(itemData).not.toHaveProperty("closetItemId");
      expect(itemData.productTitle).toMatch(/^\[QA FIXTURE\]/);
      expect(itemData.shopifyProductId).toBe("qa-fixture-full-look-real-garment-max");
      expect(itemData.shopifyProductId).not.toBe("qa-fixture-full-look-real-garment");
      expect(itemData.productImageUrl).toMatch(/^https:\/\/cdn\.shopify\.com\//);
    }
  });

  it("every item's productImageUrl is unique — no duplicate asset reused across the 5 slots", async () => {
    setAuthorizedEnv();
    mockGetCurrentNaiaCustomer.mockResolvedValue({ id: QA_ID });
    await action({ request: fullLookMaxReq() } as any);
    const urls = mockItemCreate.mock.calls.map((call) => call[0].data.productImageUrl);
    expect(new Set(urls).size).toBe(urls.length);
  });

  it("cleanup CASCADES through dependent VirtualTryOnJob rows for the MAX fixture kind too", async () => {
    setAuthorizedEnv();
    mockGetCurrentNaiaCustomer.mockResolvedValue({ id: QA_ID });
    mockSuggestionFindUnique.mockResolvedValueOnce(
      fixtureSuggestion({ items: [{ shopifyProductId: "qa-fixture-full-look-real-garment-max" }] }),
    );
    mockVtoJobCount.mockResolvedValueOnce(1);
    const res = await action({ request: deleteReq({ suggestionId: "suggestion-1" }) } as any);
    const payload = res.data as any;
    expect(payload.ok).toBe(true);
    expect(payload.deletedJobCount).toBe(1);
    expect(mockVtoJobDeleteMany).toHaveBeenCalledWith({ where: { outfitSuggestionId: "suggestion-1" } });
  });
});


describe("api.vto-qa-fixture action — fixtureKind: my-naia-model (real-session auth, real readiness fields)", () => {
  function modelReq(overrides: Record<string, unknown> = {}) {
    return req({ fixtureKind: "my-naia-model", ...overrides });
  }

  it("rejects with the same generic 403 when there is no real session attached", async () => {
    setAuthorizedEnv();
    const res = await action({ request: modelReq() } as any);
    expect(res.init?.status).toBe(403);
    expect(mockNaiaModelFindUnique).not.toHaveBeenCalled();
    expect(mockNaiaModelCreate).not.toHaveBeenCalled();
  });

  it("rejects even a genuinely-authenticated QA-account session when VERCEL_ENV is production", async () => {
    setAuthorizedEnv();
    process.env.VERCEL_ENV = "production";
    mockGetCurrentNaiaCustomer.mockResolvedValue({ id: QA_ID });
    const res = await action({ request: modelReq() } as any);
    expect(res.init?.status).toBe(403);
    expect(mockNaiaModelCreate).not.toHaveBeenCalled();
  });

  it("ignores any customerId the body supplies — identity comes only from the verified session", async () => {
    setAuthorizedEnv();
    mockGetCurrentNaiaCustomer.mockResolvedValue({ id: QA_ID });
    await action({ request: modelReq({ customerId: "attacker-supplied-id" }) } as any);
    expect(mockNaiaModelFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { customerId: QA_ID } }),
    );
    expect(mockNaiaModelCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ customerId: QA_ID }) }),
    );
  });

  it("writes exactly the fields real readiness checks require: non-empty bodyPublicId, bodyFormat, APPROVED moderation, and a non-null saveModelConsentAt", async () => {
    setAuthorizedEnv();
    mockGetCurrentNaiaCustomer.mockResolvedValue({ id: QA_ID });
    await action({ request: modelReq() } as any);
    const { data: fields } = mockNaiaModelCreate.mock.calls[0][0];
    expect(fields.bodyPublicId).toBe(`naia-wardrobe/${QA_ID}/qa-fixture-synthetic-body`);
    // Real, Cloudinary-reported format for the actual uploaded asset —
    // not assumed.
    expect(fields.bodyFormat).toBe("png");
    expect(fields.deliveryType).toBe("private");
    expect(fields.bodyModerationStatus).toBe("APPROVED");
    expect(fields.saveModelConsentAt).toBeInstanceOf(Date);
    // Same real constant a genuine customer's consent record uses — never
    // a fixture-specific placeholder value.
    expect(fields.consentPolicyVersion).toBe("1.0");
  });

  it("the written bodyPublicId satisfies validatePublicIdOwnership's own naia-wardrobe/<customerId>/ convention", async () => {
    setAuthorizedEnv();
    mockGetCurrentNaiaCustomer.mockResolvedValue({ id: QA_ID });
    await action({ request: modelReq() } as any);
    const { bodyPublicId } = mockNaiaModelCreate.mock.calls[0][0].data;
    expect(bodyPublicId.startsWith(`naia-wardrobe/${QA_ID}/`)).toBe(true);
  });

  it("OVERWRITE PROTECTION — refuses outright when a DIFFERENT (real or unrelated) NaiaModel row already exists for this customer, never touching it", async () => {
    setAuthorizedEnv();
    mockGetCurrentNaiaCustomer.mockResolvedValue({ id: QA_ID });
    mockNaiaModelFindUnique.mockResolvedValueOnce({
      id: "real-model-1",
      bodyPublicId: `naia-wardrobe/${QA_ID}/some-real-photo-from-onboarding`,
    });
    const res = await action({ request: modelReq() } as any);
    expect(res.init?.status).toBe(409);
    const payload = res.data as any;
    expect(payload.code).toBe("existing_model_present");
    expect(mockNaiaModelCreate).not.toHaveBeenCalled();
    expect(mockNaiaModelUpdate).not.toHaveBeenCalled();
  });

  it("re-running this fixture when the existing row is already its OWN prior fixture record safely re-writes via update, not create, and still refuses nothing real", async () => {
    setAuthorizedEnv();
    mockGetCurrentNaiaCustomer.mockResolvedValue({ id: QA_ID });
    mockNaiaModelFindUnique.mockResolvedValueOnce({
      id: "naiamodel-1",
      bodyPublicId: `naia-wardrobe/${QA_ID}/qa-fixture-synthetic-body`,
    });
    const res = await action({ request: modelReq() } as any);
    const payload = res.data as any;
    expect(payload.ok).toBe(true);
    expect(mockNaiaModelCreate).not.toHaveBeenCalled();
    expect(mockNaiaModelUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { customerId: QA_ID } }),
    );
  });

  it("OVERWRITE PROTECTION — a row with REAL consent but no bodyPublicId is still refused (consent alone is enough to block, not just a photo)", async () => {
    setAuthorizedEnv();
    mockGetCurrentNaiaCustomer.mockResolvedValue({ id: QA_ID });
    mockNaiaModelFindUnique.mockResolvedValueOnce({
      id: "real-model-2",
      bodyPublicId: null,
      saveModelConsentAt: new Date("2026-10-01T00:00:00Z"),
    });
    const res = await action({ request: modelReq() } as any);
    expect(res.init?.status).toBe(409);
    expect(mockNaiaModelCreate).not.toHaveBeenCalled();
    expect(mockNaiaModelUpdateMany).not.toHaveBeenCalled();
    expect(mockAdminAuditLogCreate).not.toHaveBeenCalled();
  });

  it("ADOPTION — a pre-existing row with no real photo and no real consent is adoptable: snapshots every field to AdminAuditLog, then overwrites via a compare-and-swap update", async () => {
    setAuthorizedEnv();
    mockGetCurrentNaiaCustomer.mockResolvedValue({ id: QA_ID });
    const existingStub = {
      id: "stub-model-1",
      bodyPublicId: null,
      bodyVersion: null,
      bodyFormat: "jpg", // stray — no bodyPublicId backs it, not real data
      facePublicId: null,
      faceVersion: null,
      faceFormat: null,
      deliveryType: "private",
      photoAnalysisConsentAt: null,
      saveModelConsentAt: null,
      consentPolicyVersion: null,
      bodyModerationStatus: "APPROVED", // stray — same reasoning
      bodyModerationAt: new Date("2026-11-16T11:06:39.235Z"),
    };
    mockNaiaModelFindUnique.mockResolvedValueOnce(existingStub);
    mockNaiaModelFindUniqueOrThrow.mockResolvedValueOnce({
      id: "stub-model-1",
      bodyPublicId: `naia-wardrobe/${QA_ID}/qa-fixture-synthetic-body`,
    });

    const res = await action({ request: modelReq() } as any);
    const payload = res.data as any;
    expect(payload.ok).toBe(true);
    expect(payload.adopted).toBe(true);
    expect(mockNaiaModelCreate).not.toHaveBeenCalled();

    // Snapshot written BEFORE the overwrite, capturing every field verbatim.
    const auditCall = mockAdminAuditLogCreate.mock.calls[0][0];
    expect(auditCall.data.action).toBe("qa_fixture_naia_model_adoption");
    expect(auditCall.data.detail.customerId).toBe(QA_ID);
    expect(auditCall.data.detail.originalFields.bodyFormat).toBe("jpg");
    expect(auditCall.data.detail.originalFields.bodyModerationStatus).toBe("APPROVED");
    expect(auditCall.data.detail.originalFields.bodyModerationAt).toBe("2026-11-16T11:06:39.235Z");
    expect(auditCall.data.detail.originalFields.bodyPublicId).toBeNull();
    expect(auditCall.data.detail.originalFields.saveModelConsentAt).toBeNull();

    // Compare-and-swap re-asserts no-real-photo/no-real-consent at write time.
    expect(mockNaiaModelUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { customerId: QA_ID, bodyPublicId: null, saveModelConsentAt: null } }),
    );
  });

  it("ADOPTION — a concurrent modification between read and write is detected and refused with 409, never silently overwritten", async () => {
    setAuthorizedEnv();
    mockGetCurrentNaiaCustomer.mockResolvedValue({ id: QA_ID });
    mockNaiaModelFindUnique.mockResolvedValueOnce({
      id: "stub-model-1",
      bodyPublicId: null,
      saveModelConsentAt: null,
      bodyFormat: null,
      bodyVersion: null,
      facePublicId: null,
      faceVersion: null,
      faceFormat: null,
      deliveryType: "private",
      photoAnalysisConsentAt: null,
      consentPolicyVersion: null,
      bodyModerationStatus: null,
      bodyModerationAt: null,
    });
    // Someone else wrote to this row between our read and our write.
    mockNaiaModelUpdateMany.mockResolvedValueOnce({ count: 0 });

    const res = await action({ request: modelReq() } as any);
    expect(res.init?.status).toBe(409);
    const payload = res.data as any;
    expect(payload.code).toBe("concurrent_modification");
  });

  it("DELETE restores the exact original fields from the adoption audit log, rather than deleting the row, when an adoption occurred", async () => {
    setAuthorizedEnv();
    mockGetCurrentNaiaCustomer.mockResolvedValue({ id: QA_ID });
    mockNaiaModelFindUnique.mockResolvedValueOnce({
      id: "stub-model-1",
      bodyPublicId: `naia-wardrobe/${QA_ID}/qa-fixture-synthetic-body`,
    });
    mockAdminAuditLogFindFirst.mockResolvedValueOnce({
      id: "auditlog-1",
      action: "qa_fixture_naia_model_adoption",
      detail: {
        customerId: QA_ID,
        originalFields: {
          facePublicId: null,
          faceVersion: null,
          faceFormat: null,
          bodyPublicId: null,
          bodyVersion: null,
          bodyFormat: "jpg",
          deliveryType: "private",
          photoAnalysisConsentAt: null,
          saveModelConsentAt: null,
          consentPolicyVersion: null,
          bodyModerationStatus: "APPROVED",
          bodyModerationAt: "2026-11-16T11:06:39.235Z",
        },
      },
    });

    const res = await action({ request: deleteReq({ fixtureKind: "my-naia-model" }) } as any);
    const payload = res.data as any;
    expect(payload.ok).toBe(true);
    expect(payload.restoredNaiaModelId).toBe("stub-model-1");
    expect(mockNaiaModelDelete).not.toHaveBeenCalled();

    const restoreCall = mockNaiaModelUpdate.mock.calls.find((c: any) => c[0].where?.customerId === QA_ID);
    expect(restoreCall).toBeDefined();
    const restoreData = restoreCall![0].data;
    expect(restoreData.bodyPublicId).toBeNull();
    expect(restoreData.bodyFormat).toBe("jpg");
    expect(restoreData.bodyModerationStatus).toBe("APPROVED");
    expect(restoreData.bodyModerationAt).toEqual(new Date("2026-11-16T11:06:39.235Z"));
    expect(restoreData.saveModelConsentAt).toBeNull();
  });

  it("DELETE still deletes the row entirely when no adoption log exists — i.e., the row was freshly created, not adopted", async () => {
    setAuthorizedEnv();
    mockGetCurrentNaiaCustomer.mockResolvedValue({ id: QA_ID });
    mockNaiaModelFindUnique.mockResolvedValueOnce({
      id: "naiamodel-1",
      bodyPublicId: `naia-wardrobe/${QA_ID}/qa-fixture-synthetic-body`,
    });
    mockAdminAuditLogFindFirst.mockResolvedValueOnce(null);

    const res = await action({ request: deleteReq({ fixtureKind: "my-naia-model" }) } as any);
    const payload = res.data as any;
    expect(payload.ok).toBe(true);
    expect(payload.deletedNaiaModelId).toBe("naiamodel-1");
    expect(mockNaiaModelDelete).toHaveBeenCalledWith({ where: { customerId: QA_ID } });
  });

  it("DELETE never restores from a DIFFERENT customer's adoption log entry — matches on customerId inside the detail, not just the most recent row", async () => {
    setAuthorizedEnv();
    mockGetCurrentNaiaCustomer.mockResolvedValue({ id: QA_ID });
    mockNaiaModelFindUnique.mockResolvedValueOnce({
      id: "naiamodel-1",
      bodyPublicId: `naia-wardrobe/${QA_ID}/qa-fixture-synthetic-body`,
    });
    mockAdminAuditLogFindFirst.mockResolvedValueOnce({
      id: "auditlog-2",
      action: "qa_fixture_naia_model_adoption",
      detail: { customerId: "a-completely-different-customer", originalFields: { bodyPublicId: "something" } },
    });

    const res = await action({ request: deleteReq({ fixtureKind: "my-naia-model" }) } as any);
    const payload = res.data as any;
    expect(payload.ok).toBe(true);
    expect(payload.deletedNaiaModelId).toBe("naiamodel-1");
    expect(mockNaiaModelDelete).toHaveBeenCalledWith({ where: { customerId: QA_ID } });
  });

  it("DELETE with fixtureKind my-naia-model removes exactly the fixture's own row, via the real-session path, no secret needed", async () => {
    setAuthorizedEnv();
    mockGetCurrentNaiaCustomer.mockResolvedValue({ id: QA_ID });
    mockNaiaModelFindUnique.mockResolvedValueOnce({
      id: "naiamodel-1",
      bodyPublicId: `naia-wardrobe/${QA_ID}/qa-fixture-synthetic-body`,
    });
    const res = await action({ request: deleteReq({ fixtureKind: "my-naia-model" }) } as any);
    const payload = res.data as any;
    expect(payload.ok).toBe(true);
    expect(payload.deletedNaiaModelId).toBe("naiamodel-1");
    expect(mockNaiaModelDelete).toHaveBeenCalledWith({ where: { customerId: QA_ID } });
    // getCloudinaryConfig is mocked to null in this file (see its own
    // comment) — deleteCloudinaryAsset is the REAL function, which fails
    // closed with NOT_CONFIGURED (no network call) rather than crashing.
    // Reported in the response, not fatal to the DB cleanup itself.
    expect(payload.cloudinaryAssetDeleted).toBe(false);
  });

  it("DELETE refuses a model whose bodyPublicId does NOT match this fixture's own value — never deletes a real, genuinely-configured model", async () => {
    setAuthorizedEnv();
    mockGetCurrentNaiaCustomer.mockResolvedValue({ id: QA_ID });
    mockNaiaModelFindUnique.mockResolvedValueOnce({
      id: "real-model-1",
      bodyPublicId: `naia-wardrobe/${QA_ID}/some-real-customer-photo`,
    });
    const res = await action({ request: deleteReq({ fixtureKind: "my-naia-model" }) } as any);
    expect(res.init?.status).toBe(404);
    expect(mockNaiaModelDelete).not.toHaveBeenCalled();
  });

  it("DELETE refuses when no model exists at all for this customer", async () => {
    setAuthorizedEnv();
    mockGetCurrentNaiaCustomer.mockResolvedValue({ id: QA_ID });
    mockNaiaModelFindUnique.mockResolvedValueOnce(null);
    const res = await action({ request: deleteReq({ fixtureKind: "my-naia-model" }) } as any);
    expect(res.init?.status).toBe(404);
    expect(mockNaiaModelDelete).not.toHaveBeenCalled();
  });

  it("DELETE with fixtureKind my-naia-model never touches the OutfitSuggestion cleanup path", async () => {
    setAuthorizedEnv();
    mockGetCurrentNaiaCustomer.mockResolvedValue({ id: QA_ID });
    mockNaiaModelFindUnique.mockResolvedValueOnce({
      id: "naiamodel-1",
      bodyPublicId: `naia-wardrobe/${QA_ID}/qa-fixture-synthetic-body`,
    });
    await action({ request: deleteReq({ fixtureKind: "my-naia-model" }) } as any);
    expect(mockSuggestionFindUnique).not.toHaveBeenCalled();
    expect(mockSuggestionDelete).not.toHaveBeenCalled();
  });

  // ── 2026-11-20 fixture-photo-upload fix ────────────────────────────────
  //
  // Root cause this covers: createMyNaiaModelFixture previously wrote
  // bodyPublicId/bodyFormat/APPROVED/consent fields straight to the DB
  // without ever uploading a real photo to that public_id — so a real
  // Full-Look VTO submission's downloadModelPhotoAsDataUrl (which
  // actually fetches the asset from Cloudinary) failed with
  // PROVIDER_ERROR before FASHN was ever reached. These tests prove the
  // fix: a real upload call happens, happens BEFORE any DB write claiming
  // readiness, and a failed upload never leaves that false state behind
  // — on every path that can write the row (fresh create, re-run/update-
  // own, and adopt).
  describe("fixtureKind: my-naia-model — synthetic photo upload (2026-11-20 fix)", () => {
    it("fresh create — uploads the synthetic photo with the exact publicId/deliveryType/targetFormat BEFORE writing the NaiaModel row", async () => {
      setAuthorizedEnv();
      mockGetCurrentNaiaCustomer.mockResolvedValue({ id: QA_ID });
      mockNaiaModelFindUnique.mockResolvedValueOnce(null);

      const res = await action({ request: modelReq() } as any);
      const payload = res.data as any;
      expect(payload.ok).toBe(true);

      expect(mockUploadCloudinaryPrivate).toHaveBeenCalledTimes(1);
      const [publicId, dataUrl, deliveryType, , , , targetFormat] = mockUploadCloudinaryPrivate.mock.calls[0];
      expect(publicId).toBe(`naia-wardrobe/${QA_ID}/qa-fixture-synthetic-body`);
      expect(typeof dataUrl).toBe("string");
      expect(dataUrl.startsWith("data:image/png;base64,")).toBe(true);
      expect(deliveryType).toBe("private");
      expect(targetFormat).toBe("png");

      // Upload happened before the DB write, not after or in parallel.
      expect(mockUploadCloudinaryPrivate.mock.invocationCallOrder[0]).toBeLessThan(
        mockNaiaModelCreate.mock.invocationCallOrder[0],
      );
    });

    it("fresh create — an upload failure returns upload_failed and writes no NaiaModel row at all", async () => {
      setAuthorizedEnv();
      mockGetCurrentNaiaCustomer.mockResolvedValue({ id: QA_ID });
      mockNaiaModelFindUnique.mockResolvedValueOnce(null);
      mockUploadCloudinaryPrivate.mockResolvedValueOnce({ ok: false, errorCode: "PROVIDER_REJECTED" });

      const res = await action({ request: modelReq() } as any);
      const payload = res.data as any;
      expect(payload.ok).toBe(false);
      expect(payload.code).toBe("upload_failed");
      expect(res.init?.status).toBe(502);

      expect(mockNaiaModelCreate).not.toHaveBeenCalled();
      expect(mockNaiaModelUpdate).not.toHaveBeenCalled();
      expect(mockNaiaModelUpdateMany).not.toHaveBeenCalled();
      expect(mockAdminAuditLogCreate).not.toHaveBeenCalled();
    });

    it("re-run (updated-own) — re-uploads the synthetic photo before updating the row again", async () => {
      setAuthorizedEnv();
      mockGetCurrentNaiaCustomer.mockResolvedValue({ id: QA_ID });
      mockNaiaModelFindUnique.mockResolvedValueOnce({
        id: "naiamodel-1",
        bodyPublicId: `naia-wardrobe/${QA_ID}/qa-fixture-synthetic-body`,
      });

      const res = await action({ request: modelReq() } as any);
      expect((res.data as any).ok).toBe(true);

      expect(mockUploadCloudinaryPrivate).toHaveBeenCalledTimes(1);
      expect(mockUploadCloudinaryPrivate.mock.calls[0][0]).toBe(`naia-wardrobe/${QA_ID}/qa-fixture-synthetic-body`);
      expect(mockUploadCloudinaryPrivate.mock.invocationCallOrder[0]).toBeLessThan(
        mockNaiaModelUpdate.mock.invocationCallOrder[0],
      );
    });

    it("re-run (updated-own) — an upload failure leaves the existing row untouched (no update attempted)", async () => {
      setAuthorizedEnv();
      mockGetCurrentNaiaCustomer.mockResolvedValue({ id: QA_ID });
      mockNaiaModelFindUnique.mockResolvedValueOnce({
        id: "naiamodel-1",
        bodyPublicId: `naia-wardrobe/${QA_ID}/qa-fixture-synthetic-body`,
      });
      mockUploadCloudinaryPrivate.mockResolvedValueOnce({ ok: false, errorCode: "NETWORK_ERROR" });

      const res = await action({ request: modelReq() } as any);
      expect((res.data as any).ok).toBe(false);
      expect((res.data as any).code).toBe("upload_failed");
      expect(mockNaiaModelUpdate).not.toHaveBeenCalled();
    });

    it("adopt path — also uploads the synthetic photo before the compare-and-swap update, not just DB field changes", async () => {
      setAuthorizedEnv();
      mockGetCurrentNaiaCustomer.mockResolvedValue({ id: QA_ID });
      const existingStub = {
        id: "stub-model-1",
        bodyPublicId: null,
        bodyVersion: null,
        bodyFormat: "jpg",
        facePublicId: null,
        faceVersion: null,
        faceFormat: null,
        deliveryType: "private",
        photoAnalysisConsentAt: null,
        saveModelConsentAt: null,
        consentPolicyVersion: null,
        bodyModerationStatus: "APPROVED",
        bodyModerationAt: new Date("2026-11-16T11:06:39.235Z"),
      };
      mockNaiaModelFindUnique.mockResolvedValueOnce(existingStub);
      mockNaiaModelFindUniqueOrThrow.mockResolvedValueOnce({
        id: "stub-model-1",
        bodyPublicId: `naia-wardrobe/${QA_ID}/qa-fixture-synthetic-body`,
      });

      const res = await action({ request: modelReq() } as any);
      const payload = res.data as any;
      expect(payload.ok).toBe(true);
      expect(payload.adopted).toBe(true);

      expect(mockUploadCloudinaryPrivate).toHaveBeenCalledTimes(1);
      expect(mockUploadCloudinaryPrivate.mock.calls[0][0]).toBe(`naia-wardrobe/${QA_ID}/qa-fixture-synthetic-body`);
      // Upload happened before the CAS update (and before the audit-log
      // snapshot's corresponding overwrite takes effect).
      expect(mockUploadCloudinaryPrivate.mock.invocationCallOrder[0]).toBeLessThan(
        mockNaiaModelUpdateMany.mock.invocationCallOrder[0],
      );
    });

    it("adopt path — an upload failure never adopts the row: no audit-log snapshot, no CAS update, row left exactly as found", async () => {
      setAuthorizedEnv();
      mockGetCurrentNaiaCustomer.mockResolvedValue({ id: QA_ID });
      mockNaiaModelFindUnique.mockResolvedValueOnce({
        id: "stub-model-1",
        bodyPublicId: null,
        bodyVersion: null,
        bodyFormat: "jpg",
        facePublicId: null,
        faceVersion: null,
        faceFormat: null,
        deliveryType: "private",
        photoAnalysisConsentAt: null,
        saveModelConsentAt: null,
        consentPolicyVersion: null,
        bodyModerationStatus: "APPROVED",
        bodyModerationAt: new Date("2026-11-16T11:06:39.235Z"),
      });
      mockUploadCloudinaryPrivate.mockResolvedValueOnce({ ok: false, errorCode: "PROVIDER_REJECTED" });

      const res = await action({ request: modelReq() } as any);
      const payload = res.data as any;
      expect(payload.ok).toBe(false);
      expect(payload.code).toBe("upload_failed");

      expect(mockAdminAuditLogCreate).not.toHaveBeenCalled();
      expect(mockNaiaModelUpdateMany).not.toHaveBeenCalled();
      expect(mockNaiaModelCreate).not.toHaveBeenCalled();
    });

    it("refused path (a real, different model already present) never attempts the upload at all", async () => {
      setAuthorizedEnv();
      mockGetCurrentNaiaCustomer.mockResolvedValue({ id: QA_ID });
      mockNaiaModelFindUnique.mockResolvedValueOnce({
        id: "real-model-1",
        bodyPublicId: `naia-wardrobe/${QA_ID}/some-real-photo-from-onboarding`,
      });

      const res = await action({ request: modelReq() } as any);
      expect(res.init?.status).toBe(409);
      expect(mockUploadCloudinaryPrivate).not.toHaveBeenCalled();
    });
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
    expect(res.data).toEqual({ ok: true, deletedSuggestionId: "suggestion-1", deletedSessionId: "session-1", deletedJobCount: 0 });
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
