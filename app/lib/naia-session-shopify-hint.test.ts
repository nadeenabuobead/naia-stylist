// app/lib/naia-session-shopify-hint.test.ts
//
// createNaiaSession persisting the Shopify id_token hint — the write side of
// the provider-logout/account-switching fix (destroySessionAndGetHint, the
// read side, is covered in app/routes/auth.logout.test.ts). No live DB
// available here — prisma.naiaSession.create is mocked, same convention as
// every other DB-touching unit test in this codebase with no DB-integration
// harness.
//
// Run: npx vitest run app/lib/naia-session-shopify-hint.test.ts

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const { createMock } = vi.hoisted(() => ({
  createMock: vi.fn().mockResolvedValue({ id: "session-1" }),
}));

vi.mock("~/db.server", () => ({
  default: { naiaSession: { create: createMock } },
}));

import { createNaiaSession } from "./naia-session.server";

beforeEach(() => {
  createMock.mockClear();
});

function fakeRequest() {
  return new Request("https://naia-stylist-staging.vercel.app/auth/shopify/callback", {
    headers: { "User-Agent": "test-agent" },
  });
}

describe("createNaiaSession — persists the Shopify id_token hint for later provider logout", () => {
  it("stores shopifyIdTokenHint on the new row when an id_token is supplied", async () => {
    await createNaiaSession("customer-1", fakeRequest(), "the-real-jwt-value");
    expect(createMock).toHaveBeenCalledTimes(1);
    const data = createMock.mock.calls[0][0].data;
    expect(data.shopifyIdTokenHint).toBe("the-real-jwt-value");
    expect(data.customerId).toBe("customer-1");
  });

  it("omits shopifyIdTokenHint (stores undefined, not null or an empty string) when no id_token is supplied — existing/older callers stay unaffected", async () => {
    await createNaiaSession("customer-1", fakeRequest());
    const data = createMock.mock.calls[0][0].data;
    expect(data.shopifyIdTokenHint).toBeUndefined();
  });

  it("omits shopifyIdTokenHint when explicitly passed null", async () => {
    await createNaiaSession("customer-1", fakeRequest(), null);
    const data = createMock.mock.calls[0][0].data;
    expect(data.shopifyIdTokenHint).toBeUndefined();
  });

  it("the raw id_token is never used for anything else on this row — only ever the dedicated hint field", async () => {
    await createNaiaSession("customer-1", fakeRequest(), "the-real-jwt-value");
    const data = createMock.mock.calls[0][0].data;
    const serialized = JSON.stringify(data);
    const occurrences = serialized.split("the-real-jwt-value").length - 1;
    expect(occurrences).toBe(1); // present exactly once, in shopifyIdTokenHint, not duplicated anywhere
  });
});

describe("auth.shopify.callback.tsx — wires tokens.id_token through to createNaiaSession", () => {
  const callbackSrc = readFileSync(resolve(__dirname, "../routes/auth.shopify.callback.tsx"), "utf-8");

  it("passes tokens.id_token as the third argument to createNaiaSession, after the existing id_token validation", () => {
    const validateIdx = callbackSrc.indexOf("await validateIdToken(tokens.id_token");
    const createIdx = callbackSrc.indexOf("createNaiaSession(customer.id, request, tokens.id_token)");
    assertPresent(validateIdx, "validateIdToken call");
    assertPresent(createIdx, "createNaiaSession call with tokens.id_token");
    expect(validateIdx).toBeLessThan(createIdx);
  });

  it("the cross-domain handoff branch also passes tokens.id_token through createNaiaSession (with its extra pendingExpiresAt argument), after the same id_token validation", () => {
    const validateIdx = callbackSrc.indexOf("await validateIdToken(tokens.id_token");
    const handoffCreateIdx = callbackSrc.indexOf("createNaiaSession(customer.id, request, tokens.id_token, pendingExpiresAt)");
    assertPresent(handoffCreateIdx, "createNaiaSession call with tokens.id_token and pendingExpiresAt (handoff branch)");
    expect(validateIdx).toBeLessThan(handoffCreateIdx);
  });

  it("never logs the id_token and never returns it in any loader/response data", () => {
    expect(/console\.(log|error|warn|info)\([^)]*id_token/i.test(callbackSrc)).toBe(false);

    // Past this point, id_token may ONLY appear as an argument to the two
    // known-safe createNaiaSession calls (the cross-domain handoff branch,
    // which passes a pendingExpiresAt 4th argument, and the normal branch,
    // which doesn't) — createNaiaSession stores it solely in the dedicated
    // shopifyIdTokenHint DB column (see the describe block above), never
    // logs it, never returns it. Strip exactly those two call expressions,
    // then assert id_token appears nowhere else at all — in a header, a
    // redirect URL (handoffUrl/finalReturnTarget), a cookie value, or any
    // new third call site this file doesn't already know about. This is
    // the real security property (no leak) rather than "nothing after one
    // fixed line," which breaks every time a legitimate branch is added
    // after that line — exactly what happened with the handoff branch.
    const finalRedirect = callbackSrc
      .slice(callbackSrc.indexOf("const headers = new Headers()"))
      // Strip // line comments first — this route's own explanatory prose
      // (e.g. "tokens.id_token is already validated above...") legitimately
      // mentions id_token without that being a leak; only executable code
      // matters for this assertion.
      .replace(/\/\/.*$/gm, "")
      .replace(/createNaiaSession\(customer\.id, request, tokens\.id_token(?:, pendingExpiresAt)?\)/g, "createNaiaSession(/* safe */)");
    expect(finalRedirect.includes("id_token")).toBe(false);
  });

  function assertPresent(idx: number, what: string) {
    expect(idx, `expected to find: ${what}`).toBeGreaterThan(-1);
  }
});
