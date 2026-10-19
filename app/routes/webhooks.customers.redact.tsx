// app/routes/webhooks.customers.redact.tsx
//
// Shopify mandatory privacy webhook — fires when a customer's data must be
// erased (typically 10 days after a data-erasure request, or sooner for
// inactive accounts). Calls the same eraseCustomerData used by the
// self-service Settings deletion flow — one implementation, two entry points.

import { authenticate } from "../shopify.server";
import { eraseCustomerData } from "../lib/customer-privacy.server";
import prisma from "../db.server";

export const action = async ({ request }: { request: Request }) => {
  const { shop, topic, payload } = await authenticate.webhook(request);

  const shopifyCustomerId = String((payload as any)?.customer?.id ?? "");
  console.log(`Received ${topic} webhook for ${shop} — customer present: ${Boolean(shopifyCustomerId)}`);

  if (!shopifyCustomerId) {
    return new Response();
  }

  const customer = await prisma.customer.findUnique({ where: { shopifyCustomerId }, select: { id: true } });
  if (!customer) {
    // Already gone, or never existed here — eraseCustomerData's own
    // idempotency would report the same outcome; short-circuiting here
    // just avoids an unnecessary lookup inside it.
    console.log(`customers/redact: no matching customer for shop ${shop} — already erased or never existed`);
    return new Response();
  }

  const result = await eraseCustomerData(customer.id);
  console.log(
    `customers/redact processed for shop ${shop}: ` +
    `alreadyErased=${result.alreadyErased} cloudinaryFailures=${result.cloudinaryFailures.length} ` +
    `journeyEventsPurged=${result.journeyEventsPurged}`,
  );

  return new Response();
};
