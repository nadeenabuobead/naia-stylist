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

describe("auth.shopify.login loader — default return_to", () => {
  const saved = { STOREFRONT_HOST: process.env.STOREFRONT_HOST };
  afterEach(() => {
    if (saved.STOREFRONT_HOST !== undefined) process.env.STOREFRONT_HOST = saved.STOREFRONT_HOST;
    else delete process.env.STOREFRONT_HOST;
  });

  it("a login request with no return_to carries the MY nAia Overview default through to the storefront", async () => {
    process.env.STOREFRONT_HOST = "naia-stylist-staging.vercel.app";
    const response = await loginLoader({
      request: new Request("https://naia-stylist-staging.vercel.app/auth/shopify/login"),
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
        "https://naia-stylist-staging.vercel.app/auth/shopify/login?return_to=%2Ftrends%2Fmy-edits%2Fspring-2026",
      ),
    } as any);
    const location = response.headers.get("Location") ?? "";
    const url = new URL(location);
    assert.equal(url.searchParams.get("return_to"), "/trends/my-edits/spring-2026");
  });

  it("a malicious external return_to is rejected before it ever reaches the storefront redirect", async () => {
    process.env.STOREFRONT_HOST = "naia-stylist-staging.vercel.app";
    const response = await loginLoader({
      request: new Request(
        "https://naia-stylist-staging.vercel.app/auth/shopify/login?return_to=https%3A%2F%2Fevil.example.com",
      ),
    } as any);
    const location = response.headers.get("Location") ?? "";
    const url = new URL(location);
    assert.equal(url.hostname, "naia-stylist-staging.vercel.app");
    assert.equal(url.searchParams.get("return_to"), "/my-naia");
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
