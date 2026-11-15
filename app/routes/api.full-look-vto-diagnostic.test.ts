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
  default: { virtualTryOnJob: { findMany: vi.fn() } },
}));
vi.mock("~/lib/ai/full-look-tryon-real.server", () => ({
  checkFashnPredictionStatus: vi.fn(),
  REAL_PRODUCT_HANDLE_PREFIX: "fulllook-real",
}));

import { getCurrentNaiaCustomer } from "~/lib/naia-session.server";
import prisma from "~/db.server";
import { checkFashnPredictionStatus } from "~/lib/ai/full-look-tryon-real.server";
import { loader } from "./api.full-look-vto-diagnostic";

const mockCustomer = () => getCurrentNaiaCustomer as ReturnType<typeof vi.fn>;
const mockFindMany = () => (prisma as any).virtualTryOnJob.findMany as ReturnType<typeof vi.fn>;
const mockFashnCheck = () => checkFashnPredictionStatus as ReturnType<typeof vi.fn>;

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
      makeJob({ id: "job-final", productHandle: "fulllook-real:final:Blazer", status: "COMPLETED", predictionId: "pf", completedAt: new Date() }),
    ];
    mockFindMany().mockResolvedValue(jobs);
    const res: any = await loader(makeRequest("https://x.test/api/full-look-vto-diagnostic?suggestionId=sugg-1"));
    const body = res.data ?? res;
    expect(body.finalStepCompleted).toBe(true);
    expect(body.totalJobRows).toBe(2);
    expect(mockFashnCheck()).not.toHaveBeenCalled(); // nothing is PROCESSING, so no live check is made
    // Even with the final step COMPLETED, this diagnostic must never claim
    // to have verified credit consumption — it doesn't query
    // entitlement.server.ts's actual counting logic.
    expect(body.creditConsumptionVerified).toBe(false);
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
