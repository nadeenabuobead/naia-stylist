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

import { requireAdminSession } from "~/lib/internal-auth.server";
import { purgeExpiredJourneyEvents, purgeExpiredNaiaSessions, purgeUnconfirmedSelfiePhotos } from "~/lib/data-retention.server";
import { recordAdminAction, listRecentAdminActions } from "~/lib/admin-audit-log.server";

const mockRequireAdmin = () => requireAdminSession as ReturnType<typeof vi.fn>;
const mockPurgeJourney = () => purgeExpiredJourneyEvents as ReturnType<typeof vi.fn>;
const mockPurgeSessions = () => purgeExpiredNaiaSessions as ReturnType<typeof vi.fn>;
const mockPurgeSelfies = () => purgeUnconfirmedSelfiePhotos as ReturnType<typeof vi.fn>;
const mockRecordAction = () => recordAdminAction as ReturnType<typeof vi.fn>;
const mockListActions = () => listRecentAdminActions as ReturnType<typeof vi.fn>;

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
    const { loader } = await import("./admin.maintenance.tsx");
    const result = await loader({ request: new Request("http://localhost/admin/maintenance") } as any);
    expect(mockRequireAdmin()).toHaveBeenCalled();
    expect(mockListActions()).toHaveBeenCalledWith(20);
    expect(result).toEqual({ recentActions: [] });
  });

  it("action rejects before running any purge when the session check rejects", async () => {
    mockRequireAdmin().mockRejectedValueOnce(new Response("redirect", { status: 302 }));
    const { action } = await import("./admin.maintenance.tsx");

    await expect(action({ request: actionRequest("purge-journey-events") } as any)).rejects.toBeInstanceOf(Response);
    expect(mockPurgeJourney()).not.toHaveBeenCalled();
    expect(mockPurgeSessions()).not.toHaveBeenCalled();
  });

  it("a valid session that is NOT role 'owner' is rejected with 403, before any purge", async () => {
    mockRequireAdmin().mockResolvedValueOnce({ authenticated: true, identity: { id: "x", email: "staff@naiabynadine.com", role: "staff" } });
    const { action } = await import("./admin.maintenance.tsx");

    await expect(action({ request: actionRequest("purge-journey-events") } as any)).rejects.toMatchObject({ status: 403 });
    expect(mockPurgeJourney()).not.toHaveBeenCalled();
  });

  it("the loader also enforces the owner role", async () => {
    mockRequireAdmin().mockResolvedValueOnce({ authenticated: true, identity: { id: "x", email: "staff@naiabynadine.com", role: "staff" } });
    const { loader } = await import("./admin.maintenance.tsx");

    await expect(loader({ request: new Request("http://localhost/admin/maintenance") } as any)).rejects.toMatchObject({ status: 403 });
  });
});

describe("admin.maintenance — purge actions and auditability", () => {
  it("purge-journey-events calls only purgeExpiredJourneyEvents and records the audit entry with the session's email", async () => {
    mockPurgeJourney().mockResolvedValueOnce({ count: 12 });
    const { action } = await import("./admin.maintenance.tsx");

    const result = await action({ request: actionRequest("purge-journey-events") } as any);

    expect(mockPurgeJourney()).toHaveBeenCalled();
    expect(mockPurgeSessions()).not.toHaveBeenCalled();
    expect((result as any).message).toMatch(/12/);
    expect(mockRecordAction()).toHaveBeenCalledWith("owner@naiabynadine.com", "purge-journey-events", { count: 12 });
  });

  it("purge-sessions calls only purgeExpiredNaiaSessions and records the audit entry", async () => {
    mockPurgeSessions().mockResolvedValueOnce({ count: 3 });
    const { action } = await import("./admin.maintenance.tsx");

    const result = await action({ request: actionRequest("purge-sessions") } as any);

    expect(mockPurgeSessions()).toHaveBeenCalled();
    expect(mockPurgeJourney()).not.toHaveBeenCalled();
    expect((result as any).message).toMatch(/3/);
    expect(mockRecordAction()).toHaveBeenCalledWith("owner@naiabynadine.com", "purge-sessions", { count: 3 });
  });

  it("purge-unconfirmed-selfies calls only purgeUnconfirmedSelfiePhotos and records the full result as detail", async () => {
    mockPurgeSelfies().mockResolvedValueOnce({ count: 5, attempted: 5 });
    const { action } = await import("./admin.maintenance.tsx");

    const result = await action({ request: actionRequest("purge-unconfirmed-selfies") } as any);

    expect(mockPurgeSelfies()).toHaveBeenCalled();
    expect(mockPurgeJourney()).not.toHaveBeenCalled();
    expect(mockPurgeSessions()).not.toHaveBeenCalled();
    expect((result as any).message).toMatch(/5/);
    expect(mockRecordAction()).toHaveBeenCalledWith("owner@naiabynadine.com", "purge-unconfirmed-selfies", { count: 5, attempted: 5 });
  });

  it("purge-unconfirmed-selfies surfaces a partial failure in its message rather than hiding it", async () => {
    mockPurgeSelfies().mockResolvedValueOnce({ count: 3, attempted: 5 });
    const { action } = await import("./admin.maintenance.tsx");

    const result = await action({ request: actionRequest("purge-unconfirmed-selfies") } as any);
    expect((result as any).message).toMatch(/3 of 5/);
    expect((result as any).message).toMatch(/2 failed/);
  });

  it("an invalid intent is rejected without calling either purge function or recording anything", async () => {
    const { action } = await import("./admin.maintenance.tsx");
    const result = await action({ request: actionRequest("something-else") } as any);

    expect((result as any).ok).toBe(false);
    expect(mockPurgeJourney()).not.toHaveBeenCalled();
    expect(mockPurgeSessions()).not.toHaveBeenCalled();
    expect(mockPurgeSelfies()).not.toHaveBeenCalled();
    expect(mockRecordAction()).not.toHaveBeenCalled();
  });
});
