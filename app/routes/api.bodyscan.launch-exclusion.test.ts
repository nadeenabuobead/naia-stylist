// app/routes/api.bodyscan.launch-exclusion.test.ts
//
// 2026-11-18 — Bodygram launch-exclusion verification.
//
// Every existing Bodygram test (phase1-legacy-api-lockdown.test.ts §B,
// phase1-synthetic-integration.test.ts §1) verifies CUSTOMER-ISOLATION
// properties around an INTENTIONALLY-LIVE Bodygram integration — they
// explicitly assert the real platform.bodygram.com call happens for any
// authenticated customer (see phase1-synthetic-integration.test.ts "1a").
// None of them verify that Bodygram is excluded from launch. This file
// is that missing check.
//
// This test is expected to FAIL against the current code: there is no
// feature gate, flag, or kill-switch anywhere in api.bodyscan.jsx — only
// customer authentication + session-ownership binding (an IDOR fix, not
// an exclusion mechanism). /api/body-scan remains registered
// (app/routes.ts:150) and BODYGRAM_API_KEY/BODYGRAM_ORG_ID are documented
// in .env.example as "Required: Yes ... Dev, Preview, Prod" and confirmed
// already configured in staging (RELEASE_MANIFEST.md) — this route is
// operationally callable today, not inert.
//
// This test never makes a real Bodygram call either way: fetch is mocked
// to throw if invoked at all, for a fully authenticated, legitimate
// customer request — the one case none of the existing tests cover,
// because every existing test's job is to prove the opposite (that the
// call DOES go through once authenticated).
//
// Run: npx vitest run app/routes/api.bodyscan.launch-exclusion.test.ts

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const TEST_CLERK_USER_HEADER = "X-Test-Clerk-User-Id";

vi.mock("@clerk/backend", () => ({
  createClerkClient: () => ({
    authenticateRequest: async (request: Request) => {
      const clerkUserId = request.headers.get(TEST_CLERK_USER_HEADER);
      return {
        toAuth: () => (clerkUserId ? { isAuthenticated: true, userId: clerkUserId } : { isAuthenticated: false, userId: null }),
      };
    },
  }),
}));

vi.mock("~/db.server", () => {
  const customerFindUnique = vi.fn();
  const onboardingProfileUpsert = vi.fn().mockResolvedValue({});
  return {
    default: {
      customer: { findUnique: customerFindUnique },
      onboardingProfile: { upsert: onboardingProfileUpsert },
    },
  };
});

import prisma from "~/db.server";
import { action as bodyscanAction, loader as bodyscanLoader } from "./api.bodyscan.jsx";
import { signSessionOwnership } from "../lib/bodyscan-session-binding.server";

const mockCustomerFindUnique = () => (prisma as any).customer.findUnique as ReturnType<typeof vi.fn>;
const mockUpsert = () => (prisma as any).onboardingProfile.upsert as ReturnType<typeof vi.fn>;

const CUSTOMER_A = {
  id: "synthetic-customer-A",
  clerkUserId: "clerk_synthetic-customer-A",
  shopifyCustomerId: null,
  email: null,
  firstName: null,
  onboardingProfile: null,
};

function requestAs(customer: typeof CUSTOMER_A, url: string, init?: RequestInit) {
  const headers = new Headers(init?.headers);
  headers.set(TEST_CLERK_USER_HEADER, customer.clerkUserId);
  mockCustomerFindUnique().mockResolvedValueOnce(customer);
  return new Request(url, { ...init, headers });
}

const originalFetch = globalThis.fetch;

beforeEach(() => {
  process.env.SESSION_SECRET ||= "bodygram-exclusion-test-secret";
  process.env.BODYGRAM_API_KEY = "test-key-not-real";
  process.env.BODYGRAM_ORG_ID = "test-org-not-real";
  globalThis.fetch = vi.fn(async () => {
    throw new Error("Bodygram must never be called — the feature is excluded from launch");
  });
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("api.bodyscan — launch exclusion (Bodygram must be unreachable, not just customer-isolated)", () => {
  it("EXCL-1 — a fully authenticated, otherwise-legitimate customer's scan-token request must NOT reach Bodygram", async () => {
    const req = requestAs(CUSTOMER_A, "http://localhost/api/body-scan", {
      method: "POST",
      body: JSON.stringify({}),
    });

    const res = await bodyscanAction({ request: req } as any);

    expect(res.status).not.toBe(200);
    expect([404, 503]).toContain(res.status);
  });

  it("EXCL-2 — a fully authenticated, otherwise-valid scan-result poll must NOT reach Bodygram or write to OnboardingProfile", async () => {
    const sig = signSessionOwnership("sess-A", CUSTOMER_A.id);
    const req = requestAs(
      CUSTOMER_A,
      `http://localhost/api/body-scan?sessionId=sess-A&sig=${encodeURIComponent(sig)}`,
    );

    const res = await bodyscanLoader({ request: req } as any);

    expect(res.status).not.toBe(200);
    expect([404, 503]).toContain(res.status);
    expect(mockUpsert()).not.toHaveBeenCalled();
  });
});
