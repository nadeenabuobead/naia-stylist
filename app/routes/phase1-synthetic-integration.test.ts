// app/routes/phase1-synthetic-integration.test.ts
// Phase 1 verification round 2 — synthetic multi-customer integration tests.
//
// Unlike phase1-legacy-api-lockdown.test.ts (static source assertions) and the
// unit-level crypto tests in that same file, these tests call the REAL
// ownership-checking function (deleteClosetItemWithImage) directly, with:
//   - TWO synthetic customers (never real data)
//   - prisma (~/db.server) fully mocked — no live database connection
//   - global fetch mocked — no live FASHN/Anthropic calls
//   - NaiaSession cookies constructed the same way naia-identity-security.test.ts
//     already does (vi.mock("~/db.server") + a controlled findUnique response)
//
// This directly exercises:
//   Closet item ownership (delete) is enforced per-customer at the DB-query
//   level, not just by convention.
//
// §1 (Bodygram sessionId-binding, action/loader imported from
// api.bodyscan.jsx) was removed 2026-11-18 — Bodygram is permanently out of
// scope and that route no longer exists. See phase1-legacy-api-lockdown.test.ts
// §B for the retirement regression coverage.
//
// Run: npx vitest run app/routes/phase1-synthetic-integration.test.ts

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock the database (no live connection) ───────────────────────────────────
//
// Identity resolution (2026-11-05, Clerk migration): getCurrentNaiaCustomer
// is now Clerk-backed (clerk-session.server.ts), not the old __naia_tok
// cookie / NaiaSession table — see that file's own header comment. The
// boundary this suite mocks moves with it: @clerk/backend's
// authenticateRequest (so each synthetic request can declare which Clerk
// user it is, via a test-only header no production code ever reads) and
// prisma.customer.findUnique (the Clerk-era identity lookup), replacing the
// old naiaSession mock. clerk-session.server.ts itself runs for REAL here —
// only its two actual boundaries (the Clerk SDK call, and the DB) are
// mocked — preserving the original "real route handler, mocked
// network/DB" philosophy this file's header describes.

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
  const closetItemFindFirst = vi.fn();
  const closetItemDelete = vi.fn().mockResolvedValue({});
  return {
    default: {
      customer: { findUnique: customerFindUnique },
      onboardingProfile: { upsert: onboardingProfileUpsert },
      closetItem: { findFirst: closetItemFindFirst, delete: closetItemDelete },
    },
  };
});

vi.mock("../lib/ai/taste-reconcile.server.js", () => ({
  writeSourceEvidence: vi.fn().mockResolvedValue(undefined),
}));

import prisma from "~/db.server";
import { deleteClosetItemWithImage } from "../lib/closet-item-deletion.server.js";

const mockCustomerFindUnique = () => (prisma as any).customer.findUnique as ReturnType<typeof vi.fn>;
const mockUpsert = () => (prisma as any).onboardingProfile.upsert as ReturnType<typeof vi.fn>;
const mockClosetFindFirst = () => (prisma as any).closetItem.findFirst as ReturnType<typeof vi.fn>;
const mockClosetDelete = () => (prisma as any).closetItem.delete as ReturnType<typeof vi.fn>;

// ── Synthetic customers — never real data ─────────────────────────────────────

const CUSTOMER_A = { id: "synthetic-customer-A", clerkUserId: "clerk_synthetic-customer-A", shopifyCustomerId: null, email: null, firstName: null, onboardingProfile: null };
const CUSTOMER_B = { id: "synthetic-customer-B", clerkUserId: "clerk_synthetic-customer-B", shopifyCustomerId: null, email: null, firstName: null, onboardingProfile: null };

function requestAs(customer: typeof CUSTOMER_A, url: string, init?: RequestInit) {
  const headers = new Headers(init?.headers);
  headers.set(TEST_CLERK_USER_HEADER, customer.clerkUserId);
  mockCustomerFindUnique().mockResolvedValueOnce(customer);
  return new Request(url, { ...init, headers });
}

function requestUnauthenticated(url: string, init?: RequestInit) {
  return new Request(url, init);
}

// ── Mock fetch — no live FASHN/Anthropic calls ───────────────────────────────

let fetchCalls: { url: string; init?: RequestInit }[] = [];
const originalFetch = globalThis.fetch;

function installFetchMock(responder: (url: string) => any) {
  fetchCalls = [];
  globalThis.fetch = vi.fn(async (input: any, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.url;
    fetchCalls.push({ url, init });
    const body = responder(url);
    return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  globalThis.fetch = originalFetch;
  fetchCalls = [];
  process.env.SESSION_SECRET ||= "phase1-synthetic-test-secret";
});

// ── §2: Closet — per-customer ownership enforcement, synthetic accounts ──────

describe("§2 — Closet item ownership, with two synthetic customers", () => {
  it("2a — customer A can delete their own item", async () => {
    mockClosetFindFirst().mockResolvedValueOnce({ id: "item-1", imagePublicId: null });
    const result = await deleteClosetItemWithImage("item-1", "synthetic-customer-A");
    expect(result.deleted).toBe(true);
    expect(mockClosetFindFirst()).toHaveBeenCalledWith({
      where: { id: "item-1", customerId: "synthetic-customer-A" },
      select: { id: true, imagePublicId: true },
    });
    expect(mockClosetDelete()).toHaveBeenCalledOnce();
  });

  it("2b — THE ACTUAL ISOLATION: customer B cannot delete customer A's item", async () => {
    // The query itself is scoped to (id, customerId) — querying as B for A's
    // item id returns nothing, exactly as a real DB would for a non-matching row.
    mockClosetFindFirst().mockResolvedValueOnce(null);
    const result = await deleteClosetItemWithImage("item-belonging-to-A", "synthetic-customer-B");
    expect(result.deleted).toBe(false);
    if (!result.deleted) expect(result.errorCode).toBe("NOT_FOUND");
    expect(mockClosetFindFirst()).toHaveBeenCalledWith({
      where: { id: "item-belonging-to-A", customerId: "synthetic-customer-B" },
      select: { id: true, imagePublicId: true },
    });
    // No delete call ever happens for a non-owned item.
    expect(mockClosetDelete()).not.toHaveBeenCalled();
  });
});
