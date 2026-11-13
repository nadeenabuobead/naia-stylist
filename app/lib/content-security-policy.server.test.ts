// app/lib/content-security-policy.server.test.ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  hasFrameAncestorsDirective,
  appendFrameAncestorsNone,
  ensureFrameAncestorsDirective,
} from "./content-security-policy.server.ts";

describe("hasFrameAncestorsDirective", () => {
  it("false for null/undefined/empty", () => {
    assert.equal(hasFrameAncestorsDirective(null), false);
    assert.equal(hasFrameAncestorsDirective(undefined), false);
    assert.equal(hasFrameAncestorsDirective(""), false);
  });

  it("false when the header exists but names a different directive (THE GAP THIS MODULE CLOSES)", () => {
    assert.equal(hasFrameAncestorsDirective("script-src 'self';"), false);
    assert.equal(hasFrameAncestorsDirective("script-src 'self'; style-src 'self';"), false);
  });

  it("true for the plain directive", () => {
    assert.equal(hasFrameAncestorsDirective("frame-ancestors 'none';"), true);
  });

  it("true for Shopify's real dynamic value shape", () => {
    assert.equal(
      hasFrameAncestorsDirective(
        "frame-ancestors https://a-real-store.myshopify.com https://admin.shopify.com https://*.spin.dev https://admin.myshopify.io https://admin.shop.dev;",
      ),
      true,
    );
  });

  it("true when frame-ancestors appears alongside other directives, in any position", () => {
    assert.equal(hasFrameAncestorsDirective("script-src 'self'; frame-ancestors 'none';"), true);
    assert.equal(hasFrameAncestorsDirective("frame-ancestors 'none'; script-src 'self';"), true);
    assert.equal(hasFrameAncestorsDirective("style-src 'self'; frame-ancestors 'none'; img-src *;"), true);
  });

  it("true regardless of case", () => {
    assert.equal(hasFrameAncestorsDirective("Frame-Ancestors 'none';"), true);
    assert.equal(hasFrameAncestorsDirective("FRAME-ANCESTORS 'none';"), true);
    assert.equal(hasFrameAncestorsDirective("script-src 'self'; Frame-Ancestors https://x.com;"), true);
  });

  it("true regardless of whitespace variations", () => {
    assert.equal(hasFrameAncestorsDirective("  frame-ancestors   'none'  ;"), true);
    assert.equal(hasFrameAncestorsDirective("script-src 'self';   frame-ancestors 'none';"), true);
    assert.equal(hasFrameAncestorsDirective("script-src 'self';\n  frame-ancestors 'none';"), true);
  });

  it("does not false-positive on a directive that merely contains the substring elsewhere", () => {
    // No real CSP directive looks like this, but confirms the match is
    // anchored to the start of a directive, not a bare substring search.
    assert.equal(hasFrameAncestorsDirective("script-src 'self' https://frame-ancestors.evil.com;"), false);
  });
});

describe("appendFrameAncestorsNone", () => {
  it("appends to a value that already ends with a semicolon", () => {
    assert.equal(appendFrameAncestorsNone("script-src 'self';"), "script-src 'self'; frame-ancestors 'none';");
  });

  it("appends to a value with no trailing semicolon, adding one first", () => {
    assert.equal(appendFrameAncestorsNone("script-src 'self'"), "script-src 'self'; frame-ancestors 'none';");
  });

  it("preserves every other directive, multi-directive case", () => {
    const input = "default-src 'self'; script-src 'self' https://cdnjs.cloudflare.com; style-src 'self';";
    const result = appendFrameAncestorsNone(input);
    assert.ok(result.includes("default-src 'self';"));
    assert.ok(result.includes("script-src 'self' https://cdnjs.cloudflare.com;"));
    assert.ok(result.includes("style-src 'self';"));
    assert.ok(result.endsWith("frame-ancestors 'none';"));
  });

  it("handles an empty string input", () => {
    assert.equal(appendFrameAncestorsNone(""), "frame-ancestors 'none';");
  });
});

describe("ensureFrameAncestorsDirective — the single function entry.server.jsx calls", () => {
  it("no existing CSP at all -> sets frame-ancestors 'none' (the customer-facing default)", () => {
    assert.equal(ensureFrameAncestorsDirective(null), "frame-ancestors 'none';");
    assert.equal(ensureFrameAncestorsDirective(undefined), "frame-ancestors 'none';");
    assert.equal(ensureFrameAncestorsDirective(""), "frame-ancestors 'none';");
  });

  it("THE SCENARIO THIS FIX CLOSES: existing CSP has script-src but no frame-ancestors -> appends 'none', keeps script-src intact", () => {
    const result = ensureFrameAncestorsDirective("script-src 'self';");
    assert.ok(result.includes("script-src 'self';"), "script-src must be preserved, not dropped or overwritten");
    assert.ok(hasFrameAncestorsDirective(result), "frame-ancestors must now be present");
    assert.match(result, /frame-ancestors 'none';/);
  });

  it("Shopify's own dynamic, shop-scoped frame-ancestors value is preserved byte-for-byte, never overwritten", () => {
    const shopifyValue =
      "frame-ancestors https://a-real-store.myshopify.com https://admin.shopify.com https://*.spin.dev https://admin.myshopify.io https://admin.shop.dev;";
    assert.equal(ensureFrameAncestorsDirective(shopifyValue), shopifyValue);
  });

  it("a frame-ancestors directive with unusual but valid casing/whitespace is still recognized and left alone", () => {
    const value = "script-src 'self';   Frame-Ancestors   https://admin.shopify.com  ;";
    assert.equal(ensureFrameAncestorsDirective(value), value);
  });
});
