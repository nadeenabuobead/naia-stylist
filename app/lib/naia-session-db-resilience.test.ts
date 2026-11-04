// app/lib/naia-session-db-resilience.test.ts
//
// SUPERSEDED scope (2026-11-04): getCurrentNaiaCustomer/requireCurrentNaiaCustomer
// no longer resolve through resolveNaiaSession/the __naia_tok cookie — see
// clerk-session.server.ts and clerk-session.test.ts for the live path's own
// version of this exact regression guard. resolveNaiaSession itself is
// unchanged, still the real implementation behind the legacy Shopify OAuth
// routes, so this file keeps testing IT directly rather than through the
// requireCurrentNaiaCustomer wrapper it's no longer reachable from.
//
// Original root cause this guards against: a transient Prisma P1001 ("Can't
// reach database server") on resolveNaiaSession's findUnique call propagated
// uncaught, and with no ErrorBoundary anywhere in the app, rendered as a raw
// "Application Error" to a customer who was, in fact, still validly signed
// in. The fix does NOT catch-and-return-null on a DB failure — that would
// collapse "couldn't check" into "not signed in" and silently bounce a
// genuinely-authenticated customer into fresh Shopify OAuth, which is its
// own, worse regression. Instead, a recognized transient-connectivity error
// is rethrown as a typed DatabaseUnavailableError.
//
// No live DB available to this test run — prisma is mocked here exactly as
// every other DB-touching unit in this codebase with no DB-integration
// harness.
//
// Run: npx vitest run app/lib/naia-session-db-resilience.test.ts

import { describe, it, expect, vi, beforeEach } from "vitest";

const { findUniqueMock } = vi.hoisted(() => ({
  findUniqueMock: vi.fn(),
}));

vi.mock("~/db.server", () => ({
  default: {
    naiaSession: {
      findUnique: findUniqueMock,
      update: vi.fn().mockResolvedValue({}),
      delete: vi.fn().mockResolvedValue({}),
    },
  },
}));

import { resolveNaiaSession, DatabaseUnavailableError } from "./naia-session.server";

beforeEach(() => {
  vi.clearAllMocks();
});

function requestWithCookie(token = "raw-token-value") {
  return new Request("https://naia-stylist-staging.vercel.app/settings", {
    headers: { Cookie: `__naia_tok=${token}` },
  });
}

function prismaKnownError(code: string, message: string) {
  const error = new Error(message) as Error & { code: string };
  error.code = code;
  return error;
}

function prismaPoolTimeoutError() {
  const error = new Error(
    "Invalid `prisma.naiaSession.findUnique()` invocation:\n\nTimed out fetching a new connection from the connection pool. More info: http://pris.ly/d/connection-pool (Current connection pool timeout: 10, connection limit: 1)",
  );
  error.name = "PrismaClientInitializationError";
  return error;
}

describe("resolveNaiaSession() — no session vs. database unavailable are different states", () => {
  it("no cookie at all — returns null, no DB call, normal unauthenticated path", async () => {
    const result = await resolveNaiaSession(new Request("https://naia-stylist-staging.vercel.app/settings"));
    expect(result).toBeNull();
    expect(findUniqueMock).not.toHaveBeenCalled();
  });

  it("a valid DB response with no matching row — returns null (genuinely not signed in)", async () => {
    findUniqueMock.mockResolvedValue(null);
    const result = await resolveNaiaSession(requestWithCookie());
    expect(result).toBeNull();
  });

  it("a valid, unexpired session — returns the customer (normal authenticated path)", async () => {
    const customer = { id: "cust-1", onboardingProfile: null };
    findUniqueMock.mockResolvedValue({
      customerId: "cust-1",
      expiresAt: new Date(Date.now() + 1000 * 60 * 60),
      customer,
    });
    const result = await resolveNaiaSession(requestWithCookie());
    expect(result).toBe(customer);
  });

  it("MISCLASSIFICATION REGRESSION — Prisma P1001 is never returned as null; it throws DatabaseUnavailableError instead", async () => {
    findUniqueMock.mockRejectedValue(prismaKnownError("P1001", "Can't reach database server at `db.prisma.io:5432`"));
    await expect(resolveNaiaSession(requestWithCookie())).rejects.toBeInstanceOf(DatabaseUnavailableError);
  });

  it("MISCLASSIFICATION REGRESSION — a connection-pool timeout (PrismaClientInitializationError, no stable .code) also throws DatabaseUnavailableError, never null", async () => {
    findUniqueMock.mockRejectedValue(prismaPoolTimeoutError());
    await expect(resolveNaiaSession(requestWithCookie())).rejects.toBeInstanceOf(DatabaseUnavailableError);
  });

  it("other known transient Prisma codes (P1002, P1008, P1017) are classified the same way", async () => {
    for (const code of ["P1002", "P1008", "P1017"]) {
      findUniqueMock.mockRejectedValueOnce(prismaKnownError(code, "transient"));
      await expect(resolveNaiaSession(requestWithCookie())).rejects.toBeInstanceOf(DatabaseUnavailableError);
    }
  });

  it("an unrelated, non-connectivity error is rethrown unchanged — not wrapped, not swallowed to null", async () => {
    const weirdError = new TypeError("something unrelated broke");
    findUniqueMock.mockRejectedValue(weirdError);
    await expect(resolveNaiaSession(requestWithCookie())).rejects.toBe(weirdError);
  });
});

describe("resolveNaiaSession() — the legacy Shopify-OAuth path's own DB-unavailable guard still holds unchanged", () => {
  // requireCurrentNaiaCustomer itself is no longer reachable from here (see
  // this file's header) — these exercise resolveNaiaSession directly, which
  // is exactly what the legacy auth.shopify.* routes still call.

  it("MISCLASSIFICATION REGRESSION — a P1001 propagates as DatabaseUnavailableError, never collapsed to null", async () => {
    findUniqueMock.mockRejectedValue(prismaKnownError("P1001", "Can't reach database server"));
    const rejection = await resolveNaiaSession(requestWithCookie()).catch((e) => e);
    expect(rejection).toBeInstanceOf(DatabaseUnavailableError);
  });

  it("a pool-timeout error also propagates uncaught, never silently resolved to null", async () => {
    findUniqueMock.mockRejectedValue(prismaPoolTimeoutError());
    const rejection = await resolveNaiaSession(requestWithCookie()).catch((e) => e);
    expect(rejection).toBeInstanceOf(DatabaseUnavailableError);
  });
});
