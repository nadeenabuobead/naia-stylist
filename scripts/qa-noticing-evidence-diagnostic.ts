// scripts/qa-noticing-evidence-diagnostic.ts
// READ-ONLY diagnostic for "What nAia Is Noticing" (Taste & Evidence Layer V1).
//
// Investigates why a QA customer with substantial Closet/StyleMe/Buy-or-Skip/
// review activity still sees "STILL LEARNING" on /what-naia-is-noticing.
//
// All of the actual diagnostic logic lives in
// app/lib/ai/taste-evidence-diagnostic.server.ts — shared with the staging-only
// authenticated route (app/routes/api.staging-noticing-diagnostic.ts) so the two
// call sites can never drift from each other or from the real engine's math.
//
// This script only resolves which customer to run it for. It makes no writes —
// see the shared module's own header comment for the full read-only contract.
//
// Usage (exactly one identifier required — all non-secret):
//   npx tsx scripts/qa-noticing-evidence-diagnostic.ts --customer-id <Customer.id>
//   npx tsx scripts/qa-noticing-evidence-diagnostic.ts --shopify-customer-id <shopifyCustomerId>
//   npx tsx scripts/qa-noticing-evidence-diagnostic.ts --email <customer email>
//
// Output: a single JSON report on stdout. All progress/error text goes to stderr,
// so `... > report.json` captures only the report.

import prisma from "../app/db.server.js";
import { buildTasteEvidenceDiagnosticReport } from "../app/lib/ai/taste-evidence-diagnostic.server.js";

function parseArgs(): { customerId?: string; shopifyCustomerId?: string; email?: string } {
  const args = process.argv.slice(2);
  const get = (flag: string) => {
    const i = args.indexOf(flag);
    return i !== -1 ? args[i + 1] : undefined;
  };
  return {
    customerId: get("--customer-id"),
    shopifyCustomerId: get("--shopify-customer-id"),
    email: get("--email"),
  };
}

async function main() {
  const { customerId, shopifyCustomerId, email } = parseArgs();
  if (!customerId && !shopifyCustomerId && !email) {
    console.error(
      "Missing customer identifier. Pass exactly one of:\n" +
      "  --customer-id <Customer.id>\n" +
      "  --shopify-customer-id <shopifyCustomerId>\n" +
      "  --email <customer email>\n"
    );
    process.exit(1);
  }

  const customer = customerId
    ? await prisma.customer.findUnique({ where: { id: customerId }, select: { id: true } })
    : shopifyCustomerId
    ? await prisma.customer.findUnique({ where: { shopifyCustomerId }, select: { id: true } })
    : await prisma.customer.findFirst({ where: { email: email! }, select: { id: true } });

  if (!customer) {
    console.error("No customer found for the identifier supplied.");
    process.exit(1);
  }

  const report = await buildTasteEvidenceDiagnosticReport(customer.id);
  console.log(JSON.stringify(report, null, 2));
}

main()
  .catch(err => {
    console.error("Diagnostic failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
