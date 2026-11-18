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
// Originally written and committed (7f3acb4) to FAIL against the
// pre-fix code: there was no feature gate, flag, or kill-switch
// anywhere in api.bodyscan.jsx, only customer authentication +
// session-ownership binding (an IDOR fix, not an exclusion mechanism).
// /api/body-scan remains registered (app/routes.ts:150) and
// BODYGRAM_API_KEY/BODYGRAM_ORG_ID are documented in .env.example as
// "Required: Yes ... Dev, Preview, Prod" and confirmed already
// configured in staging (RELEASE_MANIFEST.md) — the route was
// operationally callable, not inert.
//
// 2026-11-18 Founder Decision: fixed via a BODYGRAM_ENABLED = false
// constant (same convention as VIRTUAL_TRY_ON_ENABLED), checked first
// in both action() and loader() — before authentication, any database
// operation, or the outbound fetch. These tests now PASS, covering both
// authenticated and unauthenticated access, and assert the fetch mock
// and DB mocks are never even called, not just that the response isn't
// 200.
//
// This test never makes a real Bodygram call: fetch is mocked to throw
// if invoked at all. The mock never fires once the fix is in place.
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

function requestUnauthenticated(url: string, init?: RequestInit) {
  return new Request(url, init);
}

const originalFetch = globalThis.fetch;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  process.env.SESSION_SECRET ||= "bodygram-exclusion-test-secret";
  process.env.BODYGRAM_API_KEY = "test-key-not-real";
  process.env.BODYGRAM_ORG_ID = "test-org-not-real";
  fetchMock = vi.fn(async () => {
    throw new Error("Bodygram must never be called — the feature is excluded from launch");
  });
  globalThis.fetch = fetchMock as any;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("api.bodyscan — launch exclusion (Bodygram must be unreachable, not just customer-isolated)", () => {
  it("EXCL-1 — a fully authenticated, otherwise-legitimate customer's scan-token request is rejected with 503, Bodygram never called", async () => {
    const req = requestAs(CUSTOMER_A, "http://localhost/api/body-scan", {
      method: "POST",
      body: JSON.stringify({}),
    });

    const res = await bodyscanAction({ request: req } as any);
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body.error).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("EXCL-2 — a fully authenticated, otherwise-valid scan-result poll is rejected with 503 — Bodygram never called, OnboardingProfile never written", async () => {
    const sig = signSessionOwnership("sess-A", CUSTOMER_A.id);
    const req = requestAs(
      CUSTOMER_A,
      `http://localhost/api/body-scan?sessionId=sess-A&sig=${encodeURIComponent(sig)}`,
    );

    const res = await bodyscanLoader({ request: req } as any);
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body.error).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockUpsert()).not.toHaveBeenCalled();
  });

  it("EXCL-3 — an UNAUTHENTICATED scan-token request is also rejected with 503 before any auth check — Bodygram never called, identity never looked up", async () => {
    const req = requestUnauthenticated("http://localhost/api/body-scan", {
      method: "POST",
      body: JSON.stringify({}),
    });

    const res = await bodyscanAction({ request: req } as any);
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body.error).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockCustomerFindUnique()).not.toHaveBeenCalled();
  });

  it("EXCL-4 — an UNAUTHENTICATED scan-result poll is also rejected with 503 — Bodygram never called, nothing ever written", async () => {
    const req = requestUnauthenticated("http://localhost/api/body-scan?sessionId=sess-X&sig=whatever");

    const res = await bodyscanLoader({ request: req } as any);
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body.error).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockCustomerFindUnique()).not.toHaveBeenCalled();
    expect(mockUpsert()).not.toHaveBeenCalled();
  });
});
