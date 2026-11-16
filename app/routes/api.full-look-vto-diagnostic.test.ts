// app/routes/api.full-look-vto-diagnostic.test.ts
//
// TEMPORARY diagnostic route — tests for both its safety guarantees (no
// write/submit function imported or callable, customer-scoped by
// construction) and its actual reporting behavior. Fully mocked: no real
// DB, no real network.
//
// Run: npx vitest run app/routes/api.full-look-vto-diagnostic.test.ts

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

vi.mock("~/lib/naia-session.server", () => ({
  getCurrentNaiaCustomer: vi.fn(),
}));
vi.mock("~/db.server", () => ({
  default: {
    virtualTryOnJob: { findMany: vi.fn() },
    outfitSuggestion: { findUnique: vi.fn() },
  },
}));
vi.mock("~/lib/ai/full-look-tryon-real.server", () => ({
  checkFashnPredictionStatus: vi.fn(),
  REAL_PRODUCT_HANDLE_PREFIX: "fulllook-real",
  // Same derivation as the real function (naia-tryon-fulllook-intermediate/
  // {customerId}/{jobId}) — mocked rather than imported from importOriginal
  // since this module is otherwise fully replaced here; kept in sync by
  // the dedicated "matches the real derivation" test below.
  deriveIntermediateStepPublicId: vi.fn((customerId: string, jobId: string) => `naia-tryon-fulllook-intermediate/${customerId}/${jobId}`),
}));
vi.mock("~/lib/ai/full-look-vto-orchestrator.server", () => ({
  selectFullLookGarments: vi.fn(() => null), // default: no suggestion/selection — keeps existing tests unaffected
  resolveCurrentAttemptScope: vi.fn(),
}));
vi.mock("~/lib/cloudinary-admin.server", () => ({
  getCloudinaryConfig: vi.fn(() => null),
  listCloudinaryAssetsByPrefix: vi.fn(),
}));
vi.mock("~/lib/plan/entitlement.server", () => ({
  getEntitlementSummary: vi.fn(),
}));

import { getCurrentNaiaCustomer } from "~/lib/naia-session.server";
import prisma from "~/db.server";
import { checkFashnPredictionStatus } from "~/lib/ai/full-look-tryon-real.server";
import { selectFullLookGarments, resolveCurrentAttemptScope } from "~/lib/ai/full-look-vto-orchestrator.server";
import { getEntitlementSummary } from "~/lib/plan/entitlement.server";
import { listCloudinaryAssetsByPrefix } from "~/lib/cloudinary-admin.server";
import { loader } from "./api.full-look-vto-diagnostic";

const mockListAssets = () => listCloudinaryAssetsByPrefix as ReturnType<typeof vi.fn>;

const mockCustomer = () => getCurrentNaiaCustomer as ReturnType<typeof vi.fn>;
const mockFindMany = () => (prisma as any).virtualTryOnJob.findMany as ReturnType<typeof vi.fn>;
const mockFashnCheck = () => checkFashnPredictionStatus as ReturnType<typeof vi.fn>;
const mockFindSuggestion = () => (prisma as any).outfitSuggestion.findUnique as ReturnType<typeof vi.fn>;
const mockSelectGarments = () => selectFullLookGarments as ReturnType<typeof vi.fn>;
const mockResolveScope = () => resolveCurrentAttemptScope as ReturnType<typeof vi.fn>;
const mockEntitlementSummary = () => getEntitlementSummary as ReturnType<typeof vi.fn>;

function makeEntitlementSummary(overrides: Record<string, unknown> = {}) {
  return {
    vto: { monthlyLimit: 5, monthlyCompleted: 0, monthlyInFlight: 0, resetDate: "2026-12-01" },
    ...overrides,
  };
}

function makeJob(overrides: Record<string, unknown> = {}) {
  return {
    id: "job-1",
    customerId: "cust-1",
    outfitSuggestionId: "sugg-1",
    productHandle: "fulllook-real:step1:Beige Trousers",
    status: "PROCESSING",
    errorCode: null,
    predictionId: "pred-1",
    idempotencyKey: "fulllook-real-reservation:cust-1",
    createdAt: new Date("2026-11-15T14:28:18.000Z"),
    lastActivityAt: new Date("2026-11-15T14:28:19.000Z"),
    completedAt: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockEntitlementSummary().mockResolvedValue(makeEntitlementSummary());
  mockListAssets().mockResolvedValue({ ok: true, assets: [], nextCursor: null, rateLimitRemaining: null });
});

function makeRequest(url: string) {
  return { request: new Request(url) } as any;
}

describe("api.full-look-vto-diagnostic — safety guarantees (static source check)", () => {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const source = readFileSync(join(__dirname, "api.full-look-vto-diagnostic.tsx"), "utf8");

  it("imports none of the write/submission functions — checked as real import/call sites, not merely mentioned in this file's own explanatory comment", () => {
    // Strip the header comment block (the one place these names appear, by
    // name, explaining what was deliberately NOT done) before checking —
    // a bare substring match would trivially "find" them there.
    const codeOnly = source.replace(/\/\/.*$/gm, "");
    const forbidden = [
      "advanceFullLookChain",
      "startOrResumeFullLookChain",
      "submitFullLookRealStep",
      "advanceTryOnJob",
      "createOrFindTryOnJob",
      "reconcileStaleFullLookJobForCustomer",
      "pollFullLookOutfit",
      "startFullLookOutfit",
    ];
    for (const name of forbidden) {
      expect(codeOnly.includes(name)).toBe(false);
    }
  });

  it("has no action export — POST is impossible on this route", () => {
    expect(source.includes("export async function action")).toBe(false);
    expect(source.includes("export function action")).toBe(false);
  });

  it("every prisma call is findMany (read) — no create/update/delete anywhere", () => {
    expect(source.includes("prisma.virtualTryOnJob.create")).toBe(false);
    expect(source.includes("prisma.virtualTryOnJob.update")).toBe(false);
    expect(source.includes("prisma.virtualTryOnJob.delete")).toBe(false);
    expect(source.includes(".findMany(")).toBe(true);
  });

  it("the customerId filter comes from the session, never from request input", () => {
    expect(source.includes("customerId: customer.id")).toBe(true);
  });
});

describe("api.full-look-vto-diagnostic — loader behavior", () => {
  it("rejects unauthenticated requests before any DB access", async () => {
    mockCustomer().mockResolvedValue(null);
    const res = await loader(makeRequest("https://x.test/api/full-look-vto-diagnostic?suggestionId=sugg-1"));
    expect(res.init?.status ?? (res as any).status).toBe(401);
    expect(mockFindMany()).not.toHaveBeenCalled();
  });

  it("rejects a missing suggestionId before any DB access", async () => {
    mockCustomer().mockResolvedValue({ id: "cust-1" });
    const res = await loader(makeRequest("https://x.test/api/full-look-vto-diagnostic"));
    expect(res.init?.status ?? (res as any).status).toBe(400);
    expect(mockFindMany()).not.toHaveBeenCalled();
  });

  it("queries only by the SESSION's customerId plus the requested suggestionId — never trusts a client-supplied customerId", async () => {
    mockCustomer().mockResolvedValue({ id: "cust-1" });
    mockFindMany().mockResolvedValue([]);
    await loader(makeRequest("https://x.test/api/full-look-vto-diagnostic?suggestionId=sugg-1&customerId=someone-else"));
    expect(mockFindMany()).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ customerId: "cust-1", outfitSuggestionId: "sugg-1" }) }),
    );
  });

  it("reports each job's local status and derives finalStepCompleted correctly when final is COMPLETED", async () => {
    mockCustomer().mockResolvedValue({ id: "cust-1" });
    const jobs = [
      makeJob({ id: "job-0", productHandle: "fulllook-real:step1:Trousers", status: "COMPLETED", predictionId: "p0" }),
      makeJob({
        id: "job-final", productHandle: "fulllook-real:final:Blazer", status: "COMPLETED",
        predictionId: "pf", completedAt: new Date(), isTest: false,
      }),
    ];
    mockFindMany().mockResolvedValue(jobs);
    mockEntitlementSummary().mockResolvedValue(
      makeEntitlementSummary({ vto: { monthlyLimit: 5, monthlyCompleted: 1, monthlyInFlight: 0, resetDate: "2026-12-01" } }),
    );
    const res: any = await loader(makeRequest("https://x.test/api/full-look-vto-diagnostic?suggestionId=sugg-1"));
    const body = res.data ?? res;
    expect(body.finalStepCompleted).toBe(true);
    expect(body.totalJobRows).toBe(2);
    expect(mockFashnCheck()).not.toHaveBeenCalled(); // nothing is PROCESSING, so no live check is made
    // REGRESSION — this now queries entitlement.server.ts's REAL counting
    // function (getEntitlementSummary) instead of hardcoding false. A
    // COMPLETED, non-test final step IS counted.
    expect(body.realCreditAccounting).toEqual({
      verified: true,
      vtoMonthlyLimit: 5,
      vtoMonthlyCompleted: 1,
      vtoMonthlyInFlight: 0,
      thisSuggestionsFinalStepStatus: "COMPLETED",
      thisSuggestionsFinalStepIsTest: false,
      thisAttemptsFinalStepWouldCountTowardEntitlement: true,
      note: expect.stringContaining("A credit has been consumed"),
    });
  });

  it("reports thisAttemptsFinalStepWouldCountTowardEntitlement: false when there is no final-step row at all — the real, calculated answer, not an assumption", async () => {
    mockCustomer().mockResolvedValue({ id: "cust-1" });
    const jobs = [makeJob({ id: "job-0", productHandle: "fulllook-real:step1:Trousers", status: "PROCESSING", predictionId: "p0" })];
    mockFindMany().mockResolvedValue(jobs);
    mockFashnCheck().mockResolvedValue({ ok: true, body: { status: "processing" } });

    const res: any = await loader(makeRequest("https://x.test/api/full-look-vto-diagnostic?suggestionId=sugg-1"));
    const body = res.data ?? res;

    expect(body.realCreditAccounting.thisSuggestionsFinalStepStatus).toBe("no_final_step_row");
    expect(body.realCreditAccounting.thisAttemptsFinalStepWouldCountTowardEntitlement).toBe(false);
    expect(body.realCreditAccounting.note).toContain("No credit has been consumed");
  });

  it("a final step that IS completed but IS a test job does NOT count toward entitlement — isTest exclusion respected", async () => {
    mockCustomer().mockResolvedValue({ id: "cust-1" });
    const jobs = [
      makeJob({
        id: "job-final", productHandle: "fulllook-real:final:Blazer", status: "COMPLETED",
        predictionId: "pf", completedAt: new Date(), isTest: true,
      }),
    ];
    mockFindMany().mockResolvedValue(jobs);

    const res: any = await loader(makeRequest("https://x.test/api/full-look-vto-diagnostic?suggestionId=sugg-1"));
    const body = res.data ?? res;

    expect(body.realCreditAccounting.thisSuggestionsFinalStepIsTest).toBe(true);
    expect(body.realCreditAccounting.thisAttemptsFinalStepWouldCountTowardEntitlement).toBe(false);
  });

  it("performs exactly one live, read-only FASHN status check for a PROCESSING row with a predictionId — never more, never a submission", async () => {
    mockCustomer().mockResolvedValue({ id: "cust-1" });
    const jobs = [makeJob({ status: "PROCESSING", predictionId: "pred-1" })];
    mockFindMany().mockResolvedValue(jobs);
    mockFashnCheck().mockResolvedValue({ ok: true, body: { status: "processing" } });

    const res: any = await loader(makeRequest("https://x.test/api/full-look-vto-diagnostic?suggestionId=sugg-1"));
    const body = res.data ?? res;

    expect(mockFashnCheck()).toHaveBeenCalledTimes(1);
    expect(mockFashnCheck()).toHaveBeenCalledWith("pred-1");
    expect(body.steps[0].liveFashnStatus).toBe("processing");
    expect(body.finalStepCompleted).toBe(false);
  });

  it("never calls the live FASHN check for a row that is not locally PROCESSING, even if it has a predictionId", async () => {
    mockCustomer().mockResolvedValue({ id: "cust-1" });
    const jobs = [makeJob({ status: "TIMED_OUT", predictionId: "pred-1", errorCode: "ABANDONED_NO_POLL" })];
    mockFindMany().mockResolvedValue(jobs);

    const res: any = await loader(makeRequest("https://x.test/api/full-look-vto-diagnostic?suggestionId=sugg-1"));
    const body = res.data ?? res;

    expect(mockFashnCheck()).not.toHaveBeenCalled();
    expect(body.steps[0].status).toBe("TIMED_OUT");
    expect(body.steps[0].errorCode).toBe("ABANDONED_NO_POLL");
  });

  it("a FASHN status-check failure is reported, not thrown — never crashes the diagnostic itself", async () => {
    mockCustomer().mockResolvedValue({ id: "cust-1" });
    mockFindMany().mockResolvedValue([makeJob({ status: "PROCESSING", predictionId: "pred-1" })]);
    mockFashnCheck().mockResolvedValue({ ok: false });

    const res: any = await loader(makeRequest("https://x.test/api/full-look-vto-diagnostic?suggestionId=sugg-1"));
    const body = res.data ?? res;
    expect(body.steps[0].liveFashnStatus).toBe("status_check_failed");
  });
});

describe("api.full-look-vto-diagnostic — scopeCheck (empirical scope-resolution comparison)", () => {
  const suggestionFixture = { id: "sugg-1", session: { customerId: "cust-1" }, items: [] };

  it("reports a mismatch when the freshly-resolved scope does not match any existing step-0 job's own scope — the exact empirical signal for the reported bug", async () => {
    mockCustomer().mockResolvedValue({ id: "cust-1" });
    mockFindSuggestion().mockResolvedValue(suggestionFixture);
    mockSelectGarments().mockReturnValue({ garments: [], omittedLabels: [], fingerprint: "fp-abc" });
    mockResolveScope().mockResolvedValue("sugg-1:a2:fp-abc"); // what a GET refresh would resolve to right now
    const jobs = [
      makeJob({
        id: "job-c-step1",
        status: "PROCESSING",
        predictionId: "pred-c",
        idempotencyKey: "fulllook-real-reservation:cust-1:sugg-1:a2:fp-xyz", // the ACTUAL attempt's own scope — different fingerprint
      }),
    ];
    mockFindMany().mockResolvedValue(jobs);

    const res: any = await loader(makeRequest("https://x.test/api/full-look-vto-diagnostic?suggestionId=sugg-1"));
    const body = res.data ?? res;

    expect(body.scopeCheck.attempted).toBe(true);
    expect(body.scopeCheck.currentlyResolvedScope).toBe("sugg-1:a2:fp-abc");
    expect(body.scopeCheck.step0Jobs).toEqual([
      { jobId: "job-c-step1", status: "PROCESSING", ownScope: "sugg-1:a2:fp-xyz" },
    ]);
    expect(body.scopeCheck.aScopeMatchesTheMostRecentStep0Job).toBe(false);
  });

  it("reports a match when the freshly-resolved scope equals the most recent step-0 job's own scope", async () => {
    mockCustomer().mockResolvedValue({ id: "cust-1" });
    mockFindSuggestion().mockResolvedValue(suggestionFixture);
    mockSelectGarments().mockReturnValue({ garments: [], omittedLabels: [], fingerprint: "fp-abc" });
    mockResolveScope().mockResolvedValue("sugg-1:a2:fp-abc");
    const jobs = [
      makeJob({ id: "job-a-step1", idempotencyKey: "fulllook-real-reservation:cust-1:sugg-1:a0:fp-abc" }),
      makeJob({ id: "job-c-step1", idempotencyKey: "fulllook-real-reservation:cust-1:sugg-1:a2:fp-abc" }),
    ];
    mockFindMany().mockResolvedValue(jobs);

    const res: any = await loader(makeRequest("https://x.test/api/full-look-vto-diagnostic?suggestionId=sugg-1"));
    const body = res.data ?? res;

    expect(body.scopeCheck.aScopeMatchesTheMostRecentStep0Job).toBe(true);
  });

  it("the scope check never writes anything and never calls a submission function — it only calls resolveCurrentAttemptScope and selectFullLookGarments, both pure/read", async () => {
    mockCustomer().mockResolvedValue({ id: "cust-1" });
    mockFindSuggestion().mockResolvedValue(suggestionFixture);
    mockSelectGarments().mockReturnValue({ garments: [], omittedLabels: [], fingerprint: "fp-abc" });
    mockResolveScope().mockResolvedValue("sugg-1:a0:fp-abc");
    mockFindMany().mockResolvedValue([]);

    await loader(makeRequest("https://x.test/api/full-look-vto-diagnostic?suggestionId=sugg-1"));

    expect(mockResolveScope()).toHaveBeenCalledTimes(1);
    expect(mockResolveScope()).toHaveBeenCalledWith("cust-1", "sugg-1", "fp-abc");
  });

  it("reports a clean error, not a crash, when the suggestion belongs to a different customer", async () => {
    mockCustomer().mockResolvedValue({ id: "cust-1" });
    mockFindSuggestion().mockResolvedValue({ id: "sugg-1", session: { customerId: "someone-else" }, items: [] });
    mockFindMany().mockResolvedValue([]);

    const res: any = await loader(makeRequest("https://x.test/api/full-look-vto-diagnostic?suggestionId=sugg-1"));
    const body = res.data ?? res;

    expect(body.scopeCheck.attempted).toBe(true);
    expect(body.scopeCheck.error).toBeDefined();
    expect(mockResolveScope()).not.toHaveBeenCalled();
  });
});

// 2026-11-16 — the one narrowly-scoped, explicitly authorized, read-only
// Cloudinary metadata check for the exact UPLOAD_FAILED asset.
describe("cloudinaryAssetCheck — narrowly-scoped, read-only, one asset only", () => {
  it("checks exactly the single most recent UPLOAD_FAILED intermediate job's own asset — never a broader prefix, never the whole customer's folder", async () => {
    mockCustomer().mockResolvedValue({ id: "cust-1" });
    const jobs = [
      makeJob({ id: "job-older", productHandle: "fulllook-real:step1:Trousers", status: "FAILED", errorCode: "UPLOAD_FAILED", createdAt: new Date("2026-11-14T00:00:00.000Z") }),
      makeJob({ id: "job-newer", productHandle: "fulllook-real:step1:Trousers", status: "FAILED", errorCode: "UPLOAD_FAILED", createdAt: new Date("2026-11-15T00:00:00.000Z") }),
    ];
    mockFindMany().mockResolvedValue(jobs);
    mockListAssets().mockResolvedValueOnce({
      ok: true,
      assets: [{ publicId: "naia-tryon-fulllook-intermediate/cust-1/job-newer", resourceType: "image", type: "private", format: "png", createdAt: "2026-11-16T06:55:40.000Z" }],
      nextCursor: null,
      rateLimitRemaining: 95,
    });

    const res: any = await loader(makeRequest("https://x.test/api/full-look-vto-diagnostic?suggestionId=sugg-1"));
    const body = res.data ?? res;

    expect(mockListAssets()).toHaveBeenCalledTimes(1);
    const [prefixArg, deliveryTypeArg, optsArg] = mockListAssets().mock.calls[0];
    expect(prefixArg).toBe("naia-tryon-fulllook-intermediate/cust-1/job-newer"); // the NEWER one, never job-older
    expect(deliveryTypeArg).toBe("private");
    expect(optsArg).toMatchObject({ maxResults: 1 });
    expect(body.cloudinaryAssetCheck).toEqual({
      attempted: true,
      jobId: "job-newer",
      checkSucceeded: true,
      assetExistsInCloudinary: true,
      format: "png",
      cloudinaryCreatedAt: "2026-11-16T06:55:40.000Z",
      note: expect.stringContaining("may have actually succeeded"),
    });
  });

  it("never includes the raw public_id (which embeds the customer's own id) anywhere in the response", async () => {
    mockCustomer().mockResolvedValue({ id: "cust-1" });
    mockFindMany().mockResolvedValue([
      makeJob({ id: "job-1", productHandle: "fulllook-real:step1:Trousers", status: "FAILED", errorCode: "UPLOAD_FAILED" }),
    ]);
    mockListAssets().mockResolvedValueOnce({
      ok: true,
      assets: [{ publicId: "naia-tryon-fulllook-intermediate/cust-1/job-1", resourceType: "image", type: "private", format: "png", createdAt: "x" }],
      nextCursor: null,
      rateLimitRemaining: null,
    });

    const res: any = await loader(makeRequest("https://x.test/api/full-look-vto-diagnostic?suggestionId=sugg-1"));
    const body = JSON.stringify(res.data ?? res);

    expect(body).not.toContain("naia-tryon-fulllook-intermediate/cust-1/job-1");
  });

  it("reports assetExistsInCloudinary: false when the asset genuinely doesn't exist — distinguishing a real upload failure from an app-side response-handling bug", async () => {
    mockCustomer().mockResolvedValue({ id: "cust-1" });
    mockFindMany().mockResolvedValue([
      makeJob({ id: "job-1", productHandle: "fulllook-real:step1:Trousers", status: "FAILED", errorCode: "UPLOAD_FAILED" }),
    ]);
    mockListAssets().mockResolvedValueOnce({ ok: true, assets: [], nextCursor: null, rateLimitRemaining: 99 });

    const res: any = await loader(makeRequest("https://x.test/api/full-look-vto-diagnostic?suggestionId=sugg-1"));
    const body = res.data ?? res;

    expect(body.cloudinaryAssetCheck).toMatchObject({ assetExistsInCloudinary: false });
    expect(body.cloudinaryAssetCheck.note).toContain("never completing at Cloudinary");
  });

  it("surfaces a failed metadata check itself honestly, without claiming anything about the original upload", async () => {
    mockCustomer().mockResolvedValue({ id: "cust-1" });
    mockFindMany().mockResolvedValue([
      makeJob({ id: "job-1", productHandle: "fulllook-real:step1:Trousers", status: "FAILED", errorCode: "UPLOAD_FAILED" }),
    ]);
    mockListAssets().mockResolvedValueOnce({ ok: false, assets: [], nextCursor: null, rateLimitRemaining: null, errorCode: "RATE_LIMITED" });

    const res: any = await loader(makeRequest("https://x.test/api/full-look-vto-diagnostic?suggestionId=sugg-1"));
    const body = res.data ?? res;

    expect(body.cloudinaryAssetCheck).toMatchObject({ checkSucceeded: false, checkErrorCode: "RATE_LIMITED" });
  });

  it("never calls the Cloudinary check at all when no job has errorCode UPLOAD_FAILED", async () => {
    mockCustomer().mockResolvedValue({ id: "cust-1" });
    mockFindMany().mockResolvedValue([
      makeJob({ id: "job-1", status: "COMPLETED", errorCode: null }),
      makeJob({ id: "job-2", status: "FAILED", errorCode: "PROVIDER_FAILED" }),
    ]);

    const res: any = await loader(makeRequest("https://x.test/api/full-look-vto-diagnostic?suggestionId=sugg-1"));
    const body = res.data ?? res;

    expect(mockListAssets()).not.toHaveBeenCalled();
    expect(body.cloudinaryAssetCheck).toEqual({ attempted: false });
  });

  it("never checks a FINAL step's own UPLOAD_FAILED job — only intermediate steps are in scope", async () => {
    mockCustomer().mockResolvedValue({ id: "cust-1" });
    mockFindMany().mockResolvedValue([
      makeJob({ id: "job-final", productHandle: "fulllook-real:final:Blazer", status: "FAILED", errorCode: "UPLOAD_FAILED" }),
    ]);

    const res: any = await loader(makeRequest("https://x.test/api/full-look-vto-diagnostic?suggestionId=sugg-1"));
    const body = res.data ?? res;

    expect(mockListAssets()).not.toHaveBeenCalled();
    expect(body.cloudinaryAssetCheck).toEqual({ attempted: false });
  });
});

// 2026-11-16 addition — built after Attempt C's one approved recovery
// attempt (job cmwhxjd0w0001l607s25kwvq1) was rejected as
// INVALID_OUTPUT_FORMAT against a prediction FASHN itself reported as
// "completed". The raw output is never logged, so the real shape is
// unconfirmed; this targets the SAME single job the Cloudinary check
// above already targets, with one more read-only status GET, reporting
// only structural flags — never the string, a URL, or any byte content.
describe("outputShapeCheck — content-free FASHN output-shape inspection, same single job as cloudinaryAssetCheck", () => {
  function uploadFailedFixture(overrides: Record<string, unknown> = {}) {
    return makeJob({ id: "job-1", productHandle: "fulllook-real:step1:Trousers", status: "FAILED", errorCode: "UPLOAD_FAILED", predictionId: "pred-xyz", ...overrides });
  }

  it("classifies a full data-URI output correctly, and targets the job via its own predictionId", async () => {
    mockCustomer().mockResolvedValue({ id: "cust-1" });
    mockFindMany().mockResolvedValue([uploadFailedFixture()]);
    mockFashnCheck().mockResolvedValueOnce({ ok: true, body: { status: "completed", output: ["data:image/png;base64,AAAA"] } });

    const res: any = await loader(makeRequest("https://x.test/api/full-look-vto-diagnostic?suggestionId=sugg-1"));
    const body = res.data ?? res;

    expect(mockFashnCheck()).toHaveBeenCalledWith("pred-xyz");
    expect(body.outputShapeCheck).toEqual({
      attempted: true,
      jobId: "job-1",
      checkSucceeded: true,
      liveFashnStatus: "completed",
      outputArrayLength: 1,
      firstEntryIsString: true,
      looksLikeDataUri: true,
      looksLikeBareBase64: false,
      looksLikeUrl: false,
      dataUriMimeSubtype: "png",
      stringLength: "data:image/png;base64,AAAA".length,
    });
  });

  it("classifies a bare base64 payload (no data: prefix) correctly", async () => {
    mockCustomer().mockResolvedValue({ id: "cust-1" });
    mockFindMany().mockResolvedValue([uploadFailedFixture()]);
    mockFashnCheck().mockResolvedValueOnce({ ok: true, body: { status: "completed", output: ["AAAA=="] } });

    const res: any = await loader(makeRequest("https://x.test/api/full-look-vto-diagnostic?suggestionId=sugg-1"));
    const body = res.data ?? res;

    expect(body.outputShapeCheck).toMatchObject({ looksLikeDataUri: false, looksLikeBareBase64: true, looksLikeUrl: false, dataUriMimeSubtype: null });
  });

  it("classifies a plain URL output correctly", async () => {
    mockCustomer().mockResolvedValue({ id: "cust-1" });
    mockFindMany().mockResolvedValue([uploadFailedFixture()]);
    mockFashnCheck().mockResolvedValueOnce({ ok: true, body: { status: "completed", output: ["https://cdn.fashn.ai/out/abc123.png"] } });

    const res: any = await loader(makeRequest("https://x.test/api/full-look-vto-diagnostic?suggestionId=sugg-1"));
    const body = res.data ?? res;

    expect(body.outputShapeCheck).toMatchObject({ looksLikeDataUri: false, looksLikeBareBase64: false, looksLikeUrl: true });
  });

  it("never includes the raw output string, URL, or any byte content anywhere in the response", async () => {
    mockCustomer().mockResolvedValue({ id: "cust-1" });
    mockFindMany().mockResolvedValue([uploadFailedFixture()]);
    const secretUrl = "https://cdn.fashn.ai/out/super-secret-path-abc123.png";
    mockFashnCheck().mockResolvedValueOnce({ ok: true, body: { status: "completed", output: [secretUrl] } });

    const res: any = await loader(makeRequest("https://x.test/api/full-look-vto-diagnostic?suggestionId=sugg-1"));
    const body = JSON.stringify(res.data ?? res);

    expect(body).not.toContain(secretUrl);
    expect(body).not.toContain("super-secret-path-abc123");
  });

  it("reports the live status directly, with no shape analysis, when the prediction no longer reports completed", async () => {
    mockCustomer().mockResolvedValue({ id: "cust-1" });
    mockFindMany().mockResolvedValue([uploadFailedFixture()]);
    mockFashnCheck().mockResolvedValueOnce({ ok: true, body: { status: "failed" } });

    const res: any = await loader(makeRequest("https://x.test/api/full-look-vto-diagnostic?suggestionId=sugg-1"));
    const body = res.data ?? res;

    expect(body.outputShapeCheck).toEqual({
      attempted: true,
      jobId: "job-1",
      checkSucceeded: true,
      liveFashnStatus: "failed",
      note: expect.stringContaining("nothing to inspect the shape of"),
    });
  });

  it("reports checkSucceeded: false, honestly, when the status check itself fails", async () => {
    mockCustomer().mockResolvedValue({ id: "cust-1" });
    mockFindMany().mockResolvedValue([uploadFailedFixture()]);
    mockFashnCheck().mockResolvedValueOnce({ ok: false });

    const res: any = await loader(makeRequest("https://x.test/api/full-look-vto-diagnostic?suggestionId=sugg-1"));
    const body = res.data ?? res;

    expect(body.outputShapeCheck).toEqual({ attempted: true, jobId: "job-1", checkSucceeded: false });
  });

  it("never attempts the shape check when no job has errorCode UPLOAD_FAILED — same targeting as cloudinaryAssetCheck", async () => {
    mockCustomer().mockResolvedValue({ id: "cust-1" });
    mockFindMany().mockResolvedValue([makeJob({ id: "job-1", status: "COMPLETED", errorCode: null })]);

    const res: any = await loader(makeRequest("https://x.test/api/full-look-vto-diagnostic?suggestionId=sugg-1"));
    const body = res.data ?? res;

    expect(mockFashnCheck()).not.toHaveBeenCalled();
    expect(body.outputShapeCheck).toEqual({ attempted: false });
  });
});
