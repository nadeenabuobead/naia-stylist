// Tests for the QA-fixture-only actions added to api.seed-staging.jsx:
// setOnboardingProfile and createClosetItemDetailed.
//
// Kept separate from api.seed-staging.test.ts (which has pre-existing,
// unrelated drift — it asserts a VERCEL_ENV gate the code no longer uses,
// see commit "fix(seed-staging): use NAIA_PROJECT_VARIANT guard instead of
// VERCEL_ENV" — not touched here).
//
// Run: npx vitest run app/routes/api.seed-staging.fixture-actions.test.ts

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../db.server", () => ({
  default: {
    customer: { findUnique: vi.fn() },
    onboardingProfile: { upsert: vi.fn() },
    closetItem: { create: vi.fn() },
  },
}));

vi.mock("../lib/ai/journey-events.server", () => ({
  emitClosetItemAdded: vi.fn(),
  recordJourneyEvent: vi.fn(),
}));

import prisma from "../db.server";
import { action } from "./api.seed-staging";

const STAGING_SECRET = "test-secret-abc123";

function makeActionRequest(body: object): Parameters<typeof action>[0] {
  return {
    request: new Request("https://example.com/api/seed-staging", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-seed-secret": STAGING_SECRET },
      body: JSON.stringify(body),
    }),
  } as any;
}

describe("§S4 seed-staging fixture actions — scoped to test-batch1- customers only", () => {
  const originalVariant = process.env.NAIA_PROJECT_VARIANT;
  const originalSecret = process.env.STAGING_SEED_SECRET;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NAIA_PROJECT_VARIANT = "staging";
    process.env.STAGING_SEED_SECRET = STAGING_SECRET;
  });

  afterEach(() => {
    process.env.NAIA_PROJECT_VARIANT = originalVariant;
    process.env.STAGING_SEED_SECRET = originalSecret;
  });

  it("S401 — setOnboardingProfile refuses a customerId that is not a test-batch1- fixture", async () => {
    (prisma.customer.findUnique as any).mockResolvedValueOnce({
      id: "real-customer-id",
      shopifyCustomerId: "123456789", // a real Shopify numeric id, not test-batch1-
    });
    const res = await action(
      makeActionRequest({ _action: "setOnboardingProfile", customerId: "real-customer-id", profile: { lifestyle: ["office"] } }),
    );
    expect((res as Response).status).toBe(403);
    expect(prisma.onboardingProfile.upsert).not.toHaveBeenCalled();
  });

  it("S402 — setOnboardingProfile refuses when the customer does not exist at all", async () => {
    (prisma.customer.findUnique as any).mockResolvedValueOnce(null);
    const res = await action(
      makeActionRequest({ _action: "setOnboardingProfile", customerId: "nonexistent", profile: { lifestyle: ["office"] } }),
    );
    expect((res as Response).status).toBe(403);
    expect(prisma.onboardingProfile.upsert).not.toHaveBeenCalled();
  });

  it("S403 — setOnboardingProfile proceeds for a genuine test-batch1- fixture customer", async () => {
    (prisma.customer.findUnique as any).mockResolvedValueOnce({
      id: "fixture-id",
      shopifyCustomerId: "test-batch1-wi-a-populated",
    });
    (prisma.onboardingProfile.upsert as any).mockResolvedValueOnce({ id: "profile-1", completed: true });
    const res = await action(
      makeActionRequest({ _action: "setOnboardingProfile", customerId: "fixture-id", profile: { lifestyle: ["office"] } }),
    );
    expect((res as Response).status).toBe(200);
    expect(prisma.onboardingProfile.upsert).toHaveBeenCalledTimes(1);
  });

  it("S404 — createClosetItemDetailed refuses a customerId that is not a test-batch1- fixture", async () => {
    (prisma.customer.findUnique as any).mockResolvedValueOnce({
      id: "real-customer-id",
      shopifyCustomerId: "123456789",
    });
    const res = await action(
      makeActionRequest({ _action: "createClosetItemDetailed", customerId: "real-customer-id", item: { category: "TOPS" } }),
    );
    expect((res as Response).status).toBe(403);
    expect(prisma.closetItem.create).not.toHaveBeenCalled();
  });

  it("S405 — createClosetItemDetailed proceeds for a genuine test-batch1- fixture customer", async () => {
    (prisma.customer.findUnique as any).mockResolvedValueOnce({
      id: "fixture-id",
      shopifyCustomerId: "test-batch1-wi-a-populated",
    });
    (prisma.closetItem.create as any).mockResolvedValueOnce({ id: "item-1", category: "TOPS", primaryColor: "Black" });
    const res = await action(
      makeActionRequest({ _action: "createClosetItemDetailed", customerId: "fixture-id", item: { category: "TOPS" } }),
    );
    expect((res as Response).status).toBe(200);
    expect(prisma.closetItem.create).toHaveBeenCalledTimes(1);
  });

  it("S406 — a customer whose shopifyCustomerId merely contains, but does not start with, the prefix is refused", async () => {
    (prisma.customer.findUnique as any).mockResolvedValueOnce({
      id: "tricky-id",
      shopifyCustomerId: "123-test-batch1-wi-a-populated",
    });
    const res = await action(
      makeActionRequest({ _action: "setOnboardingProfile", customerId: "tricky-id", profile: {} }),
    );
    expect((res as Response).status).toBe(403);
  });
});
