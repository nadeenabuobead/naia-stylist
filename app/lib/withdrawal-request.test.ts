// app/lib/withdrawal-request.test.ts
//
// EU statutory right-of-withdrawal REQUEST capture — Legal handoff W2.
// Run: npx vitest run app/lib/withdrawal-request.test.ts

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/db.server", () => ({
  default: {
    subscription: { findFirst: vi.fn() },
    withdrawalRequest: { create: vi.fn(), findMany: vi.fn(), findFirst: vi.fn() },
  },
}));

import prisma from "~/db.server";
import { submitWithdrawalRequest, getWithdrawalRequestsForCustomer } from "./withdrawal-request.server";

const mockFindSubscription = () => (prisma as any).subscription.findFirst as ReturnType<typeof vi.fn>;
const mockCreateRequest = () => (prisma as any).withdrawalRequest.create as ReturnType<typeof vi.fn>;
const mockFindManyRequests = () => (prisma as any).withdrawalRequest.findMany as ReturnType<typeof vi.fn>;
const mockFindOpenRequest = () => (prisma as any).withdrawalRequest.findFirst as ReturnType<typeof vi.fn>;

function referenceCollision() {
  return Object.assign(new Error("Unique constraint failed"), { code: "P2002", meta: { target: ["reference"] } });
}

const NOW = new Date("2026-11-17T09:30:00.000Z");

beforeEach(() => {
  vi.clearAllMocks();
  // Default: no pre-existing open request, so the duplicate-guard path is
  // opt-in per test rather than silently active everywhere.
  mockFindOpenRequest().mockResolvedValue(null);
});

describe("submitWithdrawalRequest", () => {
  it("creates exactly one WithdrawalRequest row, nothing else — never touches Subscription", async () => {
    mockFindSubscription().mockResolvedValue({ id: "sub-1" });
    mockCreateRequest().mockResolvedValue({ id: "wr-1", reference: "WD-20261117-ABC123", submittedAt: NOW });

    const result = await submitWithdrawalRequest(
      { customerId: "cust-1", customerEmailAtRequest: "a@example.com", customerNameAtRequest: "A Customer" },
      { _now: () => NOW, _generateReferenceSuffix: () => "ABC123" },
    );

    expect(result).toEqual({ id: "wr-1", reference: "WD-20261117-ABC123", submittedAt: NOW, isNewSubmission: true });
    expect(mockCreateRequest()).toHaveBeenCalledTimes(1);
    const createArgs = mockCreateRequest().mock.calls[0][0];
    expect(createArgs.data).toEqual({
      customerId: "cust-1",
      subscriptionId: "sub-1",
      customerEmailAtRequest: "a@example.com",
      customerNameAtRequest: "A Customer",
      reference: "WD-20261117-ABC123",
      submittedAt: NOW,
    });
    // No Subscription field is ever written — only read, via findFirst.
    expect((prisma as any).subscription.findFirst).toHaveBeenCalledWith({
      where: { customerId: "cust-1" },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    expect(Object.keys((prisma as any).subscription)).not.toContain("update");
  });

  it("links to no subscription (null) when the customer has never had one — does not fail or fabricate an id", async () => {
    mockFindSubscription().mockResolvedValue(null);
    mockCreateRequest().mockResolvedValue({ id: "wr-2", reference: "WD-20261117-XYZ999", submittedAt: NOW });

    await submitWithdrawalRequest(
      { customerId: "cust-2", customerEmailAtRequest: "b@example.com" },
      { _now: () => NOW, _generateReferenceSuffix: () => "XYZ999" },
    );

    const createArgs = mockCreateRequest().mock.calls[0][0];
    expect(createArgs.data.subscriptionId).toBeNull();
  });

  it("the reference follows the WD-YYYYMMDD-XXXXXX shape, built from the real submission date", async () => {
    mockFindSubscription().mockResolvedValue(null);
    mockCreateRequest().mockImplementation(async ({ data }: any) => ({
      id: "wr-3",
      reference: data.reference,
      submittedAt: data.submittedAt,
    }));

    const result = await submitWithdrawalRequest(
      { customerId: "cust-3", customerEmailAtRequest: "c@example.com" },
      { _now: () => NOW, _generateReferenceSuffix: () => "QQQQQQ" },
    );

    expect(result.reference).toBe("WD-20261117-QQQQQQ");
  });

  it("retries on a reference collision (P2002 on the reference index) rather than failing the whole submission", async () => {
    mockFindSubscription().mockResolvedValue(null);
    mockCreateRequest()
      .mockRejectedValueOnce(referenceCollision())
      .mockResolvedValueOnce({ id: "wr-4", reference: "WD-20261117-RETRY2", submittedAt: NOW });

    const suffixes = ["RETRY1", "RETRY2"];
    let i = 0;
    const result = await submitWithdrawalRequest(
      { customerId: "cust-4", customerEmailAtRequest: "d@example.com" },
      { _now: () => NOW, _generateReferenceSuffix: () => suffixes[i++] },
    );

    expect(mockCreateRequest()).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ id: "wr-4", reference: "WD-20261117-RETRY2", submittedAt: NOW, isNewSubmission: true });
  });

  it("a non-collision error propagates immediately — never silently swallowed by the retry loop", async () => {
    mockFindSubscription().mockResolvedValue(null);
    mockCreateRequest().mockRejectedValue(new Error("DB is down"));

    await expect(
      submitWithdrawalRequest({ customerId: "cust-5", customerEmailAtRequest: "e@example.com" }, { _now: () => NOW }),
    ).rejects.toThrow("DB is down");
    expect(mockCreateRequest()).toHaveBeenCalledTimes(1);
  });
});

describe("submitWithdrawalRequest — duplicate-submission guard (2026-11-17 follow-up)", () => {
  it("an already-open request is returned as-is — no new row created, isNewSubmission: false", async () => {
    mockFindOpenRequest().mockResolvedValue({ id: "wr-open-1", reference: "WD-20261117-OPEN01", submittedAt: NOW });

    const result = await submitWithdrawalRequest(
      { customerId: "cust-dup-1", customerEmailAtRequest: "f@example.com" },
      { _now: () => NOW },
    );

    expect(result).toEqual({ id: "wr-open-1", reference: "WD-20261117-OPEN01", submittedAt: NOW, isNewSubmission: false });
    expect(mockCreateRequest()).not.toHaveBeenCalled();
    // Doesn't even bother looking up a subscription for a request it's not creating.
    expect(mockFindSubscription()).not.toHaveBeenCalled();
  });

  it("the open-request lookup is scoped to this customer and excludes CLOSED requests (via the server's own query, asserted on getWithdrawalRequestsForCustomer's sibling call shape)", async () => {
    mockFindOpenRequest().mockResolvedValue(null);
    mockFindSubscription().mockResolvedValue(null);
    mockCreateRequest().mockResolvedValue({ id: "wr-5", reference: "WD-20261117-NEWONE", submittedAt: NOW });

    await submitWithdrawalRequest({ customerId: "cust-dup-2", customerEmailAtRequest: "g@example.com" }, { _now: () => NOW });

    expect(mockFindOpenRequest()).toHaveBeenCalledWith({
      where: { customerId: "cust-dup-2", status: { not: "CLOSED" } },
      orderBy: { submittedAt: "desc" },
      select: { id: true, reference: true, submittedAt: true },
    });
  });

  it("a true concurrent-race P2002 (the DB-level partial unique index, not the reference index) re-fetches and returns the now-existing open request instead of retrying blindly", async () => {
    mockFindSubscription().mockResolvedValue(null);
    const raceCollision = Object.assign(new Error("Unique constraint failed"), {
      code: "P2002",
      meta: { target: ["customerId"] }, // the one-open-per-customer partial index, not "reference"
    });
    mockCreateRequest().mockRejectedValueOnce(raceCollision);
    // The concurrent submission that won the race is now visible on re-read.
    mockFindOpenRequest()
      .mockResolvedValueOnce(null) // first check, before our own create attempt
      .mockResolvedValueOnce({ id: "wr-won-race", reference: "WD-20261117-RACE01", submittedAt: NOW }); // re-check after the P2002

    const result = await submitWithdrawalRequest(
      { customerId: "cust-dup-3", customerEmailAtRequest: "h@example.com" },
      { _now: () => NOW },
    );

    expect(result).toEqual({ id: "wr-won-race", reference: "WD-20261117-RACE01", submittedAt: NOW, isNewSubmission: false });
    expect(mockCreateRequest()).toHaveBeenCalledTimes(1); // never blindly retried the create
  });
});

describe("getWithdrawalRequestsForCustomer", () => {
  it("queries by customerId only, newest first", async () => {
    mockFindManyRequests().mockResolvedValue([]);
    await getWithdrawalRequestsForCustomer("cust-6");
    expect(mockFindManyRequests()).toHaveBeenCalledWith({
      where: { customerId: "cust-6" },
      orderBy: { submittedAt: "desc" },
    });
  });
});
