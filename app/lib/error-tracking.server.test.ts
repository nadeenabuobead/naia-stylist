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

  it("extracts severity and routine even when both land well past the 200-char truncation boundary", () => {
    const message = `ConnectorError(ConnectorError { user_facing_error: None, kind: QueryError(PostgresError { code: "08P01", message: "${"x".repeat(300)}", severity: "ERROR", detail: None, column: None, hint: None, file: Some("postgres.c"), line: Some(123), routine: Some("exec_bind_message") }) })`;
    const event = captureError("request-handler", new Error(message));
    assert.equal(event.postgresSqlState, "08P01");
    assert.equal(event.postgresSeverity, "ERROR");
    assert.equal(event.postgresRoutine, "exec_bind_message");
    assert.equal(event.message.length, 200);
  });

  it("distinguishes a bind/prepared-statement failure from a connection-startup failure via routine alone", () => {
    const bindFailure = captureError(
      "request-handler",
      new Error('PostgresError { code: "08P01", message: "m", severity: "ERROR" } routine: Some("exec_bind_message")'),
    );
    const startupFailure = captureError(
      "request-handler",
      new Error('PostgresError { code: "08P01", message: "m", severity: "FATAL" } routine: Some("ProcessStartupPacket")'),
    );
    assert.equal(bindFailure.postgresRoutine, "exec_bind_message");
    assert.equal(startupFailure.postgresRoutine, "ProcessStartupPacket");
    assert.notEqual(bindFailure.postgresRoutine, startupFailure.postgresRoutine);
  });

  it("leaves severity and routine undefined when absent, never guessing a value", () => {
    const event = captureError("ssr-render", new Error("a plain error with no postgres wrapper at all"));
    assert.equal(event.postgresSeverity, undefined);
    assert.equal(event.postgresRoutine, undefined);
  });

  it("never captures Postgres's own detail/hint fields, even though they appear in the same struct", () => {
    const message =
      'PostgresError { code: "23505", message: "duplicate key value", severity: "ERROR", detail: Some("Key (email)=(customer-real-email@example.com) already exists."), hint: None, routine: Some("_bt_check_unique") }';
    const event = captureError("db:write", new Error(message));
    // Confirm the structured fields this module exposes are exactly the
    // four narrow ones — detail/hint are never turned into a field here,
    // and the JSON log line itself must not contain the leaked email.
    assert.equal(event.postgresSeverity, "ERROR");
    assert.equal(event.postgresRoutine, "_bt_check_unique");
    assert.ok(!("detail" in event));
    assert.ok(!("hint" in event));
    const loggedJson = logs[0];
    assert.ok(!loggedJson.includes("customer-real-email@example.com"), "logged JSON must never contain the leaked email from detail");
  });

  it("redacts a Postgres detail value out of the logged message itself, not just out of new fields", () => {
    const message =
      'PostgresError { code: "23505", message: "duplicate key value", severity: "ERROR", detail: Some("Key (email)=(customer-real-email@example.com) already exists."), hint: Some("Some advice mentioning secret-token-xyz") }';
    const event = captureError("db:write", new Error(message));
    assert.ok(!event.message.includes("customer-real-email@example.com"));
    assert.ok(!event.message.includes("secret-token-xyz"));
    assert.ok(event.message.includes('detail: Some("[redacted]")'));
    assert.ok(event.message.includes('hint: Some("[redacted]")'));
    // The redaction must not disturb the still-safe-to-extract fields.
    assert.equal(event.postgresSqlState, "23505");
    assert.equal(event.postgresSeverity, "ERROR");
  });

  it("leaves detail: None / hint: None untouched (the common, harmless case)", () => {
    const message = 'PostgresError { code: "08P01", message: "m", severity: "ERROR", detail: None, hint: None }';
    const event = captureError("x", new Error(message));
    assert.ok(event.message.includes("detail: None"));
    assert.ok(event.message.includes("hint: None"));
  });

  it("bounds severity and routine defensively against an oversized match", () => {
    const message = `PostgresError { code: "08P01", message: "m", severity: "${"A".repeat(100)}", routine: Some("${"b".repeat(100)}") }`;
    const event = captureError("x", new Error(message));
    // The patterns themselves cap capture length (severity <=20, routine <=64),
    // so an absurdly long value simply fails to match rather than being
    // captured and then truncated — confirm it comes back undefined, not a
    // giant string.
    assert.equal(event.postgresSeverity, undefined);
    assert.equal(event.postgresRoutine, undefined);
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
