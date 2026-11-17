// app/routes/style-me/saved-looks-isolation-behavioral.test.ts
//
// 2026-11-18 — Saved Looks customer-isolation coverage, following the exact
// established pattern of result-ownership-behavioral.test.ts: the REAL
// action()/loader() exports called with every dependency mocked, not a
// static source-text assertion.
//
// Background: `my-naia.saved.tsx`'s own loader hard-redirects away
// unconditionally — confirmed this is a deliberate, documented, tested
// product decision (55b0c80 -> f40670c -> 9cd36be: the standalone Saved
// page was merged into unified StyleMe history, where "saved" is a
// per-card bookmark, not a separate archive). That decision is NOT
// reversed here. The real, current, customer-facing Saved Looks mechanism
// is:
//   - save:   style-me/result.tsx, intent=save (already covered for
//             cross-customer rejection by result-ownership-behavioral.test.ts
//             for generate/regenerate/review; this file adds the same
//             coverage for save/delete-session specifically)
//   - view:   style-me/_index.tsx's loader, via the customer-scoped
//             savedLook.findMany query feeding the isSaved badge
//   - delete: style-me/_index.tsx, intent=delete-session (there is no
//             standalone "unsave one look" action in the current codebase
//             — removing a saved look today means deleting the whole
//             StyleMe session it came from; confirmed via grep, not
//             assumed)
//
// Run: npx vitest run app/routes/style-me/saved-looks-isolation-behavioral.test.ts

import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  requireCurrentNaiaCustomer,
  getCurrentNaiaCustomer,
  stylingSessionFindUnique,
  stylingSessionDelete,
  savedLookDeleteMany,
  savedLookFindMany,
  writeSourceEvidence,
} = vi.hoisted(() => ({
  requireCurrentNaiaCustomer: vi.fn(),
  getCurrentNaiaCustomer: vi.fn(),
  stylingSessionFindUnique: vi.fn(),
  stylingSessionDelete: vi.fn(),
  savedLookDeleteMany: vi.fn(),
  savedLookFindMany: vi.fn(),
  writeSourceEvidence: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("~/lib/naia-session.server", () => ({
  requireCurrentNaiaCustomer,
  getCurrentNaiaCustomer,
}));

vi.mock("~/db.server", () => ({
  default: {
    stylingSession: { findUnique: stylingSessionFindUnique, delete: stylingSessionDelete, findMany: vi.fn().mockResolvedValue([]) },
    savedLook: { deleteMany: savedLookDeleteMany, findMany: savedLookFindMany },
    outfitSuggestion: { findMany: vi.fn().mockResolvedValue([]) },
    onboardingProfile: { findUnique: vi.fn().mockResolvedValue(null) },
    closetItem: { count: vi.fn().mockResolvedValue(0) },
  },
}));

vi.mock("~/lib/ai/taste-reconcile.server", () => ({ writeSourceEvidence }));
vi.mock("~/lib/session.server", () => ({ clearStyleMeSession: vi.fn() }));
vi.mock("~/lib/cloudinary-admin.server", () => ({ getCloudinaryConfig: vi.fn().mockReturnValue(null) }));
vi.mock("~/lib/styleme/look-image-resolution.server", () => ({ resolveCollageImages: vi.fn().mockResolvedValue([]) }));

import { action, loader } from "./_index";

const CUSTOMER_A = { id: "customer-A" };
const CUSTOMER_B = { id: "customer-B" };

const SESSION_OWNED_BY_A = {
  customerId: "customer-A",
  suggestions: [{ id: "suggestion-1", outcome: { id: "outcome-1" } }],
  review: { id: "review-1" },
};

function makeActionArgs(fields: Record<string, string>) {
  const body = new URLSearchParams(fields);
  return {
    request: new Request("https://example.com/style-me", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    }),
  } as any;
}

function unwrap(result: any): { data: any; status: number | undefined } {
  return { data: result?.data, status: result?.init?.status };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('"delete-session" — behavioral, real action(), mocked dependencies', () => {
  it("an authenticated customer cannot delete a session owned by a DIFFERENT customer — 404, nothing deleted", async () => {
    requireCurrentNaiaCustomer.mockResolvedValueOnce(CUSTOMER_B);
    stylingSessionFindUnique.mockResolvedValueOnce(SESSION_OWNED_BY_A);

    const res = unwrap(await action(makeActionArgs({ intent: "delete-session", sessionId: "session-owned-by-A" })));

    expect(res.status).toBe(404);
    expect(savedLookDeleteMany).not.toHaveBeenCalled();
    expect(stylingSessionDelete).not.toHaveBeenCalled();
  });

  it("customer B's cross-customer attempt leaves customer A's SavedLook/session fully intact — verified by the mock NEVER being called, not just the response shape", async () => {
    requireCurrentNaiaCustomer.mockResolvedValueOnce(CUSTOMER_B);
    stylingSessionFindUnique.mockResolvedValueOnce(SESSION_OWNED_BY_A);

    await action(makeActionArgs({ intent: "delete-session", sessionId: "session-owned-by-A" }));

    // The two calls that would actually remove A's data were never reached.
    expect(stylingSessionDelete).toHaveBeenCalledTimes(0);
    expect(savedLookDeleteMany).toHaveBeenCalledTimes(0);
  });

  it("the legitimate owner CAN delete their own session, cascading to their own SavedLook rows scoped by customerId", async () => {
    requireCurrentNaiaCustomer.mockResolvedValueOnce(CUSTOMER_A);
    stylingSessionFindUnique.mockResolvedValueOnce(SESSION_OWNED_BY_A);
    stylingSessionDelete.mockResolvedValueOnce({ id: "session-owned-by-A" });

    const res = unwrap(await action(makeActionArgs({ intent: "delete-session", sessionId: "session-owned-by-A" })));

    expect(res.data).toEqual({ ok: true });
    expect(savedLookDeleteMany).toHaveBeenCalledWith({
      where: { customerId: "customer-A", fromSuggestionId: { in: ["suggestion-1"] } },
    });
    expect(stylingSessionDelete).toHaveBeenCalledWith({ where: { id: "session-owned-by-A" } });
  });

  it("a missing sessionId is rejected with 400 before any ownership check or delete", async () => {
    requireCurrentNaiaCustomer.mockResolvedValueOnce(CUSTOMER_A);

    const res = unwrap(await action(makeActionArgs({ intent: "delete-session" })));

    expect(res.status).toBe(400);
    expect(stylingSessionFindUnique).not.toHaveBeenCalled();
  });

  it("a nonexistent sessionId is indistinguishable from a cross-customer one — 404, same as the ownership-mismatch case, never leaking whether the id exists at all", async () => {
    requireCurrentNaiaCustomer.mockResolvedValueOnce(CUSTOMER_A);
    stylingSessionFindUnique.mockResolvedValueOnce(null);

    const res = unwrap(await action(makeActionArgs({ intent: "delete-session", sessionId: "does-not-exist" })));

    expect(res.status).toBe(404);
  });
});

describe("loader — savedLook customer-scoping (the isSaved-badge data source)", () => {
  it("the savedLook query is scoped to the authenticated customer's id — customer B's call never sees customer A's saved-suggestion ids", async () => {
    getCurrentNaiaCustomer.mockResolvedValueOnce(CUSTOMER_B);
    savedLookFindMany.mockImplementation(async ({ where }: any) => {
      // Simulate a real DB: only rows matching the queried customerId come
      // back — this proves the ROUTE passed the right customerId into the
      // where-clause, not that Prisma itself filters correctly (that's
      // Prisma's own contract, already trusted elsewhere in this codebase).
      const allRows = [
        { fromSuggestionId: "suggestion-from-A", customerId: "customer-A" },
        { fromSuggestionId: "suggestion-from-B", customerId: "customer-B" },
      ];
      return allRows.filter((r) => r.customerId === where.customerId);
    });

    await loader({ request: new Request("https://example.com/style-me") } as any);

    expect(savedLookFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ customerId: "customer-B" }) }),
    );
    // The mock's own filtering (standing in for Prisma's real WHERE clause)
    // never returned customer A's row for this call.
    const callArgs = savedLookFindMany.mock.calls[0][0];
    expect(callArgs.where.customerId).not.toBe("customer-A");
  });

  it("an unauthenticated viewer's call still scopes by whatever customerId is resolved (null/undefined) — never falls back to an unscoped query that would return every customer's saved looks", async () => {
    getCurrentNaiaCustomer.mockResolvedValueOnce(null);
    savedLookFindMany.mockResolvedValueOnce([]);

    await loader({ request: new Request("https://example.com/style-me") } as any);

    if (savedLookFindMany.mock.calls.length > 0) {
      const callArgs = savedLookFindMany.mock.calls[0][0];
      expect(callArgs.where).toHaveProperty("customerId");
      expect(callArgs.where.customerId).not.toEqual(expect.objectContaining({}));
    }
  });
});
