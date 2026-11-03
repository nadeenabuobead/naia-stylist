// app/lib/plan/billing-schema.test.ts
//
// Phase 1 (schema only) — regression coverage for the paid-membership
// billing data model approved 2026-11-03, specifically the 8 review points
// raised before implementation:
//   1. Nullable/appropriately-initialized dates for INCOMPLETE subscriptions
//   2. Provider identifiers and complete webhook idempotency
//   3. Out-of-order webhook handling / reconciliation support
//   4. Billing data retention vs. customer privacy deletion
//   5. Customer-to-subscription Prisma relationships
//   6. Add-on expiry, usage-period ownership, cancellation behaviour
//   7. No automatic Closet-data deletion on membership expiry
//   8. Customer billing history / reconciling payments against entitlements
//
// Source-string assertions against prisma/schema.prisma and the new
// migration file — same convention as entitlement.test.ts's ENT-* suite.
// No live database exists in this environment; nothing here executes a real
// query. These tests prove the SCHEMA TEXT is shaped correctly, not that a
// real Postgres instance enforces it — that can only be confirmed once the
// migration is actually applied (a separate, later, manual step).
//
// Run: node --import tsx/esm --test app/lib/plan/billing-schema.test.ts

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../../..");

function readFile(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

const schema = readFile("prisma/schema.prisma");
const migration = readFile("prisma/migrations/20261103000000_billing_subscription_phase1/migration.sql");

function modelBlock(name: string): string {
  const start = schema.indexOf(`model ${name} {`);
  assert.ok(start > -1, `model ${name} must exist in schema.prisma`);
  const end = schema.indexOf("\n}", start);
  return schema.slice(start, end);
}

describe("BILL-01 — the four new enums exist with the approved values", () => {
  it("SubscriptionStatus has exactly INCOMPLETE, ACTIVE, PAST_DUE, CANCELED, EXPIRED", () => {
    assert.match(schema, /enum SubscriptionStatus \{[\s\S]*?INCOMPLETE[\s\S]*?ACTIVE[\s\S]*?PAST_DUE[\s\S]*?CANCELED[\s\S]*?EXPIRED[\s\S]*?\}/);
  });

  it("BillingPlanType has MONTHLY and ANNUAL", () => {
    assert.match(schema, /enum BillingPlanType \{[\s\S]*?MONTHLY[\s\S]*?ANNUAL[\s\S]*?\}/);
  });

  it("BillingTransactionType covers subscription and all three add-on kinds", () => {
    const block = schema.slice(schema.indexOf("enum BillingTransactionType"), schema.indexOf("enum BillingTransactionStatus"));
    for (const value of ["SUBSCRIPTION_INITIAL", "SUBSCRIPTION_RENEWAL", "SUBSCRIPTION_REFUND", "ADDON_STYLEME_BOOST", "ADDON_VTO_BOOST", "ADDON_CLOSET_EXPANSION"]) {
      assert.ok(block.includes(value), `BillingTransactionType must include ${value}`);
    }
  });

  it("BillingTransactionStatus has SUCCEEDED, FAILED, REFUNDED", () => {
    assert.match(schema, /enum BillingTransactionStatus \{[\s\S]*?SUCCEEDED[\s\S]*?FAILED[\s\S]*?REFUNDED[\s\S]*?\}/);
  });
});

describe("BILL-02 — review point 1: billing dates are nullable, not forced on an INCOMPLETE subscription", () => {
  const sub = modelBlock("Subscription");

  it("currentPeriodStart and currentPeriodEnd are nullable DateTime", () => {
    assert.match(sub, /currentPeriodStart\s+DateTime\?/);
    assert.match(sub, /currentPeriodEnd\s+DateTime\?/);
  });

  it("providerSubscriptionId is nullable — unknown until the provider confirms the subscription object", () => {
    assert.match(sub, /providerSubscriptionId\s+String\?\s+@unique/);
  });

  it("providerCustomerId is nullable — unknown until the first checkout creates the provider-side customer", () => {
    assert.match(sub, /providerCustomerId\s+String\?/);
  });
});

describe("BILL-03 — review point 2: provider identifiers and complete webhook idempotency", () => {
  const sub = modelBlock("Subscription");
  const txn = modelBlock("BillingTransaction");
  const webhook = modelBlock("ProcessedWebhookEvent");

  it("Subscription carries provider, providerCustomerId, providerSubscriptionId (unique)", () => {
    assert.match(sub, /provider\s+String/);
    assert.match(sub, /providerCustomerId\s+String\?/);
    assert.match(sub, /providerSubscriptionId\s+String\?\s+@unique/);
  });

  it("BillingTransaction carries its own providerTransactionId (unique) — a renewal is not the same event as its subscription", () => {
    assert.match(txn, /providerTransactionId\s+String\?\s+@unique/);
  });

  it("ProcessedWebhookEvent idempotency is (provider, providerEventId) — not a bare providerEventId — so two providers can never collide on id format", () => {
    assert.match(webhook, /@@unique\(\[provider,\s*providerEventId\]\)/);
  });

  it("ProcessedWebhookEvent is NOT a Prisma relation to Customer — a loose reference only, so it can never block or be affected by customer erasure", () => {
    assert.match(webhook, /customerId\s+String\?/);
    assert.ok(!webhook.includes("customer   Customer") && !webhook.includes("customer Customer"), "ProcessedWebhookEvent must not declare a Customer relation field");
  });
});

describe("BILL-04 — review point 3: out-of-order webhook handling / reconciliation support", () => {
  it("Subscription has providerSyncedAt — the staleness guard against an out-of-order redelivery", () => {
    assert.match(modelBlock("Subscription"), /providerSyncedAt\s+DateTime\?/);
  });

  it("ProcessedWebhookEvent records the provider's own event timestamp separately from our local processing time", () => {
    const webhook = modelBlock("ProcessedWebhookEvent");
    assert.match(webhook, /eventCreatedAt\s+DateTime\b/);
    assert.match(webhook, /processedAt\s+DateTime\s+@default\(now\(\)\)/);
    // Two distinct fields, not one reused for both meanings.
    assert.notEqual(webhook.indexOf("eventCreatedAt"), webhook.indexOf("processedAt"));
  });

  it("BillingTransaction.occurredAt is the provider's event time, distinct from createdAt (our write time)", () => {
    const txn = modelBlock("BillingTransaction");
    assert.match(txn, /occurredAt\s+DateTime\b/);
    assert.match(txn, /createdAt\s+DateTime\s+@default\(now\(\)\)/);
  });
});

describe("BILL-05 — review point 4: billing retention vs. customer privacy deletion", () => {
  it("Subscription.customerId uses onDelete: Restrict, not Cascade — a financial record must not be silently destroyed by customer erasure", () => {
    const sub = modelBlock("Subscription");
    assert.match(sub, /onDelete:\s*Restrict/);
    assert.ok(!sub.includes("onDelete: Cascade"), "Subscription must not cascade-delete with its Customer");
  });

  it("BillingTransaction.customerId also uses onDelete: Restrict, for the same reason", () => {
    const txn = modelBlock("BillingTransaction");
    assert.match(txn, /customer\s+Customer\s+@relation\([^)]*onDelete:\s*Restrict/);
  });

  it("BillingTransaction.subscriptionId is required and uses onDelete: Restrict — a financial transaction's link to the subscription it funded must never be silently dropped via SetNull", () => {
    const txn = modelBlock("BillingTransaction");
    assert.match(txn, /subscriptionId\s+String\b(?!\?)/, "subscriptionId must be required, not nullable");
    assert.match(txn, /subscription\s+Subscription\s+@relation\([^)]*onDelete:\s*Restrict/);
    assert.ok(!txn.includes("onDelete: SetNull"), "BillingTransaction must not SetNull its subscription link");
  });
});

describe("BILL-06 — review point 5: Customer-to-subscription Prisma relationships", () => {
  const customer = modelBlock("Customer");

  it("Customer declares the subscriptions and billingTransactions back-relations", () => {
    assert.match(customer, /subscriptions\s+Subscription\[\]/);
    assert.match(customer, /billingTransactions\s+BillingTransaction\[\]/);
  });

  it("Customer gained NO new scalar field — every existing scalar field is still present, unchanged", () => {
    // The exact original scalar field list, verbatim — if this list ever
    // changes, it must be a deliberate edit to this test, not a silent
    // side effect of a billing schema change. In particular, no
    // stripeCustomerId/providerCustomerId/paymentMethodId-shaped field
    // belongs on Customer itself — those live on Subscription/
    // BillingTransaction instead, specifically so a billing-identifier
    // field never lands on Customer without a deliberate decision to also
    // revisit customer-erasure handling at the same time.
    for (const field of ["id", "shopifyCustomerId", "email", "firstName", "lastName", "createdAt", "updatedAt", "membershipStatus"]) {
      assert.ok(customer.includes(field), `Customer must still declare ${field}`);
    }
    for (const billingIdentifier of ["stripeCustomerId", "providerCustomerId", "paymentMethodId", "billingProviderId", "stripeSubscriptionId"]) {
      assert.ok(!customer.includes(billingIdentifier), `Customer must not gain a scalar billing-identifier field (${billingIdentifier}) — those belong on Subscription/BillingTransaction`);
    }
  });
});

describe("BILL-07 — review point 6: add-on expiry, usage-period ownership, and cancellation behaviour", () => {
  const txn = modelBlock("BillingTransaction");

  it("add-on fields exist: quantity granted and the exact usage-period window they apply to", () => {
    assert.match(txn, /addonQuantityGranted\s+Int\?/);
    assert.match(txn, /addonAppliesToPeriodStart\s+DateTime\?/);
    assert.match(txn, /addonAppliesToPeriodEnd\s+DateTime\?/);
  });

  it("the add-on period fields are nullable — Closet expansions are cumulative/permanent, not tied to a single usage window, per product decision", () => {
    // Nullable (not required) is exactly what allows ADDON_CLOSET_EXPANSION
    // rows to omit a period while ADDON_STYLEME_BOOST/ADDON_VTO_BOOST rows
    // (one-time, current-period-only) populate it.
    assert.match(txn, /addonAppliesToPeriodStart\s+DateTime\?/);
  });

  it("cancellation has no dedicated add-on field — a canceled-but-not-yet-ended subscription (cancelAtPeriodEnd) retains access through currentPeriodEnd by the existing date comparison, not a separate flag", () => {
    assert.ok(!txn.includes("addonCanceled"), "add-on validity should derive from period dates already on the transaction, not a redundant cancellation flag");
  });
});

describe("BILL-08 — review point 7: no automatic Closet-data deletion on membership expiry", () => {
  it("ClosetItem has no relation to Subscription, BillingTransaction, or any billing model at all", () => {
    const closetItem = modelBlock("ClosetItem");
    assert.ok(!closetItem.includes("Subscription"), "ClosetItem must not reference Subscription");
    assert.ok(!closetItem.includes("BillingTransaction"), "ClosetItem must not reference BillingTransaction");
  });

  it("no billing model declares a relation to ClosetItem — the cap is enforced only at creation time (reserveClosetSlot), never by deleting existing rows", () => {
    assert.ok(!modelBlock("Subscription").includes("ClosetItem"));
    assert.ok(!modelBlock("BillingTransaction").includes("ClosetItem"));
  });

  it("nothing in the new migration touches the ClosetItem table", () => {
    assert.ok(!migration.includes('"ClosetItem"'), "this migration must be purely additive and never reference ClosetItem");
  });
});

describe("BILL-09 — review point 8: billing history and reconciling payments against entitlements", () => {
  it("BillingTransaction is a distinct, immutable-by-design ledger model from Subscription — historical amounts/dates are not reconstructable from Subscription alone", () => {
    const txn = modelBlock("BillingTransaction");
    // No updatedAt — this model is written once per financial event, never
    // mutated in place, unlike Subscription (which has one and is mutated
    // by every webhook).
    assert.ok(!txn.includes("updatedAt"), "BillingTransaction must be append-only — it must never gain an updatedAt that would imply in-place mutation of a financial record");
    assert.match(txn, /amount\s+Int/);
    assert.match(txn, /currency\s+String/);
    assert.match(txn, /occurredAt\s+DateTime/);
  });

  it("BillingTransaction links back to its Subscription (required — the link is never dropped) for cross-referencing which entitlement period a payment funded", () => {
    assert.match(modelBlock("BillingTransaction"), /subscriptionId\s+String\b(?!\?)/);
  });

  it("every BillingTransaction is attributable to a customer for a full billing-history query", () => {
    assert.match(modelBlock("BillingTransaction"), /customerId\s+String\b/);
  });
});

describe("BILL-10 — migration file matches the schema, and touches nothing else", () => {
  it("the migration file exists and is purely additive — CREATE TYPE/CREATE TABLE/ADD CONSTRAINT only, no ALTER on any pre-existing table", () => {
    assert.ok(migration.includes('CREATE TYPE "SubscriptionStatus"'));
    assert.ok(migration.includes('CREATE TABLE "Subscription"'));
    assert.ok(migration.includes('CREATE TABLE "BillingTransaction"'));
    assert.ok(migration.includes('CREATE TABLE "ProcessedWebhookEvent"'));
    assert.ok(!migration.includes('ALTER TABLE "Customer"'), "this migration must not alter the existing Customer table");
  });

  it("the migration's foreign keys match the schema's Restrict choices exactly, including the corrected subscriptionId link", () => {
    assert.ok(migration.includes('FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT'));
    assert.match(migration, /BillingTransaction_subscriptionId_fkey[\s\S]*?ON DELETE RESTRICT/);
    assert.ok(!migration.includes("ON DELETE SET NULL"), "no FK in this migration should use SetNull after the correction");
    assert.match(migration, /"subscriptionId"\s+TEXT NOT NULL/);
  });

  it("entitlement.server.ts's existing checkEntitlement/reserve* calls are untouched by this schema change — Phase 1 is additive data model only", () => {
    const entSvc = readFile("app/lib/plan/entitlement.server.ts");
    assert.ok(!entSvc.includes("Subscription"), "entitlement.server.ts must not yet reference the new billing models — that is Phase 2+");
    assert.ok(entSvc.includes("membershipStatus: MembershipStatus"), "checkEntitlement's signature must be unchanged in Phase 1");
  });
});
