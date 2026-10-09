// app/lib/buyskip/persistence-error-diagnostics.test.ts
// Run: node --test --import tsx/esm app/lib/buyskip/persistence-error-diagnostics.test.ts

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Prisma } from "@prisma/client";
import { classifyPersistenceError } from "./persistence-error-diagnostics.server.ts";

describe("classifyPersistenceError()", () => {
  it("a known-request error (e.g. a real P-code) classifies as KNOWN_REQUEST_ERROR with its code", () => {
    const err = new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
      code: "P2024",
      clientVersion: "6.19.2",
    });
    const diag = classifyPersistenceError(err);
    assert.deepEqual(diag, { category: "KNOWN_REQUEST_ERROR", code: "P2024" });
  });

  it("a validation error classifies as VALIDATION_ERROR with no code — message is never surfaced", () => {
    const err = new Prisma.PrismaClientValidationError("Invalid value provided. Expected Int, provided Float.", {
      clientVersion: "6.19.2",
    });
    const diag = classifyPersistenceError(err);
    assert.deepEqual(diag, { category: "VALIDATION_ERROR", code: null });
  });

  it("an initialization error classifies as INITIALIZATION_ERROR, surfacing only its errorCode", () => {
    const err = new Prisma.PrismaClientInitializationError(
      "Can't reach database server at `db.prisma.io:5432`.",
      "6.19.2",
      "P1001",
    );
    const diag = classifyPersistenceError(err);
    assert.deepEqual(diag, { category: "INITIALIZATION_ERROR", code: "P1001" });
  });

  it("an unknown-request error classifies as UNKNOWN_REQUEST_ERROR with no code", () => {
    const err = new Prisma.PrismaClientUnknownRequestError("Unknown error occurred", {
      clientVersion: "6.19.2",
    });
    const diag = classifyPersistenceError(err);
    assert.deepEqual(diag, { category: "UNKNOWN_REQUEST_ERROR", code: null });
  });

  it("a plain, non-Prisma error classifies as UNKNOWN_ERROR with no code", () => {
    const diag = classifyPersistenceError(new TypeError("Cannot read properties of undefined"));
    assert.deepEqual(diag, { category: "UNKNOWN_ERROR", code: null });
  });

  it("a non-Error thrown value (e.g. a plain object) still classifies safely, no throw", () => {
    const diag = classifyPersistenceError({ weird: "shape" });
    assert.deepEqual(diag, { category: "UNKNOWN_ERROR", code: null });
  });

  it("the returned diagnostic never contains the error's own .message", () => {
    const err = new Prisma.PrismaClientInitializationError(
      "a message that must never be forwarded",
      "6.19.2",
      "P1001",
    );
    const diag = classifyPersistenceError(err);
    const serialized = JSON.stringify(diag);
    assert.ok(!serialized.includes("a message that must never be forwarded"), "message text never leaks into the diagnostic");
  });
});
