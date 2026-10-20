// app/routes/webhooks.shop.redact.tsx
//
// Shopify mandatory privacy webhook — fires 48 hours after a shop uninstalls
// the app, requiring all of that shop's customer data to be erased.
//
// ⚠️ KNOWN LIMITATION, not silently assumed away: the Customer model has no
// shop-domain field (confirmed against schema.prisma — this app currently
// has no multi-shop scoping at all, consistent with it serving one Shopify
// store today). This handler therefore erases EVERY customer record in the
// database, which is only correct because there is currently exactly one
// shop installation. The moment this app is installed on a second shop (the
// future B2B scenario from the architecture report), this becomes WRONG —
// it would erase every shop's customers on any one shop's uninstall. A
// `shop` field on Customer (or a join through NaiaSession's originating
// shop, if ever tracked) must be added before that point. Flagging this
// loudly here rather than letting it become a silent landmine.

import { verifyShopifyWebhookRequest } from "../lib/webhook-hmac.server";
import { eraseCustomerData } from "../lib/customer-privacy.server";
import prisma from "../db.server";

export const action = async ({ request }: { request: Request }) => {
  // Manual HMAC verification (2026-10-20) — see webhook-hmac.server.ts.
  // Fires only AFTER a shop uninstalls, so any offline session for it is
  // already gone by definition — authenticate.webhook()'s session lookup
  // could never succeed here even with the missing table fixed.
  const verified = await verifyShopifyWebhookRequest(request);
  if (!verified.ok) {
    return new Response("Unauthorized", { status: 401 });
  }
  const { shop, topic } = verified;
  console.log(`Received ${topic} webhook for ${shop}`);

  const customers = await prisma.customer.findMany({ select: { id: true } });
  console.log(`shop/redact for ${shop}: erasing ${customers.length} customer record(s) (single-shop assumption — see file header)`);

  let erased = 0;
  let cloudinaryFailureCount = 0;
  for (const c of customers) {
    const result = await eraseCustomerData(c.id);
    if (!result.alreadyErased) erased++;
    cloudinaryFailureCount += result.cloudinaryFailures.length;
  }

  console.log(`shop/redact complete for ${shop}: erased=${erased} cloudinaryFailures=${cloudinaryFailureCount}`);
  return new Response();
};
