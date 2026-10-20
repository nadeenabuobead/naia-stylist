// app/lib/webhook-shop-guard.server.test.ts
//
// Unit coverage for the shop-ownership guard protecting customers/redact
// and shop/redact from cross-shop deletion (2026-10-20). No mocks, no
// database — pure function against fixed inputs and env var state.
//
// Run: node --test --import tsx/esm app/lib/webhook-shop-guard.server.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";
import { verifyShopOwnership } from "./webhook-shop-guard.server";

const EXPECTED = "naia-test-store.myshopify.com";
const OTHER_SHOP = "a-completely-different-shop.myshopify.com";

test("accepts a request whose header shop matches the configured expected shop", () => {
  process.env.SHOPIFY_STORE_DOMAIN = EXPECTED;
  const result = verifyShopOwnership(EXPECTED, { shop_domain: EXPECTED });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.shop, EXPECTED);
});

test("accepts a request whose payload carries no shop_domain at all (e.g. shop/redact's own body shape is minimal)", () => {
  process.env.SHOPIFY_STORE_DOMAIN = EXPECTED;
  const result = verifyShopOwnership(EXPECTED, {});
  assert.equal(result.ok, true);
});

test("rejects — Shop A's authenticated header cannot pass as Shop B: header mismatch", () => {
  process.env.SHOPIFY_STORE_DOMAIN = EXPECTED;
  const result = verifyShopOwnership(OTHER_SHOP, { shop_domain: OTHER_SHOP });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "shop_mismatch");
});

test("rejects when the header matches but the payload's own shop_domain disagrees — treated as suspicious, not trusted", () => {
  process.env.SHOPIFY_STORE_DOMAIN = EXPECTED;
  const result = verifyShopOwnership(EXPECTED, { shop_domain: OTHER_SHOP });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "shop_mismatch");
});

test("rejects a missing shop header outright — never treated as 'assume it's fine'", () => {
  process.env.SHOPIFY_STORE_DOMAIN = EXPECTED;
  const result = verifyShopOwnership(null, { shop_domain: EXPECTED });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "missing_shop_header");
});

test("fails closed when SHOPIFY_STORE_DOMAIN itself is unset — cannot establish ownership without it", () => {
  delete process.env.SHOPIFY_STORE_DOMAIN;
  const result = verifyShopOwnership(EXPECTED, { shop_domain: EXPECTED });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "missing_expected_shop_config");
  process.env.SHOPIFY_STORE_DOMAIN = EXPECTED; // restore for any later test in this process
});

test("a non-string payload shop_domain (malformed/unexpected shape) does not crash and is ignored, not trusted as a match", () => {
  process.env.SHOPIFY_STORE_DOMAIN = EXPECTED;
  const result = verifyShopOwnership(EXPECTED, { shop_domain: 12345 });
  assert.equal(result.ok, true); // header alone is sufficient once validated; a junk payload field is simply not checked
});
