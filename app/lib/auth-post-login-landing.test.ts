// app/lib/auth-post-login-landing.test.ts
//
// Manual QA on shared staging found two auth UX bugs:
//
//  1. Signing out sent the customer to the raw Shopify test-store domain.
//     auth.logout.tsx's action (the real POST /auth/logout the Sign Out
//     button submits) redirected to `https://${SHOPIFY_STORE_DOMAIN}`
//     whenever that env var was set — which it always is, since OIDC
//     discovery depends on it. The GET loader (direct navigation to
//     /auth/logout) already redirected to /auth/shopify/login; the action
//     just never matched it.
//
//  2. A fresh sign-in with no captured return_to landed on the legacy `/`
//     dashboard (routes/_index.tsx) instead of the current MY nAia app.
//     validateReturnTo() defaulted an absent/invalid return_to to "/", and
//     `/` has been superseded by /my-naia since 2026-09-23 — it's no longer
//     linked from any customer-facing nav.
//
// Fix: auth.logout's action always redirects to the same-host
// /auth/shopify/login entry point; validateReturnTo()'s default (and
// reject) fallback is now "/my-naia", the current MY nAia Overview. An
// explicit, valid return_to is still honored unchanged either way.
//
// Run: node --test --import tsx/esm app/lib/auth-post-login-landing.test.ts

import assert from "node:assert/strict";
import { describe, it, afterEach } from "node:test";
import { validateReturnTo } from "./shopify-customer-oauth.server.ts";
import { action as logoutAction, loader as logoutLoader } from "../routes/auth.logout.tsx";
import { loader as loginLoader } from "../routes/auth.shopify.login.tsx";
import { loader as rootLoader } from "../routes/_index.tsx";
import { requireCurrentNaiaCustomer } from "./naia-session.server.ts";

// ── validateReturnTo() — open-redirect guard + default landing route ──────

describe("validateReturnTo()", () => {
  it("defaults an absent return_to to MY nAia Overview, not the legacy '/' dashboard", () => {
    assert.equal(validateReturnTo(null), "/my-naia");
  });

  it("passes through a valid relative path unchanged", () => {
    assert.equal(validateReturnTo("/trends/my-edits/spring-2026"), "/trends/my-edits/spring-2026");
  });

  it("still honors an explicit return_to of '/' — only the no-value default changed", () => {
    assert.equal(validateReturnTo("/"), "/");
  });

  it("rejects a protocol-relative value (//evil.com) and falls back to MY nAia Overview", () => {
    assert.equal(validateReturnTo("//evil.com"), "/my-naia");
  });

  it("rejects an absolute external URL and falls back to MY nAia Overview", () => {
    assert.equal(validateReturnTo("https://evil.example.com/phish"), "/my-naia");
  });

  it("rejects an overlong value and falls back to MY nAia Overview", () => {
    assert.equal(validateReturnTo("/" + "a".repeat(250)), "/my-naia");
  });

  it("rejects a value with no leading slash and falls back to MY nAia Overview", () => {
    assert.equal(validateReturnTo("evil.com/path"), "/my-naia");
  });
});

// ── auth/logout — destination must stay on nAia's own host ────────────────

describe("auth.logout action (POST — the real Sign Out button)", () => {
  afterEach(() => {
    delete process.env.SHOPIFY_STORE_DOMAIN;
  });

  it("redirects to nAia's own login entry point, never the Shopify store domain", async () => {
    process.env.SHOPIFY_STORE_DOMAIN = "some-test-store.myshopify.com";
    const response = await logoutAction({
      request: new Request("https://naia-stylist-staging.vercel.app/auth/logout", { method: "POST" }),
    } as any);
    assert.ok(response instanceof Response);
    assert.equal(response.headers.get("Location"), "/auth/shopify/login");
    assert.ok(!(response.headers.get("Location") ?? "").includes("myshopify.com"));
  });

  it("clears the nAia session cookie on sign-out", async () => {
    const response = await logoutAction({
      request: new Request("https://naia-stylist-staging.vercel.app/auth/logout", { method: "POST" }),
    } as any);
    const setCookie = response.headers.get("Set-Cookie") ?? "";
    assert.match(setCookie, /__naia_tok=;/);
    assert.match(setCookie, /Max-Age=0/);
  });

  it("stays same-host even with no SHOPIFY_STORE_DOMAIN configured", async () => {
    const response = await logoutAction({
      request: new Request("https://naia-stylist-staging.vercel.app/auth/logout", { method: "POST" }),
    } as any);
    assert.equal(response.headers.get("Location"), "/auth/shopify/login");
  });
});

describe("auth.logout loader (GET — direct navigation to /auth/logout)", () => {
  it("redirects straight to the login entry point", async () => {
    const response = await logoutLoader();
    assert.equal(response.headers.get("Location"), "/auth/shopify/login");
  });
});

// ── auth/shopify/login — default post-login landing ────────────────────────
// Exercised through the STOREFRONT_HOST early-redirect branch, which runs
// before any network call (OIDC discovery) — matches the shared-staging
// topology the bug was found on, and mirrors the existing test-file
// convention in shopify-customer-oauth-origin-host.test.ts.
//
// These three requests arrive on a DIFFERENT host than STOREFRONT_HOST —
// e.g. a genuine preview host — so the bounce branch still fires and these
// stay fast, network-free tests of param forwarding through it. A request
// that already arrives ON STOREFRONT_HOST is covered separately below: the
// self-bounce guard means it must NOT take this branch at all.

describe("auth.shopify.login loader — default return_to", () => {
  const saved = { STOREFRONT_HOST: process.env.STOREFRONT_HOST };
  afterEach(() => {
    if (saved.STOREFRONT_HOST !== undefined) process.env.STOREFRONT_HOST = saved.STOREFRONT_HOST;
    else delete process.env.STOREFRONT_HOST;
  });

  const PREVIEW_HOST = "naia-stylist-staging-l1e919a8p-nadeenabuobeads-projects.vercel.app";

  it("a login request with no return_to carries the MY nAia Overview default through to the storefront", async () => {
    process.env.STOREFRONT_HOST = "naia-stylist-staging.vercel.app";
    const response = await loginLoader({
      request: new Request(`https://${PREVIEW_HOST}/auth/shopify/login`),
    } as any);
    assert.ok(response instanceof Response);
    const location = response.headers.get("Location") ?? "";
    const url = new URL(location);
    assert.equal(url.hostname, "naia-stylist-staging.vercel.app");
    assert.equal(url.searchParams.get("return_to"), "/my-naia");
  });

  it("a login request with an explicit protected return_to preserves it, not the default", async () => {
    process.env.STOREFRONT_HOST = "naia-stylist-staging.vercel.app";
    const response = await loginLoader({
      request: new Request(
        `https://${PREVIEW_HOST}/auth/shopify/login?return_to=%2Ftrends%2Fmy-edits%2Fspring-2026`,
      ),
    } as any);
    const location = response.headers.get("Location") ?? "";
    const url = new URL(location);
    assert.equal(url.searchParams.get("return_to"), "/trends/my-edits/spring-2026");
  });

  it("an explicit return_to of /my-naia is preserved unchanged, not treated as the no-value default", async () => {
    process.env.STOREFRONT_HOST = "naia-stylist-staging.vercel.app";
    const response = await loginLoader({
      request: new Request(`https://${PREVIEW_HOST}/auth/shopify/login?return_to=%2Fmy-naia`),
    } as any);
    const location = response.headers.get("Location") ?? "";
    assert.equal(new URL(location).searchParams.get("return_to"), "/my-naia");
  });

  it("a malicious external return_to is rejected before it ever reaches the storefront redirect", async () => {
    process.env.STOREFRONT_HOST = "naia-stylist-staging.vercel.app";
    const response = await loginLoader({
      request: new Request(
        `https://${PREVIEW_HOST}/auth/shopify/login?return_to=https%3A%2F%2Fevil.example.com`,
      ),
    } as any);
    const location = response.headers.get("Location") ?? "";
    const url = new URL(location);
    assert.equal(url.hostname, "naia-stylist-staging.vercel.app");
    assert.equal(url.searchParams.get("return_to"), "/my-naia");
  });
});

// ── auth/shopify/login — self-bounce guard (the live logout-regression fix) ─
// A request that has ALREADY arrived on STOREFRONT_HOST must fall straight
// through to the real same-host flow, never redirect to itself (or, with a
// stale STOREFRONT_HOST value, to some other host entirely). Proven here
// without a network call: with SHOPIFY_STORE_DOMAIN deliberately unset,
// falling through means the loader reaches getOidcConfig() and rejects with
// its own "env var is not set" error — a bounce, by contrast, would have
// returned a 302 Response and never reached that line at all. Rejecting
// with that specific error is the signal that no bounce happened.

describe("auth.shopify.login loader — self-bounce guard", () => {
  const saved = { STOREFRONT_HOST: process.env.STOREFRONT_HOST, SHOPIFY_STORE_DOMAIN: process.env.SHOPIFY_STORE_DOMAIN };
  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v !== undefined) process.env[k] = v; else delete process.env[k];
    }
  });

  it("does not self-bounce when the request hostname already equals STOREFRONT_HOST — falls through to the real flow instead of redirecting to itself", async () => {
    process.env.STOREFRONT_HOST = "naia-stylist-staging.vercel.app";
    delete process.env.SHOPIFY_STORE_DOMAIN;
    await assert.rejects(
      () => loginLoader({
        request: new Request("https://naia-stylist-staging.vercel.app/auth/shopify/login"),
      } as any),
      /SHOPIFY_STORE_DOMAIN/,
    );
  });

  it("normal login still works — a request on a genuinely different host still takes the one intended hop to STOREFRONT_HOST", async () => {
    process.env.STOREFRONT_HOST = "naia-stylist-staging.vercel.app";
    const response = await loginLoader({
      request: new Request("https://naia-stylist-staging-l1e919a8p-nadeenabuobeads-projects.vercel.app/auth/shopify/login"),
    } as any);
    assert.ok(response instanceof Response);
    assert.equal(new URL(response.headers.get("Location") ?? "").hostname, "naia-stylist-staging.vercel.app");
  });
});

// ── logout → login — the full live-regression chain, on the canonical host ─
// Reproduces the exact live failure end-to-end at the loader/action level:
// POST /auth/logout on the canonical host, follow its relative Location
// into a fresh GET /auth/shopify/login on that SAME host (simulating the
// browser's own redirect-follow), and confirm that second hop never leaves
// the canonical host — regardless of what STOREFRONT_HOST happens to be
// configured as (correct OR stale), closing the loop for good rather than
// only for today's corrected env value.

describe("logout -> login stays on the canonical host (regression)", () => {
  const CANONICAL = "naia-stylist-staging.vercel.app";
  const saved = { STOREFRONT_HOST: process.env.STOREFRONT_HOST, SHOPIFY_STORE_DOMAIN: process.env.SHOPIFY_STORE_DOMAIN };
  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v !== undefined) process.env[k] = v; else delete process.env[k];
    }
  });

  it("with the corrected STOREFRONT_HOST (pointing at the canonical host itself), logout's redirect never leaves it", async () => {
    process.env.STOREFRONT_HOST = CANONICAL;
    delete process.env.SHOPIFY_STORE_DOMAIN;

    const logoutResponse = await logoutAction({
      request: new Request(`https://${CANONICAL}/auth/logout`, { method: "POST" }),
    } as any);
    const logoutLocation = logoutResponse.headers.get("Location") ?? "";
    assert.equal(logoutLocation, "/auth/shopify/login", "logout's own redirect is same-host relative");

    // The browser follows that relative redirect on the SAME host it was
    // already on — simulate that next request directly.
    await assert.rejects(
      () => loginLoader({ request: new Request(`https://${CANONICAL}${logoutLocation}`) } as any),
      /SHOPIFY_STORE_DOMAIN/,
      "must fall through to the real flow on the canonical host, not bounce anywhere else",
    );
  });

  it("REGRESSION — even with a stale STOREFRONT_HOST still configured (the live failure), logout's own redirect lands back on the canonical host, never the stale one", async () => {
    process.env.STOREFRONT_HOST = "nadine-storefront.vercel.app"; // the stale value observed live
    delete process.env.SHOPIFY_STORE_DOMAIN;

    const logoutResponse = await logoutAction({
      request: new Request(`https://${CANONICAL}/auth/logout`, { method: "POST" }),
    } as any);
    const logoutLocation = logoutResponse.headers.get("Location") ?? "";
    assert.equal(logoutLocation, "/auth/shopify/login", "logout's own redirect is same-host relative regardless of STOREFRONT_HOST");

    // Pre-fix, this next hop would have bounced to the stale host. Post-fix,
    // the self-bounce guard only protects a request already on
    // STOREFRONT_HOST — a stale STOREFRONT_HOST still legitimately bounces a
    // DIFFERENT host's request away, which is why fixing the env value (not
    // just this code guard) remains required. This test pins down that the
    // guard alone is not a substitute for the env correction.
    const loginResponse = await loginLoader({ request: new Request(`https://${CANONICAL}${logoutLocation}`) } as any);
    assert.ok(loginResponse instanceof Response);
    assert.equal(new URL(loginResponse.headers.get("Location") ?? "").hostname, "nadine-storefront.vercel.app");
  });
});

// ── root route (/) — pre-Lovable temporary redirect ────────────────────────
// `/` used to render a legacy dashboard (routes/_index.tsx). Until the
// Lovable public site takes over this path, any request to `/` — whether
// from a stale bookmark, an old in-app link, or an explicit return_to=/ —
// must never render that dashboard, and the hop it takes must not loop back.

describe("root route (/) redirect", () => {
  it("GET / redirects to /my-naia", async () => {
    const response = await rootLoader({
      request: new Request("https://naia-stylist-staging.vercel.app/"),
    } as any);
    assert.ok(response instanceof Response);
    assert.equal(response.status, 302);
    assert.equal(response.headers.get("Location"), "/my-naia");
  });

  it("preserves a query string onto /my-naia rather than dropping it", async () => {
    const response = await rootLoader({
      request: new Request("https://naia-stylist-staging.vercel.app/?foo=bar"),
    } as any);
    assert.equal(response.headers.get("Location"), "/my-naia?foo=bar");
  });

  it("/my-naia's own auth gate never sends an unauthenticated visitor back to /", async () => {
    // my-naia._index.tsx's loader calls this same helper first, before any
    // profile/DB lookup; its redirect target is built from the pathname of
    // the request actually being served (/my-naia), never a hardcoded "/".
    // No __naia_tok cookie — resolves to no session without touching the DB.
    delete process.env.STOREFRONT_HOST; // force the plain relative-redirect branch
    await assert.rejects(
      () => requireCurrentNaiaCustomer(new Request("https://naia-stylist-staging.vercel.app/my-naia")),
      (thrown: unknown) => {
        assert.ok(thrown instanceof Response);
        const location = (thrown as Response).headers.get("Location") ?? "";
        assert.ok(location.startsWith("/auth/shopify/login"));
        assert.equal(new URL(location, "https://naia-stylist-staging.vercel.app").searchParams.get("return_to"), "/my-naia");
        assert.notEqual(location, "/");
        return true;
      },
    );
  });
});
