// app/lib/webhook-hmac.server.ts
//
// Manual Shopify webhook verification (2026-10-20) — HMAC-SHA256 of the raw
// request body against this app's static client secret, per Shopify's own
// documented "manual verification" path. Replaces authenticate.webhook()
// for the three GDPR compliance handlers.
//
// Why not authenticate.webhook() (the SDK's own helper): it verifies the
// same HMAC, then ALSO loads an offline session via PrismaSessionStorage to
// resolve shop/session for the caller — a step none of these three
// handlers ever use the result of, and one that depends on a `session`
// table this app's custom NaiaSession architecture never creates (this app
// was built around the Customer Account API, not the merchant-admin OAuth
// install flow authenticate.webhook()'s session lookup assumes).
//
// This isn't just a workaround for the missing table. customers/redact and
// shop/redact are specifically expected to still work well after a shop
// uninstalls the app — Shopify can withhold customers/redact for up to six
// months, and shop/redact fires only after uninstall — by which point any
// offline session would already be gone. Verifying against the app's own
// static secret, independent of any per-shop session, is the architecturally
// correct mechanism for these topics, not merely a fix for today's error.
import { timingSafeEqual, createHmac } from "crypto";

export type VerifiedWebhook =
  | { ok: true; shop: string | null; topic: string | null; webhookId: string | null; payload: unknown }
  | { ok: false; reason: "missing_signature" | "invalid_signature" | "malformed_body" | "not_configured" };

// Exported separately from verifyShopifyWebhookRequest for direct, isolated
// testing of the cryptographic check against fixed inputs.
export function verifyHmac(rawBody: string, hmacHeader: string | null, secret: string): boolean {
  if (!hmacHeader) return false;
  const computed = createHmac("sha256", secret).update(rawBody, "utf8").digest("base64");
  const providedBuf = Buffer.from(hmacHeader, "utf8");
  const computedBuf = Buffer.from(computed, "utf8");
  // Node's timingSafeEqual throws on mismatched-length buffers — checked
  // first so a malformed or wrong-length header fails closed with a clean
  // rejection instead of an uncaught exception.
  if (providedBuf.length !== computedBuf.length) return false;
  return timingSafeEqual(providedBuf, computedBuf);
}

export async function verifyShopifyWebhookRequest(request: Request): Promise<VerifiedWebhook> {
  const secret = process.env.SHOPIFY_API_SECRET;
  // Fail closed (hotfix 2026-11-12) — an unset secret must never fall through
  // to computing a real HMAC keyed on "", which would accept any request
  // whose signature is a valid HMAC-SHA256 of the body under that known,
  // empty key. Refuse before touching the request body at all.
  if (!secret) return { ok: false, reason: "not_configured" };
  // Read as raw text before any JSON parsing — the HMAC is computed over
  // the exact bytes Shopify sent, not a re-serialized version of them.
  const rawBody = await request.text();
  const hmacHeader = request.headers.get("x-shopify-hmac-sha256");

  if (!hmacHeader) return { ok: false, reason: "missing_signature" };
  if (!verifyHmac(rawBody, hmacHeader, secret)) {
    return { ok: false, reason: "invalid_signature" };
  }

  // Only trusted once the signature above has verified — never read before.
  const shop = request.headers.get("x-shopify-shop-domain");
  const topic = request.headers.get("x-shopify-topic");
  const webhookId = request.headers.get("x-shopify-webhook-id");

  let payload: unknown;
  try {
    payload = rawBody.length > 0 ? JSON.parse(rawBody) : {};
  } catch {
    return { ok: false, reason: "malformed_body" };
  }

  return { ok: true, shop, topic, webhookId, payload };
}
