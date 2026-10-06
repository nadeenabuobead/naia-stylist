// app/lib/ai/design-signal.server.ts
//
// Who is eligible to contribute design evidence, enforced at the QUERY layer.
//
// Two filters, both in the `where` clause rather than applied after loading:
//
//   designResearchConsent  — opt-in, defaulting to false. Declining changes
//                            nothing about the styling service.
//   accountType            — our own test, demo and QA accounts never reach
//                            customer insight.
//
// Filtering in the UI instead would mean a non-consenting customer's data had
// already been read, joined and held in memory, and one missed filter in one
// view would expose it. Doing it here means the rows are never fetched.
//
// NOTHING IS AGGREGATED HERE YET. This is the plumbing the future designer view
// will call; the view itself is not being built.

import prisma from "~/db.server";

/** Bumped when the consent wording changes, which requires asking again. */
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
  designResearchConsent: true,
  designResearchConsentVersion: CONSENT_VERSION,
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

/**
 * Records a customer's decision. Storing the version matters: consent given to
 * one description of the research does not carry to a different one.
 */
export async function recordDesignResearchConsent(input: {
  customerId: string;
  granted: boolean;
}): Promise<void> {
  const { customerId, granted } = input;
  await (prisma as unknown as { customer: { update(args: unknown): Promise<unknown> } }).customer.update({
    where: { id: customerId },
    data: granted
      ? {
          designResearchConsent: true,
          designResearchConsentAt: new Date(),
          designResearchConsentVersion: CONSENT_VERSION,
        }
      : {
          designResearchConsent: false,
          designResearchConsentAt: new Date(),
          designResearchConsentVersion: null,
        },
  });
}
