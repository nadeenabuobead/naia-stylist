// app/lib/ai/poc-sequential-full-look-vto.test.ts
//
// Fully mocked — zero real network calls, zero FASHN credits spent. Validates
// the sequential chaining orchestration only. See the header of
// poc-sequential-full-look-vto.server.ts for what this proof-of-concept is
// and is not — in particular, it is not wired to any route.

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  runSequentialFullLookTryOn,
  MAX_CHAIN_LENGTH,
  type SequentialTryOnGarmentInput,
} from "./poc-sequential-full-look-vto.server.ts";
import type { VirtualTryOnConsent } from "./virtual-try-on.types.ts";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const VALID_CONSENT: VirtualTryOnConsent = {
  virtualTryOnConsent: true,
  policyVersion: "1.0",
  consentedAt: "2026-01-01T00:00:00Z",
};

const INITIAL_MODEL = "data:image/jpeg;base64,INITIALTESTMODEL";

const TROUSERS: SequentialTryOnGarmentInput = {
  label: "trousers",
  category: "BOTTOMS",
  productImageUrl: "https://cdn.shopify.com/s/files/1/trousers.jpg",
};
const TOP: SequentialTryOnGarmentInput = {
  label: "top",
  category: "TOPS",
  productImageUrl: "https://cdn.shopify.com/s/files/1/top.jpg",
};
const BLAZER: SequentialTryOnGarmentInput = {
  label: "blazer",
  category: "OUTERWEAR",
  productImageUrl: "https://cdn.shopify.com/s/files/1/blazer.jpg",
};
const SHOES: SequentialTryOnGarmentInput = {
  label: "shoes",
  category: "SHOES",
  productImageUrl: "https://cdn.shopify.com/s/files/1/shoes.jpg",
};

interface RunCallRecord {
  model_image: string;
  product_image: string;
  resolution: string;
  generation_mode: string;
  num_images: number;
}

/**
 * A stateful fetch mock covering the exact two-request shape runFashnTryOn
 * makes per step (POST /v1/run, then one GET /v1/status/{id} — every status
 * poll is pre-wired to resolve "completed" on the first check so _sleep is
 * never meaningfully awaited). `failOnRunIndex`, if given, makes that 0-based
 * /v1/run call fail at the status-poll stage instead of succeeding.
 */
function buildMockFetch(opts: { failOnRunIndex?: number } = {}) {
  const runCalls: RunCallRecord[] = [];
  let runCount = 0;

  const _fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = url.toString();

    if (u.includes("/v1/run")) {
      const body = JSON.parse(String(init?.body)) as {
        inputs: {
          model_image: string;
          product_image: string;
          resolution: string;
          generation_mode: string;
          num_images: number;
        };
      };
      runCalls.push({ ...body.inputs });
      const index = runCount++;
      return new Response(JSON.stringify({ id: `pred-${index}` }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (u.includes("/v1/status/")) {
      const predIndex = Number(u.split("/v1/status/pred-")[1]);
      if (opts.failOnRunIndex === predIndex) {
        return new Response(JSON.stringify({ status: "failed", error: "mock failure" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(
        JSON.stringify({ status: "completed", output: [`data:image/png;base64,OUTPUTSTEP${predIndex}`] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    throw new Error(`unexpected fetch to ${u}`);
  }) as typeof fetch;

  return { _fetch, runCalls, _sleep: () => Promise.resolve(), _getApiKey: () => "test-key" };
}

const neverFetch = async () => {
  throw new Error("must not call fetch");
};

// ── Chaining ──────────────────────────────────────────────────────────────────

describe("runSequentialFullLookTryOn — chaining", () => {
  it("SEQ.1 — exactly 3 calls for a 3-garment outfit, each feeding its output to the next", async () => {
    const mock = buildMockFetch();

    const report = await runSequentialFullLookTryOn(
      {
        customerId: "cust-poc-1",
        initialModelImageDataUrl: INITIAL_MODEL,
        // Scrambled input order — the module must still apply body-outward.
        garments: [BLAZER, TROUSERS, TOP],
        consent: VALID_CONSENT,
      },
      { _fetch: mock._fetch, _sleep: mock._sleep, _getApiKey: mock._getApiKey },
    );

    assert.equal(report.ok, true);
    if (!report.ok) throw new Error("unreachable");
    assert.equal(mock.runCalls.length, 3, "one FASHN call per garment");
    assert.equal(report.creditsUsed, 3);

    assert.equal(mock.runCalls[0].model_image, INITIAL_MODEL, "step 1 starts from the original model photo");
    assert.equal(mock.runCalls[1].model_image, "data:image/png;base64,OUTPUTSTEP0", "step 2 starts from step 1's output");
    assert.equal(mock.runCalls[2].model_image, "data:image/png;base64,OUTPUTSTEP1", "step 3 starts from step 2's output");
    assert.equal(report.finalImageDataUrl, "data:image/png;base64,OUTPUTSTEP2");
  });

  it("SEQ.2 — garments are reordered body-outward regardless of input order", async () => {
    const mock = buildMockFetch();
    const report = await runSequentialFullLookTryOn(
      {
        customerId: "cust-poc-2",
        initialModelImageDataUrl: INITIAL_MODEL,
        garments: [BLAZER, TOP, TROUSERS],
        consent: VALID_CONSENT,
      },
      { _fetch: mock._fetch, _sleep: mock._sleep, _getApiKey: mock._getApiKey },
    );
    assert.equal(report.ok, true);
    if (!report.ok) throw new Error("unreachable");
    assert.deepEqual(report.steps.map((s) => s.slot), ["bottom", "top", "outerwear"]);
    assert.deepEqual(report.steps.map((s) => s.garment.label), ["trousers", "top", "blazer"]);
  });

  it("SEQ.3 — every call is fast/1k/num_images:1, inherited from runFashnTryOn, never overridden here", async () => {
    const mock = buildMockFetch();
    await runSequentialFullLookTryOn(
      {
        customerId: "cust-poc-3",
        initialModelImageDataUrl: INITIAL_MODEL,
        garments: [TROUSERS, TOP, BLAZER],
        consent: VALID_CONSENT,
      },
      { _fetch: mock._fetch, _sleep: mock._sleep, _getApiKey: mock._getApiKey },
    );
    assert.equal(mock.runCalls.length, 3);
    for (const call of mock.runCalls) {
      assert.equal(call.resolution, "1k");
      assert.equal(call.generation_mode, "fast");
      assert.equal(call.num_images, 1);
    }
  });
});

// ── Failure handling ──────────────────────────────────────────────────────────

describe("runSequentialFullLookTryOn — failure handling", () => {
  it("SEQ.4 — a mid-chain failure halts before the next step and is not billed", async () => {
    // Fail the 2nd call (0-based index 1 => "top", since trousers goes first).
    const mock = buildMockFetch({ failOnRunIndex: 1 });

    const report = await runSequentialFullLookTryOn(
      {
        customerId: "cust-poc-4",
        initialModelImageDataUrl: INITIAL_MODEL,
        garments: [TROUSERS, TOP, BLAZER],
        consent: VALID_CONSENT,
      },
      { _fetch: mock._fetch, _sleep: mock._sleep, _getApiKey: mock._getApiKey },
    );

    assert.equal(report.ok, false);
    if (report.ok) throw new Error("unreachable");
    assert.equal(report.reason, "STEP_FAILED");
    assert.equal(report.failedStepIndex, 1);
    assert.equal(mock.runCalls.length, 2, "the blazer step must never be attempted");
    assert.equal(report.steps.length, 2);
    assert.equal(report.creditsUsed, 1, "only the succeeded trousers step is billed by FASHN");
  });
});

// ── Safety caps — fail closed before any network call ────────────────────────

describe("runSequentialFullLookTryOn — safety caps", () => {
  it("SEQ.5 — more than MAX_CHAIN_LENGTH garments is rejected before any FASHN call", async () => {
    assert.equal(MAX_CHAIN_LENGTH, 3);
    const report = await runSequentialFullLookTryOn(
      {
        customerId: "cust-poc-5",
        initialModelImageDataUrl: INITIAL_MODEL,
        garments: [TROUSERS, TOP, BLAZER, SHOES],
        consent: VALID_CONSENT,
      },
      { _fetch: neverFetch, _sleep: () => Promise.resolve(), _getApiKey: () => "test-key" },
    );
    assert.equal(report.ok, false);
    if (report.ok) throw new Error("unreachable");
    assert.equal(report.reason, "TOO_MANY_GARMENTS");
    assert.equal(report.creditsUsed, 0);
  });

  it("SEQ.6 — two garments claiming the same slot fail closed before any FASHN call", async () => {
    const secondTop: SequentialTryOnGarmentInput = { ...TOP, label: "second-top" };
    const report = await runSequentialFullLookTryOn(
      {
        customerId: "cust-poc-6",
        initialModelImageDataUrl: INITIAL_MODEL,
        garments: [TOP, secondTop],
        consent: VALID_CONSENT,
      },
      { _fetch: neverFetch, _sleep: () => Promise.resolve(), _getApiKey: () => "test-key" },
    );
    assert.equal(report.ok, false);
    if (report.ok) throw new Error("unreachable");
    assert.equal(report.reason, "SLOT_CONFLICT");
    assert.equal(report.creditsUsed, 0);
  });

  it("SEQ.7 — non-layering items (shoes, bags, accessories) are skipped, not silently chained", async () => {
    const mock = buildMockFetch();
    const report = await runSequentialFullLookTryOn(
      {
        customerId: "cust-poc-7",
        initialModelImageDataUrl: INITIAL_MODEL,
        garments: [TROUSERS, TOP, SHOES],
        consent: VALID_CONSENT,
      },
      { _fetch: mock._fetch, _sleep: mock._sleep, _getApiKey: mock._getApiKey },
    );
    assert.equal(report.ok, true);
    if (!report.ok) throw new Error("unreachable");
    assert.equal(mock.runCalls.length, 2, "shoes must never reach FASHN");
    assert.equal(report.skipped.length, 1);
    assert.equal(report.skipped[0].label, "shoes");
  });

  it("SEQ.8 — no eligible garments after filtering is reported, not silently a no-op success", async () => {
    const report = await runSequentialFullLookTryOn(
      {
        customerId: "cust-poc-8",
        initialModelImageDataUrl: INITIAL_MODEL,
        garments: [SHOES],
        consent: VALID_CONSENT,
      },
      { _fetch: neverFetch, _sleep: () => Promise.resolve(), _getApiKey: () => "test-key" },
    );
    assert.equal(report.ok, false);
    if (report.ok) throw new Error("unreachable");
    assert.equal(report.reason, "NO_ELIGIBLE_GARMENTS");
    assert.equal(report.creditsUsed, 0);
  });
});
