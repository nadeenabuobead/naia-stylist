// app/lib/ai/poc-job-tracked-full-look-chain.test.ts
//
// Fully mocked — checkCustomerCooldown/createOrFindTryOnJob/advanceTryOnJob
// are vi.mock'd (zero real DB), and the FASHN interaction uses an injected
// mock _fetch (zero real network). Covers the three corrected issues plus
// sequential progression and partial failure.
//
// Run: npx vitest run app/lib/ai/poc-job-tracked-full-look-chain.test.ts

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./my-naia-model.server.js", () => ({
  checkCustomerCooldown: vi.fn(),
  createOrFindTryOnJob: vi.fn(),
  advanceTryOnJob: vi.fn(),
}));

import { checkCustomerCooldown, createOrFindTryOnJob, advanceTryOnJob } from "./my-naia-model.server.js";
import { runJobTrackedFullLookChain, type JobTrackedChainGarmentInput } from "./poc-job-tracked-full-look-chain.server.js";
import type { VirtualTryOnConsent } from "./virtual-try-on.types.js";

const mockCooldown = () => checkCustomerCooldown as ReturnType<typeof vi.fn>;
const mockCreateOrFind = () => createOrFindTryOnJob as ReturnType<typeof vi.fn>;
const mockAdvance = () => advanceTryOnJob as ReturnType<typeof vi.fn>;

const CONSENT: VirtualTryOnConsent = {
  virtualTryOnConsent: true,
  policyVersion: "1.0",
  consentedAt: "2026-01-01T00:00:00.000Z",
};

const GARMENTS: JobTrackedChainGarmentInput[] = [
  { label: "Trousers", category: "BOTTOMS", subcategory: null, productImageUrl: "https://mock.example/trousers.jpg" },
  { label: "Shirt", category: "TOPS", subcategory: null, productImageUrl: "https://mock.example/shirt.jpg" },
  { label: "Blazer", category: "OUTERWEAR", subcategory: null, productImageUrl: "https://mock.example/blazer.jpg" },
];

function fakeJob(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    customerId: "cust-1",
    naiaModelId: null,
    productHandle: "fulllook-poc:step",
    provider: "FASHN",
    predictionId: null,
    status: "CREATED",
    virtualTryOnConsentAt: new Date(),
    consentPolicyVersion: "1.0",
    saveTryOnResultConsentAt: null,
    idempotencyKey: `key-${id}`,
    requestFingerprint: null,
    errorCode: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    completedAt: null,
    lastActivityAt: new Date(),
    ...overrides,
  };
}

/** Mock _fetch satisfying runFashnTryOn's two-request shape. Each /v1/run
 * call gets a fresh, incrementing predictionId; /v1/status always resolves
 * "completed" immediately unless failAtStepIndex matches. */
function mockFashnFetch(failAtStepIndex: number | null = null) {
  let stepIndex = -1;
  const _fetch = (async (url: string | URL | Request) => {
    const u = url.toString();
    if (u.includes("/v1/run")) {
      stepIndex += 1;
      return new Response(JSON.stringify({ id: `pred-${stepIndex}` }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (u.includes("/v1/status/")) {
      if (failAtStepIndex !== null && stepIndex === failAtStepIndex) {
        return new Response(JSON.stringify({ status: "failed", error: "mock failure" }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return new Response(
        JSON.stringify({ status: "completed", output: [`data:image/png;base64,bW9ja291dHB1dA${stepIndex}`] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    throw new Error(`unexpected mock fetch to ${u}`);
  }) as typeof fetch;
  return { _fetch, _sleep: () => Promise.resolve(), _getApiKey: () => "mock-key" };
}

const BASE_ARGS = {
  customerId: "cust-1",
  naiaModelId: "model-1",
  bodyPublicId: "body-pub-1",
  initialModelImageDataUrl: "data:image/jpeg;base64,aW5pdGlhbA==",
  garments: GARMENTS,
  consent: CONSENT,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockCooldown().mockResolvedValue({ ok: true });
  // Default: every createOrFindTryOnJob call creates a brand-new job.
  let seq = 0;
  mockCreateOrFind().mockImplementation(() => {
    seq += 1;
    return Promise.resolve({ ok: true, created: true, job: fakeJob(`job-${seq}`) });
  });
  mockAdvance().mockImplementation((job: { id: string }, status: string, extras: Record<string, unknown> = {}) =>
    Promise.resolve({ ok: true, job: fakeJob(job.id, { status, ...extras }) }),
  );
});

describe("Issue 1 — cooldown is checked once, never between steps", () => {
  it("JTC.1 — checkCustomerCooldown is called exactly once for a successful 3-step chain", async () => {
    await runJobTrackedFullLookChain(BASE_ARGS, mockFashnFetch());
    expect(mockCooldown()).toHaveBeenCalledTimes(1);
  });

  it("JTC.2 — a cooldown/active-job block before step 1 halts the chain before any job is created", async () => {
    mockCooldown().mockResolvedValue({ ok: false, reason: "ACTIVE_JOB" });
    const report = await runJobTrackedFullLookChain(BASE_ARGS, mockFashnFetch());
    expect(report).toMatchObject({ ok: false, reason: "duplicate_attempt_blocked", creditsUsed: 0 });
    expect(mockCreateOrFind()).not.toHaveBeenCalled();
  });

  it("JTC.3 — steps 2 and 3 never re-check cooldown even though step 1's job just completed milliseconds earlier", async () => {
    // Proves the fix directly: if cooldown were (wrongly) re-checked per step,
    // this would need a second mockResolvedValue — there is only ever one.
    await runJobTrackedFullLookChain(BASE_ARGS, mockFashnFetch());
    expect(mockCooldown()).toHaveBeenCalledTimes(1);
    expect(mockCreateOrFind()).toHaveBeenCalledTimes(3);
  });
});

describe("Issue 2 — race-safe single-attempt reservation", () => {
  it("JTC.4 — step 1 uses a deterministic, customer-scoped idempotency key", async () => {
    await runJobTrackedFullLookChain(BASE_ARGS, mockFashnFetch());
    const firstCallArgs = mockCreateOrFind().mock.calls[0][0];
    expect(firstCallArgs.idempotencyKey).toBe("fulllook-poc-reservation:cust-1");
  });

  it("JTC.5 — created:false on the reservation key refuses the whole chain, regardless of the found job's status", async () => {
    mockCreateOrFind().mockResolvedValueOnce({ ok: true, created: false, job: fakeJob("prior-job", { status: "COMPLETED" }) });
    const report = await runJobTrackedFullLookChain(BASE_ARGS, mockFashnFetch());
    expect(report).toMatchObject({ ok: false, reason: "full_look_test_already_attempted", creditsUsed: 0 });
    expect(mockAdvance()).not.toHaveBeenCalled();
  });

  it("JTC.6 — a different customer gets a different reservation key (no cross-customer collision)", async () => {
    await runJobTrackedFullLookChain({ ...BASE_ARGS, customerId: "cust-2" }, mockFashnFetch());
    const firstCallArgs = mockCreateOrFind().mock.calls[0][0];
    expect(firstCallArgs.idempotencyKey).toBe("fulllook-poc-reservation:cust-2");
  });

  it("JTC.7 — steps 2 and 3 use keys derived from step 1's own job id — never the reservation key again", async () => {
    await runJobTrackedFullLookChain(BASE_ARGS, mockFashnFetch());
    const keys = mockCreateOrFind().mock.calls.map((c: unknown[]) => (c[0] as { idempotencyKey: string }).idempotencyKey);
    expect(keys[0]).toBe("fulllook-poc-reservation:cust-1");
    expect(keys[1]).not.toBe(keys[0]);
    expect(keys[2]).not.toBe(keys[0]);
    expect(new Set(keys).size).toBe(3); // all three distinct — the unique constraint would reject a repeat
  });
});

describe("sequential progression", () => {
  it("JTC.8 — all 3 steps run in order, each feeding its output forward as the next step's model image", async () => {
    const report = await runJobTrackedFullLookChain(BASE_ARGS, mockFashnFetch());
    expect(report.ok).toBe(true);
    if (!report.ok) throw new Error("unreachable");
    expect(report.steps.map((s) => s.label)).toEqual(["Trousers", "Shirt", "Blazer"]);
    expect(report.creditsUsed).toBe(3);
    expect(report.finalImageDataUrl).toMatch(/^data:image\/png;base64,/);
  });

  it("JTC.9 — each job is advanced SUBMITTED then PROCESSING then COMPLETED, in that order, per step", async () => {
    await runJobTrackedFullLookChain(BASE_ARGS, mockFashnFetch());
    const statusesPerJob = new Map<string, string[]>();
    for (const call of mockAdvance().mock.calls) {
      const [job, status] = call as [{ id: string }, string];
      statusesPerJob.set(job.id, [...(statusesPerJob.get(job.id) ?? []), status]);
    }
    for (const statuses of statusesPerJob.values()) {
      expect(statuses).toEqual(["SUBMITTED", "PROCESSING", "COMPLETED"]);
    }
  });
});

describe("partial failure — no automatic retry", () => {
  it("JTC.10 — a mid-chain failure (step 2) marks that job FAILED and never attempts step 3", async () => {
    const report = await runJobTrackedFullLookChain(BASE_ARGS, mockFashnFetch(1));
    expect(report).toMatchObject({ ok: false, reason: "step_failed", creditsUsed: 1, failedStepIndex: 1 });
    if (report.ok) throw new Error("unreachable");
    expect(report.steps.map((s) => s.ok)).toEqual([true, false]);
    expect(mockCreateOrFind()).toHaveBeenCalledTimes(2); // step 3's job is never even created
    const lastAdvanceCall = mockAdvance().mock.calls[mockAdvance().mock.calls.length - 1];
    expect(lastAdvanceCall[1]).toBe("FAILED");
  });

  it("JTC.11 — the first step's job stays COMPLETED (genuinely billed) even when a later step fails", async () => {
    await runJobTrackedFullLookChain(BASE_ARGS, mockFashnFetch(1));
    const firstJobStatuses = mockAdvance().mock.calls.filter((c: unknown[]) => (c[0] as { id: string }).id === "job-1").map((c: unknown[]) => c[1]);
    expect(firstJobStatuses).toEqual(["SUBMITTED", "PROCESSING", "COMPLETED"]);
  });

  it("JTC.12 — a failure on step 1 itself never creates a second job", async () => {
    const report = await runJobTrackedFullLookChain(BASE_ARGS, mockFashnFetch(0));
    expect(report).toMatchObject({ ok: false, reason: "step_failed", creditsUsed: 0, failedStepIndex: 0 });
    expect(mockCreateOrFind()).toHaveBeenCalledTimes(1);
  });
});

describe("duplicate-attempt prevention — composed", () => {
  it("JTC.13 — a second call with the same customer, after the first already claimed the reservation, is refused", async () => {
    await runJobTrackedFullLookChain(BASE_ARGS, mockFashnFetch());
    // Simulate the reservation now existing for this customer on the second call.
    mockCreateOrFind().mockReset();
    mockCreateOrFind().mockResolvedValueOnce({ ok: true, created: false, job: fakeJob("job-1", { status: "COMPLETED" }) });
    const second = await runJobTrackedFullLookChain(BASE_ARGS, mockFashnFetch());
    expect(second).toMatchObject({ ok: false, reason: "full_look_test_already_attempted" });
  });

  it("JTC.14 — createOrFindTryOnJob itself failing (e.g. transaction error) fails closed, not open", async () => {
    mockCreateOrFind().mockResolvedValueOnce({ ok: false, error: "boom", code: "ACTIVE_JOB_EXISTS" });
    const report = await runJobTrackedFullLookChain(BASE_ARGS, mockFashnFetch());
    expect(report).toMatchObject({ ok: false, reason: "job_creation_failed", creditsUsed: 0 });
  });
});

describe("reservationScope (2026-11-03) — opt-in repeatable testing, zero change to the unscoped default", () => {
  it("JTC.15 — omitted entirely (the default), step 1's key is byte-for-byte identical to before this change", async () => {
    await runJobTrackedFullLookChain(BASE_ARGS, mockFashnFetch());
    const firstCallArgs = mockCreateOrFind().mock.calls[0][0];
    expect(firstCallArgs.idempotencyKey).toBe("fulllook-poc-reservation:cust-1");
  });

  it("JTC.16 — two calls with DIFFERENT reservationScope values produce two DIFFERENT step-1 keys — a fresh reservation per scope, not a permanent lock", async () => {
    await runJobTrackedFullLookChain({ ...BASE_ARGS, reservationScope: "2026-11-03T10:00:00.000Z" }, mockFashnFetch());
    await runJobTrackedFullLookChain({ ...BASE_ARGS, reservationScope: "2026-11-03T11:00:00.000Z" }, mockFashnFetch());
    const keys = mockCreateOrFind().mock.calls
      .map((c: unknown[]) => (c[0] as { idempotencyKey: string }).idempotencyKey)
      .filter((k: string) => k.startsWith("fulllook-poc-reservation:"));
    expect(keys).toEqual([
      "fulllook-poc-reservation:cust-1:2026-11-03T10:00:00.000Z",
      "fulllook-poc-reservation:cust-1:2026-11-03T11:00:00.000Z",
    ]);
  });

  it("JTC.17 — two calls with the SAME reservationScope still produce the SAME step-1 key — a genuine retry of one submission still collides correctly", async () => {
    await runJobTrackedFullLookChain({ ...BASE_ARGS, reservationScope: "2026-11-03T10:00:00.000Z" }, mockFashnFetch());
    await runJobTrackedFullLookChain({ ...BASE_ARGS, reservationScope: "2026-11-03T10:00:00.000Z" }, mockFashnFetch());
    const keys = mockCreateOrFind().mock.calls
      .map((c: unknown[]) => (c[0] as { idempotencyKey: string }).idempotencyKey)
      .filter((k: string) => k.startsWith("fulllook-poc-reservation:"));
    expect(keys[0]).toBe(keys[1]);
  });
});

/** Makes the Nth call to advanceTryOnJob (1-indexed, across the whole test)
 * resolve with `response`; every other call falls back to the normal
 * succeed-with-the-requested-status behavior from beforeEach. */
function failOnNthAdvanceCall(n: number, response: unknown) {
  let count = 0;
  mockAdvance().mockImplementation((job: { id: string }, status: string, extras: Record<string, unknown> = {}) => {
    count += 1;
    if (count === n) return Promise.resolve(response);
    return Promise.resolve({ ok: true, job: fakeJob(job.id, { status, ...extras }) });
  });
}

describe("Priority 1 — orphaned-job cleanup on transition failure", () => {
  it("JTC.15 — a failure advancing SUBMITTED triggers best-effort FAILED cleanup and halts before any FASHN call", async () => {
    failOnNthAdvanceCall(1, { ok: false, error: "db error" });
    const report = await runJobTrackedFullLookChain(BASE_ARGS, mockFashnFetch());
    expect(report).toMatchObject({ ok: false, reason: "job_creation_failed", creditsUsed: 0, steps: [] });
    expect(mockAdvance()).toHaveBeenCalledTimes(2);
    expect(mockAdvance().mock.calls[1][1]).toBe("FAILED");
    expect(mockAdvance().mock.calls[1][2]).toMatchObject({ errorCode: "state_error_before_submission" });
    expect(mockCreateOrFind()).toHaveBeenCalledTimes(1); // step 2's job is never created
  });

  it("JTC.16 — a failure advancing PROCESSING (after a genuinely successful, billable FASHN call) is reported as uncertain, not as a clean failure, and still counts the credit", async () => {
    failOnNthAdvanceCall(2, { ok: false, error: "db error" });
    const report = await runJobTrackedFullLookChain(BASE_ARGS, mockFashnFetch());
    expect(report).toMatchObject({ ok: false, reason: "step_outcome_uncertain", creditsUsed: 1, failedStepIndex: 0 });
    if (report.ok) throw new Error("unreachable");
    expect(report.steps.map((s) => s.ok)).toEqual([true]);
    expect(mockAdvance().mock.calls[2][1]).toBe("FAILED"); // cleanup attempt
    expect(mockAdvance().mock.calls[2][2]).toMatchObject({ errorCode: "state_error_after_provider_success" });
    expect(mockCreateOrFind()).toHaveBeenCalledTimes(1); // chain halts — step 2 never even attempted
  });

  it("JTC.17 — a failure advancing COMPLETED (after a genuinely successful FASHN call) is reported as uncertain, never auto-retried", async () => {
    failOnNthAdvanceCall(3, { ok: false, error: "db error" });
    const report = await runJobTrackedFullLookChain(BASE_ARGS, mockFashnFetch());
    expect(report).toMatchObject({ ok: false, reason: "step_outcome_uncertain", creditsUsed: 1, failedStepIndex: 0 });
    if (report.ok) throw new Error("unreachable");
    expect(report.steps.map((s) => s.ok)).toEqual([true]);
    expect(mockAdvance().mock.calls[3][1]).toBe("FAILED"); // cleanup attempt
    expect(mockAdvance().mock.calls[3][2]).toMatchObject({ errorCode: "state_error_after_provider_success" });
  });
});

describe("Priority 1 — cleanup failure itself is swallowed", () => {
  it("JTC.18 — cleanup's own advanceTryOnJob call resolving {ok:false} does not change or crash the original report", async () => {
    mockAdvance().mockImplementation(() => Promise.resolve({ ok: false, error: "db down" }));
    const report = await runJobTrackedFullLookChain(BASE_ARGS, mockFashnFetch());
    expect(report).toMatchObject({ ok: false, reason: "job_creation_failed", creditsUsed: 0, steps: [] });
  });

  it("JTC.19 — cleanup's own advanceTryOnJob call throwing synchronously does not propagate out of the chain", async () => {
    let count = 0;
    mockAdvance().mockImplementation(() => {
      count += 1;
      if (count === 1) return Promise.resolve({ ok: false, error: "db error" }); // SUBMITTED fails
      throw new Error("connection reset"); // cleanup attempt throws
    });
    const report = await runJobTrackedFullLookChain(BASE_ARGS, mockFashnFetch());
    expect(report).toMatchObject({ ok: false, reason: "job_creation_failed", creditsUsed: 0, steps: [] });
  });

  it("JTC.20 — cleanup's own advanceTryOnJob call rejecting does not propagate out of the chain", async () => {
    let count = 0;
    mockAdvance().mockImplementation(() => {
      count += 1;
      if (count === 1) return Promise.resolve({ ok: false, error: "db error" });
      return Promise.reject(new Error("connection reset"));
    });
    const report = await runJobTrackedFullLookChain(BASE_ARGS, mockFashnFetch());
    expect(report).toMatchObject({ ok: false, reason: "job_creation_failed", creditsUsed: 0, steps: [] });
  });
});

describe("Priority 1/3 — stale active job gets a distinct, non-automatic signal", () => {
  it("JTC.21 — an ACTIVE reservation job older than the staleness threshold is flagged for manual review, never auto-unblocked", async () => {
    const old = new Date(Date.now() - 11 * 60 * 1000); // 11 minutes — past the 10-minute threshold
    mockCreateOrFind().mockResolvedValueOnce({ ok: true, created: false, job: fakeJob("stuck-job", { status: "PROCESSING", lastActivityAt: old }) });
    const report = await runJobTrackedFullLookChain(BASE_ARGS, mockFashnFetch());
    expect(report).toMatchObject({ ok: false, reason: "full_look_test_stale_job_needs_manual_review", creditsUsed: 0 });
    expect(mockAdvance()).not.toHaveBeenCalled(); // never touched — no auto-unblock, no FASHN re-attempt
  });

  it("JTC.22 — an ACTIVE reservation job within the staleness threshold is a genuine duplicate attempt, not stale", async () => {
    const recent = new Date(Date.now() - 30 * 1000); // 30 seconds ago
    mockCreateOrFind().mockResolvedValueOnce({ ok: true, created: false, job: fakeJob("in-progress-job", { status: "SUBMITTED", lastActivityAt: recent }) });
    const report = await runJobTrackedFullLookChain(BASE_ARGS, mockFashnFetch());
    expect(report).toMatchObject({ ok: false, reason: "full_look_test_already_attempted", creditsUsed: 0 });
  });

  it("JTC.23 — a COMPLETED reservation job, even an old one, is reported as already-attempted, never as stale (it isn't active)", async () => {
    const old = new Date(Date.now() - 60 * 60 * 1000); // 1 hour ago
    mockCreateOrFind().mockResolvedValueOnce({ ok: true, created: false, job: fakeJob("done-job", { status: "COMPLETED", lastActivityAt: old }) });
    const report = await runJobTrackedFullLookChain(BASE_ARGS, mockFashnFetch());
    expect(report).toMatchObject({ ok: false, reason: "full_look_test_already_attempted", creditsUsed: 0 });
  });
});

describe("Requirement #7 — exactly three garments, no silent acceptance of other lengths", () => {
  it("JTC.24 — two garments is rejected before any DB call", async () => {
    const report = await runJobTrackedFullLookChain({ ...BASE_ARGS, garments: GARMENTS.slice(0, 2) }, mockFashnFetch());
    expect(report).toMatchObject({ ok: false, reason: "invalid_chain_length", creditsUsed: 0, steps: [] });
    expect(mockCooldown()).not.toHaveBeenCalled();
    expect(mockCreateOrFind()).not.toHaveBeenCalled();
  });

  it("JTC.25 — four garments is rejected before any DB call", async () => {
    const report = await runJobTrackedFullLookChain(
      { ...BASE_ARGS, garments: [...GARMENTS, { ...GARMENTS[0], label: "Scarf" }] },
      mockFashnFetch(),
    );
    expect(report).toMatchObject({ ok: false, reason: "invalid_chain_length", creditsUsed: 0, steps: [] });
    expect(mockCreateOrFind()).not.toHaveBeenCalled();
  });

  it("JTC.26 — zero garments is rejected, never silently reported as a hollow success", async () => {
    const report = await runJobTrackedFullLookChain({ ...BASE_ARGS, garments: [] }, mockFashnFetch());
    expect(report).toMatchObject({ ok: false, reason: "invalid_chain_length", creditsUsed: 0, steps: [] });
  });
});
