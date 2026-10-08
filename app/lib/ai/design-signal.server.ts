// app/lib/ai/design-signal.server.ts
//
// Who is eligible to contribute design evidence, enforced at the QUERY layer.
//
// One filter, in the `where` clause rather than applied after loading:
//
//   accountType  — our own test, demo and QA accounts never reach customer
//                  insight.
//
// Aggregated/coarsened design-pattern contribution is part of normal nAia
// operation for every real customer — it is no longer a separate per-customer
// opt-in (that toggle, and its designResearchConsent gate, were removed from
// Settings; see settings.tsx). This does not change what a designer view may
// ever see: ids only, aggregated, never names/emails/Closet photographs — see
// eligibleCustomerIds() below and §DS-4 in design-signal.test.ts for the
// boundary that still holds regardless of eligibility.
//
// Filtering in the UI instead would mean a row had already been read, joined
// and held in memory, and one missed filter in one view would expose it.
// Doing it here means only eligible rows are ever fetched.
//
// NOTHING IS AGGREGATED HERE YET. This is the plumbing the future designer view
// will call; the view itself is not being built.

import prisma from "~/db.server";

/** Retained for any historical consent record still on file; no longer read
 * by ELIGIBLE_WHERE. Not currently written by any active code path. */
export const CONSENT_VERSION = "2026-09-28.1";

type EligibleCustomer = { id: string };

const db = prisma as unknown as {
  customer: {
    findMany(args: unknown): Promise<EligibleCustomer[]>;
    count(args: unknown): Promise<number>;
  };
};

/**
 * The only `where` clause permitted to select customers for design research.
 *
 * Exported so the boundary test can assert every query uses it, rather than
 * each call site hand-rolling a filter that quietly drifts.
 */
export const ELIGIBLE_WHERE = {
  accountType: "CUSTOMER",
} as const;

/**
 * Customers who may contribute to aggregated design evidence.
 *
 * Returns ids only. A designer view works from aggregates; it has no business
 * holding names, emails or Closet photographs, and removing a name from a
 * detailed wardrobe profile does not make that profile anonymous.
 */
export async function eligibleCustomerIds(): Promise<string[]> {
  const rows = await db.customer.findMany({
    where: ELIGIBLE_WHERE,
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

/**
 * The denominator. A count with no population behind it says nothing, so this
 * is fetched alongside every aggregate rather than left to the caller.
 */
export async function eligiblePopulation(): Promise<{ eligible: number; allCustomers: number }> {
  const [eligible, allCustomers] = await Promise.all([
    db.customer.count({ where: ELIGIBLE_WHERE }),
    db.customer.count({ where: { accountType: "CUSTOMER" } }),
  ]);
  return { eligible, allCustomers };
}

