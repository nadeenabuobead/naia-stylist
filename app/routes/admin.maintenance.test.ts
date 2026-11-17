// app/routes/admin.maintenance.test.ts
// Priority 5 (2026-10-19) — admin-triggered retention purge route.
//
// Mocked internal-auth.server, data-retention.server, and
// admin-audit-log.server — no real admin session, no real DB. Verifies:
// both loader and action require a valid admin session AND the "owner"
// role specifically (same convention as admin.naia.phase3c-export.tsx for
// belt-and-suspenders auth); each intent calls the correct purge function;
// an invalid intent is rejected without calling either; every successful
// purge is recorded in the audit log with the session's email, never
// client input; recent actions are loaded for display.
//
// Run: npx vitest run app/routes/admin.maintenance.test.ts

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/internal-auth.server", () => ({
  requireAdminSession: vi.fn().mockResolvedValue({
    authenticated: true,
    identity: { id: "owner", email: "owner@naiabynadine.com", role: "owner" },
  }),
}));

vi.mock("~/lib/data-retention.server", () => ({
  purgeExpiredJourneyEvents: vi.fn().mockResolvedValue({ count: 0 }),
  purgeExpiredNaiaSessions: vi.fn().mockResolvedValue({ count: 0 }),
  purgeUnconfirmedSelfiePhotos: vi.fn().mockResolvedValue({ count: 0, attempted: 0 }),
}));

vi.mock("~/lib/admin-audit-log.server", () => ({
  recordAdminAction: vi.fn().mockResolvedValue(undefined),
  listRecentAdminActions: vi.fn().mockResolvedValue([]),
}));

vi.mock("~/lib/clerk-cleanup.server", () => ({
  listPendingClerkCleanups: vi.fn().mockResolvedValue([]),
  retryPendingClerkCleanup: vi.fn(),
}));

vi.mock("~/lib/customer-erasure-failures.server", () => ({
  listPendingCustomerErasureFailures: vi.fn().mockResolvedValue([]),
  retryPendingCustomerErasureFailure: vi.fn(),
}));

vi.mock("~/lib/cloudinary-deletion-claim.server", () => ({
  listPendingCloudinaryDeletions: vi.fn().mockResolvedValue([]),
  retryPendingCloudinaryDeletion: vi.fn(),
  purgeResolvedCloudinaryDeletions: vi.fn().mockResolvedValue({ count: 0 }),
}));

vi.mock("~/lib/cloudinary-orphan-sweep.server", () => ({
  runBoundedSweep: vi.fn(),
}));

// 2026-11-17 (H4) — admin-facing session revocation for a suspected
// compromised customer account.
vi.mock("~/lib/naia-session.server", () => ({
  revokeAllSessionsForCustomer: vi.fn(),
}));

import { requireAdminSession } from "~/lib/internal-auth.server";
import { purgeExpiredJourneyEvents, purgeExpiredNaiaSessions, purgeUnconfirmedSelfiePhotos } from "~/lib/data-retention.server";
import { recordAdminAction, listRecentAdminActions } from "~/lib/admin-audit-log.server";
import { listPendingClerkCleanups, retryPendingClerkCleanup } from "~/lib/clerk-cleanup.server";
import { listPendingCustomerErasureFailures, retryPendingCustomerErasureFailure } from "~/lib/customer-erasure-failures.server";
import { listPendingCloudinaryDeletions, retryPendingCloudinaryDeletion, purgeResolvedCloudinaryDeletions } from "~/lib/cloudinary-deletion-claim.server";
import { runBoundedSweep } from "~/lib/cloudinary-orphan-sweep.server";
import { revokeAllSessionsForCustomer } from "~/lib/naia-session.server";

const mockRequireAdmin = () => requireAdminSession as ReturnType<typeof vi.fn>;
const mockPurgeJourney = () => purgeExpiredJourneyEvents as ReturnType<typeof vi.fn>;
const mockPurgeSessions = () => purgeExpiredNaiaSessions as ReturnType<typeof vi.fn>;
const mockPurgeSelfies = () => purgeUnconfirmedSelfiePhotos as ReturnType<typeof vi.fn>;
const mockRecordAction = () => recordAdminAction as ReturnType<typeof vi.fn>;
const mockListActions = () => listRecentAdminActions as ReturnType<typeof vi.fn>;
const mockListPendingCleanups = () => listPendingClerkCleanups as ReturnType<typeof vi.fn>;
const mockRetryCleanup = () => retryPendingClerkCleanup as ReturnType<typeof vi.fn>;
const mockListPendingErasureFailures = () => listPendingCustomerErasureFailures as ReturnType<typeof vi.fn>;
const mockRetryErasureFailure = () => retryPendingCustomerErasureFailure as ReturnType<typeof vi.fn>;
const mockListPendingCloudinaryDeletions = () => listPendingCloudinaryDeletions as ReturnType<typeof vi.fn>;
const mockRetryCloudinaryDeletion = () => retryPendingCloudinaryDeletion as ReturnType<typeof vi.fn>;
const mockPurgeResolvedCloudinaryDeletions = () => purgeResolvedCloudinaryDeletions as ReturnType<typeof vi.fn>;
const mockRunBoundedSweep = () => runBoundedSweep as ReturnType<typeof vi.fn>;
const mockRevokeSessions = () => revokeAllSessionsForCustomer as ReturnType<typeof vi.fn>;

function actionRequest(intent: string) {
  const body = new URLSearchParams({ intent });
  return new Request("http://localhost/admin/maintenance", {
    method: "POST",
    body,
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
}

beforeEach(() => vi.clearAllMocks());

describe("admin.maintenance — session and role requirements", () => {
  it("loader calls requireAdminSession and loads recent actions", async () => {
    const { loader } = await import("./admin.maintenance");
    const result = await loader({ request: new Request("http://localhost/admin/maintenance") } as any);
    expect(mockRequireAdmin()).toHaveBeenCalled();
    expect(mockListActions()).toHaveBeenCalledWith(20);
    expect(mockListPendingCleanups()).toHaveBeenCalled();
    expect(mockListPendingErasureFailures()).toHaveBeenCalled();
    expect(mockListPendingCloudinaryDeletions()).toHaveBeenCalled();
    expect(result).toEqual({
      recentActions: [], pendingClerkCleanups: [], pendingCustomerErasureFailures: [], pendingCloudinaryDeletions: [],
    });
  });

  it("action rejects before running any purge when the session check rejects", async () => {
    mockRequireAdmin().mockRejectedValueOnce(new Response("redirect", { status: 302 }));
    const { action } = await import("./admin.maintenance");

    await expect(action({ request: actionRequest("purge-journey-events") } as any)).rejects.toBeInstanceOf(Response);
    expect(mockPurgeJourney()).not.toHaveBeenCalled();
    expect(mockPurgeSessions()).not.toHaveBeenCalled();
  });

  it("a valid session that is NOT role 'owner' is rejected with 403, before any purge", async () => {
    mockRequireAdmin().mockResolvedValueOnce({ authenticated: true, identity: { id: "x", email: "staff@naiabynadine.com", role: "staff" } });
    const { action } = await import("./admin.maintenance");

    await expect(action({ request: actionRequest("purge-journey-events") } as any)).rejects.toMatchObject({ status: 403 });
    expect(mockPurgeJourney()).not.toHaveBeenCalled();
  });

  it("the loader also enforces the owner role", async () => {
    mockRequireAdmin().mockResolvedValueOnce({ authenticated: true, identity: { id: "x", email: "staff@naiabynadine.com", role: "staff" } });
    const { loader } = await import("./admin.maintenance");

    await expect(loader({ request: new Request("http://localhost/admin/maintenance") } as any)).rejects.toMatchObject({ status: 403 });
  });
});

describe("admin.maintenance — purge actions and auditability", () => {
  it("purge-journey-events calls only purgeExpiredJourneyEvents and records the audit entry with the session's email", async () => {
    mockPurgeJourney().mockResolvedValueOnce({ count: 12 });
    const { action } = await import("./admin.maintenance");

    const result = await action({ request: actionRequest("purge-journey-events") } as any);

    expect(mockPurgeJourney()).toHaveBeenCalled();
    expect(mockPurgeSessions()).not.toHaveBeenCalled();
    expect((result as any).message).toMatch(/12/);
    expect(mockRecordAction()).toHaveBeenCalledWith("owner@naiabynadine.com", "purge-journey-events", { count: 12 });
  });

  it("purge-sessions calls only purgeExpiredNaiaSessions and records the audit entry", async () => {
    mockPurgeSessions().mockResolvedValueOnce({ count: 3 });
    const { action } = await import("./admin.maintenance");

    const result = await action({ request: actionRequest("purge-sessions") } as any);

    expect(mockPurgeSessions()).toHaveBeenCalled();
    expect(mockPurgeJourney()).not.toHaveBeenCalled();
    expect((result as any).message).toMatch(/3/);
    expect(mockRecordAction()).toHaveBeenCalledWith("owner@naiabynadine.com", "purge-sessions", { count: 3 });
  });

  it("purge-unconfirmed-selfies calls only purgeUnconfirmedSelfiePhotos and records the full result as detail", async () => {
    mockPurgeSelfies().mockResolvedValueOnce({ count: 5, attempted: 5 });
    const { action } = await import("./admin.maintenance");

    const result = await action({ request: actionRequest("purge-unconfirmed-selfies") } as any);

    expect(mockPurgeSelfies()).toHaveBeenCalled();
    expect(mockPurgeJourney()).not.toHaveBeenCalled();
    expect(mockPurgeSessions()).not.toHaveBeenCalled();
    expect((result as any).message).toMatch(/5/);
    expect(mockRecordAction()).toHaveBeenCalledWith("owner@naiabynadine.com", "purge-unconfirmed-selfies", { count: 5, attempted: 5 });
  });

  it("purge-unconfirmed-selfies surfaces a partial failure in its message rather than hiding it", async () => {
    mockPurgeSelfies().mockResolvedValueOnce({ count: 3, attempted: 5 });
    const { action } = await import("./admin.maintenance");

    const result = await action({ request: actionRequest("purge-unconfirmed-selfies") } as any);
    expect((result as any).message).toMatch(/3 of 5/);
    expect((result as any).message).toMatch(/2 failed/);
  });

  it("an invalid intent is rejected without calling either purge function or recording anything", async () => {
    const { action } = await import("./admin.maintenance");
    const result = await action({ request: actionRequest("something-else") } as any);

    expect((result as any).ok).toBe(false);
    expect(mockPurgeJourney()).not.toHaveBeenCalled();
    expect(mockPurgeSessions()).not.toHaveBeenCalled();
    expect(mockPurgeSelfies()).not.toHaveBeenCalled();
    expect(mockRecordAction()).not.toHaveBeenCalled();
  });
});

function retryActionRequest(id: string) {
  const body = new URLSearchParams({ intent: "retry-clerk-cleanup", id });
  return new Request("http://localhost/admin/maintenance", {
    method: "POST", body, headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
}

describe("admin.maintenance — retry-clerk-cleanup action", () => {
  it("a successful retry reports resolved and records the audit entry with the row id", async () => {
    mockRetryCleanup().mockResolvedValueOnce({ status: "resolved" });
    const { action } = await import("./admin.maintenance");

    const result = await action({ request: retryActionRequest("cleanup-1") } as any);

    expect(mockRetryCleanup()).toHaveBeenCalledWith("cleanup-1");
    expect((result as any).ok).toBe(true);
    expect((result as any).message).toMatch(/resolved/i);
    expect(mockRecordAction()).toHaveBeenCalledWith(
      "owner@naiabynadine.com", "retry-clerk-cleanup", { id: "cleanup-1", result: "resolved" },
    );
  });

  it("a retry that fails again surfaces the error rather than silently succeeding", async () => {
    mockRetryCleanup().mockResolvedValueOnce({ status: "failed-again", error: "still misconfigured" });
    const { action } = await import("./admin.maintenance");

    const result = await action({ request: retryActionRequest("cleanup-1") } as any);

    expect((result as any).ok).toBe(false);
    expect((result as any).error).toMatch(/still misconfigured/);
  });

  it("retrying a not-found id reports an error, never a silent success", async () => {
    mockRetryCleanup().mockResolvedValueOnce({ status: "not-found" });
    const { action } = await import("./admin.maintenance");

    const result = await action({ request: retryActionRequest("does-not-exist") } as any);
    expect((result as any).ok).toBe(false);
  });

  it("retrying an already-resolved id reports an error, not a duplicate success message", async () => {
    mockRetryCleanup().mockResolvedValueOnce({ status: "already-resolved" });
    const { action } = await import("./admin.maintenance");

    const result = await action({ request: retryActionRequest("cleanup-1") } as any);
    expect((result as any).ok).toBe(false);
  });
});

function retryErasureFailureRequest(id: string) {
  const body = new URLSearchParams({ intent: "retry-customer-erasure-failure", id });
  return new Request("http://localhost/admin/maintenance", {
    method: "POST", body, headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
}

describe("admin.maintenance — retry-customer-erasure-failure action", () => {
  it("a successful retry reports resolved and records the audit entry with the row id", async () => {
    mockRetryErasureFailure().mockResolvedValueOnce({ status: "resolved" });
    const { action } = await import("./admin.maintenance");

    const result = await action({ request: retryErasureFailureRequest("erasure-1") } as any);

    expect(mockRetryErasureFailure()).toHaveBeenCalledWith("erasure-1");
    expect((result as any).ok).toBe(true);
    expect((result as any).message).toMatch(/resolved/i);
    expect(mockRecordAction()).toHaveBeenCalledWith(
      "owner@naiabynadine.com", "retry-customer-erasure-failure", { id: "erasure-1", result: "resolved" },
    );
  });

  it("a retry that fails again surfaces the error rather than silently succeeding", async () => {
    mockRetryErasureFailure().mockResolvedValueOnce({ status: "failed-again", error: "still broken" });
    const { action } = await import("./admin.maintenance");

    const result = await action({ request: retryErasureFailureRequest("erasure-1") } as any);

    expect((result as any).ok).toBe(false);
    expect((result as any).error).toMatch(/still broken/);
  });

  it("retrying a not-found id reports an error, never a silent success", async () => {
    mockRetryErasureFailure().mockResolvedValueOnce({ status: "not-found" });
    const { action } = await import("./admin.maintenance");

    const result = await action({ request: retryErasureFailureRequest("does-not-exist") } as any);
    expect((result as any).ok).toBe(false);
  });

  it("retrying an already-resolved id reports an error, not a duplicate success message", async () => {
    mockRetryErasureFailure().mockResolvedValueOnce({ status: "already-resolved" });
    const { action } = await import("./admin.maintenance");

    const result = await action({ request: retryErasureFailureRequest("erasure-1") } as any);
    expect((result as any).ok).toBe(false);
  });
});

function sweepActionRequest(intent: "sweep-cloudinary-dry-run" | "sweep-cloudinary-execute", confirmExecute?: string) {
  const fields: Record<string, string> = { intent };
  if (confirmExecute !== undefined) fields.confirmExecute = confirmExecute;
  const body = new URLSearchParams(fields);
  return new Request("http://localhost/admin/maintenance", {
    method: "POST", body, headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
}

describe("admin.maintenance — Cloudinary orphan sweep: defaults to dry-run", () => {
  it("sweep-cloudinary-dry-run always calls runBoundedSweep with dryRun:true, even if a confirmExecute field is somehow present", async () => {
    mockRunBoundedSweep().mockResolvedValueOnce({
      runId: "run-1", startedExisting: false, customersChecked: 2, assetsChecked: 5, assetsDeleted: 1,
      assetsSkippedRecent: 1, assetsSkippedReferenced: 3, failures: 0, stoppedReason: "COMPLETED_ALL", cursorCustomerId: "c-2",
    });
    const { action } = await import("./admin.maintenance");

    const result = await action({ request: sweepActionRequest("sweep-cloudinary-dry-run", "EXECUTE") } as any);

    expect(mockRunBoundedSweep()).toHaveBeenCalledWith({ mode: "ADMIN", dryRun: true });
    expect((result as any).message).toMatch(/Dry run/);
    expect(mockRecordAction()).toHaveBeenCalledWith("owner@naiabynadine.com", "sweep-cloudinary-dry-run", expect.any(Object));
  });

  it("sweep-cloudinary-execute WITHOUT the exact confirmExecute value still runs as a dry run — intent name alone is never enough", async () => {
    mockRunBoundedSweep().mockResolvedValueOnce({
      runId: "run-2", startedExisting: false, customersChecked: 0, assetsChecked: 0, assetsDeleted: 0,
      assetsSkippedRecent: 0, assetsSkippedReferenced: 0, failures: 0, stoppedReason: "COMPLETED_ALL", cursorCustomerId: null,
    });
    const { action } = await import("./admin.maintenance");

    await action({ request: sweepActionRequest("sweep-cloudinary-execute") } as any); // no confirmExecute field at all

    expect(mockRunBoundedSweep()).toHaveBeenCalledWith({ mode: "ADMIN", dryRun: true });
  });

  it("sweep-cloudinary-execute WITH the exact confirmExecute=EXECUTE value runs for real", async () => {
    mockRunBoundedSweep().mockResolvedValueOnce({
      runId: "run-3", startedExisting: false, customersChecked: 1, assetsChecked: 1, assetsDeleted: 1,
      assetsSkippedRecent: 0, assetsSkippedReferenced: 0, failures: 0, stoppedReason: "COMPLETED_ALL", cursorCustomerId: "c-1",
    });
    const { action } = await import("./admin.maintenance");

    const result = await action({ request: sweepActionRequest("sweep-cloudinary-execute", "EXECUTE") } as any);

    expect(mockRunBoundedSweep()).toHaveBeenCalledWith({ mode: "ADMIN", dryRun: false });
    expect((result as any).message).not.toMatch(/Dry run/);
  });

  it("a sweep already in progress is reported as an error, not a silent no-op success", async () => {
    mockRunBoundedSweep().mockResolvedValueOnce({
      runId: "run-active", startedExisting: "run-active", customersChecked: 0, assetsChecked: 0, assetsDeleted: 0,
      assetsSkippedRecent: 0, assetsSkippedReferenced: 0, failures: 0, stoppedReason: "ALREADY_RUNNING", cursorCustomerId: null,
    });
    const { action } = await import("./admin.maintenance");

    const result = await action({ request: sweepActionRequest("sweep-cloudinary-dry-run") } as any);
    expect((result as any).ok).toBe(false);
  });
});

function retryCloudinaryDeletionRequest(id: string) {
  const body = new URLSearchParams({ intent: "retry-cloudinary-deletion", id });
  return new Request("http://localhost/admin/maintenance", {
    method: "POST", body, headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
}

describe("admin.maintenance — retry-cloudinary-deletion action", () => {
  it("a successful retry reports resolved and records the audit entry with the row id", async () => {
    mockRetryCloudinaryDeletion().mockResolvedValueOnce({ status: "resolved" });
    const { action } = await import("./admin.maintenance");

    const result = await action({ request: retryCloudinaryDeletionRequest("pcd-1") } as any);

    expect(mockRetryCloudinaryDeletion()).toHaveBeenCalledWith("pcd-1");
    expect((result as any).ok).toBe(true);
    expect(mockRecordAction()).toHaveBeenCalledWith(
      "owner@naiabynadine.com", "retry-cloudinary-deletion", { id: "pcd-1", result: "resolved" },
    );
  });

  it("a retry that fails again surfaces the error rather than silently succeeding", async () => {
    mockRetryCloudinaryDeletion().mockResolvedValueOnce({ status: "failed-again", error: "PROVIDER_ERROR" });
    const { action } = await import("./admin.maintenance");

    const result = await action({ request: retryCloudinaryDeletionRequest("pcd-1") } as any);
    expect((result as any).ok).toBe(false);
    expect((result as any).error).toMatch(/PROVIDER_ERROR/);
  });
});

describe("admin.maintenance — purge-resolved-cloudinary-deletions action", () => {
  it("purges and records the count", async () => {
    mockPurgeResolvedCloudinaryDeletions().mockResolvedValueOnce({ count: 7 });
    const { action } = await import("./admin.maintenance");

    const result = await action({ request: actionRequest("purge-resolved-cloudinary-deletions") } as any);

    expect((result as any).message).toMatch(/7/);
    expect(mockRecordAction()).toHaveBeenCalledWith("owner@naiabynadine.com", "purge-resolved-cloudinary-deletions", { count: 7 });
  });
});

// ── H4 — revoke-customer-sessions ───────────────────────────────────────────
//
// Nov 12 audit finding H4: "No admin-facing session-revocation for a
// suspected-compromised customer account." Every pre-existing teardown was
// scoped to the caller's own request cookie (deleteNaiaSession,
// destroySessionAndGetHint) or to expiry (purgeExpiredNaiaSessions), so an
// operator responding to a reported compromise could only wait the
// attacker's session out.

function revokeRequest(fields: Record<string, string>) {
  const body = new URLSearchParams({ intent: "revoke-customer-sessions", ...fields });
  return new Request("http://localhost/admin/maintenance", {
    method: "POST",
    body,
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
}

describe("admin.maintenance — revoke-customer-sessions action (H4)", () => {
  it("revokes every session for the named customer and records it", async () => {
    mockRevokeSessions().mockResolvedValueOnce({ revokedCount: 3 });
    const { action } = await import("./admin.maintenance");

    const result = await action({
      request: revokeRequest({ customerId: "cust-1", confirmRevoke: "REVOKE" }),
    } as any);

    expect(mockRevokeSessions()).toHaveBeenCalledWith("cust-1");
    expect((result as any).ok).toBe(true);
    expect((result as any).message).toMatch(/3/);
    expect(mockRecordAction()).toHaveBeenCalledWith(
      "owner@naiabynadine.com",
      "revoke-customer-sessions",
      { customerId: "cust-1", revokedCount: 3 },
    );
  });

  it("attributes the action to the admin session, never to request input", async () => {
    mockRevokeSessions().mockResolvedValueOnce({ revokedCount: 1 });
    const { action } = await import("./admin.maintenance");

    await action({
      request: revokeRequest({
        customerId: "cust-1",
        confirmRevoke: "REVOKE",
        performedBy: "attacker@evil.test",
      }),
    } as any);

    expect(mockRecordAction().mock.calls[0][0]).toBe("owner@naiabynadine.com");
  });

  it("refuses without the exact confirmation value, and revokes nothing", async () => {
    const { action } = await import("./admin.maintenance");

    const result = await action({
      request: revokeRequest({ customerId: "cust-1", confirmRevoke: "yes" }),
    } as any);

    expect((result as any).ok).toBe(false);
    expect(mockRevokeSessions()).not.toHaveBeenCalled();
    expect(mockRecordAction()).not.toHaveBeenCalled();
  });

  it("refuses a missing confirmation value entirely (a replayed/mis-wired form)", async () => {
    const { action } = await import("./admin.maintenance");

    const result = await action({ request: revokeRequest({ customerId: "cust-1" }) } as any);

    expect((result as any).ok).toBe(false);
    expect(mockRevokeSessions()).not.toHaveBeenCalled();
  });

  it("refuses a missing or blank customerId rather than revoking broadly", async () => {
    const { action } = await import("./admin.maintenance");

    for (const customerId of ["", "   "]) {
      vi.clearAllMocks();
      const result = await action({
        request: revokeRequest({ customerId, confirmRevoke: "REVOKE" }),
      } as any);

      expect((result as any).ok).toBe(false);
      // The dangerous failure mode would be a falsy id reaching a
      // deleteMany; it must never get that far.
      expect(mockRevokeSessions()).not.toHaveBeenCalled();
    }
  });

  it("reports a zero-revocation result honestly instead of as a bland success", async () => {
    // For an incident-response control, "nothing was there to revoke" and
    // "sessions were revoked" must not read the same — a 0 usually means a
    // wrong customer ID was pasted.
    mockRevokeSessions().mockResolvedValueOnce({ revokedCount: 0 });
    const { action } = await import("./admin.maintenance");

    const result = await action({
      request: revokeRequest({ customerId: "typo-id", confirmRevoke: "REVOKE" }),
    } as any);

    expect((result as any).message).toMatch(/No active nAia sessions/i);
    expect((result as any).message).toMatch(/customer ID is correct/i);
    // Still audited — an attempted revocation against a wrong id is itself
    // worth a record.
    expect(mockRecordAction()).toHaveBeenCalledWith(
      "owner@naiabynadine.com",
      "revoke-customer-sessions",
      { customerId: "typo-id", revokedCount: 0 },
    );
  });

  it("does not overstate its effect — the success message says the identity session survives", async () => {
    // Guards against this control being presented as an account lockout. It
    // ends nAia sessions only; Clerk/Shopify identity sessions are untouched,
    // so the operator must know to follow up with a credential reset.
    mockRevokeSessions().mockResolvedValueOnce({ revokedCount: 2 });
    const { action } = await import("./admin.maintenance");

    const result = await action({
      request: revokeRequest({ customerId: "cust-1", confirmRevoke: "REVOKE" }),
    } as any);

    expect((result as any).message).toMatch(/Clerk\/Shopify/);
    expect((result as any).message).toMatch(/sign in again/i);
  });

  it("a revocation DB failure is not swallowed as success", async () => {
    mockRevokeSessions().mockRejectedValueOnce(new Error("db down"));
    const { action } = await import("./admin.maintenance");

    await expect(
      action({ request: revokeRequest({ customerId: "cust-1", confirmRevoke: "REVOKE" }) } as any),
    ).rejects.toThrow("db down");

    expect(mockRecordAction()).not.toHaveBeenCalled();
  });
});
