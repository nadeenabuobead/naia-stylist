// app/lib/frame-ancestors-header.test.ts
//
// Regression guard for the frame-ancestors fix in app/entry.server.jsx.
//
// Background: frame-ancestors is spec-defined to be ignored when
// delivered via a <meta> tag (the framing decision is already made by
// the time the HTML is parsed) -- the <meta httpEquiv="Content-Security-
// Policy" content="frame-ancestors ..."> that used to live in
// app/root.jsx's <head> never actually enforced anything in any
// spec-compliant browser. entry.server.jsx now sends the same value as
// a real HTTP response header instead, but only as a FALLBACK: Shopify's
// own addDocumentResponseHeaders() (called first, from app/shopify.server.js)
// already sets a real, dynamic, shop-scoped Content-Security-Policy
// header for embedded-admin routes (confirmed by reading
// @shopify/shopify-app-react-router's own add-response-headers.js) --
// this fallback must never run when that already fired, since it would
// overwrite a more specific, correct value with a generic one.
//
// This file cannot drive a full SSR render of entry.server.jsx (that
// needs a real React Router match context), so it tests the two things
// that actually matter behaviorally: (1) Shopify's real, unmocked
// addDocumentResponseHeaders does NOT set the header for a request with
// no `shop` param (the gap this fix closes) and DOES set its own header
// when `shop` IS present (the case this fix must not override), and
// (2) the exact fallback logic, replicated from entry.server.jsx,
// composes correctly with both of those real outcomes. Live, end-to-end
// confirmation that the real header appears on real HTTP responses --
// including a 200 from the real Clerk sign-in page, with both headers
// present and non-conflicting -- was done separately against a running
// dev server (see the PR description) and is not repeated here.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "../..");

process.env.SHOPIFY_API_KEY ??= "test_key";
process.env.SHOPIFY_API_SECRET ??= "test_secret";
process.env.SHOPIFY_APP_URL ??= "https://example.com";
process.env.SCOPES ??= "read_products";
process.env.SESSION_SECRET ??= "x".repeat(32);
process.env.NAIA_CUSTOMER_SECRET ??= "x".repeat(32);
process.env.NAIA_DATABASE_URL ??= "postgres://u:p@localhost:5432/db";
process.env.DATABASE_URL ??= "postgres://u:p@localhost:5432/db";

const { addDocumentResponseHeaders } = await import("../shopify.server.js");

// Exact replica of the fallback added in app/entry.server.jsx -- kept
// here as a literal function (not imported, entry.server.jsx has no
// exports besides the default SSR handler) so this test exercises the
// real logic shape, not a paraphrase of it.
const FALLBACK_CSP = "frame-ancestors https://admin.shopify.com https://*.myshopify.com;";
function applyFallback(headers: Headers): void {
  if (!headers.has("Content-Security-Policy")) {
    headers.set("Content-Security-Policy", FALLBACK_CSP);
  }
}

describe("frame-ancestors: real HTTP header, not the ineffective <meta> tag", () => {
  it("app/root.jsx no longer contains a frame-ancestors <meta> tag", () => {
    const rootSrc = readFileSync(resolve(REPO_ROOT, "app/root.jsx"), "utf8");
    assert.ok(
      !/httpEquiv="Content-Security-Policy"/.test(rootSrc),
      "a meta-tag CSP would be misleading to reintroduce -- frame-ancestors is ignored when delivered this way",
    );
  });

  it("app/entry.server.jsx contains the real-header fallback, guarding against silent reversion", () => {
    const entrySrc = readFileSync(resolve(REPO_ROOT, "app/entry.server.jsx"), "utf8");
    assert.match(entrySrc, /responseHeaders\.has\("Content-Security-Policy"\)/);
    assert.match(entrySrc, /frame-ancestors https:\/\/admin\.shopify\.com https:\/\/\*\.myshopify\.com;/);
  });

  it("GAP THIS FIX CLOSES: Shopify's real, unmocked addDocumentResponseHeaders sets no CSP header at all for a request without a shop param", () => {
    const headers = new Headers();
    addDocumentResponseHeaders(new Request("https://naia-stylist.vercel.app/trends/spring-2026"), headers);
    assert.equal(headers.get("Content-Security-Policy"), null);
  });

  it("the fallback correctly fills that real gap", () => {
    const headers = new Headers();
    addDocumentResponseHeaders(new Request("https://naia-stylist.vercel.app/trends/spring-2026"), headers);
    applyFallback(headers);
    assert.equal(headers.get("Content-Security-Policy"), FALLBACK_CSP);
  });

  it("CASE THIS FIX MUST NOT BREAK: Shopify's real addDocumentResponseHeaders DOES set its own dynamic, shop-scoped CSP for an embedded-admin-shaped request", () => {
    const headers = new Headers();
    addDocumentResponseHeaders(
      new Request("https://naia-stylist.vercel.app/app/naia-admin?embedded=1&shop=a-real-store.myshopify.com"),
      headers,
    );
    const value = headers.get("Content-Security-Policy");
    assert.ok(value, "Shopify's own helper must have set something");
    assert.match(value!, /a-real-store\.myshopify\.com/);
  });

  it("the fallback never overwrites Shopify's own dynamic value when it already fired", () => {
    const headers = new Headers();
    addDocumentResponseHeaders(
      new Request("https://naia-stylist.vercel.app/app/naia-admin?embedded=1&shop=a-real-store.myshopify.com"),
      headers,
    );
    const shopifyValue = headers.get("Content-Security-Policy");
    applyFallback(headers);
    assert.equal(headers.get("Content-Security-Policy"), shopifyValue, "must be byte-identical -- unchanged by the fallback");
    assert.notEqual(headers.get("Content-Security-Policy"), FALLBACK_CSP, "must not have been replaced with the generic fallback value");
  });
});
