// Regression coverage for the cross-customer IDOR hotfixed 2026-11-12.
//
// api.outfit-rating.jsx's action() used PostOutfitReview.sessionId (a
// client-supplied historyId) alone to find/update an existing review, and
// StylingSession.id alone to attach a brand-new review — with no check that
// the resource actually belonged to the authenticated caller. Any customer
// who learned another customer's historyId could silently overwrite that
// customer's review, or attach a new review to someone else's styling
// session.
//
// Run: npx vitest run app/routes/api.outfit-rating-ownership.test.ts

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../db.server", () => ({
  default: {
    postOutfitReview: {
      findUnique: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
    },
    stylingSession: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock("../customer-auth.server", () => ({
  authenticateCustomer: vi.fn(),
}));

import prisma from "../db.server";
import { authenticateCustomer } from "../customer-auth.server";
import { action } from "./api.outfit-rating";

const mockAuth = authenticateCustomer as unknown as ReturnType<typeof vi.fn>;

const BASE_BODY = {
  historyId: "shared-history-id",
  overallReaction: 4,
  workedTags: [],
  didntWorkTags: [],
};

function makeRequest(body: object) {
  return {
    request: new Request("https://example.com/api/outfit-rating", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("api.outfit-rating action — ownership", () => {
  it("customer A cannot overwrite customer B's existing review via a shared historyId", async () => {
    mockAuth.mockResolvedValueOnce({ customer: { id: "customer-A" } });
    (prisma.postOutfitReview.findUnique as any).mockResolvedValueOnce({ customerId: "customer-B" });

    const res = (await action(makeRequest(BASE_BODY))) as Response;

    expect(res.status).toBe(404);
    expect(prisma.postOutfitReview.update).not.toHaveBeenCalled();
  });

  it("the legitimate owner can still update their own existing review", async () => {
    mockAuth.mockResolvedValueOnce({ customer: { id: "customer-A" } });
    (prisma.postOutfitReview.findUnique as any).mockResolvedValueOnce({ customerId: "customer-A" });
    (prisma.postOutfitReview.update as any).mockResolvedValueOnce({ id: "review-1" });

    const res = (await action(makeRequest(BASE_BODY))) as Response;

    expect(res.status).toBe(200);
    expect(prisma.postOutfitReview.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { sessionId: "shared-history-id" } }),
    );
  });

  it("a new review cannot be attached to a styling session owned by a different customer", async () => {
    mockAuth.mockResolvedValueOnce({ customer: { id: "customer-A" } });
    (prisma.postOutfitReview.findUnique as any).mockResolvedValueOnce(null);
    (prisma.stylingSession.findUnique as any).mockResolvedValueOnce({ customerId: "customer-B" });

    const res = (await action(makeRequest(BASE_BODY))) as Response;

    expect(res.status).toBe(404);
    expect(prisma.postOutfitReview.create).not.toHaveBeenCalled();
  });

  it("a new review can still be created for the caller's own styling session", async () => {
    mockAuth.mockResolvedValueOnce({ customer: { id: "customer-A" } });
    (prisma.postOutfitReview.findUnique as any).mockResolvedValueOnce(null);
    (prisma.stylingSession.findUnique as any).mockResolvedValueOnce({ customerId: "customer-A" });
    (prisma.postOutfitReview.create as any).mockResolvedValueOnce({ id: "review-2" });

    const res = (await action(makeRequest(BASE_BODY))) as Response;

    expect(res.status).toBe(200);
    expect(prisma.postOutfitReview.create).toHaveBeenCalled();
  });

  it("a new review can still be created when historyId doesn't resolve to any styling session at all", async () => {
    mockAuth.mockResolvedValueOnce({ customer: { id: "customer-A" } });
    (prisma.postOutfitReview.findUnique as any).mockResolvedValueOnce(null);
    (prisma.stylingSession.findUnique as any).mockResolvedValueOnce(null);
    (prisma.postOutfitReview.create as any).mockResolvedValueOnce({ id: "review-3" });

    const res = (await action(makeRequest(BASE_BODY))) as Response;

    expect(res.status).toBe(200);
    expect(prisma.postOutfitReview.create).toHaveBeenCalled();
  });

  it("unauthenticated requests are still rejected before any ownership check runs", async () => {
    mockAuth.mockResolvedValueOnce({ customer: null });

    const res = (await action(makeRequest(BASE_BODY))) as Response;

    expect(res.status).toBe(401);
    expect(prisma.postOutfitReview.findUnique).not.toHaveBeenCalled();
  });
});
