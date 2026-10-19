// app/lib/admin-audit-log.test.ts
// Priority 5 (2026-10-19) — admin maintenance auditability.
//
// Mocked Prisma — no live DB.
//
// Run: npx vitest run app/lib/admin-audit-log.test.ts

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/db.server", () => ({
  default: {
    adminAuditLog: {
      create: vi.fn().mockResolvedValue({}),
      findMany: vi.fn().mockResolvedValue([]),
    },
  },
}));

import prisma from "~/db.server";
import { recordAdminAction, listRecentAdminActions } from "./admin-audit-log.server";

const mockCreate = () => (prisma as any).adminAuditLog.create as ReturnType<typeof vi.fn>;
const mockFindMany = () => (prisma as any).adminAuditLog.findMany as ReturnType<typeof vi.fn>;

beforeEach(() => vi.clearAllMocks());

describe("recordAdminAction", () => {
  it("writes performedBy, action, and detail exactly as given", async () => {
    await recordAdminAction("owner@naiabynadine.com", "purge-journey-events", { count: 42 });
    expect(mockCreate()).toHaveBeenCalledWith({
      data: { performedBy: "owner@naiabynadine.com", action: "purge-journey-events", detail: { count: 42 } },
    });
  });

  it("detail is optional", async () => {
    await recordAdminAction("owner@naiabynadine.com", "purge-sessions");
    expect(mockCreate()).toHaveBeenCalledWith({
      data: { performedBy: "owner@naiabynadine.com", action: "purge-sessions", detail: undefined },
    });
  });
});

describe("listRecentAdminActions", () => {
  it("orders by most recent first, defaulting to 20", async () => {
    await listRecentAdminActions();
    expect(mockFindMany()).toHaveBeenCalledWith({ orderBy: { createdAt: "desc" }, take: 20 });
  });

  it("accepts a custom limit", async () => {
    await listRecentAdminActions(5);
    expect(mockFindMany()).toHaveBeenCalledWith({ orderBy: { createdAt: "desc" }, take: 5 });
  });
});
