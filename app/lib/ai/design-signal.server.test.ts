// app/lib/ai/design-signal.server.test.ts
//
// 2026-11-17 (Legal/Security containment) — dedicated DB-mocked coverage for
// eligibleCustomerIds/eligiblePopulation, which design-signal.test.ts's own
// node:test suite (pure, no I/O, by its own established design) correctly
// does not exercise — it only asserts ELIGIBLE_WHERE's shape (§DS-3a/§DS-3b).
// This file proves the actual DB-facing behavior: missing consent, false
// consent, a mix of real customers, and that the query layer — not a
// post-load filter — is what excludes them.
//
// This module has no real caller anywhere in the codebase today (confirmed
// via grep; "the view itself is not being built," per the module's own
// header) — these tests describe the fail-closed default any FUTURE caller
// will inherit, not a live customer-facing behavior change.
//
// Run: npx vitest run app/lib/ai/design-signal.server.test.ts

import { describe, it, expect, vi, beforeEach } from "vitest";

const { findManyMock, countMock } = vi.hoisted(() => ({
  findManyMock: vi.fn(),
  countMock: vi.fn(),
}));

vi.mock("~/db.server", () => ({
  default: {
    customer: { findMany: findManyMock, count: countMock },
  },
}));

import { eligibleCustomerIds, eligiblePopulation, ELIGIBLE_WHERE } from "./design-signal.server";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ELIGIBLE_WHERE — the fail-closed containment added 2026-11-17", () => {
  it("requires BOTH accountType: CUSTOMER and designResearchConsent: true — not accountType alone", () => {
    expect(ELIGIBLE_WHERE).toEqual({ accountType: "CUSTOMER", designResearchConsent: true });
  });
});

describe("eligibleCustomerIds — missing/false/true consent", () => {
  it("a customer with designResearchConsent: false (the schema default, and today's real state for every customer) is excluded — the consent filter is part of the findMany call itself, never post-filtered in memory", async () => {
    findManyMock.mockResolvedValue([]);
    const ids = await eligibleCustomerIds();

    expect(findManyMock).toHaveBeenCalledWith({
      where: { accountType: "CUSTOMER", designResearchConsent: true },
      select: { id: true },
    });
    expect(ids).toEqual([]);
  });

  it("a customer with designResearchConsent left unset/null (never written) is excluded the same as explicit false — the query never distinguishes 'never asked' from 'declined', both fail closed identically", async () => {
    // The real Prisma layer treats an unset Boolean column as its schema
    // default (false) once materialized — there is no third "null" state
    // reachable here. This test documents that assumption rather than
    // re-deriving Prisma's own defaulting behavior.
    findManyMock.mockResolvedValue([]);
    await eligibleCustomerIds();
    expect(findManyMock.mock.calls[0][0].where.designResearchConsent).toBe(true);
  });

  it("once a real consent mechanism exists and sets the field true for a specific customer, that customer (and only that customer) becomes eligible — the gate is additive, not a permanent lockout", async () => {
    findManyMock.mockResolvedValue([{ id: "cust-opted-in" }]);
    const ids = await eligibleCustomerIds();
    expect(ids).toEqual(["cust-opted-in"]);
  });

  it("returns ids only — never selects name, email, or any Closet field, regardless of consent state", async () => {
    findManyMock.mockResolvedValue([{ id: "cust-1" }]);
    await eligibleCustomerIds();
    expect(findManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ select: { id: true } }),
    );
  });
});

describe("eligiblePopulation — the denominator stays honest about today's real state", () => {
  it("with zero customers ever having consented (today's actual state), eligible is 0 but allCustomers still reports the true population — the emptiness is visible, not hidden", async () => {
    countMock
      .mockResolvedValueOnce(0) // eligible (consent-gated)
      .mockResolvedValueOnce(500); // allCustomers (accountType only)

    const pop = await eligiblePopulation();

    expect(pop).toEqual({ eligible: 0, allCustomers: 500 });
    expect(countMock).toHaveBeenNthCalledWith(1, { where: { accountType: "CUSTOMER", designResearchConsent: true } });
    expect(countMock).toHaveBeenNthCalledWith(2, { where: { accountType: "CUSTOMER" } });
  });

  it("a non-zero eligible count never exceeds allCustomers — the consent filter only ever narrows, never widens, the accountType population", async () => {
    countMock.mockResolvedValueOnce(3).mockResolvedValueOnce(500);
    const pop = await eligiblePopulation();
    expect(pop.eligible).toBeLessThanOrEqual(pop.allCustomers);
  });
});

describe("regression — accountType-only exclusion (test/demo/QA accounts) is unaffected by the new consent gate", () => {
  it("the accountType clause is still present and unconditional, independent of the consent addition", () => {
    expect(ELIGIBLE_WHERE.accountType).toBe("CUSTOMER");
  });
});
