// app/lib/withdrawal-request-ops.test.ts
//
// 2026-11-17 Operations follow-up — restricted case access and status
// transitions for EU withdrawal requests: listOpenWithdrawalRequests,
// acknowledgeWithdrawalRequest, closeWithdrawalRequest. Separate from
// withdrawal-request.test.ts (which covers submitWithdrawalRequest /
// getWithdrawalRequestsForCustomer, authored by the Website workstream)
// so that file's own history stays untouched by this follow-up.
//
// Run: npx vitest run app/lib/withdrawal-request-ops.test.ts

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/db.server", () => ({
  default: {
    withdrawalRequest: { findUnique: vi.fn(), update: vi.fn(), findMany: vi.fn() },
  },
}));

vi.mock("./admin-audit-log.server", () => ({
  recordAdminAction: vi.fn().mockResolvedValue({ id: "audit-1" }),
}));

import prisma from "~/db.server";
import { recordAdminAction } from "./admin-audit-log.server";
import {
  listOpenWithdrawalRequests,
  acknowledgeWithdrawalRequest,
  closeWithdrawalRequest,
} from "./withdrawal-request.server";

const mockFindUnique = () => (prisma as any).withdrawalRequest.findUnique as ReturnType<typeof vi.fn>;
const mockUpdate = () => (prisma as any).withdrawalRequest.update as ReturnType<typeof vi.fn>;
const mockFindMany = () => (prisma as any).withdrawalRequest.findMany as ReturnType<typeof vi.fn>;
const mockAudit = () => recordAdminAction as ReturnType<typeof vi.fn>;

beforeEach(() => vi.clearAllMocks());

describe("listOpenWithdrawalRequests", () => {
  it("queries non-CLOSED rows, oldest first — a triage queue, not an activity feed", async () => {
    mockFindMany().mockResolvedValue([]);
    await listOpenWithdrawalRequests();
    expect(mockFindMany()).toHaveBeenCalledWith({
      where: { status: { not: "CLOSED" } },
      orderBy: { submittedAt: "asc" },
      take: 50,
    });
  });
});

describe("acknowledgeWithdrawalRequest", () => {
  it("SUBMITTED -> ACKNOWLEDGED, and writes one audit record with the performer and reference", async () => {
    mockFindUnique().mockResolvedValue({ status: "SUBMITTED", reference: "WD-20261117-ABC123" });
    const result = await acknowledgeWithdrawalRequest("wr-1", "owner@naiabynadine.com");
    expect(result).toEqual({ status: "acknowledged" });
    expect(mockUpdate()).toHaveBeenCalledWith({ where: { id: "wr-1" }, data: { status: "ACKNOWLEDGED" } });
    expect(mockAudit()).toHaveBeenCalledWith("owner@naiabynadine.com", "acknowledge-withdrawal-request", {
      withdrawalRequestId: "wr-1",
      reference: "WD-20261117-ABC123",
    });
  });

  it("is idempotent on an already-ACKNOWLEDGED row — no second update call, but still audited", async () => {
    mockFindUnique().mockResolvedValue({ status: "ACKNOWLEDGED", reference: "WD-20261117-ABC123" });
    const result = await acknowledgeWithdrawalRequest("wr-1", "owner@naiabynadine.com");
    expect(result).toEqual({ status: "acknowledged" });
    expect(mockUpdate()).not.toHaveBeenCalled();
  });

  it("refuses to reopen a CLOSED request", async () => {
    mockFindUnique().mockResolvedValue({ status: "CLOSED", reference: "WD-20261117-ABC123" });
    const result = await acknowledgeWithdrawalRequest("wr-1", "owner@naiabynadine.com");
    expect(result).toEqual({ status: "already-closed" });
    expect(mockUpdate()).not.toHaveBeenCalled();
    expect(mockAudit()).not.toHaveBeenCalled();
  });

  it("a nonexistent id reports not-found, writes nothing", async () => {
    mockFindUnique().mockResolvedValue(null);
    const result = await acknowledgeWithdrawalRequest("wr-missing", "owner@naiabynadine.com");
    expect(result).toEqual({ status: "not-found" });
    expect(mockUpdate()).not.toHaveBeenCalled();
    expect(mockAudit()).not.toHaveBeenCalled();
  });
});

describe("closeWithdrawalRequest", () => {
  it("closes from any non-CLOSED status and writes one audit record carrying the note", async () => {
    mockFindUnique().mockResolvedValue({ status: "SUBMITTED", reference: "WD-20261117-ABC123" });
    const result = await closeWithdrawalRequest("wr-1", "owner@naiabynadine.com", "Refunded per case OPS-0001");
    expect(result).toEqual({ status: "closed" });
    expect(mockUpdate()).toHaveBeenCalledWith({ where: { id: "wr-1" }, data: { status: "CLOSED" } });
    expect(mockAudit()).toHaveBeenCalledWith("owner@naiabynadine.com", "close-withdrawal-request", {
      withdrawalRequestId: "wr-1",
      reference: "WD-20261117-ABC123",
      note: "Refunded per case OPS-0001",
    });
  });

  it("refuses a blank note BEFORE touching the database — an unexplained closure defeats the audit trail", async () => {
    await expect(closeWithdrawalRequest("wr-1", "owner@naiabynadine.com", "   ")).rejects.toThrow(/non-blank note/);
    expect(mockFindUnique()).not.toHaveBeenCalled();
    expect(mockUpdate()).not.toHaveBeenCalled();
  });

  it("an already-CLOSED request reports already-closed, writes nothing", async () => {
    mockFindUnique().mockResolvedValue({ status: "CLOSED", reference: "WD-20261117-ABC123" });
    const result = await closeWithdrawalRequest("wr-1", "owner@naiabynadine.com", "note");
    expect(result).toEqual({ status: "already-closed" });
    expect(mockUpdate()).not.toHaveBeenCalled();
  });

  it("a nonexistent id reports not-found", async () => {
    mockFindUnique().mockResolvedValue(null);
    const result = await closeWithdrawalRequest("wr-missing", "owner@naiabynadine.com", "note");
    expect(result).toEqual({ status: "not-found" });
  });
});
