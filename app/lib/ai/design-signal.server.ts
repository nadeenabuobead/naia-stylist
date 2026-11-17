// app/lib/ai/design-signal.server.ts
//
// Who is eligible to contribute design evidence, enforced at the QUERY layer.
//
// 2026-11-17 (Legal/Security containment — lawful-basis question still open):
// this previously selected every real customer unconditionally, with the
// comment below stating that aggregated contribution "is part of normal
// nAia operation... no longer a separate per-customer opt-in" — that is a
// product-policy claim, not a legal conclusion, and no Founder/Legal
// decision establishing a lawful basis for processing every customer's
// data this way is on record. This module was already dormant (nothing in
// this codebase calls eligibleCustomerIds/eligiblePopulation outside this
// file's own test — "the view itself is not being built," per the original
// comment below), so nothing customer-visible changes today. The fix is
// here anyway, at the query layer, so that whenever a real caller IS wired
// up, it inherits a fail-closed default rather than the unconditional one.
//
// ELIGIBLE_WHERE now ALSO requires designResearchConsent: true (schema
// default: false, and — confirmed via grep — not currently written true by
// any active code path anywhere in this codebase). Until a real consent
// mechanism exists and actually sets it, this query returns ZERO eligible
// customers. That emptiness is the point: it is a containment measure, not
// a claim that flipping this one field would make the processing lawful on
// its own — Legal/Founder must still determine the right lawful basis (and
// whatever consent/disclosure mechanism follows from that) before anyone is
// ever included again. See the companion Legal evidence pack for the full
// writeup; nothing here is a substitute for that decision.
//
// Filters, in the `where` clause rather than applied after loading:
//
//   accountType            — our own test, demo and QA accounts never reach
//                             customer insight.
//   designResearchConsent  — fail-closed gate added above; see the note.
//
// This does not change what a designer view may ever see: ids only,
// aggregated, never names/emails/Closet photographs — see
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

/** Retained for any historical consent record still on file. Still not
 * written by any active code path — see the 2026-11-17 note above. */
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
  designResearchConsent: true,
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

