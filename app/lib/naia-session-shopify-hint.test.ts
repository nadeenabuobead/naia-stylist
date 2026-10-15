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

  it("never logs the id_token and never returns it in any loader/response data", () => {
    expect(/console\.(log|error|warn|info)\([^)]*id_token/i.test(callbackSrc)).toBe(false);
    // The only two places id_token may appear: validateIdToken's call and
    // createNaiaSession's call — never inside the final redirect's data/headers.
    const finalRedirect = callbackSrc.slice(callbackSrc.indexOf("const headers = new Headers()"));
    expect(finalRedirect.includes("id_token")).toBe(false);
  });

  function assertPresent(idx: number, what: string) {
    expect(idx, `expected to find: ${what}`).toBeGreaterThan(-1);
  }
});
