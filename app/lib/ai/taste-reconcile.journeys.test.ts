// app/lib/ai/taste-reconcile.journeys.test.ts
//
// PERSISTENCE JOURNEY — reproduces the real "STILL LEARNING despite CONFIRMED
// evidence" bug against a real Postgres, not a mock.
//
// loadConfirmedTendencies()'s where-clause used to read
// `customerFeedback: { not: "not-quite" }`. On PostgreSQL, Prisma's `not`
// filter on a nullable column excludes NULL rows too — and customerFeedback
// is null until a customer explicitly reacts to an observation, which for a
// CANDIDATE row is never (the UI only renders feedback buttons on CONFIRMED
// cards) and for most fresh CONFIRMED rows hasn't happened yet either. So the
// query silently dropped almost every tendency it was supposed to surface.
// A calculation-only test using a mocked Prisma client can't catch this —
// the bug is specifically in how the real query engine treats NULL, which a
// mock has no opinion on. Only a real database proves it.
//
// Second fix (same function, separate bug): loadConfirmedTendencies also
// used to filter the query to `state: { in: ["CANDIDATE", "CONFIRMED"] }`,
// which meant a "Not quite" observation — state flips to REJECTED the
// instant the customer answers — vanished from their own Noticing history
// for good. Product truth: an assessment changes how nAia treats an
// observation internally, it must not erase it from the customer-facing
// page. REJECTED is now included in the visible set; only SUPPRESSED
// (evidence contradicted or fully withdrawn — a different lifecycle case)
// stays hidden.
//
// Requires an isolated database. Skipped entirely without one, so the normal
// suite stays offline — same convention as wardrobe-journeys.test.ts, with
// one addition: loadConfirmedTendencies() isn't dependency-injected, it
// imports the app's shared `prisma` singleton (app/db.server.js) directly,
// so DATABASE_URL itself must also point at the test instance for this one
// file — not just TEST_DATABASE_URL, which only this file's own setup/
// teardown client uses:
//
//   npm i -D embedded-postgres   (one-time, not committed)
//   node scripts/testdb/server.mjs &
//   DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5433/postgres \
//   TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5433/postgres \
//     node --test --import tsx/esm app/lib/ai/taste-reconcile.journeys.test.ts
//
// It never touches staging, production, or anyone's real data.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { loadConfirmedTendencies, loadStrongestConfirmedTendency } from "./taste-reconcile.server.js";

const URL_ = process.env.TEST_DATABASE_URL;
const skip = URL_ ? false : "set TEST_DATABASE_URL to run the persistence journeys";

let db: PrismaClient;

function tendencyRow(customerId: string, over: Record<string, unknown> = {}) {
  return {
    customerId,
    observationKey: "tendency-v1|comfort:comfort",
    dimension: "comfort",
    value: "comfort",
    generation: 1,
    dominantPolarity: "positive",
    observationFamily: "WORKS_WELL",
    state: "CONFIRMED",
    wSupport: 7.04,
    wContradict: 0,
    wNet: 7.04,
    distinctRecords: 9,
    distinctSources: 1,
    effectiveSupport: 7.04,
    customerFeedback: null,
    ...over,
  };
}

before(async () => {
  if (skip) return;
  db = new PrismaClient({ datasources: { db: { url: URL_! } } });
  await db.$executeRawUnsafe(`TRUNCATE TABLE "Customer" RESTART IDENTITY CASCADE`);
});

after(async () => {
  if (skip) return;
  await db.$disconnect();
});

describe("loadConfirmedTendencies — real-Postgres regression for the STILL LEARNING bug", { skip }, () => {
  it("a CONFIRMED tendency with customerFeedback: null (the normal, unreacted-to state) is returned, not silently dropped", async () => {
    const customer = await db.customer.create({ data: { shopifyCustomerId: "journey-confirmed-null" } });
    await db.styleTendency.create({ data: tendencyRow(customer.id) });

    const { confirmed, candidateCount } = await loadConfirmedTendencies(customer.id);

    assert.equal(confirmed.length, 1, "a real CONFIRMED row must come back — this is the exact bug: it used to return 0");
    assert.equal(confirmed[0].dimension, "comfort");
    assert.equal(candidateCount, 0);
  });

  it("a CANDIDATE tendency with customerFeedback: null is counted, not silently dropped", async () => {
    const customer = await db.customer.create({ data: { shopifyCustomerId: "journey-candidate-null" } });
    await db.styleTendency.create({
      data: tendencyRow(customer.id, { state: "CANDIDATE", observationKey: "tendency-v1|fit:fit", dimension: "fit", value: "fit" }),
    });

    const { confirmed, candidateCount } = await loadConfirmedTendencies(customer.id);

    assert.equal(confirmed.length, 0);
    assert.equal(candidateCount, 1, "a real CANDIDATE row must be counted — it was also silently dropped by the same bug");
  });

  it("no CANDIDATE or CONFIRMED tendencies at all → both empty, exactly the genuine STILL LEARNING state", async () => {
    const customer = await db.customer.create({ data: { shopifyCustomerId: "journey-no-evidence" } });

    const { confirmed, candidateCount } = await loadConfirmedTendencies(customer.id);

    assert.equal(confirmed.length, 0);
    assert.equal(candidateCount, 0);
  });

  it("a REJECTED/'not-quite' tendency remains in the customer's visible Noticing history — assessment changes trust, not visibility", async () => {
    const customer = await db.customer.create({ data: { shopifyCustomerId: "journey-rejected" } });
    await db.styleTendency.create({
      data: tendencyRow(customer.id, { state: "REJECTED", customerFeedback: "not-quite", customerFeedbackAt: new Date() }),
    });

    const { confirmed, candidateCount } = await loadConfirmedTendencies(customer.id);

    assert.equal(confirmed.length, 1, "a 'Not quite' observation must stay visible to the customer, not disappear");
    assert.equal(confirmed[0].state, "REJECTED", "it must still read as REJECTED internally — feedback is never silently promoted back to CONFIRMED");
    assert.equal(confirmed[0].customerFeedback, "not-quite");
    assert.equal(candidateCount, 0);
  });

  it("a SUPPRESSED tendency (evidence contradicted or withdrawn) stays excluded — a different lifecycle case from a customer's 'Not quite'", async () => {
    const customer = await db.customer.create({ data: { shopifyCustomerId: "journey-suppressed" } });
    await db.styleTendency.create({
      data: tendencyRow(customer.id, { state: "SUPPRESSED", observationKey: "tendency-v1|fit:oversized", dimension: "fit", value: "oversized" }),
    });

    const { confirmed, candidateCount } = await loadConfirmedTendencies(customer.id);

    assert.equal(confirmed.length, 0, "SUPPRESSED must never render — its evidence no longer supports it at all");
    assert.equal(candidateCount, 0);
  });

  it("feedback never deletes the underlying row — REJECTED is a state change, the StyleTendency row itself persists", async () => {
    const customer = await db.customer.create({ data: { shopifyCustomerId: "journey-rejected-persists" } });
    const created = await db.styleTendency.create({
      data: tendencyRow(customer.id, { state: "REJECTED", customerFeedback: "not-quite", customerFeedbackAt: new Date() }),
    });

    const stillThere = await db.styleTendency.findUnique({ where: { id: created.id } });
    assert.ok(stillThere, "the row must still exist in the DB after rejection");
    assert.equal(stillThere!.state, "REJECTED");
  });

  it("a CONFIRMED tendency explicitly marked customerFeedback: 'accurate' is still returned (the one real non-null, non-'not-quite' value)", async () => {
    const customer = await db.customer.create({ data: { shopifyCustomerId: "journey-accurate" } });
    await db.styleTendency.create({
      data: tendencyRow(customer.id, { customerFeedback: "accurate", customerFeedbackAt: new Date() }),
    });

    const { confirmed } = await loadConfirmedTendencies(customer.id);

    assert.equal(confirmed.length, 1);
  });
});

describe("loadStrongestConfirmedTendency — same real-Postgres regression, the Overview teaser's query", { skip }, () => {
  it("a CONFIRMED tendency with customerFeedback: null is returned, not silently dropped", async () => {
    const customer = await db.customer.create({ data: { shopifyCustomerId: "journey-overview-null" } });
    await db.styleTendency.create({ data: tendencyRow(customer.id) });

    const strongest = await loadStrongestConfirmedTendency(customer.id);

    assert.ok(strongest, "a real CONFIRMED row must come back — this is the exact bug: it used to return null");
    assert.equal(strongest!.dimension, "comfort");
  });

  it("a CONFIRMED tendency with customerFeedback: 'accurate' is still returned", async () => {
    const customer = await db.customer.create({ data: { shopifyCustomerId: "journey-overview-accurate" } });
    await db.styleTendency.create({
      data: tendencyRow(customer.id, { customerFeedback: "accurate", customerFeedbackAt: new Date() }),
    });

    const strongest = await loadStrongestConfirmedTendency(customer.id);

    assert.ok(strongest);
  });

  it("a CONFIRMED tendency with customerFeedback: 'not-quite' (REJECTED in practice, but checked here at the raw state level) stays excluded", async () => {
    const customer = await db.customer.create({ data: { shopifyCustomerId: "journey-overview-rejected" } });
    await db.styleTendency.create({
      data: tendencyRow(customer.id, { customerFeedback: "not-quite", customerFeedbackAt: new Date() }),
    });

    const strongest = await loadStrongestConfirmedTendency(customer.id);

    assert.equal(strongest, null, "a 'not-quite' row must never surface as the strongest tendency");
  });

  it("no CONFIRMED tendencies at all → null", async () => {
    const customer = await db.customer.create({ data: { shopifyCustomerId: "journey-overview-none" } });

    const strongest = await loadStrongestConfirmedTendency(customer.id);

    assert.equal(strongest, null);
  });
});
