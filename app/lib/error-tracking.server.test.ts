// app/lib/error-tracking.server.test.ts
import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import { captureError, captureFailure } from "./error-tracking.server.ts";

let logs: string[] = [];
let originalConsoleError: typeof console.error;

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

describe("captureError", () => {
  it("logs a structured event for a real Error", () => {
    const event = captureError("fashn:submit", new Error("boom"), { httpStatus: 502 });
    assert.equal(event.context, "fashn:submit");
    assert.equal(event.name, "Error");
    assert.equal(event.message, "boom");
    assert.deepEqual(event.meta, { httpStatus: 502 });
    assert.equal(logs.length, 1);
    assert.match(logs[0], /\[error-capture\]/);
  });

  it("handles a non-Error thrown value without crashing", () => {
    const event = captureError("fashn:poll", "a string, not an Error");
    assert.equal(event.name, "UnknownError");
    assert.equal(event.message, "Non-Error thrown");
  });

  it("truncates long error messages to 200 chars", () => {
    const long = "x".repeat(500);
    const event = captureError("ssr-render", new Error(long));
    assert.equal(event.message.length, 200);
  });

  it("never invents fields beyond what the caller passed in meta", () => {
    const event = captureError("fashn:submit", new Error("boom"), {
      customerIdHash: "abc123",
      predictionId: "pred_1",
    });
    assert.deepEqual(event.meta, { customerIdHash: "abc123", predictionId: "pred_1" });
  });
});

describe("captureFailure", () => {
  it("logs a structured event for a classified (non-thrown) failure", () => {
    const event = captureFailure("fashn:poll", "PROVIDER_FAILED", { predictionId: "pred_2" });
    assert.equal(event.name, "Failure");
    assert.equal(event.message, "PROVIDER_FAILED");
    assert.deepEqual(event.meta, { predictionId: "pred_2" });
    assert.equal(logs.length, 1);
  });

  it("truncates long messages to 200 chars", () => {
    const event = captureFailure("x", "y".repeat(500));
    assert.equal(event.message.length, 200);
  });
});
