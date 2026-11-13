// app/lib/clerk-session-db-resilience.test.ts
//
// Live staging incident (2026-11-13): a customer's Closet save failed with
// the generic error page. Root cause traced to getCurrentNaiaCustomer's
// prisma.customer.findUnique() hitting a P2024 ("Timed out fetching a new
// connection from the connection pool") during a brief upstream outage —
// before this fix, P2024 was NOT in TRANSIENT_PRISMA_ERROR_CODES (the
// classifier assumed pool-timeout errors only ever arrive as a codeless
// PrismaClientInitializationError, which is wrong for this Prisma version,
// 6.19.2 — they arrive as PrismaClientKnownRequestError with a real code).
//
// This file guards two things: the corrected classification, and the new
// bounded single retry — exactly one extra attempt, on the read-only lookup
// alone, never retrying anything that writes/uploads/charges (there is
// nothing else in this function TO retry; the lookup is the only operation).
//
// No live DB available to this test run — prisma is mocked, same convention
// as naia-session-db-resilience.test.ts.
//
// Run: npx vitest run app/lib/clerk-session-db-resilience.test.ts

import { describe, it, expect, vi, beforeEach } from "vitest";

const { findUniqueMock, customerUpdateMock, customerCreateMock, authenticateRequestMock } = vi.hoisted(() => ({
  findUniqueMock: vi.fn(),
  customerUpdateMock: vi.fn(),
  customerCreateMock: vi.fn(),
  authenticateRequestMock: vi.fn(),
}));

vi.mock("~/db.server", () => ({
  default: {
    customer: {
      findUnique: findUniqueMock,
      // Present only so a test can assert these are NEVER called — this
      // function has no business writing anything, but an explicit assertion
      // is cheap insurance against a future change accidentally adding one
      // inside the retried path.
      update: customerUpdateMock,
      create: customerCreateMock,
    },
  },
}));

vi.mock("@clerk/backend", () => ({
  createClerkClient: () => ({
    authenticateRequest: authenticateRequestMock,
  }),
}));

import { getCurrentNaiaCustomer, DatabaseUnavailableError } from "./clerk-session.server";

beforeEach(() => {
  vi.clearAllMocks();
  authenticateRequestMock.mockResolvedValue({
    toAuth: () => ({ isAuthenticated: true, userId: "clerk-user-1" }),
  });
});

function requestForTest() {
  return new Request("https://naia-stylist-staging.vercel.app/closet");
}

function prismaKnownError(code: string, message: string) {
  const error = new Error(message) as Error & { code: string };
  error.code = code;
  return error;
}

function instantSleep() {
  return vi.fn().mockResolvedValue(undefined);
}

describe("getCurrentNaiaCustomer() — P2024 classification fix (2026-11-13 regression)", () => {
  it("MISCLASSIFICATION REGRESSION — P2024 (connection pool timeout, as a real Prisma code) is now treated as transient, not an unrelated crash", async () => {
    const sleep = instantSleep();
    // Exhaust the retry too, so we observe the final classification without
    // depending on the retry succeeding.
    findUniqueMock.mockRejectedValue(
      prismaKnownError("P2024", "Timed out fetching a new connection from the connection pool."),
    );
    await expect(getCurrentNaiaCustomer(requestForTest(), { _sleep: sleep })).rejects.toBeInstanceOf(
      DatabaseUnavailableError,
    );
  });
});

describe("getCurrentNaiaCustomer() — bounded single retry, read-only lookup only", () => {
  it("first attempt hits a transient P2024, retry succeeds — returns the real customer, no error surfaced", async () => {
    const sleep = instantSleep();
    const customer = { id: "cust-1", onboardingProfile: null };
    findUniqueMock
      .mockRejectedValueOnce(prismaKnownError("P2024", "Timed out fetching a new connection from the connection pool."))
      .mockResolvedValueOnce(customer);

    const result = await getCurrentNaiaCustomer(requestForTest(), { _sleep: sleep });

    expect(result).toBe(customer);
    expect(findUniqueMock).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it("retry is bounded to exactly one extra attempt — two transient failures in a row throw, never a third attempt", async () => {
    const sleep = instantSleep();
    findUniqueMock.mockRejectedValue(
      prismaKnownError("P2024", "Timed out fetching a new connection from the connection pool."),
    );

    await expect(getCurrentNaiaCustomer(requestForTest(), { _sleep: sleep })).rejects.toBeInstanceOf(
      DatabaseUnavailableError,
    );
    expect(findUniqueMock).toHaveBeenCalledTimes(2); // original + exactly one retry, not more
  });

  it("a non-transient error is thrown immediately — no retry attempted, no delay", async () => {
    const sleep = instantSleep();
    const weirdError = new TypeError("something unrelated broke");
    findUniqueMock.mockRejectedValue(weirdError);

    await expect(getCurrentNaiaCustomer(requestForTest(), { _sleep: sleep })).rejects.toBe(weirdError);
    expect(findUniqueMock).toHaveBeenCalledTimes(1); // no retry for a non-transient error
    expect(sleep).not.toHaveBeenCalled();
  });

  it("a normal successful lookup never retries or sleeps at all", async () => {
    const sleep = instantSleep();
    const customer = { id: "cust-1", onboardingProfile: null };
    findUniqueMock.mockResolvedValue(customer);

    const result = await getCurrentNaiaCustomer(requestForTest(), { _sleep: sleep });

    expect(result).toBe(customer);
    expect(findUniqueMock).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("SAFETY — the retry never touches any write operation; only the read-only findUnique is ever called, under both outcomes", async () => {
    const sleep = instantSleep();
    findUniqueMock
      .mockRejectedValueOnce(prismaKnownError("P2024", "Timed out fetching a new connection from the connection pool."))
      .mockResolvedValueOnce({ id: "cust-1", onboardingProfile: null });

    await getCurrentNaiaCustomer(requestForTest(), { _sleep: sleep });

    expect(customerUpdateMock).not.toHaveBeenCalled();
    expect(customerCreateMock).not.toHaveBeenCalled();
  });

  it("other known transient Prisma codes (P1001, P1002, P1008, P1017) still retry once then classify the same way", async () => {
    for (const code of ["P1001", "P1002", "P1008", "P1017"]) {
      const sleep = instantSleep();
      findUniqueMock.mockReset();
      findUniqueMock.mockRejectedValue(prismaKnownError(code, "transient"));
      await expect(getCurrentNaiaCustomer(requestForTest(), { _sleep: sleep })).rejects.toBeInstanceOf(
        DatabaseUnavailableError,
      );
      expect(findUniqueMock).toHaveBeenCalledTimes(2);
    }
  });
});
