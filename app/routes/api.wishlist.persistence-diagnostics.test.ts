// app/routes/api.wishlist.persistence-diagnostics.test.ts
// Buy/Skip persistence observability — source-code assertions proving the
// diagnostic-logging addition changes nothing about behavior.
//
// Coverage:
//   A. P2002 (idempotent repeat) path is unchanged
//   B. Non-P2002 failure path still returns the same 503 + same customer copy
//   C. The new diagnostic log never includes raw message/meta/decisionEvidence/
//      customer identifiers — only category, code, and a statically-known
//      operation name
//   D. classifyPersistenceError is imported from the dedicated pure module,
//      not reimplemented inline
//
// Run: node --test --import tsx/esm app/routes/api.wishlist.persistence-diagnostics.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

const SRC = readFileSync(resolve(import.meta.dirname, "api.wishlist.jsx"), "utf-8");

function catchBlock() {
  // 2026-11-12 (fix/stripe-clerk-phase1-security): the bare
  // prisma.buyOrSkipAnalysis.create(...) fallback is gone — enforcement is
  // unconditional now, so reserveBuySkipSlot(...) is the only write path.
  // Same catch block, same diagnostic behavior; just a different anchor.
  const createIdx = SRC.indexOf("reserveBuySkipSlot(");
  const catchIdx = SRC.indexOf("} catch (dbErr)", createIdx);
  assert.ok(createIdx !== -1 && catchIdx !== -1, "the reservation call and its catch block are both present");
  return SRC.slice(catchIdx, SRC.indexOf("\n      }", catchIdx) + 8);
}

describe("A — P2002 (idempotent repeat) path is unchanged", () => {
  it("P2002 still sets isIdempotentRepeat = true and nothing else", () => {
    const block = catchBlock();
    const p2002Idx = block.indexOf('dbErr?.code === "P2002"');
    assert.ok(p2002Idx !== -1, "P2002 branch present");
    const p2002Branch = block.slice(p2002Idx, block.indexOf("} else {", p2002Idx));
    assert.ok(p2002Branch.includes("isIdempotentRepeat = true"), "still sets isIdempotentRepeat");
    assert.ok(!p2002Branch.includes("classifyPersistenceError"), "P2002 path does not call the new classifier — behavior unchanged");
    assert.ok(!p2002Branch.includes("console.error"), "P2002 path does not log — it's an expected, handled case, not a failure");
  });
});

describe("B — non-P2002 failure path still returns the same 503 + same customer copy", () => {
  it("still returns status 503", () => {
    const block = catchBlock();
    assert.ok(block.includes("status: 503"), "503 status unchanged");
  });

  it("still returns the exact same customer-facing message", () => {
    const block = catchBlock();
    assert.ok(block.includes("Analysis could not be saved. Please try again."), "customer copy unchanged");
  });
});

describe("C — the diagnostic log is value-free", () => {
  it("logs only operation, category, and code — not the raw error message or meta", () => {
    const block = catchBlock();
    const logIdx = block.indexOf("console.error(");
    assert.ok(logIdx !== -1, "a console.error call exists in the non-P2002 branch");
    const logCall = block.slice(logIdx, block.indexOf(");", logIdx) + 2);
    assert.ok(logCall.includes("operation:"), "logs the operation name");
    assert.ok(logCall.includes("category:"), "logs the safe category");
    assert.ok(logCall.includes("code:"), "logs the P-code when present");
    assert.ok(!logCall.includes("dbErr.message"), "never logs the raw Prisma error message");
    assert.ok(!logCall.includes("dbErr.meta"), "never logs Prisma error meta");
    assert.ok(!logCall.includes("decisionEvidence"), "never logs decisionEvidence");
    assert.ok(!logCall.includes("customerId") && !logCall.includes("naiaCustomer"), "never logs a customer identifier");
    assert.ok(!logCall.includes("publicId") && !logCall.includes("imagePublicId"), "never logs the image reference");
  });

  it("the operation name is a static string known from our own code, not read off the error", () => {
    const block = catchBlock();
    assert.ok(block.includes('operation: "buyOrSkipAnalysis.create"'), "operation name is a literal, not derived from dbErr");
  });
});

describe("D — classifyPersistenceError is imported, not reimplemented inline", () => {
  it("imports classifyPersistenceError from the dedicated pure module", () => {
    assert.ok(
      SRC.includes('import { classifyPersistenceError } from "../lib/buyskip/persistence-error-diagnostics.server"'),
      "imports the classifier rather than duplicating error-classification logic inline",
    );
  });

  it("the non-P2002 branch actually calls the imported classifier", () => {
    const block = catchBlock();
    assert.ok(block.includes("classifyPersistenceError(dbErr)"), "calls classifyPersistenceError on the caught error");
  });
});
