// app/routes/api-outfit-rating-ownership.test.ts
//
// Regression coverage for the cross-customer IDOR fixed 2026-10-21 in this
// legacy route: historyId (client-supplied) was used to update/create a
// PostOutfitReview with zero ownership check — any authenticated customer
// could overwrite another customer's review by supplying their sessionId.
//
// Run: npx vitest run app/routes/api-outfit-rating-ownership.test.ts

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../customer-auth.server", () => ({
  authenticateCustomer: vi.fn(),
}));

vi.mock("../db.server", () => ({
  default: {
    postOutfitReview: { findUnique: vi.fn(), update: vi.fn(), create: vi.fn() },
    stylingSession: { findUnique: vi.fn() },
  },
}));

import { authenticateCustomer } from "../customer-auth.server";
import prisma from "../db.server";
import { action } from "./api.outfit-rating.jsx";

const mockAuth = () => authenticateCustomer as unknown as ReturnType<typeof vi.fn>;
const mockReviewFindUnique = () => (prisma as any).postOutfitReview.findUnique as ReturnType<typeof vi.fn>;
const mockReviewUpdate = () => (prisma as any).postOutfitReview.update as ReturnType<typeof vi.fn>;
const mockReviewCreate = () => (prisma as any).postOutfitReview.create as ReturnType<typeof vi.fn>;
const mockSessionFindUnique = () => (prisma as any).stylingSession.findUnique as ReturnType<typeof vi.fn>;

beforeEach(() => vi.clearAllMocks());

function makeRequest(body: Record<string, unknown>) {
  return new Request("http://localhost/api/outfit-rating", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

describe("api.outfit-rating.jsx — cross-customer ownership", () => {
  it("Customer A's request cannot overwrite Customer B's existing review", async () => {
    mockAuth().mockResolvedValueOnce({ customer: { id: "customer-A" } });
    mockReviewFindUnique().mockResolvedValueOnce({ customerId: "customer-B" });

    const res = await action({ request: makeRequest({ historyId: "victim-session", overallReaction: 5 }) } as any);
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toBe("Not found");
    expect(mockReviewUpdate()).not.toHaveBeenCalled();
  });

  it("Customer A cannot create a review attached to Customer B's styling session", async () => {
    mockAuth().mockResolvedValueOnce({ customer: { id: "customer-A" } });
    mockReviewFindUnique().mockResolvedValueOnce(null); // no existing review yet
    mockSessionFindUnique().mockResolvedValueOnce({ customerId: "customer-B", suggestions: [] });

    const res = await action({ request: makeRequest({ historyId: "victim-session", overallReaction: 5 }) } as any);
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toBe("Not found");
    expect(mockReviewCreate()).not.toHaveBeenCalled();
  });

  it("the legitimate owner can still update their own review", async () => {
    mockAuth().mockResolvedValueOnce({ customer: { id: "customer-A" } });
    mockReviewFindUnique().mockResolvedValueOnce({ customerId: "customer-A" });
    mockReviewUpdate().mockResolvedValueOnce({ id: "review-1" });

    const res = await action({ request: makeRequest({ historyId: "own-session", overallReaction: 5 }) } as any);

    expect(res.status).toBe(200);
    expect(mockReviewUpdate()).toHaveBeenCalled();
  });

  it("the legitimate owner can still create a review for their own session", async () => {
    mockAuth().mockResolvedValueOnce({ customer: { id: "customer-A" } });
    mockReviewFindUnique().mockResolvedValueOnce(null);
    mockSessionFindUnique().mockResolvedValueOnce({ customerId: "customer-A", suggestions: [] });
    mockReviewCreate().mockResolvedValueOnce({ id: "review-2" });

    const res = await action({ request: makeRequest({ historyId: "own-session", overallReaction: 5 }) } as any);

    expect(res.status).toBe(200);
    expect(mockReviewCreate()).toHaveBeenCalled();
  });

  it("an unauthenticated request is rejected before any review lookup", async () => {
    mockAuth().mockResolvedValueOnce({ customer: null });

    const res = await action({ request: makeRequest({ historyId: "any-session", overallReaction: 5 }) } as any);

    expect(res.status).toBe(401);
    expect(mockReviewFindUnique()).not.toHaveBeenCalled();
  });
});
