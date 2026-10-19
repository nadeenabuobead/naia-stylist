// app/lib/data-retention.test.ts
// Priority 5 (2026-10-19) — retention purge functions.
//
// Mocked Prisma — no live DB. No cron is configured for this project
// (vercel.json has no `crons` key), so these are exposed via an
// admin-triggered maintenance action (admin.maintenance.tsx) for now.
//
// Run: npx vitest run app/lib/data-retention.test.ts

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/db.server", () => ({
  default: {
    journeyEvent: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    naiaSession: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    selfieAnalysis: { findMany: vi.fn().mockResolvedValue([]) },
  },
}));

import prisma from "~/db.server";
import {
  purgeExpiredJourneyEvents,
  purgeExpiredNaiaSessions,
  purgeUnconfirmedSelfiePhotos,
  JOURNEY_EVENT_RETENTION_DAYS,
  SELFIE_PHOTO_RETENTION_DAYS,
} from "./data-retention.server";

const mockJourneyDeleteMany = () => (prisma as any).journeyEvent.deleteMany as ReturnType<typeof vi.fn>;
const mockSessionDeleteMany = () => (prisma as any).naiaSession.deleteMany as ReturnType<typeof vi.fn>;
const mockSelfieFindMany = () => (prisma as any).selfieAnalysis.findMany as ReturnType<typeof vi.fn>;

beforeEach(() => vi.clearAllMocks());

describe("purgeExpiredJourneyEvents", () => {
  it("deletes rows older than the default retention window", async () => {
    mockJourneyDeleteMany().mockResolvedValueOnce({ count: 42 });
    const result = await purgeExpiredJourneyEvents();
    expect(result.count).toBe(42);

    const call = mockJourneyDeleteMany().mock.calls[0][0];
    const cutoff = call.where.createdAt.lt as Date;
    const expectedCutoff = Date.now() - JOURNEY_EVENT_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    expect(Math.abs(cutoff.getTime() - expectedCutoff)).toBeLessThan(5000); // within 5s of "now"
  });

  it("accepts a custom retention window", async () => {
    await purgeExpiredJourneyEvents(30);
    const call = mockJourneyDeleteMany().mock.calls[0][0];
    const cutoff = call.where.createdAt.lt as Date;
    const expectedCutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    expect(Math.abs(cutoff.getTime() - expectedCutoff)).toBeLessThan(5000);
  });
});

describe("purgeExpiredNaiaSessions", () => {
  it("deletes only sessions whose expiresAt has already passed", async () => {
    mockSessionDeleteMany().mockResolvedValueOnce({ count: 7 });
    const result = await purgeExpiredNaiaSessions();
    expect(result.count).toBe(7);

    const call = mockSessionDeleteMany().mock.calls[0][0];
    const cutoff = call.where.expiresAt.lt as Date;
    expect(cutoff.getTime()).toBeLessThanOrEqual(Date.now());
  });
});

describe("purgeUnconfirmedSelfiePhotos", () => {
  it("queries only rows with a live photo, no prior deletion, older than the default 30-day window", async () => {
    mockSelfieFindMany().mockResolvedValueOnce([]);
    await purgeUnconfirmedSelfiePhotos();

    const call = mockSelfieFindMany().mock.calls[0][0];
    expect(call.where.photoPublicId).toEqual({ not: null });
    expect(call.where.photoDeletedAt).toBe(null);
    const cutoff = call.where.updatedAt.lt as Date;
    const expectedCutoff = Date.now() - SELFIE_PHOTO_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    expect(Math.abs(cutoff.getTime() - expectedCutoff)).toBeLessThan(5000);
  });

  it("deletes the photo for every matching customer via deleteSelfiePhoto — never the analysis text", async () => {
    mockSelfieFindMany().mockResolvedValueOnce([{ customerId: "synthetic-A" }, { customerId: "synthetic-B" }]);
    const deleteFn = vi.fn().mockResolvedValue({ ok: true });

    const result = await purgeUnconfirmedSelfiePhotos(30, deleteFn);

    expect(deleteFn).toHaveBeenCalledWith("synthetic-A");
    expect(deleteFn).toHaveBeenCalledWith("synthetic-B");
    expect(deleteFn).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ count: 2, attempted: 2 });
  });

  it("a Cloudinary deletion failure is not counted as purged, but is still reported as attempted", async () => {
    mockSelfieFindMany().mockResolvedValueOnce([{ customerId: "synthetic-A" }, { customerId: "synthetic-B" }]);
    const deleteFn = vi.fn()
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: false, errorCode: "DELETION_FAILED" });

    const result = await purgeUnconfirmedSelfiePhotos(30, deleteFn);
    expect(result).toEqual({ count: 1, attempted: 2 });
  });

  it("accepts a custom retention window", async () => {
    await purgeUnconfirmedSelfiePhotos(7);
    const call = mockSelfieFindMany().mock.calls[0][0];
    const cutoff = call.where.updatedAt.lt as Date;
    const expectedCutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    expect(Math.abs(cutoff.getTime() - expectedCutoff)).toBeLessThan(5000);
  });
});
