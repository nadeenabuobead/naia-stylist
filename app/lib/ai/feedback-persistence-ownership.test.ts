// app/lib/ai/feedback-persistence-ownership.test.ts
//
// Regression coverage for a cross-customer IDOR hotfixed 2026-11-12 on the
// production source (commit 0b96e40): _upsertPostWearReview's update path
// was keyed only on the unique sessionId, so a different authenticated
// customer could silently overwrite another customer's existing
// PostOutfitReview. This test mocks the Prisma client directly (not the
// exported upsertPostWearReview's own injection point) so it exercises the
// REAL _upsertPostWearReview logic, not a test double standing in for it.
//
// Run: npx vitest run app/lib/ai/feedback-persistence-ownership.test.ts

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../db.server.js", () => ({
  default: {
    postOutfitReview: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
  },
}));

import prisma from "../../db.server.js";
import { upsertPostWearReview } from "./feedback-persistence.server";

const mockFindUnique = () => (prisma as any).postOutfitReview.findUnique as ReturnType<typeof vi.fn>;
const mockUpsert = () => (prisma as any).postOutfitReview.upsert as ReturnType<typeof vi.fn>;

const ANSWERS = {
  didWearIt: "yes" as const,
  howDidYouFeel: "great" as const,
  wasComfortable: "yes" as const,
  fitRight: "yes" as const,
  coverageRight: "yes" as const,
  colourRight: "yes" as const,
  wouldWearAgain: "definitely" as const,
  note: null,
};

beforeEach(() => vi.clearAllMocks());

describe("_upsertPostWearReview ownership (via the exported upsertPostWearReview, real implementation)", () => {
  it("customer A cannot overwrite customer B's existing review for a session customer A doesn't own", async () => {
    mockFindUnique().mockResolvedValueOnce({ customerId: "customer-B" });

    const result = await upsertPostWearReview("shared-session-id", "customer-A", ANSWERS);

    expect(result).toEqual({ ok: false, errorCode: "FORBIDDEN" });
    expect(mockUpsert()).not.toHaveBeenCalled();
  });

  it("the legitimate owner can still update their own review", async () => {
    mockFindUnique().mockResolvedValueOnce({ customerId: "customer-A" });
    mockUpsert().mockResolvedValueOnce({});

    const result = await upsertPostWearReview("own-session-id", "customer-A", ANSWERS);

    expect(result).toEqual({ ok: true });
    expect(mockUpsert()).toHaveBeenCalledWith(
      expect.objectContaining({ where: { sessionId: "own-session-id" } }),
    );
  });

  it("a brand-new session with no existing review yet is allowed to create one", async () => {
    mockFindUnique().mockResolvedValueOnce(null);
    mockUpsert().mockResolvedValueOnce({});

    const result = await upsertPostWearReview("new-session-id", "customer-A", ANSWERS);

    expect(result).toEqual({ ok: true });
    expect(mockUpsert()).toHaveBeenCalled();
  });
});
