// app/lib/naia-session-handoff-single-use.test.ts
//
// Behavioral (vitest, ~/db.server mocked) coverage for promoteHandoffSession,
// the browser-binding nonce (buildHandoffNonceCookie/verifyHandoffNonce), and
// the parts of auth.shopify.handoff.tsx that depend on them. Split out of
// shopify-customer-oauth-origin-host.test.ts because this is the one path
// that actually touches the database — everything else in that file fails
// before ever reaching it, so it stays mock-free there.
//
// Two real findings from the 2026-10-20 security review, both fixed here:
//
// 1. The original handoff design had no replay protection beyond a 60-second
//    time window — within that window, the SAME handoff URL could be used by
//    multiple requests (the same browser twice, or a different browser that
//    captured the URL) to each independently obtain a full 30-day session.
//    Fixed with promoteHandoffSession's atomic, exact-match UPDATE.
//
// 2. Single-use alone stops a SECOND redemption, but says nothing about who
//    wins the race to be FIRST — a client with only the captured URL, no
//    nonce cookie at all (since it never leaves the originating host), could
//    still redeem an unused token before the legitimate browser got there.
//    Fixed with a browser-binding nonce, checked BEFORE the single-use
//    consumption step specifically so a failed attacker attempt never
//    consumes the token the real browser is about to present.
//
// Run: npx vitest run app/lib/naia-session-handoff-single-use.test.ts

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("~/db.server", () => ({
  default: {
    naiaSession: {
      updateMany: vi.fn(),
      create: vi.fn().mockResolvedValue({}),
      findUnique: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue({}),
    },
  },
}));

import { RouterContextProvider } from "react-router";
import prisma from "~/db.server";
import { promoteHandoffSession, createNaiaSession, buildHandoffNonceCookie, verifyHandoffNonce } from "./naia-session.server";
import { loader as handoffLoader } from "../routes/auth.shopify.handoff";
import { loader as loginLoader } from "../routes/auth.shopify.login";
import { getSession, commitSession } from "./session.server";

const mockUpdateMany = () => (prisma as any).naiaSession.updateMany as ReturnType<typeof vi.fn>;
const mockCreate = () => (prisma as any).naiaSession.create as ReturnType<typeof vi.fn>;
const mockFindUnique = () => (prisma as any).naiaSession.findUnique as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("promoteHandoffSession — the single-use guard itself", () => {
  it("promotes to the full 30-day expiry when the update matches exactly one row (first, legitimate use)", async () => {
    mockUpdateMany().mockResolvedValue({ count: 1 });
    const result = await promoteHandoffSession("raw-token-abc", 1000);
    expect(result).toBe(true);
    expect(mockUpdateMany()).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ expiresAt: new Date(1000) }),
      }),
    );
  });

  it("REPLAY — returns false when the update matches zero rows (already promoted by an earlier, successful call)", async () => {
    mockUpdateMany().mockResolvedValue({ count: 0 });
    const result = await promoteHandoffSession("raw-token-abc", 1000);
    expect(result).toBe(false);
  });

  it("is a single atomic statement, not read-then-write — the WHERE clause itself encodes the one-time check, so two concurrent calls cannot both see count:1", async () => {
    mockUpdateMany().mockResolvedValue({ count: 1 });
    await promoteHandoffSession("raw-token-abc", 1000);
    expect(mockUpdateMany()).toHaveBeenCalledTimes(1);
  });
});

describe("buildHandoffNonceCookie / verifyHandoffNonce — the browser-binding guard", () => {
  it("the cookie it builds verifies successfully against its own hash", () => {
    const { cookieHeader, nonceHash } = buildHandoffNonceCookie();
    const rawNonce = cookieHeader.match(/__naia_handoff_nonce=([^;]+)/)![1];
    const req = new Request("https://example.invalid/", { headers: { Cookie: `__naia_handoff_nonce=${rawNonce}` } });
    expect(verifyHandoffNonce(req, nonceHash)).toBe(true);
  });

  it("the cookie is HttpOnly, Secure, SameSite=Lax, and short-lived", () => {
    const { cookieHeader } = buildHandoffNonceCookie();
    expect(cookieHeader).toContain("HttpOnly");
    expect(cookieHeader).toContain("Secure");
    expect(cookieHeader).toContain("SameSite=Lax");
    expect(cookieHeader).toMatch(/Max-Age=120\b/);
  });

  it("fails when the cookie is simply absent", () => {
    const req = new Request("https://example.invalid/");
    expect(verifyHandoffNonce(req, "a".repeat(64))).toBe(false);
  });

  it("fails when the presented cookie doesn't hash to the expected value", () => {
    const req = new Request("https://example.invalid/", { headers: { Cookie: "__naia_handoff_nonce=wrong-value" } });
    expect(verifyHandoffNonce(req, "a".repeat(64))).toBe(false);
  });

  it("two independently generated nonces never collide", () => {
    const a = buildHandoffNonceCookie();
    const b = buildHandoffNonceCookie();
    expect(a.nonceHash).not.toBe(b.nonceHash);
  });
});

describe("createNaiaSession — backward compatibility for every existing caller", () => {
  it("every call site that omits the new 4th parameter still gets the normal, unchanged 30-day expiry", async () => {
    const req = new Request("https://naia-stylist-staging.vercel.app/", { headers: { "User-Agent": "test" } });
    const before = Date.now();
    await createNaiaSession("customer-1", req, "id-token-hint");
    const after = Date.now();

    const call = mockCreate().mock.calls[0][0];
    const expiresAtMs = call.data.expiresAt.getTime();
    const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
    expect(expiresAtMs).toBeGreaterThanOrEqual(before + THIRTY_DAYS_MS - 1000);
    expect(expiresAtMs).toBeLessThanOrEqual(after + THIRTY_DAYS_MS + 1000);
  });

  it("an explicit overrideExpiresAt is used exactly as given — the handoff-only path", async () => {
    const req = new Request("https://naia-stylist-staging.vercel.app/");
    const pending = new Date(Date.now() + 60_000);
    await createNaiaSession("customer-1", req, "id-token-hint", pending);
    const call = mockCreate().mock.calls[0][0];
    expect(call.data.expiresAt).toEqual(pending);
  });
});

describe("no sensitive data ever travels in the handoff URL", () => {
  it("the handoff payload carries only this app's own session token, origin host, nonce hash, and an expiry timestamp — never anything resembling a Shopify access/refresh token", async () => {
    const session = await getSession();
    session.set("handoff_raw_token", "synthetic-raw-token-abc123");
    session.set("handoff_origin_host", "naia-stylist-staging-i4b0504kk-nadeenabuobeads-projects.vercel.app");
    session.set("handoff_expires_at", Date.now() + 60_000);
    session.set("handoff_origin_nonce_hash", "a".repeat(64));
    const cookie = await commitSession(session);
    const eq = cookie.indexOf("=");
    const semi = cookie.indexOf(";");
    const h = cookie.slice(eq + 1, semi === -1 ? undefined : semi);

    // The signed value is opaque (base64 + HMAC signature) — confirm it
    // decodes to exactly these four keys and nothing else, so there is no
    // way for a Shopify token to have been smuggled in alongside them.
    // handoff_origin_nonce_hash is a one-way hash of the real nonce, not
    // the nonce itself — the raw value only ever exists in the cookie,
    // which never leaves the originating host.
    const [payloadB64] = h.split(".");
    const decoded = JSON.parse(Buffer.from(decodeURIComponent(payloadB64), "base64").toString("utf8"));
    expect(Object.keys(decoded).sort()).toEqual([
      "handoff_expires_at",
      "handoff_origin_host",
      "handoff_origin_nonce_hash",
      "handoff_raw_token",
    ]);
  });
});

describe("auth.shopify.handoff.tsx — the success path, replay, and browser-binding, end to end", () => {
  const ORIGIN_HOST = "naia-stylist-staging-i4b0504kk-nadeenabuobeads-projects.vercel.app";

  async function buildHandoffValue(overrides: Record<string, unknown> = {}) {
    const nonce = buildHandoffNonceCookie();
    const session = await getSession();
    session.set("handoff_raw_token", overrides.rawToken ?? "synthetic-raw-token-abc123");
    session.set("handoff_origin_host", overrides.originHost ?? ORIGIN_HOST);
    session.set("handoff_expires_at", overrides.expiresAt ?? Date.now() + 60_000);
    session.set("handoff_origin_nonce_hash", overrides.originNonceHash ?? nonce.nonceHash);
    const cookie = await commitSession(session);
    const eq = cookie.indexOf("=");
    const semi = cookie.indexOf(";");
    const h = cookie.slice(eq + 1, semi === -1 ? undefined : semi);
    const rawNonce = nonce.cookieHeader.match(/__naia_handoff_nonce=([^;]+)/)![1];
    return { h, rawNonce, nonceCookieHeader: `__naia_handoff_nonce=${rawNonce}` };
  }

  function requestTo(searchParams: Record<string, string>, cookieHeader?: string) {
    const url = new URL(`https://${ORIGIN_HOST}/auth/shopify/handoff`);
    for (const [k, v] of Object.entries(searchParams)) url.searchParams.set(k, v);
    const init: RequestInit = cookieHeader ? { headers: { Cookie: cookieHeader } } : {};
    return new Request(url.toString(), init);
  }

  it("a valid, unexpired, correctly-bound, not-yet-consumed handoff presented WITH the matching nonce cookie sets the real session cookie and redirects to return_to", async () => {
    mockUpdateMany().mockResolvedValue({ count: 1 }); // first use
    const { h, nonceCookieHeader } = await buildHandoffValue({ rawToken: "synthetic-raw-token-abc123" });
    const request = requestTo({ h, return_to: "/my-naia" }, nonceCookieHeader);
    const res: any = await handoffLoader({
      request,
      params: {},
      context: new RouterContextProvider(), pattern: "", url: new URL(request.url),
    });
    expect(res.headers.get("Location")).toBe("/my-naia");
    const setCookie = res.headers.getSetCookie?.() ?? [res.headers.get("Set-Cookie")];
    expect(setCookie.some((c: string) => c?.includes("__naia_tok=synthetic-raw-token-abc123"))).toBe(true);
    expect(setCookie.some((c: string) => c?.includes("HttpOnly"))).toBe(true);
    expect(setCookie.some((c: string) => c?.includes("Secure"))).toBe(true);
  });

  it("the response clears the nonce cookie and sets no-store caching headers on success", async () => {
    mockUpdateMany().mockResolvedValue({ count: 1 });
    const { h, nonceCookieHeader } = await buildHandoffValue({});
    const request = requestTo({ h, return_to: "/my-naia" }, nonceCookieHeader);
    const res: any = await handoffLoader({ request, params: {}, context: new RouterContextProvider(), pattern: "", url: new URL(request.url) });
    const setCookie = res.headers.getSetCookie?.() ?? [res.headers.get("Set-Cookie")];
    expect(setCookie.some((c: string) => c?.includes("__naia_handoff_nonce=;") || c?.includes("__naia_handoff_nonce=\"\";"))).toBe(true);
    expect(res.headers.get("Cache-Control")).toMatch(/no-store/);
  });

  // Found missing in a later security review pass (2026-10-20): the handoff
  // URL briefly carries a sensitive value (h) in its query string. Without
  // Referrer-Policy: no-referrer, if the destination page ever linked out
  // to a third party before redirecting, that party's own server logs
  // could capture the full referring URL, token included. Required on
  // every response this route returns, success or rejection — the token's
  // presence on the request is what needs covering, not the outcome.
  it("sets Referrer-Policy: no-referrer on a SUCCESSFUL handoff response", async () => {
    mockUpdateMany().mockResolvedValue({ count: 1 });
    const { h, nonceCookieHeader } = await buildHandoffValue({});
    const request = requestTo({ h, return_to: "/my-naia" }, nonceCookieHeader);
    const res: any = await handoffLoader({ request, params: {}, context: new RouterContextProvider(), pattern: "", url: new URL(request.url) });
    expect(res.headers.get("Referrer-Policy")).toBe("no-referrer");
  });

  it("sets Referrer-Policy: no-referrer on a REJECTED handoff response too (missing, tampered, expired, or unbound)", async () => {
    // Missing token entirely — the cheapest rejection path, and the one
    // most likely to have been hand-rolled without the shared header set.
    const request = requestTo({ return_to: "/my-naia" });
    const res: any = await handoffLoader({
      request,
      params: {},
      context: new RouterContextProvider(), pattern: "", url: new URL(request.url),
    });
    expect(res.headers.get("Location")).toBe("/auth/shopify/login");
    expect(res.headers.get("Referrer-Policy")).toBe("no-referrer");
  });

  it("THE FIX (single-use) — replaying the exact same handoff value a second time, even WITH the correct nonce cookie, fails closed", async () => {
    const { h, nonceCookieHeader } = await buildHandoffValue({ rawToken: "synthetic-raw-token-abc123" });

    mockUpdateMany().mockResolvedValueOnce({ count: 1 }); // first request — succeeds
    const firstRequest = requestTo({ h, return_to: "/my-naia" }, nonceCookieHeader);
    const first: any = await handoffLoader({ request: firstRequest, params: {}, context: new RouterContextProvider(), pattern: "", url: new URL(firstRequest.url) });
    expect(first.headers.get("Location")).toBe("/my-naia");

    mockUpdateMany().mockResolvedValueOnce({ count: 0 }); // replay — the real row is already promoted
    const secondRequest = requestTo({ h, return_to: "/my-naia" }, nonceCookieHeader);
    const second: any = await handoffLoader({ request: secondRequest, params: {}, context: new RouterContextProvider(), pattern: "", url: new URL(secondRequest.url) });
    expect(second.headers.get("Location")).toBe("/auth/shopify/login");
  });

  // THE SECOND FIX — this is the scenario the product owner specifically
  // asked to be verified: single-use stops replay AFTER consumption, but
  // does nothing about who redeems an UNUSED token FIRST.
  it("THE FIX (browser-binding) — an unused, otherwise-valid token presented WITHOUT the nonce cookie is rejected, and crucially the token is NOT consumed", async () => {
    const { h } = await buildHandoffValue({ rawToken: "synthetic-raw-token-abc123" });

    const attacker = requestTo({ h, return_to: "/my-naia" }); // no Cookie header at all
    const attackerRes: any = await handoffLoader({ request: attacker, params: {}, context: new RouterContextProvider(), pattern: "", url: new URL(attacker.url) });
    expect(attackerRes.headers.get("Location")).toBe("/auth/shopify/login");
    expect(attackerRes.headers.get("Set-Cookie")).toBeFalsy();
    // The decisive assertion: the database was never even asked to promote
    // the session. An attacker without the cookie cannot burn the token.
    expect(mockUpdateMany()).not.toHaveBeenCalled();
  });

  it("THE FIX (browser-binding), end to end — the legitimate browser still succeeds AFTER a failed attacker attempt on the same unused token", async () => {
    const { h, nonceCookieHeader } = await buildHandoffValue({ rawToken: "synthetic-raw-token-abc123" });

    // Attacker tries first, with the captured URL but no nonce cookie.
    const attackerRequest = requestTo({ h, return_to: "/my-naia" });
    const attackerRes: any = await handoffLoader({ request: attackerRequest, params: {}, context: new RouterContextProvider(), pattern: "", url: new URL(attackerRequest.url) });
    expect(attackerRes.headers.get("Location")).toBe("/auth/shopify/login");

    // The legitimate browser, which actually has the nonce cookie, redeems
    // the SAME still-unused token straight afterward and succeeds.
    mockUpdateMany().mockResolvedValueOnce({ count: 1 });
    const realRequest = requestTo({ h, return_to: "/my-naia" }, nonceCookieHeader);
    const realRes: any = await handoffLoader({
      request: realRequest,
      params: {},
      context: new RouterContextProvider(), pattern: "", url: new URL(realRequest.url),
    });
    expect(realRes.headers.get("Location")).toBe("/my-naia");
    expect(realRes.headers.get("Set-Cookie")).toBeTruthy();
  });

  it("a cookie that merely has the right NAME but the wrong raw value is rejected — the nonce value itself is checked, not just its presence", async () => {
    const { h } = await buildHandoffValue({ rawToken: "synthetic-raw-token-abc123" });
    const request = requestTo({ h, return_to: "/my-naia" }, "__naia_handoff_nonce=a-completely-different-guess");
    const res: any = await handoffLoader({
      request,
      params: {},
      context: new RouterContextProvider(), pattern: "", url: new URL(request.url),
    });
    expect(res.headers.get("Location")).toBe("/auth/shopify/login");
    expect(mockUpdateMany()).not.toHaveBeenCalled();
  });

  it("a handoff payload with no nonce hash at all (malformed/forged) is rejected before the database is ever consulted", async () => {
    const session = await getSession();
    session.set("handoff_raw_token", "synthetic-raw-token-abc123");
    session.set("handoff_origin_host", ORIGIN_HOST);
    session.set("handoff_expires_at", Date.now() + 60_000);
    // deliberately omit handoff_origin_nonce_hash
    const cookie = await commitSession(session);
    const eq = cookie.indexOf("=");
    const semi = cookie.indexOf(";");
    const h = cookie.slice(eq + 1, semi === -1 ? undefined : semi);

    const request = requestTo({ h, return_to: "/my-naia" });
    const res: any = await handoffLoader({ request, params: {}, context: new RouterContextProvider(), pattern: "", url: new URL(request.url) });
    expect(res.headers.get("Location")).toBe("/auth/shopify/login");
    expect(mockUpdateMany()).not.toHaveBeenCalled();
  });

  it("an invalid return_to falls back to the safe default rather than an open redirect, on a legitimate first use", async () => {
    mockUpdateMany().mockResolvedValue({ count: 1 });
    const { h, nonceCookieHeader } = await buildHandoffValue({});
    const request = requestTo({ h, return_to: "https://evil.example.com" }, nonceCookieHeader);
    const res: any = await handoffLoader({
      request,
      params: {},
      context: new RouterContextProvider(), pattern: "", url: new URL(request.url),
    });
    expect(res.headers.get("Location")).toBe("/my-naia");
  });
});

// ── auth.shopify.login.tsx — the "already has a session" cross-domain case
// (2026-11-02) ────────────────────────────────────────────────────────────
//
// Root cause: ERR_TOO_MANY_REDIRECTS on a Preview deployment. The 2026-10-20
// fix above covers a FRESH OAuth success landing back on an origin host —
// but a caller who ALREADY has a valid nAia session (set on the storefront
// host from earlier use) takes a completely different, earlier-return
// branch in auth.shopify.login.tsx that was never updated: it redirected
// straight to `https://${originHost}${returnTo}` with no cookie transfer at
// all. The browser lands on originHost with no session, bounces back here,
// finds the SAME existing session again, and repeats forever. Reproduced
// below using only a mocked DB layer — no real Shopify credentials, no
// customer data, and no network calls of any kind.
// SUPERSEDED (2026-11-04): auth.shopify.login.tsx's loader was replaced
// wholesale by a redirect to /sign-in (Clerk is now primary) — the
// "already has a session, cross-domain handoff" branch this block exercises
// no longer exists in that file. promoteHandoffSession/the nonce guard/
// auth.shopify.handoff.tsx itself (everything ABOVE this block) are
// untouched and still real — only this one branch, specific to login.tsx's
// removed loader body, is gone. Skipped, not deleted.
describe.skip("auth.shopify.login.tsx — the 'already has a session' cross-domain case (SUPERSEDED by the Clerk redirect)", () => {
  const STOREFRONT_HOST = "naia-stylist-staging.vercel.app";
  const ORIGIN_HOST = "naia-stylist-staging-r6gp0w3zs-nadeenabuobeads-projects.vercel.app";
  const savedStorefrontHost = process.env.STOREFRONT_HOST;

  beforeEach(() => {
    process.env.STOREFRONT_HOST = STOREFRONT_HOST;
    mockFindUnique().mockResolvedValue({
      tokenHash: "irrelevant-mock-does-not-check-this",
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      customer: { id: "existing-customer-1", shopifyCustomerId: "shop-existing-1", onboardingProfile: null },
    });
  });
  afterEach(() => {
    if (savedStorefrontHost !== undefined) process.env.STOREFRONT_HOST = savedStorefrontHost;
    else delete process.env.STOREFRONT_HOST;
  });

  function loginRequest(params: Record<string, string>) {
    const url = new URL(`https://${STOREFRONT_HOST}/auth/shopify/login`);
    for (const [k, v] of Object.entries({ return_to: "/my-naia", _sf: "1", ...params })) {
      url.searchParams.set(k, v);
    }
    return new Request(url.toString(), { headers: { Cookie: "__naia_tok=existing-raw-token-abc123" } });
  }

  it("an existing session with a captured origin host now routes through /auth/shopify/handoff instead of redirecting straight there", async () => {
    const nonce = buildHandoffNonceCookie();
    const request = loginRequest({ origin_host: ORIGIN_HOST, origin_nonce_hash: nonce.nonceHash });
    const res: any = await loginLoader({ request, params: {}, context: new RouterContextProvider(), pattern: "" } as never);
    const location = res.headers.get("Location");
    expect(location).toMatch(new RegExp(`^https://${ORIGIN_HOST}/auth/shopify/handoff\\?`));
    const locationUrl = new URL(location);
    expect(locationUrl.searchParams.get("return_to")).toBe("/my-naia");
    expect(locationUrl.searchParams.has("h")).toBe(true);
    // The fix reuses createNaiaSession, which does hit the database —
    // confirming the new path is actually live, not a no-op.
    expect(mockCreate()).toHaveBeenCalledTimes(1);
  });

  it("the handoff built from an existing session redeems successfully end to end, through the real auth.shopify.handoff.tsx loader", async () => {
    const nonce = buildHandoffNonceCookie();
    const loginRes: any = await loginLoader({
      request: loginRequest({ origin_host: ORIGIN_HOST, origin_nonce_hash: nonce.nonceHash }),
      params: {},
      context: new RouterContextProvider(), pattern: "",
    } as never);
    const handoffLocation = new URL(loginRes.headers.get("Location"));
    const h = handoffLocation.searchParams.get("h")!;
    const rawNonce = nonce.cookieHeader.match(/__naia_handoff_nonce=([^;]+)/)![1];

    mockUpdateMany().mockResolvedValue({ count: 1 });
    const handoffRes: any = await handoffLoader({
      request: new Request(handoffLocation.toString(), {
        headers: { Cookie: `__naia_handoff_nonce=${rawNonce}` },
      }),
      params: {},
      context: new RouterContextProvider(), pattern: "",
    } as never);
    expect(handoffRes.headers.get("Location")).toBe("/my-naia");
    const setCookie = handoffRes.headers.getSetCookie?.() ?? [handoffRes.headers.get("Set-Cookie")];
    expect(setCookie.some((c: string) => c?.includes("__naia_tok="))).toBe(true);
  });

  it("fails closed — refuses to build a handoff when the nonce hash never made it this far, before touching the database", async () => {
    const res: any = await loginLoader({
      request: loginRequest({ origin_host: ORIGIN_HOST }), // no origin_nonce_hash
      params: {},
      context: new RouterContextProvider(), pattern: "",
    } as never);
    expect(res.status).toBe(400);
    expect(mockCreate()).not.toHaveBeenCalled();
  });

  it("the no-origin-host path is completely unchanged — still a bare redirect to finalReturnTarget", async () => {
    const res: any = await loginLoader({
      request: loginRequest({}), // no origin_host at all
      params: {},
      context: new RouterContextProvider(), pattern: "",
    } as never);
    expect(res.headers.get("Location")).toBe("/my-naia");
    expect(mockCreate()).not.toHaveBeenCalled();
  });
});
