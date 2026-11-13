// app/lib/frame-ancestors-header.test.ts
//
// Regression guard for the frame-ancestors fix in app/entry.server.jsx.
//
// Background: frame-ancestors is spec-defined to be ignored when
// delivered via a <meta> tag (the framing decision is already made by
// the time the HTML is parsed) -- the <meta httpEquiv="Content-Security-
// Policy" content="frame-ancestors ..."> that used to live in
// app/root.jsx's <head> never actually enforced anything in any
// spec-compliant browser. entry.server.jsx now sends the real value as
// an HTTP response header via ensureFrameAncestorsDirective
// (app/lib/content-security-policy.server.ts, unit-tested on its own in
// content-security-policy.server.test.ts) -- directive-aware, not just
// header-presence-aware, so an existing CSP that sets some other
// directive (e.g. script-src) still gets frame-ancestors appended rather
// than being left with none. Shopify's own addDocumentResponseHeaders()
// (called first, from app/shopify.server.js) already sets a real,
// dynamic, shop-scoped frame-ancestors value for embedded-admin routes --
// this module must never overwrite that.
//
// This file cannot drive a full SSR render of entry.server.jsx (that
// needs a real React Router match context), so it tests the real,
// imported ensureFrameAncestorsDirective against Shopify's real,
// unmocked addDocumentResponseHeaders in every scenario that matters.
// Live, end-to-end confirmation that the real header appears on real
// HTTP responses -- including a 200 from the real Clerk sign-in page,
// with both headers present and non-conflicting -- was done separately
// against a running dev server (see the PR description) and is not
// repeated here.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { ensureFrameAncestorsDirective } from "./content-security-policy.server.ts";

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

function applyFix(headers: Headers): void {
  headers.set("Content-Security-Policy", ensureFrameAncestorsDirective(headers.get("Content-Security-Policy")));
}

describe("frame-ancestors: real HTTP header, directive-aware, not the ineffective <meta> tag", () => {
  it("app/root.jsx no longer contains a frame-ancestors <meta> tag", () => {
    const rootSrc = readFileSync(resolve(REPO_ROOT, "app/root.jsx"), "utf8");
    assert.ok(
      !/httpEquiv="Content-Security-Policy"/.test(rootSrc),
      "a meta-tag CSP would be misleading to reintroduce -- frame-ancestors is ignored when delivered this way",
    );
  });

  it("app/entry.server.jsx calls the real, directive-aware fix, not a header-presence check", () => {
    const entrySrc = readFileSync(resolve(REPO_ROOT, "app/entry.server.jsx"), "utf8");
    assert.match(entrySrc, /ensureFrameAncestorsDirective/);
    assert.ok(
      !/responseHeaders\.has\("Content-Security-Policy"\)/.test(entrySrc),
      "must not have regressed back to the header-presence-only check",
    );
  });

  it("GAP THIS FIX CLOSES: Shopify's real, unmocked addDocumentResponseHeaders sets no CSP header at all for a request without a shop param", () => {
    const headers = new Headers();
    addDocumentResponseHeaders(new Request("https://naia-stylist.vercel.app/trends/spring-2026"), headers);
    assert.equal(headers.get("Content-Security-Policy"), null);
  });

  it("customer-facing routes get the strictest value: frame-ancestors 'none' -- no third-party site may embed them", () => {
    const headers = new Headers();
    addDocumentResponseHeaders(new Request("https://naia-stylist.vercel.app/trends/spring-2026"), headers);
    applyFix(headers);
    assert.equal(headers.get("Content-Security-Policy"), "frame-ancestors 'none';");
  });

  it("CASE THIS FIX MUST NOT BREAK: Shopify's real addDocumentResponseHeaders DOES set its own dynamic, shop-scoped CSP for an embedded-admin-shaped request -- legitimate embedded-admin framing keeps working", () => {
    const headers = new Headers();
    addDocumentResponseHeaders(
      new Request("https://naia-stylist.vercel.app/app/naia-admin?embedded=1&shop=a-real-store.myshopify.com"),
      headers,
    );
    const value = headers.get("Content-Security-Policy");
    assert.ok(value, "Shopify's own helper must have set something");
    assert.match(value!, /a-real-store\.myshopify\.com/);
  });

  it("the fix never overwrites Shopify's own dynamic value when it already fired", () => {
    const headers = new Headers();
    addDocumentResponseHeaders(
      new Request("https://naia-stylist.vercel.app/app/naia-admin?embedded=1&shop=a-real-store.myshopify.com"),
      headers,
    );
    const shopifyValue = headers.get("Content-Security-Policy");
    applyFix(headers);
    assert.equal(headers.get("Content-Security-Policy"), shopifyValue, "must be byte-identical -- unchanged by the fix");
    assert.notEqual(headers.get("Content-Security-Policy"), "frame-ancestors 'none';", "must not have been replaced with the customer-facing default");
  });

  it("DIRECTIVE-AWARE SCENARIO: an existing CSP with script-src but no frame-ancestors gets frame-ancestors appended, without losing script-src", () => {
    const headers = new Headers();
    headers.set("Content-Security-Policy", "script-src 'self' https://cdnjs.cloudflare.com;");
    applyFix(headers);
    const value = headers.get("Content-Security-Policy")!;
    assert.ok(value.includes("script-src 'self' https://cdnjs.cloudflare.com;"), "script-src must survive untouched");
    assert.match(value, /frame-ancestors 'none';/, "frame-ancestors must now be present");
  });
});
