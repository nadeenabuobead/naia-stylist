// app/lib/clerk-session.test.ts
//
// getCurrentNaiaCustomer/requireCurrentNaiaCustomer, now Clerk-backed.
// Same contract naia-session-db-resilience.test.ts established for the old
// cookie-based implementation: a transient DB failure while resolving the
// Customer row must throw DatabaseUnavailableError, never collapse into
// "not signed in" — see that file's own header comment for the original
// regression. Run: npx vitest run app/lib/clerk-session.test.ts

import { describe, it, expect, vi, beforeEach } from "vitest";

const { findUniqueMock } = vi.hoisted(() => ({ findUniqueMock: vi.fn() }));

vi.mock("~/db.server", () => ({
  default: { customer: { findUnique: findUniqueMock } },
}));

import {
  getCurrentNaiaCustomer,
  requireCurrentNaiaCustomer,
  resolveClerkUserId,
  DatabaseUnavailableError,
} from "./clerk-session.server";

beforeEach(() => {
  vi.clearAllMocks();
});

function fakeClerkClient(authResult: { isAuthenticated: boolean; userId: string | null }) {
  return {
    authenticateRequest: vi.fn().mockResolvedValue({
      toAuth: () => authResult,
    }),
  };
}

function prismaKnownError(code: string, message: string) {
  const error = new Error(message) as Error & { code: string };
  error.code = code;
  return error;
}

function prismaPoolTimeoutError() {
  const error = new Error(
    "Timed out fetching a new connection from the connection pool. More info: http://pris.ly/d/connection-pool",
  );
  error.name = "PrismaClientInitializationError";
  return error;
}

describe("resolveClerkUserId", () => {
  it("no valid Clerk session — returns null", async () => {
    const client = fakeClerkClient({ isAuthenticated: false, userId: null });
    const result = await resolveClerkUserId(new Request("https://naia.example/closet"), { _clerkClient: client });
    expect(result).toBeNull();
  });

  it("a valid Clerk session — returns the Clerk userId", async () => {
    const client = fakeClerkClient({ isAuthenticated: true, userId: "clerk_abc123" });
    const result = await resolveClerkUserId(new Request("https://naia.example/closet"), { _clerkClient: client });
    expect(result).toBe("clerk_abc123");
  });
});

describe("getCurrentNaiaCustomer — no Clerk session vs. unlinked vs. database unavailable are different states", () => {
  it("no Clerk session at all — returns null, no DB call (normal unauthenticated path)", async () => {
    const client = fakeClerkClient({ isAuthenticated: false, userId: null });
    const result = await getCurrentNaiaCustomer(new Request("https://naia.example/closet"), { _clerkClient: client });
    expect(result).toBeNull();
    expect(findUniqueMock).not.toHaveBeenCalled();
  });

  it("authenticated with Clerk but no linked Customer row yet — returns null, NOT an error (mid sign-up / pending identity link)", async () => {
    const client = fakeClerkClient({ isAuthenticated: true, userId: "clerk_new_1" });
    findUniqueMock.mockResolvedValue(null);
    const result = await getCurrentNaiaCustomer(new Request("https://naia.example/closet"), { _clerkClient: client });
    expect(result).toBeNull();
    expect(findUniqueMock).toHaveBeenCalledWith({ where: { clerkUserId: "clerk_new_1" }, include: { onboardingProfile: true } });
  });

  it("authenticated with Clerk and linked — returns the Customer row", async () => {
    const client = fakeClerkClient({ isAuthenticated: true, userId: "clerk_linked_1" });
    const customer = { id: "cust-1", clerkUserId: "clerk_linked_1", onboardingProfile: null };
    findUniqueMock.mockResolvedValue(customer);
    const result = await getCurrentNaiaCustomer(new Request("https://naia.example/closet"), { _clerkClient: client });
    expect(result).toBe(customer);
  });

  it("MISCLASSIFICATION REGRESSION — a transient P1001 while resolving the Customer row throws DatabaseUnavailableError, never returned as null", async () => {
    const client = fakeClerkClient({ isAuthenticated: true, userId: "clerk_linked_1" });
    findUniqueMock.mockRejectedValue(prismaKnownError("P1001", "Can't reach database server"));
    await expect(
      getCurrentNaiaCustomer(new Request("https://naia.example/closet"), { _clerkClient: client }),
    ).rejects.toBeInstanceOf(DatabaseUnavailableError);
  });

  it("MISCLASSIFICATION REGRESSION — a connection-pool timeout also throws DatabaseUnavailableError, never null", async () => {
    const client = fakeClerkClient({ isAuthenticated: true, userId: "clerk_linked_1" });
    findUniqueMock.mockRejectedValue(prismaPoolTimeoutError());
    await expect(
      getCurrentNaiaCustomer(new Request("https://naia.example/closet"), { _clerkClient: client }),
    ).rejects.toBeInstanceOf(DatabaseUnavailableError);
  });

  it("an unrelated, non-connectivity error is rethrown unchanged — not wrapped, not swallowed to null", async () => {
    const client = fakeClerkClient({ isAuthenticated: true, userId: "clerk_linked_1" });
    const weirdError = new TypeError("something unrelated broke");
    findUniqueMock.mockRejectedValue(weirdError);
    await expect(
      getCurrentNaiaCustomer(new Request("https://naia.example/closet"), { _clerkClient: client }),
    ).rejects.toBe(weirdError);
  });
});

describe("requireCurrentNaiaCustomer — redirects to /sign-in, never the old Shopify login path", () => {
  it("no session — redirects to /sign-in with return_to set, not /auth/shopify/login", async () => {
    const client = fakeClerkClient({ isAuthenticated: false, userId: null });
    const rejection = await requireCurrentNaiaCustomer(new Request("https://naia.example/closet"), {
      _clerkClient: client,
    }).catch((e) => e);
    expect(rejection).toBeInstanceOf(Response);
    expect(rejection.status).toBe(302);
    expect(rejection.headers.get("Location")).toBe("/sign-in?return_to=%2Fcloset");
  });

  it("valid session, linked customer — resolves to the customer, no redirect thrown", async () => {
    const client = fakeClerkClient({ isAuthenticated: true, userId: "clerk_linked_1" });
    const customer = { id: "cust-1" };
    findUniqueMock.mockResolvedValue(customer);
    const result = await requireCurrentNaiaCustomer(new Request("https://naia.example/closet"), {
      _clerkClient: client,
    });
    expect(result).toBe(customer);
  });

  it("MISCLASSIFICATION REGRESSION — a DB-unavailable error must never become a /sign-in redirect", async () => {
    const client = fakeClerkClient({ isAuthenticated: true, userId: "clerk_linked_1" });
    findUniqueMock.mockRejectedValue(prismaKnownError("P1001", "Can't reach database server"));
    const rejection = await requireCurrentNaiaCustomer(new Request("https://naia.example/closet"), {
      _clerkClient: client,
    }).catch((e) => e);
    expect(rejection).toBeInstanceOf(DatabaseUnavailableError);
    expect(rejection).not.toHaveProperty("status", 302);
  });
});
