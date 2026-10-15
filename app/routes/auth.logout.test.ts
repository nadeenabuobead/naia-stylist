// app/routes/auth.logout.test.ts
//
// Provider-session logout — the account-switching fix. Local logout
// (destroySessionAndGetHint / __naia_tok) only ever ends this app's own
// session; Shopify's own identity-provider session at its authentication
// domain survives that untouched, so an explicit Sign In right after Sign
// Out used to silently re-authenticate the same account with no chance to
// switch. The fix: read the session's stored Shopify id_token hint while
// deleting it, then (best-effort, never blocking local logout) redirect to
// Shopify's discovered end_session_endpoint so Shopify's own session
// actually ends too.
//
// Resilience regression (the reason this file's DB mock shape changed from
// findUnique+deleteMany to a single delete): a live transient DB outage
// (Prisma P1001) hit the original findUnique call with no try/catch,
// throwing uncaught through the whole action and surfacing as "Unexpected
// Server Error" to a customer trying to Sign Out. destroySessionAndGetHint
// is now a single delete({select}) call wrapped in its own try/catch —
// P2025 (no such row), a DB outage, or any other failure all resolve to
// null rather than throwing. auth.logout's action also wraps its own body
// in a final defensive try/catch, so even an unexpected exception anywhere
// else in session cleanup still returns the one outcome that matters to the
// customer: cookie cleared, landing on /auth/signed-out.
//
// No live DB available to this test run — prisma is mocked here exactly as
// every other DB-touching unit in this codebase with no DB-integration
// harness (see personalised-trend-edit-usage.test.ts, closet-photo-
// privacy.test.ts). getOidcConfig is mocked for the same reason: it makes a
// real network fetch to Shopify, which this sandbox can't reach either.
// buildProviderLogoutUrl stays the REAL implementation — that's the part
// these tests actually need to prove correct.
//
// Run: npx vitest run app/routes/auth.logout.test.ts

import { describe, it, expect, vi, beforeEach } from "vitest";

const { deleteMock } = vi.hoisted(() => ({
  deleteMock: vi.fn(),
}));

vi.mock("~/db.server", () => ({
  default: { naiaSession: { delete: deleteMock } },
}));

const { getOidcConfigMock } = vi.hoisted(() => ({
  getOidcConfigMock: vi.fn(),
}));

vi.mock("~/lib/shopify-customer-oauth.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/lib/shopify-customer-oauth.server")>();
  return {
    ...actual, // keep the real buildProviderLogoutUrl, validateReturnTo, etc.
    getOidcConfig: getOidcConfigMock,
  };
});

import { action as logoutAction, loader as logoutLoader } from "./auth.logout";
import { destroySessionAndGetHint } from "~/lib/naia-session.server";

// A spy on console.error so the DB-failure tests can assert a failure was
// actually logged (not silently swallowed) without printing it to the real
// test run output, and without ever asserting on its content — this must
// never depend on, or leak, any part of an id_token.
let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

function requestWithCookie(token = "raw-token-value") {
  return new Request("https://naia-stylist-staging.vercel.app/auth/logout", {
    method: "POST",
    headers: { Cookie: `__naia_tok=${token}` },
  });
}

function requestWithNoCookie() {
  return new Request("https://naia-stylist-staging.vercel.app/auth/logout", { method: "POST" });
}

function prismaError(code: string, message: string) {
  const error = new Error(message) as Error & { code: string };
  error.code = code;
  return error;
}

describe("destroySessionAndGetHint — single delete, documented 'never throws' contract actually holds", () => {
  it("no cookie at all — returns null, never touches the DB", async () => {
    const result = await destroySessionAndGetHint(requestWithNoCookie());
    expect(result).toBeNull();
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it("normal case — deletes the row and returns its stored shopifyIdTokenHint in one call", async () => {
    deleteMock.mockResolvedValue({ shopifyIdTokenHint: "the-id-token-jwt" });
    const result = await destroySessionAndGetHint(requestWithCookie());
    expect(result).toBe("the-id-token-jwt");
    expect(deleteMock).toHaveBeenCalledTimes(1);
    const call = deleteMock.mock.calls[0][0];
    expect(call.select).toEqual({ shopifyIdTokenHint: true });
  });

  it("an older session with no stored hint (shopifyIdTokenHint: null) — returns null, row is still deleted", async () => {
    deleteMock.mockResolvedValue({ shopifyIdTokenHint: null });
    const result = await destroySessionAndGetHint(requestWithCookie());
    expect(result).toBeNull();
    expect(deleteMock).toHaveBeenCalledTimes(1);
  });

  it("Prisma P2025 (no such row — already deleted, expired and reaped, or a stale/invalid token) — returns null, does not log an error (routine, not a failure)", async () => {
    deleteMock.mockRejectedValue(prismaError("P2025", "An operation failed because it depends on one or more records that were required but not found."));
    const result = await destroySessionAndGetHint(requestWithCookie());
    expect(result).toBeNull();
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it("DB-FAILURE REGRESSION — Prisma P1001 (can't reach database server) — returns null instead of throwing, and logs the failure", async () => {
    deleteMock.mockRejectedValue(prismaError("P1001", "Can't reach database server at `db.prisma.io:5432`"));
    const result = await destroySessionAndGetHint(requestWithCookie());
    expect(result).toBeNull();
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
  });

  it("any other unexpected error from delete() — still returns null rather than propagating", async () => {
    deleteMock.mockRejectedValue(new TypeError("something unrelated broke"));
    const result = await destroySessionAndGetHint(requestWithCookie());
    expect(result).toBeNull();
  });
});

describe("auth.logout action — local logout always happens; provider logout is best-effort on top", () => {
  it("no session — clears __naia_tok and goes straight to /auth/signed-out, no OIDC lookup attempted, no 500", async () => {
    deleteMock.mockRejectedValue(prismaError("P2025", "not found"));
    const response = await logoutAction({ request: requestWithCookie() } as any);
    expect(response.headers.get("Location")).toBe("/auth/signed-out");
    expect(response.headers.get("Set-Cookie")).toMatch(/__naia_tok=;/);
    expect(response.headers.get("Set-Cookie")).toMatch(/Max-Age=0/);
    expect(getOidcConfigMock).not.toHaveBeenCalled();
  });

  it("no cookie at all — same safe outcome, no DB call made", async () => {
    const response = await logoutAction({ request: requestWithNoCookie() } as any);
    expect(response.headers.get("Location")).toBe("/auth/signed-out");
    expect(response.headers.get("Set-Cookie")).toMatch(/__naia_tok=;/);
    expect(deleteMock).not.toHaveBeenCalled();
    expect(getOidcConfigMock).not.toHaveBeenCalled();
  });

  it("normal session + hint + OIDC discovery succeeds — local session removed, provider logout used: redirects to Shopify's end_session_endpoint with id_token_hint and the approved post_logout_redirect_uri", async () => {
    deleteMock.mockResolvedValue({ shopifyIdTokenHint: "jwt-value-for-this-session" });
    getOidcConfigMock.mockResolvedValue({ end_session_endpoint: "https://shopify.com/authentication/99810082948/logout" });

    const response = await logoutAction({ request: requestWithCookie() } as any);
    const url = new URL(response.headers.get("Location") ?? "");

    expect(url.origin + url.pathname).toBe("https://shopify.com/authentication/99810082948/logout");
    expect(url.searchParams.get("id_token_hint")).toBe("jwt-value-for-this-session");
    expect(url.searchParams.get("post_logout_redirect_uri")).toBe("https://naia-stylist-staging.vercel.app/auth/logout");
    // local destruction still happened — provider logout is additive, not a substitute
    expect(response.headers.get("Set-Cookie")).toMatch(/__naia_tok=;/);
    expect(deleteMock).toHaveBeenCalledTimes(1);
  });

  it("hint present but OIDC discovery fails — never blocks logout, falls back to /auth/signed-out", async () => {
    deleteMock.mockResolvedValue({ shopifyIdTokenHint: "jwt-value" });
    getOidcConfigMock.mockRejectedValue(new Error("OIDC discovery failed: 502"));

    const response = await logoutAction({ request: requestWithCookie() } as any);
    expect(response.headers.get("Location")).toBe("/auth/signed-out");
    expect(response.headers.get("Set-Cookie")).toMatch(/__naia_tok=;/);
  });

  it("hint present but end_session_endpoint itself is missing from discovery — falls back to /auth/signed-out rather than building a broken redirect", async () => {
    deleteMock.mockResolvedValue({ shopifyIdTokenHint: "jwt-value" });
    getOidcConfigMock.mockResolvedValue({ end_session_endpoint: undefined });

    const response = await logoutAction({ request: requestWithCookie() } as any);
    expect(response.headers.get("Location")).toBe("/auth/signed-out");
  });

  it("DB-FAILURE REGRESSION — Prisma P1001 while destroying the session — no 500, cookie still cleared, lands on /auth/signed-out, provider logout never attempted (there is no hint to attempt it with)", async () => {
    deleteMock.mockRejectedValue(prismaError("P1001", "Can't reach database server at `db.prisma.io:5432`"));

    const response = await logoutAction({ request: requestWithCookie() } as any);

    expect(response.headers.get("Location")).toBe("/auth/signed-out");
    expect(response.headers.get("Set-Cookie")).toMatch(/__naia_tok=;/);
    expect(response.headers.get("Set-Cookie")).toMatch(/Max-Age=0/);
    expect(getOidcConfigMock).not.toHaveBeenCalled();
  });

  it("UNEXPECTED-THROW REGRESSION — even if destroySessionAndGetHint's own safety net somehow still let something throw, the action's final catch still returns the safe response, never a 500", async () => {
    // Simulates "Prisma not-found/connection-error handling inside
    // destroySessionAndGetHint itself somehow doesn't catch everything" —
    // the action must not depend solely on that inner safety net.
    vi.doMock("~/lib/naia-session.server", async (importOriginal) => {
      const actual = await importOriginal<typeof import("~/lib/naia-session.server")>();
      return { ...actual, destroySessionAndGetHint: vi.fn().mockRejectedValue(new Error("unexpected")) };
    });
    vi.resetModules();
    const { action: freshLogoutAction } = await import("./auth.logout");

    const response = await freshLogoutAction({ request: requestWithCookie() } as any);
    expect(response.headers.get("Location")).toBe("/auth/signed-out");
    expect(response.headers.get("Set-Cookie")).toMatch(/__naia_tok=;/);

    vi.doUnmock("~/lib/naia-session.server");
  });

  it("ACCOUNT-SWITCHING REGRESSION — local logout alone is insufficient; only a hint-present logout ever reaches Shopify's end_session_endpoint", async () => {
    // Documents the actual bug this feature closes: destroying the local
    // session and clearing __naia_tok (both happen in EVERY case below)
    // only ever ends nAia's own session. Without also reaching
    // end_session_endpoint, Shopify's own identity-provider session
    // survives, and the very next explicit Sign In silently
    // re-authenticates whichever account that browser-level session still
    // belongs to — never a genuine opportunity to switch accounts.
    deleteMock.mockResolvedValue({ shopifyIdTokenHint: null }); // older/hint-less session
    const noHintResponse = await logoutAction({ request: requestWithCookie("token-a") } as any);
    expect(noHintResponse.headers.get("Location")).toBe("/auth/signed-out");
    expect(new URL(noHintResponse.headers.get("Location") ?? "", "https://naia-stylist-staging.vercel.app").hostname)
      .toBe("naia-stylist-staging.vercel.app");

    deleteMock.mockResolvedValue({ shopifyIdTokenHint: "jwt-for-account-a" });
    getOidcConfigMock.mockResolvedValue({ end_session_endpoint: "https://shopify.com/authentication/99810082948/logout" });
    const hintResponse = await logoutAction({ request: requestWithCookie("token-b") } as any);
    const hintLocation = hintResponse.headers.get("Location") ?? "";
    expect(hintLocation.startsWith("https://shopify.com/")).toBe(true);
  });
});

describe("GET /auth/logout — terminal landing only, never loops back into provider logout", () => {
  it("always redirects to /auth/signed-out, with no session read and no OIDC lookup — Shopify's own post-logout redirect lands here safely", async () => {
    const response = await logoutLoader();
    expect(response.headers.get("Location")).toBe("/auth/signed-out");
    expect(deleteMock).not.toHaveBeenCalled();
    expect(getOidcConfigMock).not.toHaveBeenCalled();
  });
});
