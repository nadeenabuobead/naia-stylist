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

function args(search = "") {
  return { request: new Request(`https://naia.example/auth/clerk-callback${search}`), params: {}, context: {} } as any;
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

  it("target customer is cross-account locked — routes to link-identity with the locked flag, not a generic pending state", async () => {
    getAuthMock.mockResolvedValue({ userId: "clerk_claimant_2" });
    getUserMock.mockResolvedValue({
      primaryEmailAddress: { emailAddress: "locked@example.com" },
      emailAddresses: [],
    });
    resolveMock.mockResolvedValue({ status: "locked" });

    const res: any = await loader(args());
    expect(res.headers.get("Location")).toBe("/account/link-identity?error=locked");
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

  it("returning sign-in with a valid return_to — honors it instead of the /my-naia default", async () => {
    getAuthMock.mockResolvedValue({ userId: "clerk_returning_1" });
    getUserMock.mockResolvedValue({ primaryEmailAddress: { emailAddress: "returning@example.com" }, emailAddresses: [] });
    resolveMock.mockResolvedValue({ status: "already-linked", customerId: "cust-1" });

    const res: any = await loader(args("?return_to=%2Fcloset"));
    expect(res.headers.get("Location")).toBe("/closet");
  });

  it("returning sign-in with a malicious return_to (open-redirect attempt) — falls back to /my-naia, never redirects off-site", async () => {
    getAuthMock.mockResolvedValue({ userId: "clerk_returning_2" });
    getUserMock.mockResolvedValue({ primaryEmailAddress: { emailAddress: "returning2@example.com" }, emailAddresses: [] });
    resolveMock.mockResolvedValue({ status: "already-linked", customerId: "cust-2" });

    const res: any = await loader(args("?return_to=https%3A%2F%2Fevil.example.com"));
    expect(res.headers.get("Location")).toBe("/my-naia");
  });

  it("2026-11-21 security fix — returning sign-in with a backslash-fronted return_to (/\\example.com) — the Lovable-reported bypass that passed the old check, falls back to /my-naia, never redirects off-site", async () => {
    // WHATWG "special" schemes (http/https) normalize a leading backslash
    // the same as a forward slash, so a real browser would have resolved
    // this as //example.com (protocol-relative) even though the raw string
    // never literally starts with "//" — see validateReturnTo's own
    // comment in shopify-customer-oauth.server.ts for the full explanation
    // and fix. This is this route's own end-to-end proof, on the real,
    // live, primary sign-in sink — not just the shared helper in isolation.
    getAuthMock.mockResolvedValue({ userId: "clerk_returning_3" });
    getUserMock.mockResolvedValue({ primaryEmailAddress: { emailAddress: "returning3@example.com" }, emailAddresses: [] });
    resolveMock.mockResolvedValue({ status: "already-linked", customerId: "cust-3" });

    const res: any = await loader(args("?return_to=" + encodeURIComponent("/\\example.com")));
    expect(res.headers.get("Location")).toBe("/my-naia");
  });

  it("brand-new registration with a return_to present — still lands on /my-naia, not the inherited deep link", async () => {
    getAuthMock.mockResolvedValue({ userId: "clerk_new_3" });
    getUserMock.mockResolvedValue({ primaryEmailAddress: { emailAddress: "fresh2@example.com" }, emailAddresses: [] });
    resolveMock.mockResolvedValue({ status: "created", customerId: "cust-new-2" });

    const res: any = await loader(args("?return_to=%2Fcloset"));
    expect(res.headers.get("Location")).toBe("/my-naia");
  });

  it("verification email failed to send — bounces to sign-in with a retryable error, not the link-identity code-entry page (there's no code to enter)", async () => {
    getAuthMock.mockResolvedValue({ userId: "clerk_claimant_3" });
    getUserMock.mockResolvedValue({ primaryEmailAddress: { emailAddress: "legacy3@example.com" }, emailAddresses: [] });
    resolveMock.mockResolvedValue({ status: "email-send-failed" });

    const res: any = await loader(args());
    expect(res.headers.get("Location")).toBe("/sign-in?error=verification_email_failed");
  });
});
