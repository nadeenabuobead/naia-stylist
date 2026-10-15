// app/routes/auth.logout.test.ts
//
// Provider-session logout — the account-switching fix. Local logout
// (deleteNaiaSession / __naia_tok) only ever ends this app's own session;
// Shopify's own identity-provider session at its authentication domain
// survives that untouched, so an explicit Sign In right after Sign Out used
// to silently re-authenticate the same account with no chance to switch.
// The fix: read the session's stored Shopify id_token hint before deleting
// it, then (best-effort, never blocking local logout) redirect to Shopify's
// discovered end_session_endpoint so Shopify's own session actually ends
// too.
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

const { findUniqueMock, deleteManyMock } = vi.hoisted(() => ({
  findUniqueMock: vi.fn(),
  deleteManyMock: vi.fn().mockResolvedValue({ count: 1 }),
}));

vi.mock("~/db.server", () => ({
  default: { naiaSession: { findUnique: findUniqueMock, deleteMany: deleteManyMock } },
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

beforeEach(() => {
  vi.clearAllMocks();
  deleteManyMock.mockResolvedValue({ count: 1 });
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

describe("destroySessionAndGetHint — reads the stored hint before deleting the row", () => {
  it("no cookie at all — returns null, never touches the DB", async () => {
    const result = await destroySessionAndGetHint(requestWithNoCookie());
    expect(result).toBeNull();
    expect(findUniqueMock).not.toHaveBeenCalled();
    expect(deleteManyMock).not.toHaveBeenCalled();
  });

  it("reads shopifyIdTokenHint via findUnique, THEN deletes — read must happen before the row is gone", async () => {
    findUniqueMock.mockResolvedValue({ shopifyIdTokenHint: "the-id-token-jwt" });
    const result = await destroySessionAndGetHint(requestWithCookie());
    expect(result).toBe("the-id-token-jwt");
    expect(findUniqueMock).toHaveBeenCalledTimes(1);
    expect(deleteManyMock).toHaveBeenCalledTimes(1);
    const findOrder = findUniqueMock.mock.invocationCallOrder[0];
    const deleteOrder = deleteManyMock.mock.invocationCallOrder[0];
    expect(findOrder).toBeLessThan(deleteOrder);
  });

  it("an older session with no stored hint (shopifyIdTokenHint: null) — returns null, still deletes the row", async () => {
    findUniqueMock.mockResolvedValue({ shopifyIdTokenHint: null });
    const result = await destroySessionAndGetHint(requestWithCookie());
    expect(result).toBeNull();
    expect(deleteManyMock).toHaveBeenCalledTimes(1);
  });

  it("no matching row at all — returns null without throwing", async () => {
    findUniqueMock.mockResolvedValue(null);
    const result = await destroySessionAndGetHint(requestWithCookie());
    expect(result).toBeNull();
  });
});

describe("auth.logout action — local logout always happens; provider logout is best-effort on top", () => {
  it("hint absent (no cookie) — clears __naia_tok and goes straight to /auth/signed-out, no OIDC lookup attempted", async () => {
    const response = await logoutAction({ request: requestWithNoCookie() } as any);
    expect(response.headers.get("Location")).toBe("/auth/signed-out");
    expect(response.headers.get("Set-Cookie")).toMatch(/__naia_tok=;/);
    expect(response.headers.get("Set-Cookie")).toMatch(/Max-Age=0/);
    expect(getOidcConfigMock).not.toHaveBeenCalled();
  });

  it("hint present + OIDC discovery succeeds — redirects to Shopify's discovered end_session_endpoint with id_token_hint and the approved post_logout_redirect_uri", async () => {
    findUniqueMock.mockResolvedValue({ shopifyIdTokenHint: "jwt-value-for-this-session" });
    getOidcConfigMock.mockResolvedValue({ end_session_endpoint: "https://shopify.com/authentication/99810082948/logout" });

    const response = await logoutAction({ request: requestWithCookie() } as any);
    const location = response.headers.get("Location") ?? "";
    const url = new URL(location);

    expect(url.origin + url.pathname).toBe("https://shopify.com/authentication/99810082948/logout");
    expect(url.searchParams.get("id_token_hint")).toBe("jwt-value-for-this-session");
    expect(url.searchParams.get("post_logout_redirect_uri")).toBe("https://naia-stylist-staging.vercel.app/auth/logout");
    // local destruction still happened — provider logout is additive, not a substitute
    expect(response.headers.get("Set-Cookie")).toMatch(/__naia_tok=;/);
    expect(deleteManyMock).toHaveBeenCalledTimes(1);
  });

  it("post_logout_redirect_uri is the already-approved staging logout URL — no Shopify app-config change required", async () => {
    findUniqueMock.mockResolvedValue({ shopifyIdTokenHint: "jwt" });
    getOidcConfigMock.mockResolvedValue({ end_session_endpoint: "https://shopify.com/authentication/99810082948/logout" });
    const response = await logoutAction({ request: requestWithCookie() } as any);
    const url = new URL(response.headers.get("Location") ?? "");
    // Exactly one of shopify.app.staging.toml's [customer_authentication].logout_urls entries.
    expect(url.searchParams.get("post_logout_redirect_uri")).toBe("https://naia-stylist-staging.vercel.app/auth/logout");
  });

  it("hint present but OIDC discovery fails — never blocks logout, falls back to /auth/signed-out", async () => {
    findUniqueMock.mockResolvedValue({ shopifyIdTokenHint: "jwt-value" });
    getOidcConfigMock.mockRejectedValue(new Error("OIDC discovery failed: 502"));

    const response = await logoutAction({ request: requestWithCookie() } as any);
    expect(response.headers.get("Location")).toBe("/auth/signed-out");
    expect(response.headers.get("Set-Cookie")).toMatch(/__naia_tok=;/);
  });

  it("hint present but end_session_endpoint itself is missing from discovery — falls back to /auth/signed-out rather than building a broken redirect", async () => {
    findUniqueMock.mockResolvedValue({ shopifyIdTokenHint: "jwt-value" });
    getOidcConfigMock.mockResolvedValue({ end_session_endpoint: undefined });

    const response = await logoutAction({ request: requestWithCookie() } as any);
    expect(response.headers.get("Location")).toBe("/auth/signed-out");
  });

  it("ACCOUNT-SWITCHING REGRESSION — local logout alone is insufficient; only a hint-present logout ever reaches Shopify's end_session_endpoint", async () => {
    // Documents the actual bug this feature closes: deleting NaiaSession and
    // clearing __naia_tok (both happen in EVERY case below) only ever ends
    // nAia's own session. Without also reaching end_session_endpoint,
    // Shopify's own identity-provider session survives, and the very next
    // explicit Sign In silently re-authenticates whichever account that
    // browser-level session still belongs to — never a genuine opportunity
    // to switch accounts. A later explicit Sign In being "treated as a
    // fresh Shopify authentication" depends entirely on this redirect
        // actually having been reached.
    findUniqueMock.mockResolvedValue({ shopifyIdTokenHint: null }); // older/hint-less session
    const noHintResponse = await logoutAction({ request: requestWithCookie("token-a") } as any);
    expect(noHintResponse.headers.get("Location")).toBe("/auth/signed-out");
    expect(new URL(noHintResponse.headers.get("Location") ?? "", "https://naia-stylist-staging.vercel.app").hostname)
      .toBe("naia-stylist-staging.vercel.app");

    findUniqueMock.mockResolvedValue({ shopifyIdTokenHint: "jwt-for-account-a" });
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
    expect(findUniqueMock).not.toHaveBeenCalled();
    expect(getOidcConfigMock).not.toHaveBeenCalled();
  });
});
