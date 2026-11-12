// app/lib/ai/claude.server.test.ts
//
// Phase 1 ops: tests for request-timeout wiring and PII-safe failure
// logging added to callClaude/analyzeImage. No real network calls — every
// test injects _fetch.

import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import { callClaude, analyzeImage } from "./claude.server.ts";

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

function okResponse(text: string): Response {
  return new Response(
    JSON.stringify({ content: [{ text }] }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

function errorResponse(status: number, message: string, type = "invalid_request_error"): Response {
  return new Response(
    JSON.stringify({ error: { message, type } }),
    { status, headers: { "Content-Type": "application/json" } },
  );
}

describe("callClaude", () => {
  it("returns the text content on a successful call (unchanged happy path)", async () => {
    const _fetch = (async () => okResponse("hello")) as typeof fetch;
    const result = await callClaude({ messages: [{ role: "user", content: "hi" }], _fetch });
    assert.equal(result, "hello");
  });

  it("every request carries a bounded AbortSignal", async () => {
    let capturedSignal: AbortSignal | undefined;
    const _fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      capturedSignal = init?.signal as AbortSignal | undefined;
      return okResponse("hi");
    }) as typeof fetch;
    await callClaude({ messages: [{ role: "user", content: "hi" }], _fetch });
    assert.ok(capturedSignal instanceof AbortSignal, "request must carry an AbortSignal");
    assert.equal(capturedSignal!.aborted, false);
  });

  it("throws the same error message on a non-ok response as before (customer-facing behavior preserved)", async () => {
    const _fetch = (async () => errorResponse(429, "Rate limited upstream")) as typeof fetch;
    await assert.rejects(
      () => callClaude({ messages: [{ role: "user", content: "hi" }], _fetch }),
      (err: Error) => err.message === "Rate limited upstream",
    );
  });

  it("logs a classified failure (status + errorType) without the raw response body", async () => {
    const _fetch = (async () => errorResponse(500, "boom", "api_error")) as typeof fetch;
    await assert.rejects(() => callClaude({ messages: [{ role: "user", content: "hi" }], _fetch }));
    assert.equal(logs.length, 2); // captureFailure (non-ok) + captureError (catch rethrow)
    assert.match(logs[0], /"httpStatus":500/);
    assert.match(logs[0], /"errorType":"api_error"/);
  });

  it("an AbortError from a timed-out fetch is rethrown exactly like any other fetch failure — no new error shape", async () => {
    const _fetch = (async () => {
      const e = new Error("The operation was aborted due to timeout");
      e.name = "TimeoutError";
      throw e;
    }) as typeof fetch;
    await assert.rejects(
      () => callClaude({ messages: [{ role: "user", content: "hi" }], _fetch }),
      (err: Error) => err.name === "TimeoutError",
    );
  });
});

describe("analyzeImage", () => {
  it("returns the text content on a successful call (unchanged happy path)", async () => {
    const _fetch = (async () => okResponse("a description")) as typeof fetch;
    const result = await analyzeImage({ imageUrl: "https://cdn.example.com/x.jpg", prompt: "describe", _fetch });
    assert.equal(result, "a description");
  });

  it("applies a default timeout signal when the caller passes no signal of its own", async () => {
    let capturedSignal: AbortSignal | undefined;
    const _fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      capturedSignal = init?.signal as AbortSignal | undefined;
      return okResponse("x");
    }) as typeof fetch;
    await analyzeImage({ imageUrl: "https://cdn.example.com/x.jpg", prompt: "describe", _fetch });
    assert.ok(capturedSignal instanceof AbortSignal);
  });

  it("still carries a signal when the caller passes its own cancellation signal (combined, not replaced)", async () => {
    let capturedSignal: AbortSignal | undefined;
    const _fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      capturedSignal = init?.signal as AbortSignal | undefined;
      return okResponse("x");
    }) as typeof fetch;
    const callerController = new AbortController();
    await analyzeImage({
      imageUrl: "https://cdn.example.com/x.jpg",
      prompt: "describe",
      signal: callerController.signal,
      _fetch,
    });
    assert.ok(capturedSignal instanceof AbortSignal);
  });

  it("the caller's own signal can still abort the request early (cancellation capability preserved)", async () => {
    const callerController = new AbortController();
    const _fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      const sig = init?.signal as AbortSignal;
      if (sig.aborted) throw new DOMException("aborted", "AbortError");
      return okResponse("x");
    }) as typeof fetch;
    callerController.abort();
    await assert.rejects(() =>
      analyzeImage({
        imageUrl: "https://cdn.example.com/x.jpg",
        prompt: "describe",
        signal: callerController.signal,
        _fetch,
      }),
    );
  });

  it("logs only httpStatus/errorType on failure — never the raw response body (previously logged in full)", async () => {
    const _fetch = (async () => errorResponse(400, "bad image", "invalid_request_error")) as typeof fetch;
    await assert.rejects(() =>
      analyzeImage({ imageUrl: "https://cdn.example.com/x.jpg", prompt: "describe, including secret-looking-prompt-text", _fetch }),
    );
    assert.equal(logs.length, 1);
    assert.match(logs[0], /"httpStatus":400/);
    assert.match(logs[0], /"errorType":"invalid_request_error"/);
    assert.ok(!logs[0].includes("secret-looking-prompt-text"), "the prompt must never appear in the failure log");
  });

  it("throws the same error message on a non-ok response as before (customer-facing behavior preserved)", async () => {
    const _fetch = (async () => errorResponse(400, "Image could not be processed")) as typeof fetch;
    await assert.rejects(
      () => analyzeImage({ imageUrl: "https://cdn.example.com/x.jpg", prompt: "describe", _fetch }),
      (err: Error) => err.message === "Image could not be processed",
    );
  });
});
