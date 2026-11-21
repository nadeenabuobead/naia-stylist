// app/lib/customer-session-revocation.server.test.ts
//
// 2026-11-21 (H4, closing the real gap) — revokeAllCustomerSessions is the
// orchestrator admin.maintenance.tsx's revoke-customer-sessions intent
// calls. Verifies it actually combines both teardowns (legacy NaiaSession +
// Clerk), correctly treats "no linked Clerk identity" as a real non-error
// outcome, and fails closed (propagates) rather than swallowing a Clerk
// revocation failure into a partial success.
//
// Run: npx vitest run app/lib/customer-session-revocation.server.test.ts

import { describe, it, expect, vi, beforeEach } from "vitest";

const { findUniqueMock } = vi.hoisted(() => ({ findUniqueMock: vi.fn() }));

vi.mock("~/db.server", () => ({
  default: { customer: { findUnique: findUniqueMock } },
}));

vi.mock("./naia-session.server", () => ({
  revokeAllSessionsForCustomer: vi.fn(),
}));

vi.mock("./clerk-session.server", () => ({
  revokeClerkSessionsForCustomer: vi.fn(),
}));

import { revokeAllSessionsForCustomer } from "./naia-session.server";
import { revokeClerkSessionsForCustomer } from "./clerk-session.server";
import { revokeAllCustomerSessions } from "./customer-session-revocation.server";

const mockLegacy = () => revokeAllSessionsForCustomer as ReturnType<typeof vi.fn>;
const mockClerk = () => revokeClerkSessionsForCustomer as ReturnType<typeof vi.fn>;

beforeEach(() => vi.clearAllMocks());

describe("revokeAllCustomerSessions", () => {
  it("revokes both legacy and Clerk sessions when the customer has a linked Clerk identity", async () => {
    findUniqueMock.mockResolvedValueOnce({ clerkUserId: "user_1" });
    mockLegacy().mockResolvedValueOnce({ revokedCount: 2 });
    mockClerk().mockResolvedValueOnce({ revokedCount: 3, alreadyInactiveCount: 0 });

    const result = await revokeAllCustomerSessions("cust-1");

    expect(result).toEqual({ legacyRevokedCount: 2, clerkRevokedCount: 3, clerkLinked: true });
    expect(mockLegacy()).toHaveBeenCalledWith("cust-1");
    expect(mockClerk()).toHaveBeenCalledWith("user_1");
  });

  it("skips Clerk revocation entirely — not an error — when the customer has no linked Clerk identity", async () => {
    findUniqueMock.mockResolvedValueOnce({ clerkUserId: null });
    mockLegacy().mockResolvedValueOnce({ revokedCount: 1 });

    const result = await revokeAllCustomerSessions("cust-legacy-only");

    expect(result).toEqual({ legacyRevokedCount: 1, clerkRevokedCount: 0, clerkLinked: false });
    expect(mockClerk()).not.toHaveBeenCalled();
  });

  it("skips Clerk revocation for an unknown customerId the same way — reports 0/0 honestly, not an error", async () => {
    findUniqueMock.mockResolvedValueOnce(null);
    mockLegacy().mockResolvedValueOnce({ revokedCount: 0 });

    const result = await revokeAllCustomerSessions("typo-id");

    expect(result).toEqual({ legacyRevokedCount: 0, clerkRevokedCount: 0, clerkLinked: false });
    expect(mockClerk()).not.toHaveBeenCalled();
  });

  it("still runs the legacy teardown even when the customer turns out to have a Clerk identity", async () => {
    findUniqueMock.mockResolvedValueOnce({ clerkUserId: "user_1" });
    mockLegacy().mockResolvedValueOnce({ revokedCount: 0 });
    mockClerk().mockResolvedValueOnce({ revokedCount: 0, alreadyInactiveCount: 0 });

    await revokeAllCustomerSessions("cust-1");

    expect(mockLegacy()).toHaveBeenCalled();
  });

  it("fails closed — propagates, not swallowed — when Clerk revocation throws", async () => {
    findUniqueMock.mockResolvedValueOnce({ clerkUserId: "user_1" });
    mockLegacy().mockResolvedValueOnce({ revokedCount: 2 });
    mockClerk().mockRejectedValueOnce(new Error("Clerk API unreachable"));

    await expect(revokeAllCustomerSessions("cust-1")).rejects.toThrow("Clerk API unreachable");
    // The legacy teardown already ran and its effect is real and kept —
    // this assertion documents that it was called, not that it's undone.
    expect(mockLegacy()).toHaveBeenCalled();
  });

  it("fails closed — propagates — when the legacy NaiaSession teardown itself throws", async () => {
    findUniqueMock.mockResolvedValueOnce({ clerkUserId: "user_1" });
    mockLegacy().mockRejectedValueOnce(new Error("db down"));

    await expect(revokeAllCustomerSessions("cust-1")).rejects.toThrow("db down");
    expect(mockClerk()).not.toHaveBeenCalled();
  });
});
