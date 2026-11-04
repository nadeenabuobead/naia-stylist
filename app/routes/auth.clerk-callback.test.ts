// app/routes/auth.clerk-callback.test.ts
//
// Journey: new registration + returning sign-in with no linked Customer yet.
// Proves routing only — resolveCustomerForClerkSignUp's own behavior is
// covered by identity-linking.test.ts.
// Run: npx vitest run app/routes/auth.clerk-callback.test.ts

import { describe, it, expect, vi, beforeEach } from "vitest";

const { resolveMock } = vi.hoisted(() => ({ resolveMock: vi.fn() }));

vi.mock("~/lib/identity-linking.server", () => ({
  resolveCustomerForClerkSignUp: resolveMock,
}));

const { getAuthMock, getUserMock } = vi.hoisted(() => ({
  getAuthMock: vi.fn(),
  getUserMock: vi.fn(),
}));

vi.mock("@clerk/react-router/server", () => ({
  getAuth: getAuthMock,
  clerkClient: () => ({ users: { getUser: getUserMock } }),
}));

import { loader } from "./auth.clerk-callback";

beforeEach(() => {
  vi.clearAllMocks();
});

function args() {
  return { request: new Request("https://naia.example/auth/clerk-callback"), params: {}, context: {} } as any;
}

describe("auth.clerk-callback loader", () => {
  it("no Clerk session at all — redirects to /sign-in, never calls resolveCustomerForClerkSignUp", async () => {
    getAuthMock.mockResolvedValue({ userId: null });
    const res: any = await loader(args());
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/sign-in");
    expect(resolveMock).not.toHaveBeenCalled();
  });

  it("new registration — resolveCustomerForClerkSignUp reports 'created', lands on /my-naia", async () => {
    getAuthMock.mockResolvedValue({ userId: "clerk_new_1" });
    getUserMock.mockResolvedValue({
      primaryEmailAddress: { emailAddress: "dana@example.com" },
      emailAddresses: [],
      firstName: "Dana",
      lastName: null,
    });
    resolveMock.mockResolvedValue({ status: "created", customerId: "cust-new-1" });

    const res: any = await loader(args());
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/my-naia");
    expect(resolveMock).toHaveBeenCalledWith({
      clerkUserId: "clerk_new_1",
      email: "dana@example.com",
      firstName: "Dana",
      lastName: null,
    });
  });

  it("returning sign-in, already linked — also lands on /my-naia (same route renders the right state either way)", async () => {
    getAuthMock.mockResolvedValue({ userId: "clerk_returning_1" });
    getUserMock.mockResolvedValue({
      primaryEmailAddress: { emailAddress: "returning@example.com" },
      emailAddresses: [],
      firstName: null,
      lastName: null,
    });
    resolveMock.mockResolvedValue({ status: "already-linked", customerId: "cust-1" });

    const res: any = await loader(args());
    expect(res.headers.get("Location")).toBe("/my-naia");
  });

  it("identity collision — routes to /account/link-identity, not straight into the app", async () => {
    getAuthMock.mockResolvedValue({ userId: "clerk_claimant_1" });
    getUserMock.mockResolvedValue({
      primaryEmailAddress: { emailAddress: "legacy@example.com" },
      emailAddresses: [],
    });
    resolveMock.mockResolvedValue({ status: "link-pending" });

    const res: any = await loader(args());
    expect(res.headers.get("Location")).toBe("/account/link-identity");
  });

  it("email already linked to a different Clerk identity — bounces back to sign-in with an error flag, never into the app", async () => {
    getAuthMock.mockResolvedValue({ userId: "clerk_new_2" });
    getUserMock.mockResolvedValue({
      primaryEmailAddress: { emailAddress: "weird@example.com" },
      emailAddresses: [],
    });
    resolveMock.mockResolvedValue({ status: "email-conflict" });

    const res: any = await loader(args());
    expect(res.headers.get("Location")).toBe("/sign-in?error=email_in_use");
  });
});
