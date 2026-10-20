// app/routes/webhooks.customers.data_request.tsx
//
// Shopify mandatory privacy webhook — fires when a customer (or Shopify, on
// their behalf) requests a copy of their data. Shopify's own webhook gives no
// channel to return the data directly to the customer — this handler's job is
// to verify the request is genuinely from Shopify, locate the matching
// customer, and compile their export for YOU to actually deliver. It does not
// email anyone — no email provider is integrated in this app (see the
// architecture report). Treat a successful 200 here as "request logged and
// compiled," not "request fulfilled end-to-end."

import { verifyShopifyWebhookRequest } from "../lib/webhook-hmac.server";
import { verifyShopOwnership } from "../lib/webhook-shop-guard.server";
import { compileCustomerExport } from "../lib/customer-privacy.server";
import prisma from "../db.server";

export const action = async ({ request }: { request: Request }) => {
  // Manual HMAC verification (2026-10-20) — see webhook-hmac.server.ts for
  // why this handler no longer uses the SDK's authenticate.webhook(), which
  // requires a `session` table this app's custom auth architecture never
  // creates. The HMAC check itself is unchanged: Shopify's documented
  // base64(HMAC-SHA256(raw_body, client_secret)) comparison.
  const verified = await verifyShopifyWebhookRequest(request);
  if (!verified.ok) {
    return new Response("Unauthorized", { status: 401 });
  }
  const { shop, topic, payload } = verified;

  // Shop-ownership guard (2026-10-20) — see webhook-shop-guard.server.ts.
  // This isn't a deletion risk like the two redact handlers, but the same
  // ID-collision reasoning applies to exposure: shopifyCustomerId is
  // unique per row but not scoped to a shop, so without this check a
  // second shop installation could compile and log a size/shape summary
  // for the wrong shop's customer on an ID collision. Verified against the
  // one shop this app's login flow is already locked to, not assumed.
  const ownership = verifyShopOwnership(shop, payload);
  if (!ownership.ok) {
    console.error(
      `customers/data_request REFUSED for header shop "${shop}": ${ownership.reason}. ` +
      `Not compiling any export — this must be investigated before retrying.`,
    );
    return new Response("Shop ownership could not be established", { status: 500 });
  }

  const shopifyCustomerId = String((payload as any)?.customer?.id ?? "");
  console.log(`Received ${topic} webhook for ${shop} — customer present: ${Boolean(shopifyCustomerId)}`);

  if (!shopifyCustomerId) {
    // Shopify sent the webhook with no customer reference — nothing to do,
    // still a success (there's no request we failed to honour).
    return new Response();
  }

  const customer = await prisma.customer.findUnique({ where: { shopifyCustomerId } });
  if (!customer) {
    // No matching account — same effect as "nothing to export," not an error.
    console.log(`customers/data_request: no matching customer for shop ${shop}`);
    return new Response();
  }

  const exportData = await compileCustomerExport(customer.id);
  // Logged, not emailed — see file header. A human (you) completes delivery.
  // Only a size/shape summary is logged, never the export content itself.
  console.log(
    `customers/data_request compiled for customer ${customer.id}: ` +
    `${exportData ? "export ready, awaiting manual delivery" : "compile returned null unexpectedly"}`,
  );

  return new Response();
};
