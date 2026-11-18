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

  it("extracts a wrapped Postgres SQLSTATE even past the 200-char truncation boundary", () => {
    const prefix = "x".repeat(250);
    const message = `${prefix} ConnectorError(ConnectorError { user_facing_error: None, kind: QueryError(PostgresError { code: "08P01", message: "protocol violation" }) })`;
    const event = captureError("request-handler", new Error(message));
    assert.equal(event.postgresSqlState, "08P01");
    assert.equal(event.message.length, 200);
  });

  it("leaves postgresSqlState undefined when no PostgresError wrapper is present", () => {
    const event = captureError("ssr-render", new Error("a plain error with no postgres wrapper"));
    assert.equal(event.postgresSqlState, undefined);
  });

  it("captures Prisma's own structured .code when present, regardless of message content", () => {
    const err = new Error("Timed out fetching a new connection from the connection pool");
    (err as { code?: string }).code = "P2024";
    const event = captureError("db:lookup", err);
    assert.equal(event.prismaCode, "P2024");
  });

  it("never captures an oversized or non-string .code value", () => {
    const withLongCode = new Error("boom");
    (withLongCode as { code?: string }).code = "x".repeat(50);
    const longEvent = captureError("x", withLongCode);
    assert.equal(longEvent.prismaCode, undefined);

    const withNumericCode = new Error("boom");
    (withNumericCode as { code?: unknown }).code = 42;
    const numericEvent = captureError("x", withNumericCode);
    assert.equal(numericEvent.prismaCode, undefined);
  });

  it("never leaks SQL text or parameter values even when they appear right next to the SQLSTATE", () => {
    const message =
      'QueryError(PostgresError { code: "08P01", message: "bind message supplies 4 parameters for customer_secret_token=abc123real-token" })';
    const event = captureError("request-handler", new Error(message));
    assert.equal(event.postgresSqlState, "08P01");
    // The structured field itself must never carry anything beyond the 5-char code.
    assert.equal(event.postgresSqlState?.length, 5);
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
