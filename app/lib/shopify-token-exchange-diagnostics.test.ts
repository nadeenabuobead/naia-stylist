// app/lib/shopify-token-exchange-diagnostics.test.ts
//
// Diagnostic-only logging for a failed Shopify token-exchange, added after
// a live account-switch Sign In reached the callback but failed there with
// a bare "Token exchange failed." — the actual Shopify error/
// error_description was read off the token endpoint's response and then
// discarded by the old code, both inside exchangeCodeForTokens (the body
// was read into a variable never used in the thrown message) and in
// auth.shopify.callback.tsx's catch block (no logging at all). Neither the
// customer-facing message nor any OAuth behavior changes here — this is
// purely about making the next occurrence diagnosable from server logs.
//
// buildTokenExchangeFailureMessage is pure and network-free — tested
// directly. The callback's catch-block wiring needs a real (test-secret)
// signed session cookie — session.server.ts's createCookieSessionStorage
// needs no DB/network, so no mocking is required for that part. Only
// getOidcConfig and exchangeCodeForTokens (both real network calls) are
// mocked, same convention as every other DB/network-touching unit test in
// this codebase with no live-integration harness.
//
// Run: npx vitest run app/lib/shopify-token-exchange-diagnostics.test.ts

import { describe, it, expect, vi, beforeEach } from "vitest";

describe("buildTokenExchangeFailureMessage() — pure, network-free", () => {
  it("extracts error and error_description from a standard OAuth error JSON body", async () => {
    const { buildTokenExchangeFailureMessage } = await import("./shopify-customer-oauth.server");
    const body = JSON.stringify({ error: "invalid_grant", error_description: "The authorization code is invalid or has expired." });
    const message = buildTokenExchangeFailureMessage(400, body);
    expect(message).toContain("status=400");
    expect(message).toContain("error=invalid_grant");
    expect(message).toContain("error_description=The authorization code is invalid or has expired.");
  });

  it("falls back to safe defaults when error_description is absent", async () => {
    const { buildTokenExchangeFailureMessage } = await import("./shopify-customer-oauth.server");
    const message = buildTokenExchangeFailureMessage(400, JSON.stringify({ error: "invalid_request" }));
    expect(message).toContain("error=invalid_request");
    expect(message).toContain("error_description=<unavailable>");
  });

  it("truncates an overlong error_description rather than including it in full", async () => {
    const { buildTokenExchangeFailureMessage } = await import("./shopify-customer-oauth.server");
    const longDescription = "x".repeat(500);
    const message = buildTokenExchangeFailureMessage(400, JSON.stringify({ error: "invalid_grant", error_description: longDescription }));
    expect(message.length).toBeLessThan(500);
    expect(message).not.toContain("x".repeat(500));
  });

  it("truncates an overlong error code the same way", async () => {
    const { buildTokenExchangeFailureMessage } = await import("./shopify-customer-oauth.server");
    const longError = "y".repeat(500);
    const message = buildTokenExchangeFailureMessage(400, JSON.stringify({ error: longError }));
    expect(message).not.toContain("y".repeat(500));
  });

  it("a non-JSON body produces only a short truncated snippet, never the full body", async () => {
    const { buildTokenExchangeFailureMessage } = await import("./shopify-customer-oauth.server");
    const htmlErrorPage = "<html><body>" + "z".repeat(1000) + "</body></html>";
    const message = buildTokenExchangeFailureMessage(502, htmlErrorPage);
    expect(message.length).toBeLessThan(300);
    expect(message).not.toContain(htmlErrorPage);
  });

  it("a null/unreadable body never throws — safe defaults only", async () => {
    const { buildTokenExchangeFailureMessage } = await import("./shopify-customer-oauth.server");
    expect(() => buildTokenExchangeFailureMessage(500, null)).not.toThrow();
    const message = buildTokenExchangeFailureMessage(500, null);
    expect(message).toContain("status=500");
    expect(message).toContain("error=<none>");
  });

  it("SAFETY REGRESSION — fields other than error/error_description are never pulled in, even if the response body contains token-shaped keys", async () => {
    const { buildTokenExchangeFailureMessage } = await import("./shopify-customer-oauth.server");
    const bodyWithExtraFields = JSON.stringify({
      error: "invalid_grant",
      access_token: "should-never-appear-anywhere",
      refresh_token: "should-never-appear-anywhere",
      id_token: "should-never-appear-anywhere",
      client_secret: "should-never-appear-anywhere",
    });
    const message = buildTokenExchangeFailureMessage(400, bodyWithExtraFields);
    expect(message).not.toContain("should-never-appear-anywhere");
  });
});

// ── auth.shopify.callback.tsx — catch-block wiring ─────────────────────────

const { getOidcConfigMock, exchangeCodeForTokensMock } = vi.hoisted(() => ({
  getOidcConfigMock: vi.fn(),
  exchangeCodeForTokensMock: vi.fn(),
}));

vi.mock("~/lib/shopify-customer-oauth.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/lib/shopify-customer-oauth.server")>();
  return {
    ...actual, // keep the real validateReturnTo/validateOriginHost/buildTokenExchangeFailureMessage
    getOidcConfig: getOidcConfigMock,
    exchangeCodeForTokens: exchangeCodeForTokensMock,
  };
});

let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

const SECRET_VERIFIER = "SECRET-code-verifier-never-should-leak";
const SECRET_NONCE = "SECRET-nonce-never-should-leak";
const SECRET_STATE = "SECRET-state-never-should-leak";
const SECRET_CODE = "SECRET-authorization-code-never-should-leak";

async function buildCallbackRequestWithRealPkceSession(overrides: { code?: string; state?: string } = {}) {
  const { getSession, commitSession } = await import("./session.server");
  const session = await getSession(null);
  session.set("pkce_state", SECRET_STATE);
  session.set("pkce_verifier", SECRET_VERIFIER);
  session.set("pkce_nonce", SECRET_NONCE);
  session.set("return_to", "/my-naia");
  const setCookieHeader = await commitSession(session);
  const cookieValue = setCookieHeader.split(";")[0]; // "__naia_session=<signed-value>"

  const code = overrides.code ?? SECRET_CODE;
  const state = overrides.state ?? SECRET_STATE;
  return new Request(
    `https://naia-stylist-staging.vercel.app/auth/shopify/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`,
    { headers: { Cookie: cookieValue } },
  );
}

describe("auth.shopify.callback.tsx — token-exchange failure logging", () => {
  it("logs a sanitized diagnostic server-side, but returns only the generic 'Token exchange failed' message to the browser", async () => {
    const { loader } = await import("../routes/auth.shopify.callback");
    getOidcConfigMock.mockResolvedValue({
      issuer: "https://shopify.com/authentication/99810082948",
      authorization_endpoint: "https://shopify.com/authentication/99810082948/oauth/authorize",
      token_endpoint: "https://shopify.com/authentication/99810082948/oauth/token",
      end_session_endpoint: "https://shopify.com/authentication/99810082948/logout",
      jwks_uri: "https://shopify.com/authentication/99810082948/.well-known/jwks.json",
    });
    exchangeCodeForTokensMock.mockRejectedValue(
      new Error("Shopify token exchange failed: status=400 error=invalid_grant error_description=The authorization code is invalid or has expired."),
    );

    const response = await loader({ request: await buildCallbackRequestWithRealPkceSession() } as any);

    expect(response.status).toBe(502);
    const bodyText = await response.text();
    expect(bodyText).toBe("Token exchange failed");
    // The customer-facing page must not expose Shopify's diagnostics.
    expect(bodyText).not.toContain("invalid_grant");
    expect(bodyText).not.toContain("status=400");

    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    const [tag, payload] = consoleErrorSpy.mock.calls[0];
    expect(tag).toBe("shopify_token_exchange_failed");
    const logged = JSON.parse(payload as string);
    expect(logged.message).toContain("invalid_grant");
    expect(logged.callbackHostname).toBe("naia-stylist-staging.vercel.app");
    expect(logged.redirectUri).toContain("/auth/shopify/callback");
    expect(logged.codePresent).toBe(true);
    expect(logged.codeVerifierPresent).toBe(true);
    expect(logged.storedStatePresent).toBe(true);
    expect(logged.storedNoncePresent).toBe(true);
  });

  it("SECRETS-NEVER-LOGGED REGRESSION — the logged diagnostic never contains the actual code, verifier, nonce, or state values, only presence booleans", async () => {
    const { loader } = await import("../routes/auth.shopify.callback");
    getOidcConfigMock.mockResolvedValue({
      issuer: "x", authorization_endpoint: "x", token_endpoint: "x", end_session_endpoint: "x", jwks_uri: "x",
    });
    exchangeCodeForTokensMock.mockRejectedValue(new Error("Shopify token exchange failed: status=400 error=invalid_grant error_description=expired"));

    await loader({ request: await buildCallbackRequestWithRealPkceSession() } as any);

    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    const loggedPayload = consoleErrorSpy.mock.calls[0][1] as string;
    for (const secret of [SECRET_VERIFIER, SECRET_NONCE, SECRET_STATE, SECRET_CODE]) {
      expect(loggedPayload).not.toContain(secret);
    }
  });

  it("a successful token exchange is completely unaffected — no error logged, exchangeCodeForTokens called with the real values", async () => {
    vi.resetModules();
    const { getOidcConfig: realGetOidcConfig } = await vi.importActual<typeof import("./shopify-customer-oauth.server")>("./shopify-customer-oauth.server");
    getOidcConfigMock.mockResolvedValue({
      issuer: "x", authorization_endpoint: "x", token_endpoint: "x", end_session_endpoint: "x", jwks_uri: "x",
    });
    exchangeCodeForTokensMock.mockResolvedValue({
      id_token: "fake-but-irrelevant-to-this-test", access_token: "fake", token_type: "Bearer", expires_in: 3600,
    });

    const { loader } = await import("../routes/auth.shopify.callback");
    // This will fail LATER (validateIdToken on a fake id_token), but the
    // point of this test is only that the exchange step itself succeeds
    // without logging anything — confirming the happy path is untouched.
    await loader({ request: await buildCallbackRequestWithRealPkceSession() } as any).catch(() => {});

    expect(exchangeCodeForTokensMock).toHaveBeenCalledTimes(1);
    const [codeArg, verifierArg] = exchangeCodeForTokensMock.mock.calls[0];
    expect(codeArg).toBe(SECRET_CODE);
    expect(verifierArg).toBe(SECRET_VERIFIER);
    expect(consoleErrorSpy).not.toHaveBeenCalledWith("shopify_token_exchange_failed", expect.anything());
  });
});
