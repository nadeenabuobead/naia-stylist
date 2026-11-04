// app/lib/identity-linking.test.ts
//
// Verified identity linking — the explicit requirement that a new Clerk
// sign-up whose email matches an existing Customer row is NEVER
// auto-attached on email match alone. Run: npx vitest run app/lib/identity-linking.test.ts

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/db.server", () => ({
  default: {
    customer: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    identityLinkRequest: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

import prisma from "~/db.server";
import {
  startIdentityLink,
  confirmIdentityLink,
  abandonIdentityLink,
  resolveCustomerForClerkSignUp,
  LINK_REQUEST_TTL_MS,
  MAX_LINK_ATTEMPTS,
  MAX_CUSTOMER_FAILED_ATTEMPTS,
  CUSTOMER_LOCKOUT_MS,
} from "./identity-linking.server";

const mockFindCustomer = () => (prisma as any).customer.findUnique as ReturnType<typeof vi.fn>;
const mockCreateCustomer = () => (prisma as any).customer.create as ReturnType<typeof vi.fn>;
const mockUpdateCustomer = () => (prisma as any).customer.update as ReturnType<typeof vi.fn>;
const mockFindRequest = () => (prisma as any).identityLinkRequest.findUnique as ReturnType<typeof vi.fn>;
const mockUpsertRequest = () => (prisma as any).identityLinkRequest.upsert as ReturnType<typeof vi.fn>;
const mockUpdateRequest = () => (prisma as any).identityLinkRequest.update as ReturnType<typeof vi.fn>;
const mockDeleteRequest = () => (prisma as any).identityLinkRequest.delete as ReturnType<typeof vi.fn>;
const mockTransaction = () => (prisma as any).$transaction as ReturnType<typeof vi.fn>;

const NOW = new Date("2026-11-04T12:00:00.000Z");
const FIXED_CODE = "482913";

beforeEach(() => {
  vi.clearAllMocks();
  mockTransaction().mockImplementation(async (ops: any[]) => Promise.all(ops));
});

describe("startIdentityLink", () => {
  it("no existing Customer with this email — reports no-collision, sends nothing", async () => {
    mockFindCustomer().mockResolvedValue(null);
    const sendEmail = vi.fn();
    const result = await startIdentityLink(
      { clerkUserId: "clerk_new_1", email: "fresh@example.com" },
      { _sendVerificationEmail: sendEmail },
    );
    expect(result).toEqual({ status: "no-collision" });
    expect(sendEmail).not.toHaveBeenCalled();
    expect(mockUpsertRequest()).not.toHaveBeenCalled();
  });

  it("an existing Customer with this email that's ALREADY linked to a different Clerk user — reports email-already-linked, never opens a link request", async () => {
    mockFindCustomer().mockResolvedValue({ id: "cust-1", email: "taken@example.com", clerkUserId: "clerk_other_user" });
    const sendEmail = vi.fn();
    const result = await startIdentityLink(
      { clerkUserId: "clerk_new_2", email: "taken@example.com" },
      { _sendVerificationEmail: sendEmail },
    );
    expect(result).toEqual({ status: "email-already-linked" });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("an existing, unlinked Customer that's currently locked out — reports locked, never issues a fresh code", async () => {
    mockFindCustomer().mockResolvedValue({
      id: "cust-legacy-1", email: "legacy@example.com", clerkUserId: null,
      identityLinkLockedUntil: new Date(NOW.getTime() + 60_000),
    });
    const sendEmail = vi.fn();
    const result = await startIdentityLink(
      { clerkUserId: "clerk_claimant_1", email: "legacy@example.com" },
      { _now: () => NOW, _sendVerificationEmail: sendEmail },
    );
    expect(result).toEqual({ status: "locked" });
    expect(sendEmail).not.toHaveBeenCalled();
    expect(mockUpsertRequest()).not.toHaveBeenCalled();
  });

  it("an existing, unlinked Customer whose lock has already expired — issues a fresh code normally", async () => {
    mockFindCustomer().mockResolvedValue({
      id: "cust-legacy-1", email: "legacy@example.com", clerkUserId: null,
      identityLinkLockedUntil: new Date(NOW.getTime() - 1),
    });
    mockUpsertRequest().mockResolvedValue({ id: "link-req-1" });
    const result = await startIdentityLink(
      { clerkUserId: "clerk_claimant_1", email: "legacy@example.com" },
      { _now: () => NOW, _generateCode: () => FIXED_CODE, _sendVerificationEmail: vi.fn().mockResolvedValue(undefined) },
    );
    expect(result).toEqual({ status: "pending", identityLinkRequestId: "link-req-1" });
  });

  it("an existing, unlinked Customer with this email — opens a pending link request and emails the code to that address, never auto-attaches", async () => {
    mockFindCustomer().mockResolvedValue({ id: "cust-legacy-1", email: "legacy@example.com", clerkUserId: null });
    mockUpsertRequest().mockResolvedValue({ id: "link-req-1" });
    const sendEmail = vi.fn().mockResolvedValue(undefined);

    const result = await startIdentityLink(
      { clerkUserId: "clerk_claimant_1", email: "legacy@example.com" },
      { _now: () => NOW, _generateCode: () => FIXED_CODE, _sendVerificationEmail: sendEmail },
    );

    expect(result).toEqual({ status: "pending", identityLinkRequestId: "link-req-1" });
    expect(sendEmail).toHaveBeenCalledWith("legacy@example.com", FIXED_CODE);

    const upsertArgs = mockUpsertRequest().mock.calls[0][0];
    expect(upsertArgs.where).toEqual({ clerkUserId: "clerk_claimant_1" });
    expect(upsertArgs.create.customerId).toBe("cust-legacy-1");
    expect(upsertArgs.create.expiresAt.getTime()).toBe(NOW.getTime() + LINK_REQUEST_TTL_MS);
    // The raw code is never persisted — only its hash.
    expect(upsertArgs.create.codeHash).not.toBe(FIXED_CODE);
    expect(JSON.stringify(upsertArgs)).not.toContain(FIXED_CODE);
  });

  it("the email provider throwing (rate-limited, misconfigured, Resend down) reports email-send-failed — never propagates as a raw, uncaught exception", async () => {
    mockFindCustomer().mockResolvedValue({ id: "cust-legacy-1", email: "legacy@example.com", clerkUserId: null });
    mockUpsertRequest().mockResolvedValue({ id: "link-req-1" });
    const sendEmail = vi.fn().mockRejectedValue(new Error("Resend rate limit exceeded"));

    const result = await startIdentityLink(
      { clerkUserId: "clerk_claimant_1", email: "legacy@example.com" },
      { _now: () => NOW, _generateCode: () => FIXED_CODE, _sendVerificationEmail: sendEmail },
    );

    expect(result).toEqual({ status: "email-send-failed" });
  });
});

describe("confirmIdentityLink", () => {
  function pendingRequest(overrides: Partial<Record<string, any>> = {}) {
    return {
      id: "link-req-1",
      clerkUserId: "clerk_claimant_1",
      customerId: "cust-legacy-1",
      codeHash: "4a8eec4925826f4b60526d7ac3c0a9b61ef54ac19233bafce2f4a13eb49395d2", // sha256("482913")
      attemptCount: 0,
      expiresAt: new Date(NOW.getTime() + LINK_REQUEST_TTL_MS),
      confirmedAt: null,
      customer: { identityLinkFailedAttempts: 0, identityLinkLockedUntil: null },
      ...overrides,
    };
  }

  it("no pending request for this Clerk user — not-found", async () => {
    mockFindRequest().mockResolvedValue(null);
    const result = await confirmIdentityLink({ clerkUserId: "clerk_x", code: "000000" }, { _now: () => NOW });
    expect(result).toEqual({ status: "not-found" });
  });

  it("already-confirmed request resolves as not-found, not a second confirmation", async () => {
    mockFindRequest().mockResolvedValue(pendingRequest({ confirmedAt: NOW }));
    const result = await confirmIdentityLink({ clerkUserId: "clerk_claimant_1", code: "482913" }, { _now: () => NOW });
    expect(result).toEqual({ status: "not-found" });
  });

  it("expired request — reports expired and deletes the row", async () => {
    mockFindRequest().mockResolvedValue(pendingRequest({ expiresAt: new Date(NOW.getTime() - 1000) }));
    const result = await confirmIdentityLink({ clerkUserId: "clerk_claimant_1", code: "482913" }, { _now: () => NOW });
    expect(result).toEqual({ status: "expired" });
    expect(mockDeleteRequest()).toHaveBeenCalledWith({ where: { id: "link-req-1" } });
  });

  it("too many prior incorrect attempts (per-request cap) — locked out, row deleted, correct code no longer accepted", async () => {
    mockFindRequest().mockResolvedValue(pendingRequest({ attemptCount: MAX_LINK_ATTEMPTS }));
    const result = await confirmIdentityLink({ clerkUserId: "clerk_claimant_1", code: "482913" }, { _now: () => NOW });
    expect(result).toEqual({ status: "too-many-attempts" });
    expect(mockDeleteRequest()).toHaveBeenCalled();
  });

  it("the TARGET customer is already cross-account-locked when this request was checked — reports locked, not incorrect-code, even before a wrong guess", async () => {
    mockFindRequest().mockResolvedValue(
      pendingRequest({ customer: { identityLinkFailedAttempts: 9, identityLinkLockedUntil: new Date(NOW.getTime() + 60_000) } }),
    );
    const result = await confirmIdentityLink({ clerkUserId: "clerk_claimant_1", code: "482913" }, { _now: () => NOW });
    expect(result).toEqual({ status: "locked" });
    // The correct code was presented — this must not be treated as a confirm.
    expect(mockTransaction()).not.toHaveBeenCalled();
  });

  it("a lock that has already expired no longer blocks — falls through to the normal code check", async () => {
    mockFindRequest().mockResolvedValue(
      pendingRequest({ customer: { identityLinkFailedAttempts: 10, identityLinkLockedUntil: new Date(NOW.getTime() - 1) } }),
    );
    const result = await confirmIdentityLink({ clerkUserId: "clerk_claimant_1", code: "482913" }, { _now: () => NOW });
    expect(result).toEqual({ status: "confirmed", customerId: "cust-legacy-1" });
  });

  it("incorrect code — increments both the per-request attemptCount and the cumulative customer counter, does not delete or confirm", async () => {
    mockFindRequest().mockResolvedValue(pendingRequest({ customer: { identityLinkFailedAttempts: 3, identityLinkLockedUntil: null } }));
    const result = await confirmIdentityLink({ clerkUserId: "clerk_claimant_1", code: "000000" }, { _now: () => NOW });
    expect(result).toEqual({ status: "incorrect-code" });
    expect(mockTransaction()).toHaveBeenCalledTimes(1);
    const ops = mockTransaction().mock.calls[0][0];
    expect(ops).toHaveLength(2);
    expect(mockUpdateRequest()).toHaveBeenCalledWith({
      where: { id: "link-req-1" },
      data: { attemptCount: { increment: 1 } },
    });
    expect(mockUpdateCustomer()).toHaveBeenCalledWith({
      where: { id: "cust-legacy-1" },
      data: { identityLinkFailedAttempts: 4, identityLinkLockedUntil: undefined },
    });
    expect(mockDeleteRequest()).not.toHaveBeenCalled();
  });

  it("CROSS-ACCOUNT BRUTE FORCE — a wrong guess that pushes the cumulative counter over the threshold locks the customer, not just this one request", async () => {
    mockFindRequest().mockResolvedValue(pendingRequest({ customer: { identityLinkFailedAttempts: MAX_CUSTOMER_FAILED_ATTEMPTS - 1, identityLinkLockedUntil: null } }));
    const result = await confirmIdentityLink({ clerkUserId: "clerk_claimant_1", code: "000000" }, { _now: () => NOW });
    expect(result).toEqual({ status: "locked" });
    const ops = mockTransaction().mock.calls[0][0];
    expect(ops).toHaveLength(2);
    expect(mockUpdateCustomer()).toHaveBeenCalledWith({
      where: { id: "cust-legacy-1" },
      data: { identityLinkFailedAttempts: 0, identityLinkLockedUntil: new Date(NOW.getTime() + CUSTOMER_LOCKOUT_MS) },
    });
  });

  it("correct, unexpired code — links the Customer row and deletes the request atomically, never reports success without both", async () => {
    mockFindRequest().mockResolvedValue(pendingRequest());
    const result = await confirmIdentityLink({ clerkUserId: "clerk_claimant_1", code: "482913" }, { _now: () => NOW });
    expect(result).toEqual({ status: "confirmed", customerId: "cust-legacy-1" });
    expect(mockTransaction()).toHaveBeenCalledTimes(1);
    const ops = mockTransaction().mock.calls[0][0];
    expect(ops).toHaveLength(2);
  });
});

describe("abandonIdentityLink", () => {
  it("removes any pending request for this Clerk user", async () => {
    await abandonIdentityLink({ clerkUserId: "clerk_claimant_1" });
    expect((prisma as any).identityLinkRequest.deleteMany).toHaveBeenCalledWith({
      where: { clerkUserId: "clerk_claimant_1" },
    });
  });
});

describe("resolveCustomerForClerkSignUp", () => {
  it("already linked (retried callback) — returns the existing customerId, does not re-run the link flow", async () => {
    mockFindCustomer().mockResolvedValueOnce({ id: "cust-1", clerkUserId: "clerk_1" });
    const result = await resolveCustomerForClerkSignUp({ clerkUserId: "clerk_1", email: "a@example.com" });
    expect(result).toEqual({ status: "already-linked", customerId: "cust-1" });
    expect(mockCreateCustomer()).not.toHaveBeenCalled();
  });

  it("no collision — creates a fresh Customer with only clerkUserId set, no shopifyCustomerId", async () => {
    mockFindCustomer()
      .mockResolvedValueOnce(null) // already-linked check
      .mockResolvedValueOnce(null); // startIdentityLink's own collision check
    mockCreateCustomer().mockResolvedValue({ id: "cust-new-1" });

    const result = await resolveCustomerForClerkSignUp({
      clerkUserId: "clerk_new_1",
      email: "fresh@example.com",
      firstName: "Dana",
    });

    expect(result).toEqual({ status: "created", customerId: "cust-new-1" });
    const createArgs = mockCreateCustomer().mock.calls[0][0];
    expect(createArgs.data).toEqual({
      clerkUserId: "clerk_new_1",
      email: "fresh@example.com",
      firstName: "Dana",
      lastName: null,
    });
    expect(createArgs.data).not.toHaveProperty("shopifyCustomerId");
  });

  it("collision with an unlinked legacy row — reports link-pending, creates no Customer row", async () => {
    mockFindCustomer()
      .mockResolvedValueOnce(null) // already-linked check
      .mockResolvedValueOnce({ id: "cust-legacy-1", email: "legacy@example.com", clerkUserId: null });
    mockUpsertRequest().mockResolvedValue({ id: "link-req-1" });

    const result = await resolveCustomerForClerkSignUp(
      { clerkUserId: "clerk_claimant_1", email: "legacy@example.com" },
      { _sendVerificationEmail: vi.fn().mockResolvedValue(undefined) },
    );

    expect(result).toEqual({ status: "link-pending" });
    expect(mockCreateCustomer()).not.toHaveBeenCalled();
  });

  it("collision with an already-linked row (shouldn't normally happen, defensive) — reports email-conflict, creates nothing", async () => {
    mockFindCustomer()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "cust-other", email: "weird@example.com", clerkUserId: "clerk_someone_else" });

    const result = await resolveCustomerForClerkSignUp({ clerkUserId: "clerk_new_3", email: "weird@example.com" });
    expect(result).toEqual({ status: "email-conflict" });
    expect(mockCreateCustomer()).not.toHaveBeenCalled();
  });

  it("collision with a currently-locked-out legacy row — reports locked, creates nothing", async () => {
    mockFindCustomer()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: "cust-legacy-1", email: "legacy@example.com", clerkUserId: null,
        identityLinkLockedUntil: new Date(NOW.getTime() + 60_000),
      });

    const result = await resolveCustomerForClerkSignUp(
      { clerkUserId: "clerk_claimant_1", email: "legacy@example.com" },
      { _now: () => NOW },
    );
    expect(result).toEqual({ status: "locked" });
    expect(mockCreateCustomer()).not.toHaveBeenCalled();
  });

  it("the verification email fails to send — propagates email-send-failed, creates nothing", async () => {
    mockFindCustomer()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "cust-legacy-1", email: "legacy@example.com", clerkUserId: null });
    mockUpsertRequest().mockResolvedValue({ id: "link-req-1" });

    const result = await resolveCustomerForClerkSignUp(
      { clerkUserId: "clerk_claimant_1", email: "legacy@example.com" },
      { _sendVerificationEmail: vi.fn().mockRejectedValue(new Error("delivery failed")) },
    );
    expect(result).toEqual({ status: "email-send-failed" });
    expect(mockCreateCustomer()).not.toHaveBeenCalled();
  });
});
