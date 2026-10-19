// app/routes/admin.maintenance.test.ts
// Priority 5 (2026-10-19) — admin-triggered retention purge route.
//
// Mocked internal-auth.server and data-retention.server — no real admin
// session, no real DB. Verifies: both loader and action require a valid
// admin session (belt-and-suspenders, same convention as
// admin.naia.phase3c-export.tsx), each intent calls the correct purge
// function, and an invalid intent is rejected without calling either.
//
// Run: npx vitest run app/routes/admin.maintenance.test.ts

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/internal-auth.server", () => ({
  requireAdminSession: vi.fn().mockResolvedValue({ authenticated: true, identity: { id: "owner", email: "a", role: "owner" } }),
}));

vi.mock("~/lib/data-retention.server", () => ({
  purgeExpiredJourneyEvents: vi.fn().mockResolvedValue({ count: 0 }),
  purgeExpiredNaiaSessions: vi.fn().mockResolvedValue({ count: 0 }),
}));

import { requireAdminSession } from "~/lib/internal-auth.server";
import { purgeExpiredJourneyEvents, purgeExpiredNaiaSessions } from "~/lib/data-retention.server";

const mockRequireAdmin = () => requireAdminSession as ReturnType<typeof vi.fn>;
const mockPurgeJourney = () => purgeExpiredJourneyEvents as ReturnType<typeof vi.fn>;
const mockPurgeSessions = () => purgeExpiredNaiaSessions as ReturnType<typeof vi.fn>;

function actionRequest(intent: string) {
  const body = new URLSearchParams({ intent });
  return new Request("http://localhost/admin/maintenance", {
    method: "POST",
    body,
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
}

beforeEach(() => vi.clearAllMocks());

describe("admin.maintenance — loader and action both require a valid admin session", () => {
  it("loader calls requireAdminSession", async () => {
    const { loader } = await import("./admin.maintenance.tsx");
    await loader({ request: new Request("http://localhost/admin/maintenance") } as any);
    expect(mockRequireAdmin()).toHaveBeenCalled();
  });

  it("action rejects before running any purge when the session check rejects", async () => {
    mockRequireAdmin().mockRejectedValueOnce(new Response("redirect", { status: 302 }));
    const { action } = await import("./admin.maintenance.tsx");

    await expect(action({ request: actionRequest("purge-journey-events") } as any)).rejects.toBeInstanceOf(Response);
    expect(mockPurgeJourney()).not.toHaveBeenCalled();
    expect(mockPurgeSessions()).not.toHaveBeenCalled();
  });

  it("purge-journey-events calls only purgeExpiredJourneyEvents", async () => {
    mockPurgeJourney().mockResolvedValueOnce({ count: 12 });
    const { action } = await import("./admin.maintenance.tsx");

    const result = await action({ request: actionRequest("purge-journey-events") } as any);

    expect(mockPurgeJourney()).toHaveBeenCalled();
    expect(mockPurgeSessions()).not.toHaveBeenCalled();
    expect((result as any).message).toMatch(/12/);
  });

  it("purge-sessions calls only purgeExpiredNaiaSessions", async () => {
    mockPurgeSessions().mockResolvedValueOnce({ count: 3 });
    const { action } = await import("./admin.maintenance.tsx");

    const result = await action({ request: actionRequest("purge-sessions") } as any);

    expect(mockPurgeSessions()).toHaveBeenCalled();
    expect(mockPurgeJourney()).not.toHaveBeenCalled();
    expect((result as any).message).toMatch(/3/);
  });

  it("an invalid intent is rejected without calling either purge function", async () => {
    const { action } = await import("./admin.maintenance.tsx");
    const result = await action({ request: actionRequest("something-else") } as any);

    expect((result as any).ok).toBe(false);
    expect(mockPurgeJourney()).not.toHaveBeenCalled();
    expect(mockPurgeSessions()).not.toHaveBeenCalled();
  });
});
