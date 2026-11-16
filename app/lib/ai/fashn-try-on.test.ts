// app/lib/ai/fashn-try-on.test.ts
// Unit tests for the FASHN Try-On adapter.
// No real provider calls — all network interactions use DI mocks.

import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import { readFileSync } from "node:fs";
import {
  runFashnTryOn,
  isAllowedProductImageUrl,
  isValidModelImageDataUrl,
  hasVirtualTryOnConsent,
  submitTryOnToProvider,
} from "./fashn-try-on.server.ts";
import type { VirtualTryOnInput } from "./virtual-try-on.types.ts";
import { CUSTOMER_ERROR_MESSAGES } from "./virtual-try-on.types.ts";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const VALID_DATA_URL = "data:image/jpeg;base64,/9j/4AAQ";
const VALID_PRODUCT_URL = "https://cdn.shopify.com/s/files/1/product.jpg";
const VALID_CONSENT = {
  virtualTryOnConsent: true as const,
  policyVersion: "1.0",
  consentedAt: "2026-01-01T00:00:00Z",
};

function makeInput(overrides: Partial<VirtualTryOnInput> = {}): VirtualTryOnInput {
  return {
    customerId: "cust-test",
    modelImageDataUrl: VALID_DATA_URL,
    productImageUrl: VALID_PRODUCT_URL,
    productHandle: "collar-shirt",
    consent: VALID_CONSENT,
    ...overrides,
  };
}

function makeRunResponse(id: string, error?: string): Response {
  return new Response(
    JSON.stringify(error ? { id, error } : { id }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

function makeStatusResponse(
  status: "starting" | "in_queue" | "processing" | "completed" | "failed",
  output?: string[],
  error?: string,
): Response {
  return new Response(
    JSON.stringify({ status, ...(output ? { output } : {}), ...(error ? { error } : {}) }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

function noSleep(): Promise<void> {
  return Promise.resolve();
}

// ── isAllowedProductImageUrl ──────────────────────────────────────────────────

describe("isAllowedProductImageUrl", () => {
  it("FU.1 — accepts a plain https URL", () => {
    assert.equal(isAllowedProductImageUrl("https://cdn.shopify.com/img.jpg"), true);
  });

  it("FU.2 — rejects http", () => {
    assert.equal(isAllowedProductImageUrl("http://cdn.shopify.com/img.jpg"), false);
  });

  it("FU.3 — rejects localhost", () => {
    assert.equal(isAllowedProductImageUrl("https://localhost/img.jpg"), false);
  });

  it("FU.4 — rejects 127.0.0.1", () => {
    assert.equal(isAllowedProductImageUrl("https://127.0.0.1/img.jpg"), false);
  });

  it("FU.5 — rejects 10.x private range", () => {
    assert.equal(isAllowedProductImageUrl("https://10.0.0.1/img.jpg"), false);
  });

  it("FU.6 — rejects 192.168.x private range", () => {
    assert.equal(isAllowedProductImageUrl("https://192.168.1.1/img.jpg"), false);
  });

  it("FU.7 — rejects 172.16–31 private range", () => {
    assert.equal(isAllowedProductImageUrl("https://172.20.0.1/img.jpg"), false);
  });

  it("FU.8 — rejects malformed non-URL", () => {
    assert.equal(isAllowedProductImageUrl("not-a-url"), false);
  });

  it("FU.9 — rejects empty string", () => {
    assert.equal(isAllowedProductImageUrl(""), false);
  });

  it("FU.10 — accepts Cloudinary https URL", () => {
    assert.equal(
      isAllowedProductImageUrl("https://res.cloudinary.com/naia/image/upload/v1/prod.jpg"),
      true,
    );
  });
});

// ── isValidModelImageDataUrl ──────────────────────────────────────────────────

describe("isValidModelImageDataUrl", () => {
  it("FU.11 — accepts jpeg data URL", () => {
    assert.equal(isValidModelImageDataUrl("data:image/jpeg;base64,/9j/4AA"), true);
  });

  it("FU.12 — accepts png data URL", () => {
    assert.equal(isValidModelImageDataUrl("data:image/png;base64,iVBOR"), true);
  });

  it("FU.13 — accepts webp data URL", () => {
    assert.equal(isValidModelImageDataUrl("data:image/webp;base64,AAAA"), true);
  });

  it("FU.14 — rejects plain https URL", () => {
    assert.equal(isValidModelImageDataUrl("https://example.com/photo.jpg"), false);
  });

  it("FU.15 — rejects svg data URL", () => {
    assert.equal(isValidModelImageDataUrl("data:image/svg+xml;base64,PHN2Zy"), false);
  });

  it("FU.16 — rejects empty string", () => {
    assert.equal(isValidModelImageDataUrl(""), false);
  });
});

// ── hasVirtualTryOnConsent ────────────────────────────────────────────────────

describe("hasVirtualTryOnConsent", () => {
  it("FU.17 — accepts valid consent", () => {
    assert.equal(hasVirtualTryOnConsent(VALID_CONSENT), true);
  });

  it("FU.18 — rejects missing policyVersion", () => {
    assert.equal(hasVirtualTryOnConsent({ ...VALID_CONSENT, policyVersion: "" }), false);
  });

  it("FU.19 — rejects missing consentedAt", () => {
    assert.equal(hasVirtualTryOnConsent({ ...VALID_CONSENT, consentedAt: "" }), false);
  });
});

// ── runFashnTryOn — happy path ────────────────────────────────────────────────

describe("runFashnTryOn — happy path", () => {
  it("FA.1 — returns ok=true with predictionId and outputDataUrl on success", async () => {
    let callCount = 0;
    const _fetch = async (url: string | URL | Request) => {
      const u = url.toString();
      if (u.includes("/v1/run")) {
        callCount++;
        return makeRunResponse("pred-001");
      }
      if (u.includes("/v1/status/")) {
        return makeStatusResponse("completed", ["data:image/png;base64,OUTPUT"]);
      }
      throw new Error("unexpected fetch");
    };

    const result = await runFashnTryOn(makeInput({ customerId: "cust-fa1" }), {
      _fetch: _fetch as typeof fetch,
      _sleep: noSleep,
      _getApiKey: () => "test-key",
    });

    assert.equal(result.ok, true);
    if (!result.ok) throw new Error("unreachable");
    assert.equal(result.provider, "fashn");
    assert.equal(result.predictionId, "pred-001");
    assert.equal(result.outputDataUrl, "data:image/png;base64,OUTPUT");
    assert.equal(result.outputFormat, "png");
    assert.equal(callCount, 1, "POST /v1/run must be called exactly once");
  });

  it("FA.2 — polls through starting/in_queue/processing before completed", async () => {
    const statusSequence: Array<"starting" | "in_queue" | "processing" | "completed"> = [
      "starting",
      "in_queue",
      "processing",
      "completed",
    ];
    let pollCount = 0;

    const _fetch = async (url: string | URL | Request) => {
      const u = url.toString();
      if (u.includes("/v1/run")) return makeRunResponse("pred-002");
      if (u.includes("/v1/status/")) {
        const status = statusSequence[pollCount++] ?? "completed";
        const output = status === "completed" ? ["data:image/png;base64,DONE"] : undefined;
        return makeStatusResponse(status as "completed", output);
      }
      throw new Error("unexpected fetch");
    };

    const result = await runFashnTryOn(makeInput({ customerId: "cust-fa2" }), {
      _fetch: _fetch as typeof fetch,
      _sleep: noSleep,
      _getApiKey: () => "test-key",
    });

    assert.equal(result.ok, true);
    assert.equal(pollCount, 4);
  });
});

// ── runFashnTryOn — consent failures ─────────────────────────────────────────

describe("runFashnTryOn — consent gate", () => {
  it("FA.3 — returns CONSENT_REQUIRED when virtualTryOnConsent is missing", async () => {
    // @ts-expect-error deliberately invalid
    const result = await runFashnTryOn(makeInput({ consent: { policyVersion: "1.0", consentedAt: "2026-01-01T00:00:00Z" } }), {
      _fetch: async () => { throw new Error("must not call fetch"); },
      _sleep: noSleep,
      _getApiKey: () => "test-key",
    });
    assert.equal(result.ok, false);
    if (result.ok) throw new Error("unreachable");
    assert.equal(result.code, "CONSENT_REQUIRED");
  });

  it("FA.4 — returns CONSENT_REQUIRED when policyVersion is empty", async () => {
    const result = await runFashnTryOn(
      makeInput({ customerId: "cust-fa4", consent: { ...VALID_CONSENT, policyVersion: "" } }),
      { _fetch: async () => { throw new Error("must not call fetch"); }, _sleep: noSleep, _getApiKey: () => "test-key" },
    );
    assert.equal(result.ok, false);
    if (result.ok) throw new Error("unreachable");
    assert.equal(result.code, "CONSENT_REQUIRED");
  });
});

// ── runFashnTryOn — configuration failures ────────────────────────────────────

describe("runFashnTryOn — configuration", () => {
  it("FA.5 — returns NOT_CONFIGURED when API key is missing", async () => {
    const result = await runFashnTryOn(makeInput({ customerId: "cust-fa5" }), {
      _fetch: async () => { throw new Error("must not call fetch"); },
      _sleep: noSleep,
      _getApiKey: () => undefined,
    });
    assert.equal(result.ok, false);
    if (result.ok) throw new Error("unreachable");
    assert.equal(result.code, "NOT_CONFIGURED");
  });

  it("FA.6 — returns NOT_CONFIGURED when API key is empty string", async () => {
    const result = await runFashnTryOn(makeInput({ customerId: "cust-fa6" }), {
      _fetch: async () => { throw new Error("must not call fetch"); },
      _sleep: noSleep,
      _getApiKey: () => "",
    });
    assert.equal(result.ok, false);
    if (result.ok) throw new Error("unreachable");
    assert.equal(result.code, "NOT_CONFIGURED");
  });
});

// ── runFashnTryOn — input validation failures ─────────────────────────────────

describe("runFashnTryOn — input validation", () => {
  it("FA.7 — returns INVALID_MODEL_IMAGE for https URL (not a data URL)", async () => {
    const result = await runFashnTryOn(
      makeInput({ customerId: "cust-fa7", modelImageDataUrl: "https://example.com/me.jpg" }),
      { _fetch: async () => { throw new Error("must not call fetch"); }, _sleep: noSleep, _getApiKey: () => "k" },
    );
    assert.equal(result.ok, false);
    if (result.ok) throw new Error("unreachable");
    assert.equal(result.code, "INVALID_MODEL_IMAGE");
  });

  it("FA.8 — returns INVALID_PRODUCT_IMAGE for http URL", async () => {
    const result = await runFashnTryOn(
      makeInput({ customerId: "cust-fa8", productImageUrl: "http://cdn.shopify.com/img.jpg" }),
      { _fetch: async () => { throw new Error("must not call fetch"); }, _sleep: noSleep, _getApiKey: () => "k" },
    );
    assert.equal(result.ok, false);
    if (result.ok) throw new Error("unreachable");
    assert.equal(result.code, "INVALID_PRODUCT_IMAGE");
  });

  it("FA.9 — returns INVALID_PRODUCT_IMAGE for localhost product URL", async () => {
    const result = await runFashnTryOn(
      makeInput({ customerId: "cust-fa9", productImageUrl: "https://localhost/img.jpg" }),
      { _fetch: async () => { throw new Error("must not call fetch"); }, _sleep: noSleep, _getApiKey: () => "k" },
    );
    assert.equal(result.ok, false);
    if (result.ok) throw new Error("unreachable");
    assert.equal(result.code, "INVALID_PRODUCT_IMAGE");
  });

  it("FA.10 — returns INVALID_PRODUCT_IMAGE for private-network product URL", async () => {
    const result = await runFashnTryOn(
      makeInput({ customerId: "cust-fa10", productImageUrl: "https://192.168.1.1/img.jpg" }),
      { _fetch: async () => { throw new Error("must not call fetch"); }, _sleep: noSleep, _getApiKey: () => "k" },
    );
    assert.equal(result.ok, false);
    if (result.ok) throw new Error("unreachable");
    assert.equal(result.code, "INVALID_PRODUCT_IMAGE");
  });
});

// ── runFashnTryOn — rate limiting removed ────────────────────────────────────
//
// The in-process _customerLastRun Map (DEV_RATE_LIMIT_MS) has been removed.
// Throttling is now handled exclusively by the DB-backed checkCustomerCooldown
// (2 s post-completion) and active-job protection in the CREATED/SUBMITTED/
// PROCESSING state machine — both of which are reliable across Vercel instances.

describe("runFashnTryOn — rate limiting removed", () => {
  it("FA.11 — source contract: _customerLastRun Map is gone from fashn-try-on.server.ts", () => {
    const src: string = readFileSync(
      new URL("./fashn-try-on.server.ts", import.meta.url).pathname,
      "utf8",
    );
    assert.ok(!src.includes("_customerLastRun"), "_customerLastRun Map must be removed");
    assert.ok(!src.includes("DEV_RATE_LIMIT_MS"), "DEV_RATE_LIMIT_MS must be removed");
  });

  it("FA.12 — consecutive calls from same customerId both reach FASHN (no in-process block)", async () => {
    let runCallCount = 0;
    const _fetch = async (url: string | URL | Request) => {
      const u = url.toString();
      if (u.includes("/v1/run")) { runCallCount++; return makeRunResponse(`pred-${runCallCount}`); }
      return makeStatusResponse("completed", ["data:image/png;base64,OUT"]);
    };
    const customerId = "cust-nrl-same";

    const first = await runFashnTryOn(makeInput({ customerId }), {
      _fetch: _fetch as typeof fetch, _sleep: noSleep, _getApiKey: () => "k",
    });
    const second = await runFashnTryOn(makeInput({ customerId }), {
      _fetch: _fetch as typeof fetch, _sleep: noSleep, _getApiKey: () => "k",
    });

    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    assert.equal(runCallCount, 2, "both calls must reach FASHN POST — no in-process block");
  });
});

// ── runFashnTryOn — provider error paths ─────────────────────────────────────

describe("runFashnTryOn — provider error paths", () => {
  it("FA.13 — returns PROVIDER_REJECTED when POST /v1/run returns non-200", async () => {
    const _fetch = async (url: string | URL | Request) => {
      if (url.toString().includes("/v1/run")) {
        return new Response("Unauthorized", { status: 401 });
      }
      throw new Error("unexpected");
    };
    const result = await runFashnTryOn(makeInput({ customerId: "cust-fa13" }), {
      _fetch: _fetch as typeof fetch, _sleep: noSleep, _getApiKey: () => "k",
    });
    assert.equal(result.ok, false);
    if (result.ok) throw new Error("unreachable");
    assert.equal(result.code, "PROVIDER_REJECTED");
  });

  it("FA.14 — returns PROVIDER_REJECTED when run body contains error field", async () => {
    const _fetch = async (url: string | URL | Request) => {
      if (url.toString().includes("/v1/run")) return makeRunResponse("", "validation error");
      throw new Error("unexpected");
    };
    const result = await runFashnTryOn(makeInput({ customerId: "cust-fa14" }), {
      _fetch: _fetch as typeof fetch, _sleep: noSleep, _getApiKey: () => "k",
    });
    assert.equal(result.ok, false);
    if (result.ok) throw new Error("unreachable");
    assert.equal(result.code, "PROVIDER_REJECTED");
  });

  it("FA.15 — returns PROVIDER_FAILED when status polling returns non-200", async () => {
    const _fetch = async (url: string | URL | Request) => {
      const u = url.toString();
      if (u.includes("/v1/run")) return makeRunResponse("pred-fa15");
      return new Response("Server Error", { status: 500 });
    };
    const result = await runFashnTryOn(makeInput({ customerId: "cust-fa15" }), {
      _fetch: _fetch as typeof fetch, _sleep: noSleep, _getApiKey: () => "k",
    });
    assert.equal(result.ok, false);
    if (result.ok) throw new Error("unreachable");
    assert.equal(result.code, "PROVIDER_FAILED");
  });

  it("FA.16 — returns PROVIDER_FAILED when status is 'failed'", async () => {
    const _fetch = async (url: string | URL | Request) => {
      const u = url.toString();
      if (u.includes("/v1/run")) return makeRunResponse("pred-fa16");
      return makeStatusResponse("failed");
    };
    const result = await runFashnTryOn(makeInput({ customerId: "cust-fa16" }), {
      _fetch: _fetch as typeof fetch, _sleep: noSleep, _getApiKey: () => "k",
    });
    assert.equal(result.ok, false);
    if (result.ok) throw new Error("unreachable");
    assert.equal(result.code, "PROVIDER_FAILED");
  });

  it("FA.17 — returns PROVIDER_FAILED when completed output is empty array", async () => {
    const _fetch = async (url: string | URL | Request) => {
      const u = url.toString();
      if (u.includes("/v1/run")) return makeRunResponse("pred-fa17");
      return makeStatusResponse("completed", []);
    };
    const result = await runFashnTryOn(makeInput({ customerId: "cust-fa17" }), {
      _fetch: _fetch as typeof fetch, _sleep: noSleep, _getApiKey: () => "k",
    });
    assert.equal(result.ok, false);
    if (result.ok) throw new Error("unreachable");
    assert.equal(result.code, "PROVIDER_FAILED");
  });

  it("FA.18 — returns PROVIDER_FAILED when fetch throws on /v1/run", async () => {
    const _fetch = async (url: string | URL | Request) => {
      if (url.toString().includes("/v1/run")) throw new Error("network error");
      throw new Error("unexpected");
    };
    const result = await runFashnTryOn(makeInput({ customerId: "cust-fa18" }), {
      _fetch: _fetch as typeof fetch, _sleep: noSleep, _getApiKey: () => "k",
    });
    assert.equal(result.ok, false);
    if (result.ok) throw new Error("unreachable");
    assert.equal(result.code, "PROVIDER_FAILED");
  });

  it("FA.19 — returns PROVIDER_FAILED when fetch throws during polling", async () => {
    const _fetch = async (url: string | URL | Request) => {
      const u = url.toString();
      if (u.includes("/v1/run")) return makeRunResponse("pred-fa19");
      throw new Error("poll network error");
    };
    const result = await runFashnTryOn(makeInput({ customerId: "cust-fa19" }), {
      _fetch: _fetch as typeof fetch, _sleep: noSleep, _getApiKey: () => "k",
    });
    assert.equal(result.ok, false);
    if (result.ok) throw new Error("unreachable");
    assert.equal(result.code, "PROVIDER_FAILED");
  });
});

// ── runFashnTryOn — timeout ───────────────────────────────────────────────────

describe("runFashnTryOn — timeout", () => {
  it("FA.20 — returns TIMEOUT after MAX_POLL_ATTEMPTS with no completion", async () => {
    let pollCount = 0;
    const _fetch = async (url: string | URL | Request) => {
      const u = url.toString();
      if (u.includes("/v1/run")) return makeRunResponse("pred-to");
      pollCount++;
      return makeStatusResponse("processing");
    };
    const result = await runFashnTryOn(makeInput({ customerId: `cust-timeout-${Date.now()}` }), {
      _fetch: _fetch as typeof fetch,
      _sleep: noSleep,
      _getApiKey: () => "k",
    });
    assert.equal(result.ok, false);
    if (result.ok) throw new Error("unreachable");
    assert.equal(result.code, "TIMEOUT");
    assert.equal(pollCount, 45, "must poll exactly MAX_POLL_ATTEMPTS=45 times");
  });
});

// ── runFashnTryOn — customerMessage shape ────────────────────────────────────

describe("runFashnTryOn — customer messages", () => {
  it("FA.21 — every error result has a non-empty customerMessage", async () => {
    // Trigger each error code and confirm a non-empty customer message
    const cases: Array<Promise<Awaited<ReturnType<typeof runFashnTryOn>>>> = [
      // NOT_CONFIGURED
      runFashnTryOn(makeInput({ customerId: "cm-1" }), {
        _fetch: async () => { throw new Error("x"); },
        _sleep: noSleep,
        _getApiKey: () => undefined,
      }),
      // CONSENT_REQUIRED
      runFashnTryOn(makeInput({ customerId: "cm-2", consent: { ...VALID_CONSENT, policyVersion: "" } }), {
        _fetch: async () => { throw new Error("x"); },
        _sleep: noSleep,
        _getApiKey: () => "k",
      }),
      // INVALID_MODEL_IMAGE
      runFashnTryOn(makeInput({ customerId: "cm-3", modelImageDataUrl: "bad" }), {
        _fetch: async () => { throw new Error("x"); },
        _sleep: noSleep,
        _getApiKey: () => "k",
      }),
      // INVALID_PRODUCT_IMAGE
      runFashnTryOn(makeInput({ customerId: "cm-4", productImageUrl: "http://bad.com" }), {
        _fetch: async () => { throw new Error("x"); },
        _sleep: noSleep,
        _getApiKey: () => "k",
      }),
    ];

    const results = await Promise.all(cases);
    for (const r of results) {
      assert.equal(r.ok, false);
      if (r.ok) throw new Error("unreachable");
      assert.ok(r.customerMessage.length > 0, `customerMessage should be non-empty for code ${r.code}`);
    }
  });
});

// ── runFashnTryOn — existingPredictionId / onPredictionId ────────────────────

describe("runFashnTryOn — resume polling", () => {
  it("FA.26 — existingPredictionId skips POST /v1/run entirely", async () => {
    let runCallCount = 0;
    const _fetch = async (url: string | URL | Request) => {
      const u = url.toString();
      if (u.includes("/v1/run")) { runCallCount++; return makeRunResponse("should-not-be-called"); }
      return makeStatusResponse("completed", ["data:image/png;base64,RESUMED"]);
    };
    const result = await runFashnTryOn(makeInput({ customerId: "cust-fa26" }), {
      _fetch: _fetch as typeof fetch,
      _sleep: noSleep,
      _getApiKey: () => "k",
      existingPredictionId: "pred-existing-001",
    });
    assert.equal(result.ok, true);
    if (!result.ok) throw new Error("unreachable");
    assert.equal(result.predictionId, "pred-existing-001");
    assert.equal(runCallCount, 0, "POST /v1/run must not be called when existingPredictionId is set");
  });

  it("FA.27 — existingPredictionId polls through intermediate states and returns ok=true", async () => {
    const statusSeq: Array<"processing" | "completed"> = ["processing", "processing", "completed"];
    let pollCount = 0;
    const _fetch = async (url: string | URL | Request) => {
      const u = url.toString();
      if (u.includes("/v1/run")) throw new Error("must not call POST");
      const status = statusSeq[pollCount++] ?? "completed";
      const output = status === "completed" ? ["data:image/png;base64,FINAL"] : undefined;
      return makeStatusResponse(status, output);
    };
    const result = await runFashnTryOn(makeInput({ customerId: "cust-fa27" }), {
      _fetch: _fetch as typeof fetch,
      _sleep: noSleep,
      _getApiKey: () => "k",
      existingPredictionId: "pred-resume-002",
    });
    assert.equal(result.ok, true);
    if (!result.ok) throw new Error("unreachable");
    assert.equal(result.predictionId, "pred-resume-002");
    assert.equal(pollCount, 3);
  });

  it("FA.28 — onPredictionId callback is invoked with the ID immediately after POST /v1/run", async () => {
    let capturedId: string | null = null;
    const _fetch = async (url: string | URL | Request) => {
      const u = url.toString();
      if (u.includes("/v1/run")) return makeRunResponse("pred-callback-003");
      return makeStatusResponse("completed", ["data:image/png;base64,OUT"]);
    };
    await runFashnTryOn(makeInput({ customerId: "cust-fa28" }), {
      _fetch: _fetch as typeof fetch,
      _sleep: noSleep,
      _getApiKey: () => "k",
      onPredictionId: (id) => { capturedId = id; },
    });
    assert.equal(capturedId, "pred-callback-003");
  });

  it("FA.29 — existingPredictionId that exhausts polls returns TIMEOUT", async () => {
    const _fetch = async (url: string | URL | Request) => {
      if (url.toString().includes("/v1/run")) throw new Error("must not call POST");
      return makeStatusResponse("processing");
    };
    const result = await runFashnTryOn(makeInput({ customerId: `cust-fa29-${Date.now()}` }), {
      _fetch: _fetch as typeof fetch,
      _sleep: noSleep,
      _getApiKey: () => "k",
      existingPredictionId: "pred-timeout-004",
    });
    assert.equal(result.ok, false);
    if (result.ok) throw new Error("unreachable");
    assert.equal(result.code, "TIMEOUT");
  });
});

// ── Security: no auth headers or image data appear in errors ─────────────────

describe("runFashnTryOn — security: no sensitive data in results", () => {
  it("FA.22 — error result does not contain the API key string", async () => {
    const apiKey = "super-secret-fashn-key";
    const result = await runFashnTryOn(makeInput({ customerId: `cust-sec-${Date.now()}` }), {
      _fetch: async () => new Response("Server Error", { status: 500 }),
      _sleep: noSleep,
      _getApiKey: () => apiKey,
    });
    // Force run to complete submission first by injecting a successful run response
    // then fail on status — but for this test the run itself will fail with non-200
    const serialised = JSON.stringify(result);
    assert.ok(!serialised.includes(apiKey), "API key must not appear in error result");
  });

  it("FA.23 — error result does not contain modelImageDataUrl", async () => {
    const result = await runFashnTryOn(
      makeInput({ customerId: `cust-sec2-${Date.now()}`, modelImageDataUrl: "data:image/jpeg;base64,SENSITIVEDATA" }),
      {
        _fetch: async () => new Response("Server Error", { status: 401 }),
        _sleep: noSleep,
        _getApiKey: () => "k",
      },
    );
    const serialised = JSON.stringify(result);
    assert.ok(!serialised.includes("SENSITIVEDATA"), "model image data must not appear in error result");
  });

  it("FA.24 — ok result does not contain the API key string", async () => {
    const apiKey = "prod-key-xyz";
    const custId = `cust-sec3-${Date.now()}`;
    const _fetch = async (url: string | URL | Request) => {
      const u = url.toString();
      if (u.includes("/v1/run")) return makeRunResponse("pred-sec");
      return makeStatusResponse("completed", ["data:image/png;base64,OKIMAGE"]);
    };
    const result = await runFashnTryOn(makeInput({ customerId: custId }), {
      _fetch: _fetch as typeof fetch, _sleep: noSleep, _getApiKey: () => apiKey,
    });
    assert.equal(result.ok, true);
    const serialised = JSON.stringify(result);
    assert.ok(!serialised.includes(apiKey), "API key must not appear in ok result");
  });

  it("FA.25 — POST /v1/run is called exactly once per successful generation", async () => {
    let runCallCount = 0;
    const custId = `cust-once-${Date.now()}`;
    const _fetch = async (url: string | URL | Request) => {
      const u = url.toString();
      if (u.includes("/v1/run")) { runCallCount++; return makeRunResponse("pred-once"); }
      return makeStatusResponse("completed", ["data:image/png;base64,OUT"]);
    };
    await runFashnTryOn(makeInput({ customerId: custId }), {
      _fetch: _fetch as typeof fetch, _sleep: noSleep, _getApiKey: () => "k",
    });
    assert.equal(runCallCount, 1, "POST /v1/run must be called exactly once per generation");
  });
});

// ── submitTryOnToProvider — parameter selection (2026-11-03) ─────────────────
// Covers the new optional prompt/generationMode fields added for the
// Full-Look VTO final-step visual-fidelity improvement. Every assertion here
// is about the RAW REQUEST BODY sent to FASHN — the one place a regression
// could silently change behavior for the existing single-garment path too.

describe("submitTryOnToProvider — parameter selection", () => {
  it("PS.1 — default call (no prompt/generationMode) sends generation_mode:\"fast\" and omits prompt entirely — byte-identical to the pre-existing behavior", async () => {
    let capturedBody: any = null;
    const _fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      capturedBody = JSON.parse(init!.body as string);
      return makeRunResponse("pred-default");
    }) as typeof fetch;
    const result = await submitTryOnToProvider(makeInput(), { _fetch, _getApiKey: () => "k" });
    assert.equal(result.ok, true);
    assert.equal(capturedBody.inputs.generation_mode, "fast");
    assert.ok(!("prompt" in capturedBody.inputs), "prompt key must not be present when unset");
  });

  it("PS.2 — generationMode:\"quality\" with no prompt sends generation_mode:\"quality\", still omits prompt", async () => {
    let capturedBody: any = null;
    const _fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      capturedBody = JSON.parse(init!.body as string);
      return makeRunResponse("pred-quality");
    }) as typeof fetch;
    await submitTryOnToProvider(makeInput({ generationMode: "quality" }), { _fetch, _getApiKey: () => "k" });
    assert.equal(capturedBody.inputs.generation_mode, "quality");
    assert.ok(!("prompt" in capturedBody.inputs));
  });

  it("PS.3 — a non-empty prompt is forwarded verbatim alongside the requested generation_mode", async () => {
    let capturedBody: any = null;
    const _fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      capturedBody = JSON.parse(init!.body as string);
      return makeRunResponse("pred-prompted");
    }) as typeof fetch;
    const prompt = "Wear the beige tailored blazer open over the existing blue chambray shirt.";
    await submitTryOnToProvider(makeInput({ generationMode: "quality", prompt }), { _fetch, _getApiKey: () => "k" });
    assert.equal(capturedBody.inputs.prompt, prompt);
    assert.equal(capturedBody.inputs.generation_mode, "quality");
  });

  it("PS.4 — every other field in the request body is unaffected by prompt/generationMode (model_name, resolution, output_format, num_images, return_base64)", async () => {
    let capturedBody: any = null;
    const _fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      capturedBody = JSON.parse(init!.body as string);
      return makeRunResponse("pred-shape");
    }) as typeof fetch;
    await submitTryOnToProvider(makeInput({ generationMode: "quality", prompt: "x" }), { _fetch, _getApiKey: () => "k" });
    assert.equal(capturedBody.model_name, "tryon-max");
    assert.equal(capturedBody.inputs.resolution, "1k");
    assert.equal(capturedBody.inputs.output_format, "png");
    assert.equal(capturedBody.inputs.num_images, 1);
    assert.equal(capturedBody.inputs.return_base64, true);
  });
});

// ── submitTryOnToProvider — bounded retry on transient 429/5xx (2026-11-16) ──
// Live incident: garment 2's submission was rejected with a bare HTTP 429,
// ~100ms after garment 1's own status check reported COMPLETED, stopping
// the whole Full-Look chain on what was a transient rate-limit, not a real
// rejection — predictionId stayed null, so nothing was billed, but the
// customer saw a failure for no real reason. These tests pin the fix:
// a bounded retry on exactly 429/5xx, nothing else.

describe("submitTryOnToProvider — bounded retry on transient 429/5xx", () => {
  it("RETRY.1 — a 429 on the first attempt succeeds on the second, without sleeping in tests", async () => {
    let callCount = 0;
    const _fetch = (async () => {
      callCount++;
      if (callCount === 1) return new Response("Too Many Requests", { status: 429 });
      return makeRunResponse("pred-after-429");
    }) as typeof fetch;
    const result = await submitTryOnToProvider(makeInput(), { _fetch, _getApiKey: () => "k", _sleep: noSleep });
    assert.equal(result.ok, true);
    if (!result.ok) throw new Error("unreachable");
    assert.equal(result.predictionId, "pred-after-429");
    assert.equal(callCount, 2, "must retry exactly once, not resubmit indefinitely");
  });

  it("RETRY.2 — a 5xx is NEVER retried (2026-11-17 correction) — FASHN's docs give 429 an explicit no-prediction-issued guarantee that is not extended to 500, so retrying a 5xx is an undocumented double-submission risk", async () => {
    let callCount = 0;
    const _fetch = (async () => {
      callCount++;
      return new Response("Bad Gateway", { status: 502 });
    }) as typeof fetch;
    const result = await submitTryOnToProvider(makeInput(), { _fetch, _getApiKey: () => "k", _sleep: noSleep });
    assert.equal(result.ok, false);
    assert.equal(callCount, 1, "a 5xx must fail immediately, never retried");
  });

  it("RETRY.3 — exactly one retry (two total attempts) — a persistent 429 still fails, never retries a third time", async () => {
    let callCount = 0;
    const _fetch = (async () => {
      callCount++;
      return new Response("Too Many Requests", { status: 429 });
    }) as typeof fetch;
    const result = await submitTryOnToProvider(makeInput(), { _fetch, _getApiKey: () => "k", _sleep: noSleep });
    assert.equal(result.ok, false);
    if (result.ok) throw new Error("unreachable");
    assert.equal(result.code, "PROVIDER_REJECTED");
    assert.equal(callCount, 2, "must stop after the bounded max, not retry forever");
  });

  it("RETRY.4 — a permanent 4xx (e.g. 401) never retries — one call, immediate PROVIDER_REJECTED", async () => {
    let callCount = 0;
    const _fetch = (async () => {
      callCount++;
      return new Response("Unauthorized", { status: 401 });
    }) as typeof fetch;
    const result = await submitTryOnToProvider(makeInput(), { _fetch, _getApiKey: () => "k", _sleep: noSleep });
    assert.equal(result.ok, false);
    assert.equal(callCount, 1, "a non-transient rejection must never be retried");
  });

  it("RETRY.5 — a 413 (payload too large) never retries either — same non-transient treatment as 401", async () => {
    let callCount = 0;
    const _fetch = (async () => {
      callCount++;
      return new Response("Payload Too Large", { status: 413 });
    }) as typeof fetch;
    await submitTryOnToProvider(makeInput(), { _fetch, _getApiKey: () => "k", _sleep: noSleep });
    assert.equal(callCount, 1);
  });

  it("RETRY.6 — a retried-and-successful submission never logs a failure for the transient first attempt", async () => {
    let callCount = 0;
    const _fetch = (async () => {
      callCount++;
      if (callCount === 1) return new Response("Too Many Requests", { status: 429 });
      return makeRunResponse("pred-quiet-retry");
    }) as typeof fetch;
    const logs: string[] = [];
    const originalError = console.error;
    console.error = (msg: string) => logs.push(msg);
    try {
      await submitTryOnToProvider(makeInput(), { _fetch, _getApiKey: () => "k", _sleep: noSleep });
    } finally {
      console.error = originalError;
    }
    assert.equal(logs.length, 0, "a transient attempt that the retry recovers from must never surface as a logged failure");
  });

  it("RETRY.7 — a run-body error field (200 OK but FASHN reports an application error) is never retried — not a transient HTTP signal", async () => {
    let callCount = 0;
    const _fetch = (async () => {
      callCount++;
      return makeRunResponse("", "validation error");
    }) as typeof fetch;
    const result = await submitTryOnToProvider(makeInput(), { _fetch, _getApiKey: () => "k", _sleep: noSleep });
    assert.equal(result.ok, false);
    assert.equal(callCount, 1);
  });

  it("RETRY.8 — the retry delay is actually awaited via the injected _sleep, with the documented duration", async () => {
    let callCount = 0;
    const _fetch = (async () => {
      callCount++;
      if (callCount === 1) return new Response("Too Many Requests", { status: 429 });
      return makeRunResponse("pred-timed");
    }) as typeof fetch;
    const sleptMs: number[] = [];
    await submitTryOnToProvider(makeInput(), {
      _fetch,
      _getApiKey: () => "k",
      _sleep: async (ms: number) => {
        sleptMs.push(ms);
      },
    });
    assert.deepEqual(sleptMs, [500]);
  });
});

// ── submitTryOnToProvider — FASHN's documented 429 sub-types (2026-11-17) ──
// docs.fashn.ai/api-overview/error-handling: a 429 body's `error` field is
// exactly one of RateLimitExceeded, ConcurrencyLimitExceeded, or
// OutOfCredits. The first two are transient; OutOfCredits is permanent
// (no credits left, waiting never helps) and must never be retried, even
// though it shares the same HTTP 429 status as the other two.

function make429Body(errorName: string): Response {
  return new Response(JSON.stringify({ error: errorName }), { status: 429, headers: { "Content-Type": "application/json" } });
}

describe("submitTryOnToProvider — FASHN 429 sub-type classification", () => {
  it("CLASSIFY.1 — RateLimitExceeded retries and can succeed", async () => {
    let callCount = 0;
    const _fetch = (async () => {
      callCount++;
      if (callCount === 1) return make429Body("RateLimitExceeded");
      return makeRunResponse("pred-rle");
    }) as typeof fetch;
    const result = await submitTryOnToProvider(makeInput(), { _fetch, _getApiKey: () => "k", _sleep: noSleep });
    assert.equal(result.ok, true);
    assert.equal(callCount, 2);
  });

  it("CLASSIFY.2 — ConcurrencyLimitExceeded retries and can succeed", async () => {
    let callCount = 0;
    const _fetch = (async () => {
      callCount++;
      if (callCount === 1) return make429Body("ConcurrencyLimitExceeded");
      return makeRunResponse("pred-cle");
    }) as typeof fetch;
    const result = await submitTryOnToProvider(makeInput(), { _fetch, _getApiKey: () => "k", _sleep: noSleep });
    assert.equal(result.ok, true);
    assert.equal(callCount, 2);
  });

  it("CLASSIFY.3 — OutOfCredits NEVER retries, even though it is HTTP 429 — exactly one call", async () => {
    let callCount = 0;
    const _fetch = (async () => {
      callCount++;
      return make429Body("OutOfCredits");
    }) as typeof fetch;
    const result = await submitTryOnToProvider(makeInput(), { _fetch, _getApiKey: () => "k", _sleep: noSleep });
    assert.equal(result.ok, false);
    assert.equal(callCount, 1, "OutOfCredits must never be retried — waiting cannot restore a zero credit balance");
  });

  it("CLASSIFY.4 — OutOfCredits is never retried even when _sleep would throw if called (proves it's truly never invoked)", async () => {
    const _fetch = (async () => make429Body("OutOfCredits")) as typeof fetch;
    const result = await submitTryOnToProvider(makeInput(), {
      _fetch,
      _getApiKey: () => "k",
      _sleep: async () => {
        throw new Error("_sleep must not be called for OutOfCredits");
      },
    });
    assert.equal(result.ok, false);
  });

  it("CLASSIFY.5 — an unrecognized error-name string falls back to the bare HTTP status (still retries a 429)", async () => {
    let callCount = 0;
    const _fetch = (async () => {
      callCount++;
      if (callCount === 1) return make429Body("SomeFutureErrorFashnHasNotDocumentedYet");
      return makeRunResponse("pred-fallback");
    }) as typeof fetch;
    const result = await submitTryOnToProvider(makeInput(), { _fetch, _getApiKey: () => "k", _sleep: noSleep });
    assert.equal(result.ok, true);
    assert.equal(callCount, 2);
  });

  it("CLASSIFY.6 — a 429 with no parseable JSON body at all still retries via the bare-status fallback", async () => {
    let callCount = 0;
    const _fetch = (async () => {
      callCount++;
      if (callCount === 1) return new Response("plain text rate limit message", { status: 429 });
      return makeRunResponse("pred-no-json");
    }) as typeof fetch;
    const result = await submitTryOnToProvider(makeInput(), { _fetch, _getApiKey: () => "k", _sleep: noSleep });
    assert.equal(result.ok, true);
    assert.equal(callCount, 2);
  });

  it("CLASSIFY.7 — the logged failure for OutOfCredits carries the classified name, never the raw provider error text verbatim in an unexpected field", async () => {
    const _fetch = (async () => make429Body("OutOfCredits")) as typeof fetch;
    const logs: string[] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => logs.push(args.join(" "));
    try {
      await submitTryOnToProvider(makeInput(), { _fetch, _getApiKey: () => "k", _sleep: noSleep });
    } finally {
      console.error = originalError;
    }
    assert.equal(logs.length, 1);
    assert.match(logs[0], /OutOfCredits/);
    assert.match(logs[0], /PROVIDER_REJECTED/);
  });
});

// ── submitTryOnToProvider — Retry-After header (2026-11-17) ─────────────────
// Not documented by FASHN today, but read and honored if ever present —
// standard HTTP practice for 429 — with a hard cap so a large or malformed
// value can never stall a serverless invocation.

describe("submitTryOnToProvider — Retry-After header", () => {
  it("RETRY-AFTER.1 — a Retry-After: <seconds> header overrides the default delay", async () => {
    let callCount = 0;
    const _fetch = (async () => {
      callCount++;
      if (callCount === 1) {
        return new Response(JSON.stringify({ error: "RateLimitExceeded" }), {
          status: 429,
          headers: { "Content-Type": "application/json", "Retry-After": "2" },
        });
      }
      return makeRunResponse("pred-retry-after");
    }) as typeof fetch;
    const sleptMs: number[] = [];
    await submitTryOnToProvider(makeInput(), {
      _fetch,
      _getApiKey: () => "k",
      _sleep: async (ms: number) => {
        sleptMs.push(ms);
      },
    });
    assert.deepEqual(sleptMs, [2000]);
  });

  it("RETRY-AFTER.2 — a Retry-After value exceeding the safe ceiling fails closed — NEVER retries early, never resubmits (2026-11-17 correction)", async () => {
    let callCount = 0;
    const _fetch = (async () => {
      callCount++;
      return new Response(JSON.stringify({ error: "ConcurrencyLimitExceeded" }), {
        status: 429,
        headers: { "Content-Type": "application/json", "Retry-After": "3600" },
      });
    }) as typeof fetch;
    const sleptMs: number[] = [];
    const result = await submitTryOnToProvider(makeInput(), {
      _fetch,
      _getApiKey: () => "k",
      _sleep: async (ms: number) => {
        sleptMs.push(ms);
      },
    });
    assert.equal(result.ok, false);
    assert.equal(callCount, 1, "must not retry within this invocation when Retry-After exceeds the safe ceiling");
    assert.equal(sleptMs.length, 0, "must never wait even a truncated/capped amount — failing closed means no wait at all");
  });

  it("RETRY-AFTER.2b — a Retry-After value exactly at the safe ceiling still retries (boundary is inclusive)", async () => {
    let callCount = 0;
    const _fetch = (async () => {
      callCount++;
      if (callCount === 1) {
        return new Response(JSON.stringify({ error: "RateLimitExceeded" }), {
          status: 429,
          headers: { "Content-Type": "application/json", "Retry-After": "5" },
        });
      }
      return makeRunResponse("pred-at-ceiling");
    }) as typeof fetch;
    const sleptMs: number[] = [];
    const result = await submitTryOnToProvider(makeInput(), {
      _fetch,
      _getApiKey: () => "k",
      _sleep: async (ms: number) => {
        sleptMs.push(ms);
      },
    });
    assert.equal(result.ok, true);
    assert.deepEqual(sleptMs, [5000]);
  });

  it("RETRY-AFTER.2c — a Retry-After value just over the safe ceiling (5.001s) fails closed, never retries", async () => {
    let callCount = 0;
    const _fetch = (async () => {
      callCount++;
      return new Response(JSON.stringify({ error: "RateLimitExceeded" }), {
        status: 429,
        headers: { "Content-Type": "application/json", "Retry-After": "5.001" },
      });
    }) as typeof fetch;
    const result = await submitTryOnToProvider(makeInput(), { _fetch, _getApiKey: () => "k", _sleep: noSleep });
    assert.equal(result.ok, false);
    assert.equal(callCount, 1);
  });

  it("RETRY-AFTER.3 — a missing Retry-After header falls back to the default delay", async () => {
    let callCount = 0;
    const _fetch = (async () => {
      callCount++;
      if (callCount === 1) return make429Body("RateLimitExceeded");
      return makeRunResponse("pred-default-delay");
    }) as typeof fetch;
    const sleptMs: number[] = [];
    await submitTryOnToProvider(makeInput(), {
      _fetch,
      _getApiKey: () => "k",
      _sleep: async (ms: number) => {
        sleptMs.push(ms);
      },
    });
    assert.deepEqual(sleptMs, [500]);
  });

  it("RETRY-AFTER.4 — a malformed (non-numeric) Retry-After value is ignored, falling back to the default delay", async () => {
    let callCount = 0;
    const _fetch = (async () => {
      callCount++;
      if (callCount === 1) {
        return new Response(JSON.stringify({ error: "RateLimitExceeded" }), {
          status: 429,
          headers: { "Content-Type": "application/json", "Retry-After": "not-a-number" },
        });
      }
      return makeRunResponse("pred-malformed-retry-after");
    }) as typeof fetch;
    const sleptMs: number[] = [];
    await submitTryOnToProvider(makeInput(), {
      _fetch,
      _getApiKey: () => "k",
      _sleep: async (ms: number) => {
        sleptMs.push(ms);
      },
    });
    assert.deepEqual(sleptMs, [500]);
  });
});

// ── Phase 1 ops: failure logging (safe) ──────────────────────────────────────
//
// Every failure path must now log something retrievable (prior behavior:
// total silence on these paths), and that log must never contain the raw
// customerId, image data, the API key, or the provider's free-text `error`
// field — only a hashed customerId, our own classified code, and opaque
// metadata (predictionId, httpStatus, providerStatus).

describe("Phase 1 ops — FASHN failure logging is present and PII-safe", () => {
  let originalConsoleError: typeof console.error;
  let logs: string[] = [];

  beforeEach(() => {
    logs = [];
    originalConsoleError = console.error;
    console.error = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };
  });

  afterEach(() => {
    console.error = originalConsoleError;
  });

  it("LOG.1 — submit network failure now logs exactly one event", async () => {
    const _fetch = (async () => {
      throw new Error("ECONNRESET");
    }) as typeof fetch;
    await runFashnTryOn(makeInput({ customerId: "cust-sensitive-id-123" }), { _fetch, _sleep: noSleep, _getApiKey: () => "k" });
    assert.equal(logs.length, 1);
    assert.match(logs[0], /\[error-capture\]/);
    assert.match(logs[0], /PROVIDER_FAILED/);
    assert.ok(!logs[0].includes("cust-sensitive-id-123"), "raw customerId must never appear in logs");
    assert.ok(!logs[0].includes(VALID_DATA_URL), "image data must never appear in logs");
    assert.ok(!logs[0].includes("k"), "the API key string must never appear in logs"); // trivial since 'k' is a short test fixture, kept for documentation of intent
  });

  it("LOG.2 — poll network failure logs with the predictionId included", async () => {
    let call = 0;
    const _fetch = (async (url: string | URL | Request) => {
      call++;
      if (call === 1) return makeRunResponse("pred-log-2");
      throw new Error("socket hang up");
    }) as typeof fetch;
    await runFashnTryOn(makeInput(), { _fetch, _sleep: noSleep, _getApiKey: () => "k" });
    assert.equal(logs.length, 1);
    assert.match(logs[0], /pred-log-2/);
    assert.match(logs[0], /fashn:poll/);
  });

  it("LOG.3 — provider-reported failed status logs the providerStatus, never a free-text error field", async () => {
    let call = 0;
    const _fetch = (async () => {
      call++;
      if (call === 1) return makeRunResponse("pred-log-3");
      return makeStatusResponse("failed", undefined, "the customer's blazer prompt leaked here hypothetically");
    }) as typeof fetch;
    await runFashnTryOn(makeInput(), { _fetch, _sleep: noSleep, _getApiKey: () => "k" });
    assert.equal(logs.length, 1);
    assert.match(logs[0], /"providerStatus":"failed"/);
    assert.ok(
      !logs[0].includes("the customer's blazer prompt leaked here hypothetically"),
      "the provider's free-text error field must never be logged",
    );
  });

  it("LOG.4 — submit PROVIDER_REJECTED (non-ok HTTP) logs the httpStatus", async () => {
    const _fetch = (async () => new Response("", { status: 503 })) as typeof fetch;
    await runFashnTryOn(makeInput(), { _fetch, _sleep: noSleep, _getApiKey: () => "k" });
    assert.equal(logs.length, 1);
    assert.match(logs[0], /"httpStatus":503/);
    assert.match(logs[0], /PROVIDER_REJECTED/);
  });

  it("LOG.5 — exhausting all poll attempts logs exactly one TIMEOUT event", async () => {
    let call = 0;
    const _fetch = (async () => {
      call++;
      if (call === 1) return makeRunResponse("pred-log-5");
      return makeStatusResponse("processing");
    }) as typeof fetch;
    await runFashnTryOn(makeInput(), { _fetch, _sleep: noSleep, _getApiKey: () => "k" });
    assert.equal(logs.length, 1);
    assert.match(logs[0], /TIMEOUT/);
    assert.match(logs[0], /pred-log-5/);
  });

  it("LOG.6 — submitTryOnToProvider network failure also logs", async () => {
    const _fetch = (async () => {
      throw new Error("ETIMEDOUT");
    }) as typeof fetch;
    await submitTryOnToProvider(makeInput({ customerId: "another-sensitive-id" }), { _fetch, _getApiKey: () => "k" });
    assert.equal(logs.length, 1);
    assert.ok(!logs[0].includes("another-sensitive-id"));
  });

  it("LOG.7 — customerId in the log is a fixed-length hex hash, never the raw ID in any form", async () => {
    // Guards against a future refactor accidentally truncating/encoding the
    // raw ID instead of hashing it.
    const _fetch = (async () => {
      throw new Error("ECONNRESET");
    }) as typeof fetch;
    await runFashnTryOn(makeInput({ customerId: "cust-log-7-raw-id" }), { _fetch, _sleep: noSleep, _getApiKey: () => "k" });
    assert.equal(logs.length, 1);
    assert.match(logs[0], /"customerIdHash":"[0-9a-f]{12}"/);
    assert.ok(!logs[0].includes("cust-log-7-raw-id"));
  });
});

// ── Phase 1 ops: request timeouts ────────────────────────────────────────────
//
// Every fetch call to FASHN must carry an AbortSignal so a hung connection
// is bounded instead of blocking indefinitely. This does not change what
// happens on timeout — an aborted fetch rejects, which already lands in the
// same catch block a network failure would, preserving the existing
// PROVIDER_FAILED/TIMEOUT error-handling shape (see FA.18/FA.19 above,
// still passing unchanged).

describe("Phase 1 ops — FASHN requests carry a bounded timeout signal", () => {
  it("TIMEOUT-WIRE.1 — the submit request (runFashnTryOn) passes an AbortSignal", async () => {
    let capturedSignal: AbortSignal | undefined;
    const _fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      capturedSignal = init?.signal as AbortSignal | undefined;
      return makeRunResponse("pred-timeout-wire-1");
    }) as typeof fetch;
    await submitTryOnToProvider(makeInput(), { _fetch, _getApiKey: () => "k" });
    assert.ok(capturedSignal instanceof AbortSignal, "submit request must carry an AbortSignal");
    assert.equal(capturedSignal!.aborted, false, "signal must not be pre-aborted for a normal request");
  });

  it("TIMEOUT-WIRE.2 — the runFashnTryOn submit call also passes an AbortSignal", async () => {
    let capturedSignal: AbortSignal | undefined;
    const _fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      capturedSignal = init?.signal as AbortSignal | undefined;
      return makeRunResponse("pred-timeout-wire-2");
    }) as typeof fetch;
    await runFashnTryOn(makeInput(), { _fetch, _sleep: noSleep, _getApiKey: () => "k" });
    assert.ok(capturedSignal instanceof AbortSignal);
  });

  it("TIMEOUT-WIRE.3 — the poll status call passes an AbortSignal", async () => {
    let call = 0;
    let pollSignal: AbortSignal | undefined;
    const _fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      call++;
      if (call === 1) return makeRunResponse("pred-timeout-wire-3");
      pollSignal = init?.signal as AbortSignal | undefined;
      return makeStatusResponse("completed", ["data:image/png;base64,AA=="]);
    }) as typeof fetch;
    await runFashnTryOn(makeInput(), { _fetch, _sleep: noSleep, _getApiKey: () => "k" });
    assert.ok(pollSignal instanceof AbortSignal, "poll request must carry an AbortSignal");
  });

  it("TIMEOUT-WIRE.4 — a fetch that rejects with an AbortError is treated identically to any other network failure (PROVIDER_FAILED), not a new error shape", async () => {
    const _fetch = (async () => {
      const e = new Error("The operation was aborted due to timeout");
      e.name = "TimeoutError";
      throw e;
    }) as typeof fetch;
    const result = await runFashnTryOn(makeInput(), { _fetch, _sleep: noSleep, _getApiKey: () => "k" });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, "PROVIDER_FAILED");
      assert.equal(result.customerMessage, CUSTOMER_ERROR_MESSAGES.PROVIDER_FAILED);
    }
  });
});
