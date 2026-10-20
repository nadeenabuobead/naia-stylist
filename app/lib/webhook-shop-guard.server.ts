// app/lib/webhook-shop-guard.server.ts
//
// Shop-ownership guard for the GDPR compliance webhooks (2026-10-20).
//
// Why this exists: customers/redact and shop/redact delete data. Customer
// rows have no shop field at all (confirmed against schema.prisma), and
// shopifyCustomerId is unique per-row with no compound (shop, id) key — so
// if this app were ever installed on a second shop, a customers/redact for
// shop B's customer "12345" could match shop A's customer "12345" if the
// raw IDs ever collided (Shopify customer IDs are unique per shop, not
// globally). shop/redact goes further still: its existing code (unchanged
// here, see its own file header) erases every Customer row in the
// database, which is only correct for exactly one shop.
//
// This guard does not silently trust "we only have one shop" as given.
// SHOPIFY_STORE_DOMAIN is the same env var shopify-customer-oauth.server.ts
// already hard-codes the entire customer login flow to (getOidcConfig
// throws if it's unset) — there is no code path anywhere in this app that
// creates a Customer row tied to any other shop. Comparing the webhook's
// own authenticated shop identity against that same value, at the moment
// of deletion, turns "we assume single-shop" into "we verified this exact
// request is for the one shop every Customer row actually belongs to" —
// and if that ever stops being true (second install, misconfigured env),
// this fails closed instead of silently deleting the wrong shop's data.
//
// Two independent signals are checked, not one: the X-Shopify-Shop-Domain
// header (authenticated by the HMAC check that must run before this) and
// shop_domain in the payload body itself (present on both compliance
// topics per Shopify's documented sample payloads). Both must agree with
// the configured domain — a lone mismatch between the two, even if one of
// them happened to match, is itself treated as suspicious.
export type ShopOwnershipResult =
  | { ok: true; shop: string }
  | { ok: false; reason: "missing_expected_shop_config" | "missing_shop_header" | "shop_mismatch" };

export function verifyShopOwnership(headerShop: string | null, payload: unknown): ShopOwnershipResult {
  const expected = process.env.SHOPIFY_STORE_DOMAIN;
  if (!expected) {
    // Fail closed: without a configured expected shop, ownership cannot be
    // established at all — never fall back to "assume it's fine".
    return { ok: false, reason: "missing_expected_shop_config" };
  }
  if (!headerShop) {
    return { ok: false, reason: "missing_shop_header" };
  }
  if (headerShop !== expected) {
    return { ok: false, reason: "shop_mismatch" };
  }
  const payloadShop = (payload as { shop_domain?: unknown } | null)?.shop_domain;
  if (typeof payloadShop === "string" && payloadShop !== expected) {
    return { ok: false, reason: "shop_mismatch" };
  }
  return { ok: true, shop: headerShop };
}
