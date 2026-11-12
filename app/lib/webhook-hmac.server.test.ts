// app/lib/webhook-hmac.server.test.ts
//
// Unit coverage for the manual Shopify webhook HMAC verification that
// replaced authenticate.webhook() in the three GDPR compliance handlers
// (2026-10-20) — real crypto throughout, no mocks, no database.
//
// Run: node --experimental-strip-types --test app/lib/webhook-hmac.server.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "crypto";
import { verifyHmac, verifyShopifyWebhookRequest } from "./webhook-hmac.server";

const SECRET = "test-shopify-api-secret";

function sign(rawBody: string, secret: string = SECRET): string {
  return createHmac("sha256", secret).update(rawBody, "utf8").digest("base64");
}

function makeRequest(rawBody: string, opts: { hmac?: string | null; shop?: string; topic?: string; webhookId?: string } = {}) {
  const headers: Record<string, string> = {};
  if (opts.hmac !== null) headers["X-Shopify-Hmac-Sha256"] = opts.hmac ?? sign(rawBody);
  if (opts.shop) headers["X-Shopify-Shop-Domain"] = opts.shop;
  if (opts.topic) headers["X-Shopify-Topic"] = opts.topic;
  if (opts.webhookId) headers["X-Shopify-Webhook-Id"] = opts.webhookId;
  return new Request("http://localhost/webhooks/test", { method: "POST", headers, body: rawBody });
}

test("verifyHmac: accepts a correctly signed body", () => {
  const body = '{"shop_id":1}';
  assert.equal(verifyHmac(body, sign(body), SECRET), true);
});

test("verifyHmac: rejects a tampered body with an otherwise-valid-looking signature", () => {
  const original = '{"shop_id":1}';
  const tampered = '{"shop_id":2}';
  assert.equal(verifyHmac(tampered, sign(original), SECRET), false);
});

test("verifyHmac: rejects a signature computed with the wrong secret", () => {
  const body = '{"shop_id":1}';
  assert.equal(verifyHmac(body, sign(body, "wrong-secret"), SECRET), false);
});

test("verifyHmac: rejects a missing header", () => {
  assert.equal(verifyHmac('{"a":1}', null, SECRET), false);
});

test("verifyHmac: rejects a malformed/wrong-length header without throwing", () => {
  // This is the exact pitfall Shopify's own docs flag: timingSafeEqual
  // throws on mismatched-length buffers if not guarded against.
  assert.doesNotThrow(() => verifyHmac('{"a":1}', "not-base64-and-wrong-length", SECRET));
  assert.equal(verifyHmac('{"a":1}', "short", SECRET), false);
});

test("verifyShopifyWebhookRequest: valid signature, well-formed payload — succeeds with no session/database dependency", async () => {
  process.env.SHOPIFY_API_SECRET = SECRET;
  const body = JSON.stringify({ customer: { id: "123" } });
  const req = makeRequest(body, { shop: "test-shop.myshopify.com", topic: "customers/data_request", webhookId: "wh-1" });

  const result = await verifyShopifyWebhookRequest(req);

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.shop, "test-shop.myshopify.com");
    assert.equal(result.topic, "customers/data_request");
    assert.equal(result.webhookId, "wh-1");
    assert.deepEqual(result.payload, { customer: { id: "123" } });
  }
});

test("verifyShopifyWebhookRequest: invalid signature is rejected before the body is ever parsed", async () => {
  process.env.SHOPIFY_API_SECRET = SECRET;
  const req = makeRequest('{"customer":{"id":"123"}}', { hmac: "forged-signature" });

  const result = await verifyShopifyWebhookRequest(req);

  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "invalid_signature");
});

test("verifyShopifyWebhookRequest: missing signature header is rejected", async () => {
  process.env.SHOPIFY_API_SECRET = SECRET;
  const req = makeRequest('{"customer":{"id":"123"}}', { hmac: null });

  const result = await verifyShopifyWebhookRequest(req);

  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "missing_signature");
});

test("verifyShopifyWebhookRequest: valid signature but malformed JSON body is rejected cleanly, not thrown", async () => {
  process.env.SHOPIFY_API_SECRET = SECRET;
  const malformed = "{not valid json";
  const req = makeRequest(malformed, { hmac: sign(malformed) });

  const result = await verifyShopifyWebhookRequest(req);

  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "malformed_body");
});

test("verifyShopifyWebhookRequest: unset SHOPIFY_API_SECRET fails closed instead of falling back to an empty-string key", async () => {
  const original = process.env.SHOPIFY_API_SECRET;
  delete process.env.SHOPIFY_API_SECRET;
  try {
    // Before the hotfix, this would compute a real HMAC keyed on "" and
    // accept a request signed with that known, empty key.
    const body = '{"customer":{"id":"123"}}';
    const forgedUnderEmptyKey = createHmac("sha256", "").update(body, "utf8").digest("base64");
    const req = makeRequest(body, { hmac: forgedUnderEmptyKey });

    const result = await verifyShopifyWebhookRequest(req);

    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "not_configured");
  } finally {
    if (original !== undefined) process.env.SHOPIFY_API_SECRET = original;
  }
});

test("verifyShopifyWebhookRequest: empty body with a valid signature over empty string succeeds with an empty payload object", async () => {
  process.env.SHOPIFY_API_SECRET = SECRET;
  const req = makeRequest("", { hmac: sign("") });

  const result = await verifyShopifyWebhookRequest(req);

  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.payload, {});
});
