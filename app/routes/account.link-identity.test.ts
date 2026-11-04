// app/routes/account.link-identity.test.ts
//
// The verification-code confirmation UI's action — confirmIdentityLink's
// own behavior is covered by identity-linking.test.ts; this proves the
// route wires status -> redirect/response correctly.
// Run: npx vitest run app/routes/account.link-identity.test.ts

import { describe, it, expect, vi, beforeEach } from "vitest";

const { confirmMock, abandonMock } = vi.hoisted(() => ({
  confirmMock: vi.fn(),
  abandonMock: vi.fn(),
}));

vi.mock("~/lib/identity-linking.server", () => ({
  confirmIdentityLink: confirmMock,
  abandonIdentityLink: abandonMock,
}));

const { getAuthMock } = vi.hoisted(() => ({ getAuthMock: vi.fn() }));
vi.mock("@clerk/react-router/server", () => ({ getAuth: getAuthMock }));

import { action, loader } from "./account.link-identity";

beforeEach(() => {
  vi.clearAllMocks();
});

function postArgs(formFields: Record<string, string>) {
  const body = new URLSearchParams(formFields);
  return {
    request: new Request("https://naia.example/account/link-identity", {
      method: "POST",
      body,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    }),
    params: {},
    context: {},
  } as any;
}

describe("account.link-identity loader", () => {
  it("no Clerk session — redirects to /sign-in", async () => {
    getAuthMock.mockResolvedValue({ userId: null });
    const res: any = await loader({ request: new Request("https://naia.example/account/link-identity"), params: {}, context: {} } as any);
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/sign-in");
  });
});

describe("account.link-identity action", () => {
  it("correct code — confirms the link and redirects straight into the app", async () => {
    getAuthMock.mockResolvedValue({ userId: "clerk_claimant_1" });
    confirmMock.mockResolvedValue({ status: "confirmed", customerId: "cust-legacy-1" });

    const res: any = await action(postArgs({ code: "482913" }));
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/my-naia");
    expect(confirmMock).toHaveBeenCalledWith({ clerkUserId: "clerk_claimant_1", code: "482913" });
  });

  it("incorrect code — returns the error status, no redirect, request stays pending for another attempt", async () => {
    getAuthMock.mockResolvedValue({ userId: "clerk_claimant_1" });
    confirmMock.mockResolvedValue({ status: "incorrect-code" });

    const result = await action(postArgs({ code: "000000" }));
    expect(result).toEqual({ error: "incorrect-code" });
  });

  it("expired request — returns the error status, not a silent success", async () => {
    getAuthMock.mockResolvedValue({ userId: "clerk_claimant_1" });
    confirmMock.mockResolvedValue({ status: "expired" });

    const result = await action(postArgs({ code: "482913" }));
    expect(result).toEqual({ error: "expired" });
  });

  it("'this isn't me' — abandons the pending request and sends them back to sign-in, never confirms anything", async () => {
    getAuthMock.mockResolvedValue({ userId: "clerk_claimant_1" });

    const res: any = await action(postArgs({ intent: "abandon" }));
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/sign-in");
    expect(abandonMock).toHaveBeenCalledWith({ clerkUserId: "clerk_claimant_1" });
    expect(confirmMock).not.toHaveBeenCalled();
  });
});
