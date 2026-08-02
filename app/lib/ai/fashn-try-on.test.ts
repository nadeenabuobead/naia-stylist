// app/lib/ai/fashn-try-on.test.ts
// Unit tests for the FASHN Try-On adapter.
// No real provider calls — all network interactions use DI mocks.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  runFashnTryOn,
  isAllowedProductImageUrl,
  isValidModelImageDataUrl,
  hasVirtualTryOnConsent,
} from "./fashn-try-on.server.ts";
import type { VirtualTryOnInput } from "./virtual-try-on.types.ts";

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

// ── runFashnTryOn — rate limiting ─────────────────────────────────────────────

describe("runFashnTryOn — rate limiting", () => {
  it("FA.11 — same customerId is rate-limited on a second call within the window", async () => {
    const customerId = `cust-rl-${Date.now()}`;
    let runCallCount = 0;
    const _fetch = async (url: string | URL | Request) => {
      const u = url.toString();
      if (u.includes("/v1/run")) { runCallCount++; return makeRunResponse("pred-rl"); }
      return makeStatusResponse("completed", ["data:image/png;base64,OUT"]);
    };

    const first = await runFashnTryOn(makeInput({ customerId }), {
      _fetch: _fetch as typeof fetch,
      _sleep: noSleep,
      _getApiKey: () => "k",
    });
    assert.equal(first.ok, true, "first call should succeed");

    const second = await runFashnTryOn(makeInput({ customerId }), {
      _fetch: _fetch as typeof fetch,
      _sleep: noSleep,
      _getApiKey: () => "k",
    });
    assert.equal(second.ok, false);
    if (second.ok) throw new Error("unreachable");
    assert.equal(second.code, "RATE_LIMITED");
    assert.equal(runCallCount, 1, "fetch must only be called once (no second run)");
  });

  it("FA.12 — different customerIds are not rate-limited against each other", async () => {
    let runCallCount = 0;
    const _fetch = async (url: string | URL | Request) => {
      const u = url.toString();
      if (u.includes("/v1/run")) { runCallCount++; return makeRunResponse(`pred-multi-${runCallCount}`); }
      return makeStatusResponse("completed", ["data:image/png;base64,OUT"]);
    };

    const custA = `cust-rl-a-${Date.now()}`;
    const custB = `cust-rl-b-${Date.now()}`;

    const resA = await runFashnTryOn(makeInput({ customerId: custA }), {
      _fetch: _fetch as typeof fetch, _sleep: noSleep, _getApiKey: () => "k",
    });
    const resB = await runFashnTryOn(makeInput({ customerId: custB }), {
      _fetch: _fetch as typeof fetch, _sleep: noSleep, _getApiKey: () => "k",
    });

    assert.equal(resA.ok, true);
    assert.equal(resB.ok, true);
    assert.equal(runCallCount, 2);
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
