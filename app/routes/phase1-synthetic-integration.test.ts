// app/routes/phase1-synthetic-integration.test.ts
// Phase 1 verification round 2 — synthetic multi-customer integration tests.
//
// Unlike phase1-legacy-api-lockdown.test.ts (static source assertions) and the
// unit-level crypto tests in that same file, these tests call the REAL route
// handlers (action/loader exported from api.bodyscan.jsx) and the REAL
// ownership-checking function (deleteClosetItemWithImage) directly, with:
//   - TWO synthetic customers (never real data)
//   - prisma (~/db.server) fully mocked — no live database connection
//   - global fetch mocked — no live Bodygram/FASHN/Anthropic calls
//   - NaiaSession cookies constructed the same way naia-identity-security.test.ts
//     already does (vi.mock("~/db.server") + a controlled findUnique response)
//
// This directly exercises the two NEW security properties from this round:
//   1. Bodygram sessionId is bound to the customer it was issued for — not just
//      "the write uses customer.id" (§A), including the actual attack: customer
//      B presenting customer A's real sessionId + real sig.
//   2. Closet item ownership (delete) is enforced per-customer at the DB-query
//      level, not just by convention.
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
import { action as bodyscanAction, loader as bodyscanLoader } from "./api.bodyscan.jsx";
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

// ── Mock fetch — no live Bodygram/FASHN/Anthropic calls ──────────────────────

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
  process.env.BODYGRAM_API_KEY = "test-key-not-real";
  process.env.BODYGRAM_ORG_ID = "test-org-not-real";
});

// ── §1: Bodygram — full synthetic two-customer session-binding flow ──────────

describe("§1 — Bodygram scan sessionId binding, with two synthetic customers", () => {
  it("1a — customer A creates a scan session for themselves", async () => {
    installFetchMock((url) => {
      expect(url).toContain("/scan-tokens");
      return { token: "bodygram-session-for-A" };
    });

    const req = requestAs(CUSTOMER_A, "http://localhost/api/body-scan", {
      method: "POST",
      body: JSON.stringify({}),
    });
    const res = await bodyscanAction({ request: req } as any);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.sessionId).toBe("bodygram-session-for-A");
    expect(typeof data.sig).toBe("string");
    expect(data.sig.length).toBeGreaterThan(10);
    // Proves the call actually went through the mock, not a real network call.
    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0].url).toContain("platform.bodygram.com");
  });

  it("1b — customer A polls their OWN session successfully; write targets A only", async () => {
    installFetchMock((url) => {
      if (url.includes("/scan-tokens")) return { token: "sess-A" };
      return { status: "success", scan: { measurements: [{ measurementType: "WAIST_GIRTH", value: 700 }] } };
    });

    const createReq = requestAs(CUSTOMER_A, "http://localhost/api/body-scan", { method: "POST", body: "{}" });
    const createData = await (await bodyscanAction({ request: createReq } as any)).json();

    const pollReq = requestAs(
      CUSTOMER_A,
      `http://localhost/api/body-scan?sessionId=${createData.sessionId}&sig=${createData.sig}`,
    );
    const pollRes = await bodyscanLoader({ request: pollReq } as any);
    const pollData = await pollRes.json();

    expect(pollRes.status).toBe(200);
    expect(pollData.status).toBe("success");
    expect(mockUpsert()).toHaveBeenCalledOnce();
    // The actual security property: the write's `where` targets customer A,
    // never any value read from the request.
    expect(mockUpsert().mock.calls[0][0].where).toEqual({ customerId: "synthetic-customer-A" });
    expect(mockUpsert().mock.calls[0][0].create.customerId).toBe("synthetic-customer-A");
  });

  it("1c — THE ACTUAL EXPLOIT: customer B presents customer A's real sessionId + real sig", async () => {
    // Customer A legitimately creates a session and receives a valid sig for it.
    installFetchMock(() => ({ token: "sess-A-real" }));
    const createReq = requestAs(CUSTOMER_A, "http://localhost/api/body-scan", { method: "POST", body: "{}" });
    const { sessionId, sig } = await (await bodyscanAction({ request: createReq } as any)).json();

    // Customer B authenticates as THEMSELVES, but tries to poll A's sessionId,
    // presenting A's own sig (e.g. obtained from A's browser network tab, or a
    // pasted support request — the realistic leak vector this closes).
    installFetchMock(() => {
      throw new Error("Bodygram scan-result must never be called for a rejected request");
    });
    const exploitReq = requestAs(CUSTOMER_B, `http://localhost/api/body-scan?sessionId=${sessionId}&sig=${sig}`);
    const exploitRes = await bodyscanLoader({ request: exploitReq } as any);

    expect(exploitRes.status).toBe(403);
    const exploitData = await exploitRes.json();
    expect(exploitData.error).toMatch(/does not belong/i);
    // The two properties that actually matter: no provider call, no DB write —
    // customer B's attempt never got anywhere near A's data.
    expect(fetchCalls).toHaveLength(0);
    expect(mockUpsert()).not.toHaveBeenCalled();
  });

  it("1d — unauthenticated request never reaches Bodygram or the DB", async () => {
    installFetchMock(() => {
      throw new Error("Bodygram must never be called for an unauthenticated request");
    });
    const req = requestUnauthenticated("http://localhost/api/body-scan?sessionId=x&sig=y");
    const res = await bodyscanLoader({ request: req } as any);

    expect(res.status).toBe(401);
    expect(fetchCalls).toHaveLength(0);
    expect(mockUpsert()).not.toHaveBeenCalled();
    // Confirms auth is checked before even the DB-mocked identity lookup
    // fires — resolveClerkUserId returns null for a request with no Clerk
    // session, and getCurrentNaiaCustomer short-circuits before ever
    // calling prisma.customer.findUnique.
    expect(mockCustomerFindUnique()).not.toHaveBeenCalled();
  });
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
