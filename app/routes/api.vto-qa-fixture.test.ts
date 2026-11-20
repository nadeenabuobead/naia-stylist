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
const mockClosetItemFindFirst = vi.fn();
const mockClosetItemFindUnique = vi.fn();
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
      findFirst: (...args: unknown[]) => mockClosetItemFindFirst(...args),
      findUnique: (...args: unknown[]) => mockClosetItemFindUnique(...args),
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
// without needing real Cloudinary credentials. Defaults to null in every
// test (see beforeEach below) — the SAME behavior this file has always
// had — and is only overridden to a real-shaped config inside the
// full-look-real-garments-max describe block, which actually needs a
// cloudName to build the two synthetic items' public delivery URLs.
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
//
// 2026-11-20 (same day) — deleteCloudinaryAsset converted from "the real
// function, which fails closed with NOT_CONFIGURED since getCloudinaryConfig
// is null" to the SAME controllable-mock style as uploadCloudinaryPrivate,
// so the new full-look-real-garments-max cleanup path (two synthetic
// Cloudinary assets) can be asserted on precisely (which publicId, which
// deliveryType) rather than only inferred from a fixed fail-closed outcome.
// Defaults to the exact same NOT_CONFIGURED-shaped failure the real
// function previously produced, so every pre-existing test's expectations
// (e.g. the my-naia-model deletion test below) are unaffected.
const mockGetCloudinaryConfig = vi.fn();
const mockUploadCloudinaryPrivate = vi.fn();
const mockDeleteCloudinaryAsset = vi.fn();
// 2026-11-20 — verifyCloudinaryAsset added for the closet-real-shoe fixture
// (its only caller of this function in this file). Left as the real
// implementation everywhere else — every other existing fixture either
// never calls it or has its own already-passing coverage unaffected by
// this addition (it stays undefined until a test sets it, same posture
// as the other mocks below).
const mockVerifyCloudinaryAsset = vi.fn();
vi.mock("~/lib/cloudinary-admin.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/lib/cloudinary-admin.server")>();
  return {
    ...actual,
    getCloudinaryConfig: () => mockGetCloudinaryConfig(),
    uploadCloudinaryPrivate: (...args: unknown[]) => mockUploadCloudinaryPrivate(...args),
    deleteCloudinaryAsset: (...args: unknown[]) => mockDeleteCloudinaryAsset(...args),
    verifyCloudinaryAsset: (...args: unknown[]) => mockVerifyCloudinaryAsset(...args),
  };
});

// 2026-11-20 — the closet-real-shoe fixture's own external boundaries:
// moderation and suitability screening (real AI calls in production),
// garment-intelligence analysis (real AI call), and the deletion-record
// wrapper (used for discardUpload on every rejection path). Mocked the
// same way every other external boundary in this file is — a controllable
// vi.fn(), never the real network/AI call.
const mockModerateImageContent = vi.fn();
vi.mock("~/lib/image-moderation.server", () => ({
  moderateImageContent: (...args: unknown[]) => mockModerateImageContent(...args),
}));
const mockScreenGarmentSuitability = vi.fn();
vi.mock("~/lib/image-suitability.server", () => ({
  screenGarmentSuitability: (...args: unknown[]) => mockScreenGarmentSuitability(...args),
}));
const mockAnalyzeClosetGarment = vi.fn();
vi.mock("~/lib/ai/closet-garment-analysis.server", () => ({
  analyzeClosetGarment: (...args: unknown[]) => mockAnalyzeClosetGarment(...args),
}));
const mockDeleteCloudinaryAssetOrRecord = vi.fn();
vi.mock("~/lib/cloudinary-deletion-record.server", () => ({
  deleteCloudinaryAssetOrRecord: (...args: unknown[]) => mockDeleteCloudinaryAssetOrRecord(...args),
}));

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
// Real, unmocked — proves the corrected fixture's items actually clear the
// real (now-fixed) selection logic end-to-end, not just that 5 OutfitItem
// rows got written. See the "selects 5 distinct items" test below.
import { selectFullLookGarments, type SelectableOutfitItem } from "~/lib/ai/full-look-vto-orchestrator.server";

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
  // getCloudinaryConfig defaults to null, same as this file has always
  // used — only the full-look-real-garments-max describe block below
  // overrides this to a real-shaped config.
  mockGetCloudinaryConfig.mockReturnValue(null);
  // deleteCloudinaryAsset defaults to the exact NOT_CONFIGURED-shaped
  // failure the real function always produced in this suite (getCloudinary
  // Config has always been null here) — preserves every pre-existing
  // test's expectation unchanged.
  mockDeleteCloudinaryAsset.mockResolvedValue({ ok: false, errorCode: "NOT_CONFIGURED" });
  // Default: no real Clerk session attached — matches every existing test's
  // assumption that the real-session fallback does not kick in unless a
  // test explicitly sets up a session via mockGetCurrentNaiaCustomer.
  mockGetCurrentNaiaCustomer.mockResolvedValue(null);
  // Defaults for the closet-real-shoe fixture's own external boundaries —
  // a clean "everything passes" shape, matching every other happy-path
  // default above. Individual tests override one step at a time.
  mockVerifyCloudinaryAsset.mockResolvedValue({
    ok: true,
    asset: { publicId: "p", resourceType: "image", type: "private", version: "1", format: "webp", bytes: 50000, width: 800, height: 800 },
  });
  mockModerateImageContent.mockResolvedValue({ status: "PASS" });
  mockScreenGarmentSuitability.mockResolvedValue({ status: "PASS" });
  mockAnalyzeClosetGarment.mockResolvedValue(undefined);
  mockDeleteCloudinaryAssetOrRecord.mockResolvedValue({ ok: true });
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

  const SHOE_PUBLIC_ID = `naia-wardrobe/${QA_ID}/qa-fixture-synthetic-shoe`;
  const CAP_PUBLIC_ID = `naia-wardrobe/${QA_ID}/qa-fixture-synthetic-cap`;
  const REAL_SHOE_CLOSET_ITEM_ID = "closet-item-real-shoes-1";

  // 2026-11-20 — the SHOES slot now requires a REAL closet photo (no
  // synthetic fallback — see createFullLookRealGarmentsMaxFixture's own
  // comment on why). Default here: a real, eligible SHOES closet item IS
  // on record, so the happy-path tests below exercise the normal case;
  // the "no real shoe item" tests override this per-test. Only the cap
  // still uses the synthetic-upload path (unchanged). getCloudinaryConfig
  // defaults to null everywhere else in this file (see its own comment) —
  // overridden here to a real-shaped config so this block's URL-building
  // step has a cloudName to work with, exactly like a real staging
  // environment would.
  beforeEach(() => {
    mockGetCloudinaryConfig.mockReturnValue({ cloudName: "naia-test-cloud", apiKey: "test-key", apiSecret: "test-secret" });
    mockClosetItemFindFirst.mockResolvedValue({ id: REAL_SHOE_CLOSET_ITEM_ID, name: "Real Test Sneakers" });
    mockUploadCloudinaryPrivate.mockImplementation(async (publicId: string) => ({
      ok: true,
      publicId,
      format: "png",
      version: publicId === SHOE_PUBLIC_ID ? "100" : "101",
    }));
  });

  it("rejects with the same generic 403 when there is no real session attached", async () => {
    setAuthorizedEnv();
    const res = await action({ request: fullLookMaxReq() } as any);
    expect(res.init?.status).toBe(403);
    expect(mockSessionCreate).not.toHaveBeenCalled();
    expect(mockUploadCloudinaryPrivate).not.toHaveBeenCalled();
    expect(mockClosetItemFindFirst).not.toHaveBeenCalled();
  });

  it("creates exactly one StylingSession, one OutfitSuggestion (moodDescription left null), and exactly 5 OutfitItem rows — TOP, BOTTOM, OUTERWEAR, SHOES, ACCESSORY (5 genuinely distinct categories, not a repeated one)", async () => {
    setAuthorizedEnv();
    mockGetCurrentNaiaCustomer.mockResolvedValue({ id: QA_ID });
    const res = await action({ request: fullLookMaxReq() } as any);
    const payload = res.data as any;
    expect(payload.ok).toBe(true);
    expect(payload.fixtureKind).toBe("full-look-real-garments-max");
    expect(payload.itemCount).toBe(5);
    expect(payload.shoeSource).toBe("real-closet-item");
    expect(payload.shoeClosetItemId).toBe(REAL_SHOE_CLOSET_ITEM_ID);

    const suggestionCreateArg = mockSuggestionCreate.mock.calls[0][0];
    expect(suggestionCreateArg.data).not.toHaveProperty("moodDescription");

    expect(mockItemCreate).toHaveBeenCalledTimes(5);
    const itemTypes = mockItemCreate.mock.calls.map((call) => call[0].data.itemType).sort();
    expect(itemTypes).toEqual(["ACCESSORY", "BOTTOM", "OUTERWEAR", "SHOES", "TOP"]);
  });

  it("looks up a real SHOES closet item (imagePublicId/imageFormat present) for this exact customer before doing anything else", async () => {
    setAuthorizedEnv();
    mockGetCurrentNaiaCustomer.mockResolvedValue({ id: QA_ID });
    await action({ request: fullLookMaxReq() } as any);
    expect(mockClosetItemFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          customerId: QA_ID,
          category: "SHOES",
          imagePublicId: { not: null },
          imageFormat: { not: null },
        }),
      }),
    );
  });

  it("if no real SHOES closet item exists for this customer, fails clearly with no_real_shoe_closet_item and writes nothing — never silently falls back to a synthetic image", async () => {
    setAuthorizedEnv();
    mockGetCurrentNaiaCustomer.mockResolvedValue({ id: QA_ID });
    mockClosetItemFindFirst.mockResolvedValueOnce(null);
    const res = await action({ request: fullLookMaxReq() } as any);
    expect(res.init?.status).toBe(400);
    const payload = res.data as any;
    expect(payload.ok).toBe(false);
    expect(payload.code).toBe("no_real_shoe_closet_item");
    expect(mockUploadCloudinaryPrivate).not.toHaveBeenCalled();
    expect(mockSessionCreate).not.toHaveBeenCalled();
    expect(mockSuggestionCreate).not.toHaveBeenCalled();
    expect(mockItemCreate).not.toHaveBeenCalled();
  });

  it("uploads only the cap image (not a synthetic shoe) BEFORE writing any OutfitItem row, with the deterministic per-customer public id and delivery type 'upload' (public, not private)", async () => {
    setAuthorizedEnv();
    mockGetCurrentNaiaCustomer.mockResolvedValue({ id: QA_ID });
    await action({ request: fullLookMaxReq() } as any);
    expect(mockUploadCloudinaryPrivate).toHaveBeenCalledTimes(1);
    const call = mockUploadCloudinaryPrivate.mock.calls[0];
    expect(call[0]).toBe(CAP_PUBLIC_ID);
    expect(call[2]).toBe("upload"); // deliveryType — public, never "private"
  });

  it("the SHOES item uses closetItemId (the customer's own real photo), never productImageUrl; the 3 base items and ACCESSORY are unaffected by this change", async () => {
    setAuthorizedEnv();
    mockGetCurrentNaiaCustomer.mockResolvedValue({ id: QA_ID });
    await action({ request: fullLookMaxReq() } as any);
    for (const call of mockItemCreate.mock.calls) {
      const itemData = call[0].data;
      expect(itemData.productTitle).toMatch(/^\[QA FIXTURE\]/);
      expect(itemData.shopifyProductId).toBe("qa-fixture-full-look-real-garment-max");
      expect(itemData.shopifyProductId).not.toBe("qa-fixture-full-look-real-garment");
      if (itemData.itemType === "SHOES") {
        expect(itemData.closetItemId).toBe(REAL_SHOE_CLOSET_ITEM_ID);
        expect(itemData).not.toHaveProperty("productImageUrl");
      } else if (itemData.itemType === "ACCESSORY") {
        expect(itemData).not.toHaveProperty("closetItemId");
        expect(itemData.productImageUrl).toMatch(/^https:\/\/res\.cloudinary\.com\/naia-test-cloud\/image\/upload\//);
        expect(itemData.productImageUrl).not.toMatch(/cdn\.shopify\.com/);
      } else {
        expect(itemData).not.toHaveProperty("closetItemId");
        expect(itemData.productImageUrl).toMatch(/^https:\/\/cdn\.shopify\.com\//);
      }
    }
  });

  it("every item with a productImageUrl has a unique one — no duplicate asset reused across the slots that have one (the SHOES slot has none, it resolves via closetItemId instead)", async () => {
    setAuthorizedEnv();
    mockGetCurrentNaiaCustomer.mockResolvedValue({ id: QA_ID });
    await action({ request: fullLookMaxReq() } as any);
    const urls = mockItemCreate.mock.calls
      .map((call) => call[0].data.productImageUrl)
      .filter((url: string | undefined) => url !== undefined);
    expect(urls.length).toBe(4); // TOP, BOTTOM, OUTERWEAR, ACCESSORY — SHOES has none
    expect(new Set(urls).size).toBe(urls.length);
  });

  it("if the cap upload fails, NO row is written either — same discipline as before, now with only one upload to fail", async () => {
    setAuthorizedEnv();
    mockGetCurrentNaiaCustomer.mockResolvedValue({ id: QA_ID });
    mockUploadCloudinaryPrivate.mockImplementation(async (publicId: string) =>
      publicId === CAP_PUBLIC_ID ? { ok: false, errorCode: "PROVIDER_REJECTED" } : { ok: true, publicId, format: "png", version: "100" },
    );
    const res = await action({ request: fullLookMaxReq() } as any);
    expect(res.init?.status).toBe(502);
    const payload = res.data as any;
    expect(payload.ok).toBe(false);
    expect(payload.code).toBe("upload_failed");
    expect(mockSessionCreate).not.toHaveBeenCalled();
    expect(mockItemCreate).not.toHaveBeenCalled();
  });

  it("the corrected fixture's 5 items actually clear the REAL (now-fixed) selectFullLookGarments end-to-end: garments.length === 5, omittedLabels empty — proving the fix at the selection-logic level, not just that 5 rows got written", async () => {
    setAuthorizedEnv();
    mockGetCurrentNaiaCustomer.mockResolvedValue({ id: QA_ID });
    await action({ request: fullLookMaxReq() } as any);

    // Mirrors what a real read-back (suggestion.items.include.closetItem,
    // same shape api.full-look-vto.tsx's own loader uses) would return for
    // the SHOES item's closetItemId — resolveItemImage needs the relation
    // object itself, not just the id, to resolve a real photo.
    const items: SelectableOutfitItem[] = mockItemCreate.mock.calls.map((call) => ({
      itemType: call[0].data.itemType,
      productTitle: call[0].data.productTitle,
      productImageUrl: call[0].data.productImageUrl,
      closetItemId: call[0].data.closetItemId,
      closetItem: call[0].data.closetItemId
        ? { name: "Real Test Sneakers", imagePublicId: `naia-wardrobe/${QA_ID}/real-shoe-photo`, imageFormat: "jpg", category: "SHOES" }
        : null,
    }));

    // cloudinaryConfig must be real-shaped (not null) here — resolveItemImage's
    // closetItemId path (used by the SHOES item above) requires it to build
    // the signed private-download URL, exactly as it would in production.
    const result = selectFullLookGarments(items, {
      customerId: QA_ID,
      cloudinaryConfig: { cloudName: "naia-test-cloud", apiKey: "test-key", apiSecret: "test-secret" },
    });
    expect(result).not.toBeNull();
    expect(result?.garments.length).toBe(5);
    expect(result?.omittedLabels).toEqual([]);
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

  it("cleanup ALSO best-effort deletes the 2 synthetic Cloudinary assets (shoe + cap), delivery type 'upload', scoped to this customer — never for the 3-item fixture kind, which has no assets of its own", async () => {
    setAuthorizedEnv();
    mockGetCurrentNaiaCustomer.mockResolvedValue({ id: QA_ID });
    mockDeleteCloudinaryAsset.mockResolvedValue({ ok: true });
    mockSuggestionFindUnique.mockResolvedValueOnce(
      fixtureSuggestion({ items: [{ shopifyProductId: "qa-fixture-full-look-real-garment-max" }] }),
    );
    mockVtoJobCount.mockResolvedValueOnce(0);
    const res = await action({ request: deleteReq({ suggestionId: "suggestion-1" }) } as any);
    const payload = res.data as any;
    expect(payload.ok).toBe(true);
    expect(payload.cloudinaryAssetsDeleted).toBe(true);
    const deletedArgs = mockDeleteCloudinaryAsset.mock.calls.map((call) => call as [string, string]).sort();
    expect(deletedArgs).toEqual([
      [CAP_PUBLIC_ID, "upload"],
      [SHOE_PUBLIC_ID, "upload"],
    ]);
  });

  it("a failed Cloudinary cleanup is reported but NEVER fails the request — the DB rows are already gone by that point regardless", async () => {
    setAuthorizedEnv();
    mockGetCurrentNaiaCustomer.mockResolvedValue({ id: QA_ID });
    mockDeleteCloudinaryAsset.mockResolvedValue({ ok: false, errorCode: "PROVIDER_ERROR_500" });
    mockSuggestionFindUnique.mockResolvedValueOnce(
      fixtureSuggestion({ items: [{ shopifyProductId: "qa-fixture-full-look-real-garment-max" }] }),
    );
    mockVtoJobCount.mockResolvedValueOnce(0);
    const res = await action({ request: deleteReq({ suggestionId: "suggestion-1" }) } as any);
    const payload = res.data as any;
    expect(payload.ok).toBe(true);
    expect(payload.cloudinaryAssetsDeleted).toBe(false);
    expect(mockSuggestionDelete).toHaveBeenCalled();
  });

  it("cleanup of the 3-item (non-max) fixture kind never touches deleteCloudinaryAsset at all — it has no synthetic assets of its own", async () => {
    setAuthorizedEnv();
    mockGetCurrentNaiaCustomer.mockResolvedValue({ id: QA_ID });
    mockSuggestionFindUnique.mockResolvedValueOnce(
      fixtureSuggestion({ items: [{ shopifyProductId: "qa-fixture-full-look-real-garment" }] }),
    );
    mockVtoJobCount.mockResolvedValueOnce(0);
    const res = await action({ request: deleteReq({ suggestionId: "suggestion-1" }) } as any);
    const payload = res.data as any;
    expect(payload.ok).toBe(true);
    expect(payload).not.toHaveProperty("cloudinaryAssetsDeleted");
    expect(mockDeleteCloudinaryAsset).not.toHaveBeenCalled();
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
    // deleteCloudinaryAsset's mock defaults to the same NOT_CONFIGURED-
    // shaped failure the real function always produced here (getCloudinary
    // Config has always been null in this suite) — reported in the
    // response, not fatal to the DB cleanup itself.
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

describe("api.vto-qa-fixture action — fixtureKind: closet-real-shoe (real-session only, no secret, runs the real upload-validation pipeline)", () => {
  const VALID_DATA_URL = "data:image/webp;base64,UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==";

  function realShoeReq(overrides: Record<string, unknown> = {}) {
    return req({ fixtureKind: "closet-real-shoe", imageDataUrl: VALID_DATA_URL, ...overrides });
  }

  beforeEach(() => {
    // getCloudinaryConfig defaults to null everywhere else in this file —
    // overridden here to a real-shaped config, same pattern as the
    // full-look-real-garments-max block above, since this fixture's magic-
    // byte check needs a cloudName to build a download URL with.
    mockGetCloudinaryConfig.mockReturnValue({ cloudName: "naia-test-cloud", apiKey: "test-key", apiSecret: "test-secret" });
    // No prior fixture item on record by default — most tests exercise the
    // first-run (create) path. Idempotency tests override this.
    mockClosetItemFindFirst.mockResolvedValue(null);
    mockClosetItemCreate.mockResolvedValue({
      id: "closet-item-real-shoe-1",
      category: "SHOES",
      tryOnEligibility: "eligible",
    });
    // The magic-byte check fetches raw bytes from the signed download URL —
    // a real network call in production, mocked here the same way the rest
    // of this file treats its external boundaries. Defaults to a byte
    // sequence that is NOT a recognized image signature on purpose (this
    // fixture's code only rejects on a successful fetch whose bytes fail
    // detection — see closet._index.tsx's own identical "if (byteRes.ok)"
    // structure — a failed/non-ok fetch is silently treated as unverifiable
    // and does not itself reject). Real WEBP magic bytes are supplied by
    // vi.stubGlobal("fetch", ...) in the one test that exercises success
    // end-to-end AND the bad-signature rejection explicitly below.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: async () => new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]).buffer, // "RIFF....WEBP"
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("rejects with the same generic 403 when there is no real session attached, and touches nothing", async () => {
    setAuthorizedEnv();
    const res = await action({ request: realShoeReq() } as any);
    expect(res.init?.status).toBe(403);
    expect(mockClosetItemFindFirst).not.toHaveBeenCalled();
    expect(mockUploadCloudinaryPrivate).not.toHaveBeenCalled();
    expect(mockClosetItemCreate).not.toHaveBeenCalled();
  });

  it("rejects when genuinely signed in as a DIFFERENT customer than QA_OVERRIDE_CUSTOMER_ID", async () => {
    setAuthorizedEnv();
    mockGetCurrentNaiaCustomer.mockResolvedValue({ id: "some-other-real-customer" });
    const res = await action({ request: realShoeReq() } as any);
    expect(res.init?.status).toBe(403);
    expect(mockUploadCloudinaryPrivate).not.toHaveBeenCalled();
  });

  it("rejects even a genuinely-authenticated QA-account session when VERCEL_ENV is production — can never reach a real environment", async () => {
    setAuthorizedEnv();
    process.env.VERCEL_ENV = "production";
    mockGetCurrentNaiaCustomer.mockResolvedValue({ id: QA_ID });
    const res = await action({ request: realShoeReq() } as any);
    expect(res.init?.status).toBe(403);
    expect(mockUploadCloudinaryPrivate).not.toHaveBeenCalled();
  });

  it("rejects a missing imageDataUrl before the authorization check even has a body to act on", async () => {
    setAuthorizedEnv();
    mockGetCurrentNaiaCustomer.mockResolvedValue({ id: QA_ID });
    const res = await action({ request: req({ fixtureKind: "closet-real-shoe" }) } as any);
    expect(res.init?.status).toBe(400);
    expect((res.data as any).code).toBe("image_data_url_required");
    expect(mockUploadCloudinaryPrivate).not.toHaveBeenCalled();
  });

  it("rejects a string that is not a data:image/... URL", async () => {
    setAuthorizedEnv();
    mockGetCurrentNaiaCustomer.mockResolvedValue({ id: QA_ID });
    const res = await action({ request: realShoeReq({ imageDataUrl: "not-a-data-url" }) } as any);
    expect(res.init?.status).toBe(400);
    expect((res.data as any).code).toBe("invalid_image_data_url");
    expect(mockUploadCloudinaryPrivate).not.toHaveBeenCalled();
  });

  it("always derives the Cloudinary publicId from the session's own customerId — never from the request body — and it passes the real ownership-folder convention", async () => {
    setAuthorizedEnv();
    mockGetCurrentNaiaCustomer.mockResolvedValue({ id: QA_ID });
    await action({ request: realShoeReq({ customerId: "attacker-supplied-id" }) } as any);
    expect(mockUploadCloudinaryPrivate).toHaveBeenCalledWith(
      `naia-wardrobe/${QA_ID}/qa-fixture-real-shoe`,
      VALID_DATA_URL,
      "private",
    );
  });

  it("uploads via the private delivery type, never public — this is a real customer photo, not a FASHN-facing synthetic image", async () => {
    setAuthorizedEnv();
    mockGetCurrentNaiaCustomer.mockResolvedValue({ id: QA_ID });
    await action({ request: realShoeReq() } as any);
    expect(mockUploadCloudinaryPrivate.mock.calls[0][2]).toBe("private");
  });

  it("discards the upload and refuses when the Cloudinary upload call itself fails, and creates no ClosetItem", async () => {
    setAuthorizedEnv();
    mockGetCurrentNaiaCustomer.mockResolvedValue({ id: QA_ID });
    mockUploadCloudinaryPrivate.mockResolvedValue({ ok: false, errorCode: "NETWORK_ERROR" });
    const res = await action({ request: realShoeReq() } as any);
    expect(res.init?.status).toBe(502);
    expect((res.data as any).code).toBe("upload_failed");
    expect(mockClosetItemCreate).not.toHaveBeenCalled();
  });

  it("discards the upload and refuses when Cloudinary Admin API verification fails", async () => {
    setAuthorizedEnv();
    mockGetCurrentNaiaCustomer.mockResolvedValue({ id: QA_ID });
    mockUploadCloudinaryPrivate.mockResolvedValue({ ok: true, publicId: `naia-wardrobe/${QA_ID}/qa-fixture-real-shoe`, format: "webp", version: "1" });
    mockVerifyCloudinaryAsset.mockResolvedValue({ ok: false, errorCode: "NOT_FOUND" });
    const res = await action({ request: realShoeReq() } as any);
    expect(res.init?.status).toBe(400);
    expect((res.data as any).code).toBe("verify_failed");
    expect(mockDeleteCloudinaryAssetOrRecord).toHaveBeenCalledWith(
      expect.objectContaining({ customerId: QA_ID, publicId: `naia-wardrobe/${QA_ID}/qa-fixture-real-shoe`, deliveryType: "private" }),
    );
    expect(mockClosetItemCreate).not.toHaveBeenCalled();
  });

  it("rejects an asset whose verified delivery type is not 'private' (e.g. a public asset posing as this customer's own)", async () => {
    setAuthorizedEnv();
    mockGetCurrentNaiaCustomer.mockResolvedValue({ id: QA_ID });
    mockVerifyCloudinaryAsset.mockResolvedValue({
      ok: true,
      asset: { publicId: "p", resourceType: "image", type: "upload", version: "1", format: "webp", bytes: 50000, width: 800, height: 800 },
    });
    const res = await action({ request: realShoeReq() } as any);
    expect(res.init?.status).toBe(400);
    expect((res.data as any).code).toBe("wrong_delivery_type");
    expect(mockClosetItemCreate).not.toHaveBeenCalled();
  });

  it("rejects an asset whose verified resourceType is not 'image'", async () => {
    setAuthorizedEnv();
    mockGetCurrentNaiaCustomer.mockResolvedValue({ id: QA_ID });
    mockVerifyCloudinaryAsset.mockResolvedValue({
      ok: true,
      asset: { publicId: "p", resourceType: "video", type: "private", version: "1", format: "webp", bytes: 50000, width: 800, height: 800 },
    });
    const res = await action({ request: realShoeReq() } as any);
    expect(res.init?.status).toBe(400);
    expect((res.data as any).code).toBe("not_an_image");
  });

  it("rejects a format outside the real allowlist (e.g. gif), same set the real customer-facing upload enforces", async () => {
    setAuthorizedEnv();
    mockGetCurrentNaiaCustomer.mockResolvedValue({ id: QA_ID });
    mockVerifyCloudinaryAsset.mockResolvedValue({
      ok: true,
      asset: { publicId: "p", resourceType: "image", type: "private", version: "1", format: "gif", bytes: 50000, width: 800, height: 800 },
    });
    const res = await action({ request: realShoeReq() } as any);
    expect(res.init?.status).toBe(400);
    expect((res.data as any).code).toBe("format_not_allowed");
  });

  it("rejects a file larger than 5 MB, using the server-verified byte count, never a client-declared one", async () => {
    setAuthorizedEnv();
    mockGetCurrentNaiaCustomer.mockResolvedValue({ id: QA_ID });
    mockVerifyCloudinaryAsset.mockResolvedValue({
      ok: true,
      asset: { publicId: "p", resourceType: "image", type: "private", version: "1", format: "webp", bytes: 6 * 1024 * 1024, width: 800, height: 800 },
    });
    const res = await action({ request: realShoeReq() } as any);
    expect(res.init?.status).toBe(400);
    expect((res.data as any).code).toBe("image_too_large");
  });

  it("rejects an image narrower than the 200px minimum dimension", async () => {
    setAuthorizedEnv();
    mockGetCurrentNaiaCustomer.mockResolvedValue({ id: QA_ID });
    mockVerifyCloudinaryAsset.mockResolvedValue({
      ok: true,
      asset: { publicId: "p", resourceType: "image", type: "private", version: "1", format: "webp", bytes: 50000, width: 100, height: 800 },
    });
    const res = await action({ request: realShoeReq() } as any);
    expect(res.init?.status).toBe(400);
    expect((res.data as any).code).toBe("dimensions_out_of_range");
  });

  it("rejects an image exceeding the 8000px maximum dimension", async () => {
    setAuthorizedEnv();
    mockGetCurrentNaiaCustomer.mockResolvedValue({ id: QA_ID });
    mockVerifyCloudinaryAsset.mockResolvedValue({
      ok: true,
      asset: { publicId: "p", resourceType: "image", type: "private", version: "1", format: "webp", bytes: 50000, width: 800, height: 9000 },
    });
    const res = await action({ request: realShoeReq() } as any);
    expect(res.init?.status).toBe(400);
    expect((res.data as any).code).toBe("dimensions_out_of_range");
  });

  it("rejects when the fetched byte signature does not match a known image format, even though Cloudinary accepted the upload", async () => {
    setAuthorizedEnv();
    mockGetCurrentNaiaCustomer.mockResolvedValue({ id: QA_ID });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => new Uint8Array([0, 0, 0, 0]).buffer }));
    const res = await action({ request: realShoeReq() } as any);
    expect(res.init?.status).toBe(400);
    expect((res.data as any).code).toBe("bad_file_signature");
    expect(mockClosetItemCreate).not.toHaveBeenCalled();
  });

  it("rejects when moderation is unavailable — never silently proceeds past a down moderation service", async () => {
    setAuthorizedEnv();
    mockGetCurrentNaiaCustomer.mockResolvedValue({ id: QA_ID });
    mockModerateImageContent.mockResolvedValue({ status: "MODERATION_UNAVAILABLE" });
    const res = await action({ request: realShoeReq() } as any);
    expect(res.init?.status).toBe(503);
    expect((res.data as any).code).toBe("moderation_unavailable");
    expect(mockClosetItemCreate).not.toHaveBeenCalled();
  });

  it("rejects when moderation flags the image as unsafe", async () => {
    setAuthorizedEnv();
    mockGetCurrentNaiaCustomer.mockResolvedValue({ id: QA_ID });
    mockModerateImageContent.mockResolvedValue({ status: "SAFETY_REJECT", reasonCode: "explicit_content" });
    const res = await action({ request: realShoeReq() } as any);
    expect(res.init?.status).toBe(422);
    expect((res.data as any).code).toBe("safety_reject");
    expect(mockClosetItemCreate).not.toHaveBeenCalled();
  });

  it("rejects when garment suitability screening says RETRY_IMAGE (e.g. no garment visible)", async () => {
    setAuthorizedEnv();
    mockGetCurrentNaiaCustomer.mockResolvedValue({ id: QA_ID });
    mockScreenGarmentSuitability.mockResolvedValue({ status: "RETRY_IMAGE", subCode: "no_garment_visible" });
    const res = await action({ request: realShoeReq() } as any);
    expect(res.init?.status).toBe(422);
    expect((res.data as any).code).toBe("retry_image");
    expect(mockClosetItemCreate).not.toHaveBeenCalled();
  });

  it("rejects NEEDS_CLARIFICATION for a blocking subCode (e.g. color_indeterminate)", async () => {
    setAuthorizedEnv();
    mockGetCurrentNaiaCustomer.mockResolvedValue({ id: QA_ID });
    mockScreenGarmentSuitability.mockResolvedValue({ status: "NEEDS_CLARIFICATION", subCode: "color_indeterminate" });
    const res = await action({ request: realShoeReq() } as any);
    expect(res.init?.status).toBe(422);
    expect((res.data as any).code).toBe("needs_clarification");
    expect(mockClosetItemCreate).not.toHaveBeenCalled();
  });

  it("does NOT block on NEEDS_CLARIFICATION / category_mismatch — the declared SHOES category wins, same as the real action", async () => {
    setAuthorizedEnv();
    mockGetCurrentNaiaCustomer.mockResolvedValue({ id: QA_ID });
    mockScreenGarmentSuitability.mockResolvedValue({ status: "NEEDS_CLARIFICATION", subCode: "category_mismatch" });
    const res = await action({ request: realShoeReq() } as any);
    expect((res.data as any).ok).toBe(true);
    expect(mockClosetItemCreate).toHaveBeenCalled();
  });

  it("passes the declared category SHOES to garment suitability screening", async () => {
    setAuthorizedEnv();
    mockGetCurrentNaiaCustomer.mockResolvedValue({ id: QA_ID });
    await action({ request: realShoeReq() } as any);
    expect(mockScreenGarmentSuitability).toHaveBeenCalledWith(expect.any(String), { declaredCategory: "SHOES" });
  });

  it("happy path — creates exactly one SHOES ClosetItem with real imagePublicId/imageFormat, never the membership/capacity gate", async () => {
    setAuthorizedEnv();
    mockGetCurrentNaiaCustomer.mockResolvedValue({ id: QA_ID });
    const res = await action({ request: realShoeReq() } as any);
    const payload = res.data as any;
    expect(payload.ok).toBe(true);
    expect(payload.fixtureKind).toBe("closet-real-shoe");
    expect(payload.closetItemId).toBe("closet-item-real-shoe-1");
    expect(payload.imagePublicId).toBe(`naia-wardrobe/${QA_ID}/qa-fixture-real-shoe`);
    expect(payload.imageFormat).toBe("webp");
    expect(payload.reused).toBe(false);

    expect(mockClosetItemCreate).toHaveBeenCalledTimes(1);
    const createArg = mockClosetItemCreate.mock.calls[0][0].data;
    expect(createArg.customerId).toBe(QA_ID);
    expect(createArg.category).toBe("SHOES");
    expect(createArg.imagePublicId).toBe(`naia-wardrobe/${QA_ID}/qa-fixture-real-shoe`);
    expect(createArg.imageFormat).toBe("webp");
    expect(createArg.imageUrl).toBeNull();
    expect(createArg.analysisStatus).toBe("pending");
  });

  it("runs the same garment-intelligence analysis the real action runs, awaited, with the real publicId/format/category", async () => {
    setAuthorizedEnv();
    mockGetCurrentNaiaCustomer.mockResolvedValue({ id: QA_ID });
    await action({ request: realShoeReq() } as any);
    expect(mockAnalyzeClosetGarment).toHaveBeenCalledWith(
      expect.objectContaining({
        closetItemId: "closet-item-real-shoe-1",
        imagePublicId: `naia-wardrobe/${QA_ID}/qa-fixture-real-shoe`,
        category: "SHOES",
        imageFormat: "webp",
      }),
    );
  });

  it("is idempotent — a second call after a prior successful run reuses the existing item, never re-uploads or creates a duplicate", async () => {
    setAuthorizedEnv();
    mockGetCurrentNaiaCustomer.mockResolvedValue({ id: QA_ID });
    mockClosetItemFindFirst.mockResolvedValue({
      id: "closet-item-real-shoe-1",
      imagePublicId: `naia-wardrobe/${QA_ID}/qa-fixture-real-shoe`,
      imageFormat: "webp",
    });
    const res = await action({ request: realShoeReq() } as any);
    const payload = res.data as any;
    expect(payload.ok).toBe(true);
    expect(payload.reused).toBe(true);
    expect(payload.closetItemId).toBe("closet-item-real-shoe-1");
    expect(mockUploadCloudinaryPrivate).not.toHaveBeenCalled();
    expect(mockClosetItemCreate).not.toHaveBeenCalled();
    expect(mockAnalyzeClosetGarment).not.toHaveBeenCalled();
  });

  it("the idempotency lookup is scoped to category SHOES and this fixture's own marker name, within this exact customer only", async () => {
    setAuthorizedEnv();
    mockGetCurrentNaiaCustomer.mockResolvedValue({ id: QA_ID });
    await action({ request: realShoeReq() } as any);
    expect(mockClosetItemFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          customerId: QA_ID,
          category: "SHOES",
          name: "[QA FIXTURE] Real shoe (customer-supplied photo)",
        }),
      }),
    );
  });
});

describe("api.vto-qa-fixture action — DELETE fixtureKind: closet-real-shoe", () => {
  function deleteRealShoeReq(overrides: Record<string, unknown> = {}) {
    return deleteReq({ fixtureKind: "closet-real-shoe", ...overrides });
  }

  it("rejects with the same generic 403 when there is no real session attached", async () => {
    setAuthorizedEnv();
    const res = await action({ request: deleteRealShoeReq() } as any);
    expect(res.init?.status).toBe(403);
    expect(mockClosetItemDeleteMany).not.toHaveBeenCalled();
  });

  it("deletes exactly the marked fixture item for this session's own customer, scoped by category and marker name", async () => {
    setAuthorizedEnv();
    mockGetCurrentNaiaCustomer.mockResolvedValue({ id: QA_ID });
    mockClosetItemDeleteMany.mockResolvedValue({ count: 1 });
    const res = await action({ request: deleteRealShoeReq() } as any);
    expect((res.data as any)).toEqual({ ok: true, fixtureKind: "closet-real-shoe", deletedCount: 1 });
    expect(mockClosetItemDeleteMany).toHaveBeenCalledWith({
      where: { customerId: QA_ID, category: "SHOES", name: "[QA FIXTURE] Real shoe (customer-supplied photo)" },
    });
  });

  it("is idempotent — deleting when nothing exists returns ok:true with count 0, never an error", async () => {
    setAuthorizedEnv();
    mockGetCurrentNaiaCustomer.mockResolvedValue({ id: QA_ID });
    mockClosetItemDeleteMany.mockResolvedValue({ count: 0 });
    const res = await action({ request: deleteRealShoeReq() } as any);
    expect((res.data as any)).toEqual({ ok: true, fixtureKind: "closet-real-shoe", deletedCount: 0 });
  });
});


// ── closet-real-accessory (2026-11-20) ───────────────────────────────────────
describe("api.vto-qa-fixture action — fixtureKind: closet-real-accessory (hat/scarf/handbag/belt; same real-session gate + same upload-validation pipeline as closet-real-shoe)", () => {
  const VALID_DATA_URL = "data:image/webp;base64,UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==";
  const CASES = [
    { type: "hat", category: "ACCESSORIES", sub: "hat" },
    { type: "scarf", category: "ACCESSORIES", sub: "scarf" },
    { type: "handbag", category: "BAGS", sub: "handbag" },
    { type: "belt", category: "ACCESSORIES", sub: "belt" },
  ] as const;
  const pid = (type: string) => `naia-wardrobe/${QA_ID}/qa-fixture-real-${type}`;
  const marker = (type: string) => `[QA FIXTURE] Real ${type} (customer-supplied photo)`;

  function accReq(overrides: Record<string, unknown> = {}) {
    return req({ fixtureKind: "closet-real-accessory", accessoryType: "hat", imageDataUrl: VALID_DATA_URL, ...overrides });
  }

  beforeEach(() => {
    mockGetCloudinaryConfig.mockReturnValue({ cloudName: "naia-test-cloud", apiKey: "k", apiSecret: "s" });
    mockClosetItemFindFirst.mockResolvedValue(null);
    mockClosetItemFindUnique.mockResolvedValue(null);
    mockClosetItemCreate.mockResolvedValue({ id: "closet-item-acc-1", category: "ACCESSORIES", tryOnEligibility: "pending-assessment" });
    mockUploadCloudinaryPrivate.mockImplementation(async (publicId: string) => ({ ok: true, publicId, format: "webp", version: "1" }));
    mockVerifyCloudinaryAsset.mockResolvedValue({
      ok: true,
      asset: { publicId: "p", resourceType: "image", type: "private", version: "1", format: "webp", bytes: 50000, width: 800, height: 800 },
    });
    mockModerateImageContent.mockResolvedValue({ status: "SAFE" });
    mockScreenGarmentSuitability.mockResolvedValue({ status: "PASS", subCode: null });
    mockAnalyzeClosetGarment.mockResolvedValue(undefined);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]).buffer,
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("403 with no real session, and touches nothing", async () => {
    setAuthorizedEnv();
    const res = await action({ request: accReq() } as any);
    expect(res.init?.status).toBe(403);
    expect(mockUploadCloudinaryPrivate).not.toHaveBeenCalled();
    expect(mockClosetItemCreate).not.toHaveBeenCalled();
  });

  it("403 for a different real customer, and in production", async () => {
    setAuthorizedEnv();
    mockGetCurrentNaiaCustomer.mockResolvedValue({ id: "someone-else" });
    expect((await action({ request: accReq() } as any)).init?.status).toBe(403);
    mockGetCurrentNaiaCustomer.mockResolvedValue({ id: QA_ID });
    process.env.VERCEL_ENV = "production";
    expect((await action({ request: accReq() } as any)).init?.status).toBe(403);
    expect(mockUploadCloudinaryPrivate).not.toHaveBeenCalled();
  });

  it.each([undefined, "sock", "__proto__", "constructor", 5, null])("rejects invalid accessoryType %s before any upload", async (bad) => {
    setAuthorizedEnv();
    mockGetCurrentNaiaCustomer.mockResolvedValue({ id: QA_ID });
    const res = await action({ request: accReq({ accessoryType: bad }) } as any);
    expect(res.init?.status).toBe(400);
    expect((res.data as any).code).toBe("invalid_accessory_type");
    expect(mockUploadCloudinaryPrivate).not.toHaveBeenCalled();
    expect(mockClosetItemFindFirst).not.toHaveBeenCalled();
  });

  it("rejects missing and non-data-URL images before any upload", async () => {
    setAuthorizedEnv();
    mockGetCurrentNaiaCustomer.mockResolvedValue({ id: QA_ID });
    const missing = await action({ request: req({ fixtureKind: "closet-real-accessory", accessoryType: "hat" }) } as any);
    expect((missing.data as any).code).toBe("image_data_url_required");
    const bad = await action({ request: accReq({ imageDataUrl: "http://evil.example/x.png" }) } as any);
    expect((bad.data as any).code).toBe("invalid_image_data_url");
    expect(mockUploadCloudinaryPrivate).not.toHaveBeenCalled();
  });

  it.each(CASES)("$type: creates one $category item with subcategory $sub, private upload, customer-scoped publicId (never from body), no capacity gate", async ({ type, category, sub }) => {
    setAuthorizedEnv();
    mockGetCurrentNaiaCustomer.mockResolvedValue({ id: QA_ID });
    mockClosetItemFindUnique.mockResolvedValue({ subcategory: sub });
    const res = await action({ request: accReq({ accessoryType: type, customerId: "attacker" }) } as any);
    const payload = res.data as any;
    expect(payload).toMatchObject({ ok: true, fixtureKind: "closet-real-accessory", accessoryType: type, reused: false, vtoAllowed: true, subcategory: sub });
    expect(mockUploadCloudinaryPrivate).toHaveBeenCalledWith(pid(type), VALID_DATA_URL, "private");
    expect(mockClosetItemCreate).toHaveBeenCalledTimes(1);
    const d = mockClosetItemCreate.mock.calls[0][0].data;
    expect(d).toMatchObject({ customerId: QA_ID, category, subcategory: sub, name: marker(type), imagePublicId: pid(type), imageFormat: "webp", imageUrl: null, analysisStatus: "pending" });
    expect(mockScreenGarmentSuitability).toHaveBeenCalledWith(expect.any(String), { declaredCategory: category });
    expect(mockAnalyzeClosetGarment).toHaveBeenCalledWith(expect.objectContaining({ category, imagePublicId: pid(type) }));
  });

  it("reports vtoAllowed:false honestly when garment analysis rewrites the subcategory to a non-allowlisted value", async () => {
    setAuthorizedEnv();
    mockGetCurrentNaiaCustomer.mockResolvedValue({ id: QA_ID });
    mockClosetItemFindUnique.mockResolvedValue({ subcategory: "sunglasses" });
    const payload = (await action({ request: accReq() } as any)).data as any;
    expect(payload.ok).toBe(true);
    expect(payload.vtoAllowed).toBe(false);
    expect(payload.subcategory).toBe("sunglasses");
  });

  it("Stage-A eligibility is assessed with the declared accessory subcategory (hat is not rejected as unsupported ACCESSORIES)", async () => {
    setAuthorizedEnv();
    mockGetCurrentNaiaCustomer.mockResolvedValue({ id: QA_ID });
    await action({ request: accReq({ accessoryType: "hat" }) } as any);
    expect(mockClosetItemCreate.mock.calls[0][0].data.tryOnEligibility).not.toBe("not-supported");
  });

  it.each([
    ["verify_failed", () => mockVerifyCloudinaryAsset.mockResolvedValue({ ok: false, errorCode: "NOT_FOUND" }), 400],
    ["wrong_delivery_type", () => mockVerifyCloudinaryAsset.mockResolvedValue({ ok: true, asset: { resourceType: "image", type: "upload", format: "webp", bytes: 1000, width: 800, height: 800 } }), 400],
    ["format_not_allowed", () => mockVerifyCloudinaryAsset.mockResolvedValue({ ok: true, asset: { resourceType: "image", type: "private", format: "gif", bytes: 1000, width: 800, height: 800 } }), 400],
    ["image_too_large", () => mockVerifyCloudinaryAsset.mockResolvedValue({ ok: true, asset: { resourceType: "image", type: "private", format: "webp", bytes: 6 * 1024 * 1024, width: 800, height: 800 } }), 400],
    ["dimensions_out_of_range", () => mockVerifyCloudinaryAsset.mockResolvedValue({ ok: true, asset: { resourceType: "image", type: "private", format: "webp", bytes: 1000, width: 100, height: 800 } }), 400],
    ["moderation_unavailable", () => mockModerateImageContent.mockResolvedValue({ status: "MODERATION_UNAVAILABLE" }), 503],
    ["safety_reject", () => mockModerateImageContent.mockResolvedValue({ status: "SAFETY_REJECT", reasonCode: "x" }), 422],
    ["retry_image", () => mockScreenGarmentSuitability.mockResolvedValue({ status: "RETRY_IMAGE", subCode: "image_too_blurry" }), 422],
    ["needs_clarification", () => mockScreenGarmentSuitability.mockResolvedValue({ status: "NEEDS_CLARIFICATION", subCode: "multiple_items_ambiguous" }), 422],
  ])("pipeline reject %s: discards the private upload, returns %i-class error, writes no ClosetItem", async (code, arrange, status) => {
    setAuthorizedEnv();
    mockGetCurrentNaiaCustomer.mockResolvedValue({ id: QA_ID });
    (arrange as () => void)();
    const res = await action({ request: accReq({ accessoryType: "scarf" }) } as any);
    expect(res.init?.status).toBe(status);
    expect((res.data as any).code).toBe(code);
    expect(mockDeleteCloudinaryAssetOrRecord).toHaveBeenCalledWith(expect.objectContaining({ customerId: QA_ID, publicId: pid("scarf"), deliveryType: "private" }));
    expect(mockClosetItemCreate).not.toHaveBeenCalled();
  });

  it("a bad magic-byte signature is rejected and discarded", async () => {
    setAuthorizedEnv();
    mockGetCurrentNaiaCustomer.mockResolvedValue({ id: QA_ID });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => new Uint8Array(12).buffer }));
    const res = await action({ request: accReq() } as any);
    expect((res.data as any).code).toBe("bad_file_signature");
    expect(mockClosetItemCreate).not.toHaveBeenCalled();
  });

  it("category_mismatch from suitability screening is tolerated exactly as the shoe fixture does", async () => {
    setAuthorizedEnv();
    mockGetCurrentNaiaCustomer.mockResolvedValue({ id: QA_ID });
    mockScreenGarmentSuitability.mockResolvedValue({ status: "NEEDS_CLARIFICATION", subCode: "category_mismatch" });
    expect(((await action({ request: accReq() } as any)).data as any).ok).toBe(true);
  });

  it.each(CASES)("$type: idempotent — existing marked item is reused with no upload, create or analysis; lookup scoped to customer+category+marker", async ({ type, category }) => {
    setAuthorizedEnv();
    mockGetCurrentNaiaCustomer.mockResolvedValue({ id: QA_ID });
    mockClosetItemFindFirst.mockResolvedValue({ id: "existing-1", imagePublicId: pid(type), imageFormat: "webp" });
    const payload = (await action({ request: accReq({ accessoryType: type }) } as any)).data as any;
    expect(payload).toMatchObject({ ok: true, reused: true, closetItemId: "existing-1", fixtureKind: "closet-real-accessory" });
    expect(mockClosetItemFindFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ customerId: QA_ID, category, name: marker(type) }) }));
    expect(mockUploadCloudinaryPrivate).not.toHaveBeenCalled();
    expect(mockClosetItemCreate).not.toHaveBeenCalled();
    expect(mockAnalyzeClosetGarment).not.toHaveBeenCalled();
  });

  it("types never collide: each type uses its own marker and publicId", () => {
    const markers = new Set(CASES.map((c) => marker(c.type)));
    expect(markers.size).toBe(4);
  });

  it("does not touch the real-shoe fixture's marker/publicId", async () => {
    setAuthorizedEnv();
    mockGetCurrentNaiaCustomer.mockResolvedValue({ id: QA_ID });
    await action({ request: accReq({ accessoryType: "handbag" }) } as any);
    expect(mockUploadCloudinaryPrivate.mock.calls[0][0]).not.toContain("real-shoe");
    expect(mockClosetItemCreate.mock.calls[0][0].data.category).not.toBe("SHOES");
  });
});

describe("api.vto-qa-fixture action — DELETE fixtureKind: closet-real-accessory", () => {
  const del = (o: Record<string, unknown> = {}) => deleteReq({ fixtureKind: "closet-real-accessory", accessoryType: "hat", ...o });

  it("403 without a real session", async () => {
    setAuthorizedEnv();
    expect((await action({ request: del() } as any)).init?.status).toBe(403);
    expect(mockClosetItemDeleteMany).not.toHaveBeenCalled();
  });

  it("400 on an invalid accessoryType", async () => {
    setAuthorizedEnv();
    mockGetCurrentNaiaCustomer.mockResolvedValue({ id: QA_ID });
    const res = await action({ request: del({ accessoryType: "shoe" }) } as any);
    expect(res.init?.status).toBe(400);
    expect(mockClosetItemDeleteMany).not.toHaveBeenCalled();
  });

  it.each([["hat", "ACCESSORIES"], ["scarf", "ACCESSORIES"], ["handbag", "BAGS"], ["belt", "ACCESSORIES"]])("%s: deletes only this type's marked item for the session customer", async (type, category) => {
    setAuthorizedEnv();
    mockGetCurrentNaiaCustomer.mockResolvedValue({ id: QA_ID });
    mockClosetItemDeleteMany.mockResolvedValue({ count: 1 });
    const res = await action({ request: del({ accessoryType: type }) } as any);
    expect(res.data).toEqual({ ok: true, fixtureKind: "closet-real-accessory", accessoryType: type, deletedCount: 1 });
    expect(mockClosetItemDeleteMany).toHaveBeenCalledWith({ where: { customerId: QA_ID, category, name: `[QA FIXTURE] Real ${type} (customer-supplied photo)` } });
  });

  it("idempotent when nothing exists", async () => {
    setAuthorizedEnv();
    mockGetCurrentNaiaCustomer.mockResolvedValue({ id: QA_ID });
    mockClosetItemDeleteMany.mockResolvedValue({ count: 0 });
    expect(((await action({ request: del() } as any)).data as any).deletedCount).toBe(0);
  });
});

describe("api.vto-qa-fixture action — five-real-item acceptance path (full-look-real-garments-max-all-real) fails closed; legacy max kind stays synthetic-cap and says so", () => {
  const strictReq = () => req({ fixtureKind: "full-look-real-garments-max-all-real" });
  const legacyReq = () => req({ fixtureKind: "full-look-real-garments-max" });

  beforeEach(() => {
    mockGetCloudinaryConfig.mockReturnValue({ cloudName: "naia-test-cloud", apiKey: "k", apiSecret: "s" });
    mockClosetItemFindFirst.mockResolvedValue({ id: "shoe-1", name: "Real Shoe" });
    mockUploadCloudinaryPrivate.mockImplementation(async (publicId: string) => ({ ok: true, publicId, format: "png", version: "101" }));
  });

  it("strict: 403 without a real session, touches nothing", async () => {
    setAuthorizedEnv();
    expect((await action({ request: strictReq() } as any)).init?.status).toBe(403);
    expect(mockFindMany).not.toHaveBeenCalled();
    expect(mockSessionCreate).not.toHaveBeenCalled();
  });

  it("strict: uses a real VTO-allowed ACCESSORIES closet item, uploads nothing, writes 5 rows with zero synthetic placeholders", async () => {
    setAuthorizedEnv();
    mockGetCurrentNaiaCustomer.mockResolvedValue({ id: QA_ID });
    mockFindMany.mockResolvedValueOnce([
      { id: "shades-1", name: "Shades", subcategory: "sunglasses", tryOnEligibility: "pending-assessment" },
      { id: "hat-1", name: "[QA FIXTURE] Real hat (customer-supplied photo)", subcategory: "hat", tryOnEligibility: "pending-assessment" },
    ]);
    const payload = (await action({ request: strictReq() } as any)).data as any;
    expect(payload).toMatchObject({
      ok: true,
      fixtureKind: "full-look-real-garments-max-all-real",
      fixtureMode: "all-real",
      itemCount: 5,
      shoeSource: "real-closet-item",
      accessorySource: "real-closet-item",
      accessoryClosetItemId: "hat-1",
      syntheticPlaceholderCount: 0,
    });
    expect(mockUploadCloudinaryPrivate).not.toHaveBeenCalled();
    const rows = mockItemCreate.mock.calls.map((c) => c[0].data);
    expect(rows).toHaveLength(5);
    expect(rows.find((d) => d.itemType === "ACCESSORY").closetItemId).toBe("hat-1");
    expect(rows.find((d) => d.itemType === "ACCESSORY").productImageUrl).toBeUndefined();
  });

  it.each([
    ["no accessory rows at all", []],
    ["only a non-allowlisted subcategory", [{ id: "s", name: "Shades", subcategory: "sunglasses", tryOnEligibility: "pending-assessment" }]],
    ["allowlisted subcategory but marked not-supported", [{ id: "h", name: "Hat", subcategory: "hat", tryOnEligibility: "not-supported" }]],
    ["null subcategory", [{ id: "n", name: "Thing", subcategory: null, tryOnEligibility: null }]],
    ["allowlisted subcategory but needs-clearer-photo (e.g. under 300px)", [{ id: "c", name: "Scarf", subcategory: "scarf", tryOnEligibility: "needs-clearer-photo" }]],
    ["allowlisted subcategory but never assessed (null eligibility)", [{ id: "u", name: "Scarf", subcategory: "scarf", tryOnEligibility: null }]],
  ])("strict FAILS CLOSED with no_real_accessory_closet_item when %s — no upload, no rows, no synthetic substitution", async (_label, rows) => {
    setAuthorizedEnv();
    mockGetCurrentNaiaCustomer.mockResolvedValue({ id: QA_ID });
    mockFindMany.mockResolvedValueOnce(rows);
    const res = await action({ request: strictReq() } as any);
    expect(res.init?.status).toBe(400);
    expect((res.data as any)).toMatchObject({ ok: false, code: "no_real_accessory_closet_item" });
    expect(mockUploadCloudinaryPrivate).not.toHaveBeenCalled();
    expect(mockSessionCreate).not.toHaveBeenCalled();
    expect(mockSuggestionCreate).not.toHaveBeenCalled();
    expect(mockItemCreate).not.toHaveBeenCalled();
  });

  it("strict still requires the real shoe first (no_real_shoe_closet_item) and never reaches the accessory lookup", async () => {
    setAuthorizedEnv();
    mockGetCurrentNaiaCustomer.mockResolvedValue({ id: QA_ID });
    mockClosetItemFindFirst.mockResolvedValueOnce(null);
    const res = await action({ request: strictReq() } as any);
    expect((res.data as any).code).toBe("no_real_shoe_closet_item");
    expect(mockFindMany).not.toHaveBeenCalled();
  });

  it("legacy max kind is unchanged: ignores any real accessory, uploads the synthetic cap, and honestly reports it (syntheticPlaceholderCount 1)", async () => {
    setAuthorizedEnv();
    mockGetCurrentNaiaCustomer.mockResolvedValue({ id: QA_ID });
    mockFindMany.mockResolvedValue([{ id: "hat-1", name: "Hat", subcategory: "hat", tryOnEligibility: "pending-assessment" }]);
    const payload = (await action({ request: legacyReq() } as any)).data as any;
    expect(payload).toMatchObject({
      ok: true,
      fixtureKind: "full-look-real-garments-max",
      fixtureMode: "legacy-synthetic-cap",
      itemCount: 5,
      accessorySource: "synthetic-cap",
      syntheticPlaceholderCount: 1,
    });
    expect(payload.accessoryClosetItemId).toBeUndefined();
    expect(mockUploadCloudinaryPrivate).toHaveBeenCalledTimes(1);
    expect(mockFindMany).not.toHaveBeenCalled();
  });
});


describe("api.vto-qa-fixture action — closet-real-accessory reports real try-on eligibility (not just category allowance)", () => {
  const URL_ = "data:image/png;base64,iVBORw0KGgo=";
  const body = (o: Record<string, unknown> = {}) => req({ fixtureKind: "closet-real-accessory", accessoryType: "scarf", imageDataUrl: URL_, ...o });

  beforeEach(() => {
    mockGetCloudinaryConfig.mockReturnValue({ cloudName: "naia-test-cloud", apiKey: "k", apiSecret: "s" });
    mockClosetItemFindFirst.mockResolvedValue(null);
    mockClosetItemFindUnique.mockResolvedValue(null);
    mockClosetItemCreate.mockResolvedValue({ id: "acc-1", category: "ACCESSORIES", tryOnEligibility: "x" });
    mockUploadCloudinaryPrivate.mockImplementation(async (publicId: string) => ({ ok: true, publicId, format: "png", version: "1" }));
    mockModerateImageContent.mockResolvedValue({ status: "SAFE" });
    mockScreenGarmentSuitability.mockResolvedValue({ status: "PASS", subCode: null });
    mockAnalyzeClosetGarment.mockResolvedValue(undefined);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0, 0, 0, 0]).buffer }));
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  const verifyWith = (width: number, height: number) =>
    mockVerifyCloudinaryAsset.mockResolvedValue({ ok: true, asset: { publicId: "p", resourceType: "image", type: "private", version: "1", format: "png", bytes: 155233, width, height } });

  it("a 274x310 photo (below the 300px Stage-A minimum) is saved but reported tryOnEligible:false / needs-clearer-photo with a hint", async () => {
    setAuthorizedEnv();
    mockGetCurrentNaiaCustomer.mockResolvedValue({ id: QA_ID });
    verifyWith(274, 310);
    mockClosetItemFindUnique.mockResolvedValue({ subcategory: "scarf", tryOnEligibility: "needs-clearer-photo" });
    const p = (await action({ request: body() } as any)).data as any;
    expect(p).toMatchObject({ ok: true, vtoAllowed: true, tryOnEligibility: "needs-clearer-photo", tryOnEligible: false });
    expect(typeof p.photoHint).toBe("string");
    expect(mockClosetItemCreate.mock.calls[0][0].data.tryOnEligibility).toBe("needs-clearer-photo");
  });

  it("a 1200x1200 photo passes Stage A: tryOnEligible:true", async () => {
    setAuthorizedEnv();
    mockGetCurrentNaiaCustomer.mockResolvedValue({ id: QA_ID });
    verifyWith(1200, 1200);
    mockClosetItemFindUnique.mockResolvedValue({ subcategory: "scarf", tryOnEligibility: "pending-assessment" });
    const p = (await action({ request: body() } as any)).data as any;
    expect(p).toMatchObject({ ok: true, tryOnEligibility: "pending-assessment", tryOnEligible: true });
    expect(p.photoHint).toBeUndefined();
  });

  it("falls back to the Stage-A value if the post-analysis re-read fails", async () => {
    setAuthorizedEnv();
    mockGetCurrentNaiaCustomer.mockResolvedValue({ id: QA_ID });
    verifyWith(1200, 1200);
    mockClosetItemFindUnique.mockRejectedValue(new Error("db"));
    const p = (await action({ request: body() } as any)).data as any;
    expect(p).toMatchObject({ ok: true, tryOnEligibility: "pending-assessment", tryOnEligible: true });
  });

  it("the idempotent reuse path reports the stored eligibility too", async () => {
    setAuthorizedEnv();
    mockGetCurrentNaiaCustomer.mockResolvedValue({ id: QA_ID });
    mockClosetItemFindFirst.mockResolvedValue({ id: "acc-1", imagePublicId: "pid", imageFormat: "png", subcategory: "scarf", tryOnEligibility: "needs-clearer-photo" });
    const p = (await action({ request: body() } as any)).data as any;
    expect(p).toMatchObject({ ok: true, reused: true, accessoryType: "scarf", vtoAllowed: true, tryOnEligibility: "needs-clearer-photo", tryOnEligible: false });
    expect(mockUploadCloudinaryPrivate).not.toHaveBeenCalled();
  });
});
