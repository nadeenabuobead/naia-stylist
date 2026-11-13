// app/routes/admin.billing-overrides.test.ts
// Correctness review (2026-11-13) — the admin-auth-gated operational
// surface for applyAdminRestoreOverride/applyAdminRevokeOverride and
// ManualReviewFlag triage. Mirrors admin.maintenance.test.ts's own
// conventions exactly: mocked internal-auth.server and the two billing
// library modules — no real admin session, no real DB. Verifies both
// loader and action require a valid admin session AND the "owner" role
// specifically; each intent calls the correct function with the session's
// own email as performedBy (never client input); an invalid intent is
// rejected without calling anything; the loader lists what's needed to
// decide whether to override anything.
//
// Run: npx vitest run app/routes/admin.billing-overrides.test.ts

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/internal-auth.server", () => ({
  requireAdminSession: vi.fn().mockResolvedValue({
    authenticated: true,
    identity: { id: "owner", email: "owner@naiabynadine.com", role: "owner" },
  }),
}));

vi.mock("~/lib/billing/admin-revocation-override.server", () => ({
  applyAdminRestoreOverride: vi.fn(),
  applyAdminRevokeOverride: vi.fn(),
  listActiveAccessRevocations: vi.fn().mockResolvedValue([]),
}));

vi.mock("~/lib/billing/manual-review.server", () => ({
  listOpenManualReviewFlags: vi.fn().mockResolvedValue([]),
  resolveManualReviewFlag: vi.fn(),
}));

import { requireAdminSession } from "~/lib/internal-auth.server";
import {
  applyAdminRestoreOverride,
  applyAdminRevokeOverride,
  listActiveAccessRevocations,
} from "~/lib/billing/admin-revocation-override.server";
import { listOpenManualReviewFlags, resolveManualReviewFlag } from "~/lib/billing/manual-review.server";
import { loader, action } from "./admin.billing-overrides";

const mockRequireAdmin = () => requireAdminSession as ReturnType<typeof vi.fn>;
const mockRestore = () => applyAdminRestoreOverride as ReturnType<typeof vi.fn>;
const mockRevoke = () => applyAdminRevokeOverride as ReturnType<typeof vi.fn>;
const mockListActive = () => listActiveAccessRevocations as ReturnType<typeof vi.fn>;
const mockListFlags = () => listOpenManualReviewFlags as ReturnType<typeof vi.fn>;
const mockResolveFlag = () => resolveManualReviewFlag as ReturnType<typeof vi.fn>;

function actionRequest(fields: Record<string, string>) {
  const body = new URLSearchParams(fields);
  return new Request("http://localhost/admin/billing-overrides", {
    method: "POST",
    body,
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
}

beforeEach(() => vi.clearAllMocks());

describe("admin.billing-overrides — session and role requirements", () => {
  it("loader requires an admin session and loads active revocations + open review flags", async () => {
    mockListActive().mockResolvedValue([{ id: "rev-1" }]);
    mockListFlags().mockResolvedValue([{ id: "flag-1" }]);
    const result = await loader({ request: new Request("http://localhost/admin/billing-overrides") } as any);
    expect(mockRequireAdmin()).toHaveBeenCalled();
    expect(result).toEqual({ activeRevocations: [{ id: "rev-1" }], openReviewFlags: [{ id: "flag-1" }] });
  });

  it("loader rejects a non-owner session with 403, never loading anything", async () => {
    mockRequireAdmin().mockResolvedValueOnce({ authenticated: true, identity: { id: "staff-1", email: "staff@x.com", role: "staff" } });
    await expect(loader({ request: new Request("http://localhost/admin/billing-overrides") } as any)).rejects.toMatchObject({ status: 403 });
    expect(mockListActive()).not.toHaveBeenCalled();
  });

  it("action rejects a non-owner session with 403, never calling any override function", async () => {
    mockRequireAdmin().mockResolvedValueOnce({ authenticated: true, identity: { id: "staff-1", email: "staff@x.com", role: "staff" } });
    const request = actionRequest({ intent: "restore-access", subscriptionId: "sub-1", customerId: "cust-1", reason: "x" });
    await expect(action({ request } as any)).rejects.toMatchObject({ status: 403 });
    expect(mockRestore()).not.toHaveBeenCalled();
  });
});

describe("admin.billing-overrides — restore-access", () => {
  it("calls applyAdminRestoreOverride with the session's OWN email as performedBy, never from form input", async () => {
    mockRestore().mockResolvedValue({ ok: true, overrideAuditLogId: "audit-1", resolvedCount: 2 });
    const request = actionRequest({
      intent: "restore-access",
      subscriptionId: "sub-1",
      customerId: "cust-1",
      reason: "Goodwill restore",
      performedBy: "attacker@evil.com", // must be ignored — identity comes from the session, never the form
    });
    const result = await action({ request } as any);
    expect(mockRestore()).toHaveBeenCalledWith({
      subscriptionId: "sub-1",
      customerId: "cust-1",
      performedBy: "owner@naiabynadine.com",
      reason: "Goodwill restore",
    });
    expect(result).toEqual({ ok: true, intent: "restore-access", message: "Restored access for subscription sub-1 — resolved 2 revocation(s)." });
  });

  it("surfaces a refused override (e.g. blank reason) as an error, not a thrown exception", async () => {
    mockRestore().mockResolvedValue({ ok: false, reason: "override_reason_required" });
    const request = actionRequest({ intent: "restore-access", subscriptionId: "sub-1", customerId: "cust-1", reason: "" });
    const result = await action({ request } as any);
    expect(result).toEqual({ ok: false, error: "override_reason_required" });
  });
});

describe("admin.billing-overrides — revoke-access", () => {
  it("calls applyAdminRevokeOverride with the session's own email, defaulting reasonCode to REFUND when not DISPUTE_LOST", async () => {
    mockRevoke().mockResolvedValue({ ok: true, overrideAuditLogId: "audit-2", resolvedCount: 0 });
    const request = actionRequest({ intent: "revoke-access", subscriptionId: "sub-2", customerId: "cust-2", reason: "Policy violation" });
    const result = await action({ request } as any);
    expect(mockRevoke()).toHaveBeenCalledWith({
      subscriptionId: "sub-2",
      customerId: "cust-2",
      performedBy: "owner@naiabynadine.com",
      reason: "Policy violation",
      reasonCode: "REFUND",
    });
    expect(result).toEqual({ ok: true, intent: "revoke-access", message: "Revoked access for subscription sub-2." });
  });

  it("passes DISPUTE_LOST through when explicitly selected", async () => {
    mockRevoke().mockResolvedValue({ ok: true, overrideAuditLogId: "audit-3", resolvedCount: 0 });
    const request = actionRequest({ intent: "revoke-access", subscriptionId: "sub-3", customerId: "cust-3", reason: "x", reasonCode: "DISPUTE_LOST" });
    await action({ request } as any);
    expect(mockRevoke()).toHaveBeenCalledWith(expect.objectContaining({ reasonCode: "DISPUTE_LOST" }));
  });
});

describe("admin.billing-overrides — resolve-review-flag", () => {
  it("calls resolveManualReviewFlag with the session's own email", async () => {
    mockResolveFlag().mockResolvedValue({ status: "resolved" });
    const request = actionRequest({ intent: "resolve-review-flag", id: "flag-1", note: "checked, fine" });
    const result = await action({ request } as any);
    expect(mockResolveFlag()).toHaveBeenCalledWith("flag-1", "owner@naiabynadine.com", "checked, fine");
    expect(result).toEqual({ ok: true, intent: "resolve-review-flag", message: "Review flag resolved." });
  });

  it("surfaces not-found/already-resolved as an error", async () => {
    mockResolveFlag().mockResolvedValue({ status: "not-found" });
    const request = actionRequest({ intent: "resolve-review-flag", id: "flag-x" });
    const result = await action({ request } as any);
    expect(result).toEqual({ ok: false, error: "Flag not found." });
  });
});

describe("admin.billing-overrides — invalid intent", () => {
  it("rejects without calling any override/resolve function", async () => {
    const request = actionRequest({ intent: "something-else" });
    const result = await action({ request } as any);
    expect(result).toEqual({ ok: false, error: "Invalid request." });
    expect(mockRestore()).not.toHaveBeenCalled();
    expect(mockRevoke()).not.toHaveBeenCalled();
    expect(mockResolveFlag()).not.toHaveBeenCalled();
  });
});
