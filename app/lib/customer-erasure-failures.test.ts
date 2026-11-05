// app/lib/customer-erasure-failures.test.ts
//
// Durable record + retry for a GDPR erasure that hit a genuinely unexpected
// failure — see customer-erasure-failures.server.ts's own header comment.
// Run: npx vitest run app/lib/customer-erasure-failures.test.ts

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../db.server", () => ({
  default: {
    pendingCustomerErasureFailure: {
      upsert: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

import prisma from "../db.server";
import {
  recordPendingCustomerErasureFailure,
  listPendingCustomerErasureFailures,
  retryPendingCustomerErasureFailure,
} from "./customer-erasure-failures.server";

const mockUpsert = () => (prisma as any).pendingCustomerErasureFailure.upsert as ReturnType<typeof vi.fn>;
const mockFindMany = () => (prisma as any).pendingCustomerErasureFailure.findMany as ReturnType<typeof vi.fn>;
const mockFindUnique = () => (prisma as any).pendingCustomerErasureFailure.findUnique as ReturnType<typeof vi.fn>;
const mockUpdate = () => (prisma as any).pendingCustomerErasureFailure.update as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  mockUpsert().mockResolvedValue({ id: "row-1" });
});

describe("recordPendingCustomerErasureFailure", () => {
  it("upserts keyed on customerId, with the error message (never the raw error object) as lastError, and returns the row id", async () => {
    const id = await recordPendingCustomerErasureFailure("cust-1", "shop/redact", new Error("P2003 foreign key violation"));

    expect(mockUpsert()).toHaveBeenCalledWith({
      where: { customerId: "cust-1" },
      create: { customerId: "cust-1", context: "shop/redact", lastError: "P2003 foreign key violation" },
      update: { context: "shop/redact", lastError: "P2003 foreign key violation", attemptCount: { increment: 1 }, lastAttemptAt: expect.any(Date) },
    });
    expect(id).toBe("row-1");
  });

  it("handles a non-Error thrown value without crashing", async () => {
    await recordPendingCustomerErasureFailure("cust-1", "customers/redact", { code: "unexpected" });
    const call = mockUpsert().mock.calls[0][0];
    expect(call.create.lastError).toContain("unexpected");
  });
});

describe("listPendingCustomerErasureFailures", () => {
  it("lists only unresolved rows, oldest first", async () => {
    mockFindMany().mockResolvedValue([]);
    await listPendingCustomerErasureFailures();
    expect(mockFindMany()).toHaveBeenCalledWith({
      where: { resolvedAt: null },
      orderBy: { createdAt: "asc" },
      take: 50,
    });
  });
});

describe("retryPendingCustomerErasureFailure", () => {
  it("not-found when no row exists for this id", async () => {
    mockFindUnique().mockResolvedValue(null);
    const result = await retryPendingCustomerErasureFailure("missing-id");
    expect(result).toEqual({ status: "not-found" });
  });

  it("already-resolved when the row was already resolved — never re-runs erasure", async () => {
    mockFindUnique().mockResolvedValue({ id: "row-1", customerId: "cust-1", resolvedAt: new Date() });
    const erase = vi.fn();
    const result = await retryPendingCustomerErasureFailure("row-1", { _eraseCustomerData: erase as any });
    expect(result).toEqual({ status: "already-resolved" });
    expect(erase).not.toHaveBeenCalled();
  });

  it("a successful retry re-runs eraseCustomerData and marks the row resolved", async () => {
    mockFindUnique().mockResolvedValue({ id: "row-1", customerId: "cust-1", resolvedAt: null });
    const erase = vi.fn().mockResolvedValue({ ok: true, alreadyErased: false, anonymized: false, cloudinaryFailures: [], journeyEventsPurged: 0 });

    const result = await retryPendingCustomerErasureFailure("row-1", { _eraseCustomerData: erase as any });

    expect(erase).toHaveBeenCalledWith("cust-1");
    expect(mockUpdate()).toHaveBeenCalledWith({ where: { id: "row-1" }, data: { resolvedAt: expect.any(Date) } });
    expect(result).toEqual({ status: "resolved" });
  });

  it("a retry that fails again (eraseCustomerData itself re-records it) reports failed-again without double-recording", async () => {
    mockFindUnique().mockResolvedValue({ id: "row-1", customerId: "cust-1", resolvedAt: null });
    const erase = vi.fn().mockResolvedValue({ ok: false, alreadyErased: false, anonymized: false, cloudinaryFailures: [], journeyEventsPurged: 0, pendingFailureId: "row-1" });

    const result = await retryPendingCustomerErasureFailure("row-1", { _eraseCustomerData: erase as any });

    expect(result.status).toBe("failed-again");
    expect(mockUpdate()).not.toHaveBeenCalledWith(expect.objectContaining({ data: { resolvedAt: expect.any(Date) } }));
  });

  it("a retry that throws outright updates lastError/attemptCount and reports failed-again", async () => {
    mockFindUnique().mockResolvedValue({ id: "row-1", customerId: "cust-1", resolvedAt: null });
    const erase = vi.fn().mockRejectedValue(new Error("still broken"));

    const result = await retryPendingCustomerErasureFailure("row-1", { _eraseCustomerData: erase as any });

    expect(mockUpdate()).toHaveBeenCalledWith({
      where: { id: "row-1" },
      data: { lastError: "still broken", attemptCount: { increment: 1 }, lastAttemptAt: expect.any(Date) },
    });
    expect(result).toEqual({ status: "failed-again", error: "still broken" });
  });
});
