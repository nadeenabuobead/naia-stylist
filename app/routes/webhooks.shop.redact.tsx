// app/routes/webhooks.shop.redact.tsx
//
// Shopify mandatory privacy webhook — fires 48 hours after a shop uninstalls
// the app, requiring all of that shop's customer data to be erased. This is
// a SHOP-level obligation, distinct from customers/redact's per-customer
// data-subject request (webhooks.customers.redact.tsx) — the distinction
// matters for exactly who this handler is allowed to touch, see below.
//
// ⚠️ KNOWN LIMITATION, not silently assumed away: the Customer model has no
// shop-domain field (confirmed against schema.prisma — this app currently
// has no multi-shop scoping at all, consistent with it serving one Shopify
// store today). A `shop` field on Customer (or a join through NaiaSession's
// originating shop, if ever tracked) must be added before a second shop
// install is possible, so this handler can scope to that one shop's
// customers instead of "every row with no Clerk relationship" below.
//
// Scoping (2026-11-05, post-Clerk-migration correction): this handler does
// NOT erase every customer row. It erases only rows that are STILL purely
// Shopify-identified — shopifyCustomerId set AND clerkUserId unset. A
// customer who has ever linked Clerk (see IdentityLinkRequest) has an
// independent nAia relationship — membership, Style Passport, Closet — no
// longer mediated by this shop's install state, and uninstalling this one
// Shopify store must not erase it. The earlier version of this file erased
// EVERY Customer row unconditionally; that was correct only by accident,
// back when no Customer could have an independent Clerk identity at all.
//
// Per-customer isolation: one customer's erasure failing (e.g. billing
// history hitting an unexpected error — eraseCustomerData's own try/catch
// already durably records that case, see customer-erasure-failures.server.ts)
// must never stop the rest of the batch from being processed. The loop below
// also wraps each call itself as a second, independent safety net.

import { verifyShopifyWebhookRequest } from "../lib/webhook-hmac.server";
import { verifyShopOwnership } from "../lib/webhook-shop-guard.server";
import { eraseCustomerData } from "../lib/customer-privacy.server";
import { recordPendingCustomerErasureFailure } from "../lib/customer-erasure-failures.server";
import prisma from "../db.server";

export const action = async ({ request }: { request: Request }) => {
  // Manual HMAC verification (2026-10-20) — see webhook-hmac.server.ts.
  // Fires only AFTER a shop uninstalls, so any offline session for it is
  // already gone by definition — authenticate.webhook()'s session lookup
  // could never succeed even with the missing table fixed.
  const verified = await verifyShopifyWebhookRequest(request);
  if (!verified.ok) {
    return new Response("Unauthorized", { status: 401 });
  }
  const { shop, topic, payload } = verified;
  console.log(`Received ${topic} webhook for ${shop}`);

  // Shop-ownership guard (2026-10-20) — see webhook-shop-guard.server.ts.
  // This handler erases Shopify-only customer rows; that is only correct
  // when the authenticated request is for the one shop those rows actually
  // belong to. Verified, not assumed — fails closed otherwise.
  const ownership = verifyShopOwnership(shop, payload);
  if (!ownership.ok) {
    console.error(
      `shop/redact REFUSED for header shop "${shop}": ${ownership.reason}. ` +
      `Not erasing any data — this must be investigated before retrying.`,
    );
    return new Response("Shop ownership could not be established", { status: 500 });
  }

  // Only customers still purely Shopify-identified — see the scoping note
  // above. A Clerk-linked customer (clerkUserId set) is excluded even if
  // shopifyCustomerId is also set, because that customer's nAia relationship
  // now survives independently of this shop's install state.
  const customers = await prisma.customer.findMany({
    where: { shopifyCustomerId: { not: null }, clerkUserId: null },
    select: { id: true },
  });
  console.log(`shop/redact for ${shop}: erasing ${customers.length} Shopify-only customer record(s)`);

  let erased = 0;
  let anonymized = 0;
  let failed = 0;
  let cloudinaryFailureCount = 0;
  for (const c of customers) {
    try {
      const result = await eraseCustomerData(c.id, {}, "shop/redact");
      if (result.pendingFailureId) {
        failed++;
      } else if (result.anonymized) {
        anonymized++;
      } else if (!result.alreadyErased) {
        erased++;
      }
      cloudinaryFailureCount += result.cloudinaryFailures.length;
    } catch (err) {
      // Defense in depth: eraseCustomerData already durably records any
      // failure inside its own try/catch, but if something throws before
      // or outside of that (a programming error, not a DB error) this
      // still must not abort the rest of the batch.
      failed++;
      await recordPendingCustomerErasureFailure(c.id, "shop/redact", err);
      console.error(`shop/redact: customer ${c.id} failed unexpectedly, recorded for retry — continuing with the rest of the batch.`);
    }
  }

  console.log(
    `shop/redact complete for ${shop}: erased=${erased} anonymized=${anonymized} failed=${failed} cloudinaryFailures=${cloudinaryFailureCount}`,
  );
  return new Response();
};
