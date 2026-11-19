// app/routes/api.saved-items-ownership.test.ts
//
// 2026-11-19 — Saved Items customer-isolation coverage, following the exact
// established pattern of app/routes/style-me/saved-looks-isolation-behavioral.test.ts:
// the REAL action()/loader() exports called with every dependency mocked,
// not a static source-text assertion.
//
// Covers the mandatory cross-customer check for this new customer-data route
// (one customer must never be able to read or delete another's SavedItem),
// plus the FACET-type rejection required by the facet-free v1 scope.
//
// Run: npx vitest run app/routes/api.saved-items-ownership.test.ts

import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  getCurrentNaiaCustomer,
  savedItemFindUnique,
  savedItemCreate,
  savedItemDeleteMany,
} = vi.hoisted(() => ({
  getCurrentNaiaCustomer: vi.fn(),
  savedItemFindUnique: vi.fn(),
  savedItemCreate: vi.fn(),
  savedItemDeleteMany: vi.fn(),
}));

vi.mock("~/lib/naia-session.server", () => ({ getCurrentNaiaCustomer }));

vi.mock("~/db.server", () => ({
  default: {
    savedItem: {
      findUnique: savedItemFindUnique,
      create: savedItemCreate,
      deleteMany: savedItemDeleteMany,
    },
  },
}));

vi.mock("~/lib/ai/naia-catalog", () => ({
  getProductByHandle: () => ({
    handle: "navy-blazer",
    parsed: {
      identity: { verifiedTitle: "Navy Blazer", featuredImageUrl: null },
      prose: { stylingRole: null },
    },
  }),
}));

vi.mock("~/lib/editorial-reports.server", () => ({
  getEditorialReportBySlug: vi.fn().mockResolvedValue({
    slug: "spring-2026-soft-structure",
    title: "Spring 2026 Wardrobe Edit",
    season: "Spring 2026",
    keyTrends: [{ name: "Softened Tailoring", description: "x" }],
    rising: [], fading: [], referencesBehindThisEdit: [],
  }),
}));

import { action } from "./api.saved-items";

const CUSTOMER_A = { id: "customer-A" };
const CUSTOMER_B = { id: "customer-B" };
const A_ROW = { id: "saved-item-1" };

function postArgs(fields: Record<string, string>) {
  const body = new URLSearchParams(fields);
  return {
    request: new Request("https://example.com/api/saved-items", {
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

describe("unsave — cross-customer isolation", () => {
  it("customer B's unsave of customer A's itemKey never matches a row — scoped lookup by customerId finds nothing", async () => {
    getCurrentNaiaCustomer.mockResolvedValueOnce(CUSTOMER_B);
    // Simulates the real DB: findUnique is scoped to (customerId, itemKey) —
    // B's customerId never matches A's row, so this returns null regardless
    // of what itemKey string is sent.
    savedItemFindUnique.mockImplementation(async ({ where }: any) => {
      if (where.customerId_itemKey.customerId === "customer-A") return A_ROW;
      return null;
    });

    const res = unwrap(await action(postArgs({
      intent: "unsave",
      itemKey: "TREND:spring-2026-soft-structure:softened-tailoring",
    })));

    expect(res.data).toEqual({ ok: true, saved: false, itemKey: "TREND:spring-2026-soft-structure:softened-tailoring" });
    // The row that actually belongs to A was never reached by a delete call.
    expect(savedItemDeleteMany).not.toHaveBeenCalled();
  });

  it("the legitimate owner's unsave DOES delete, scoped by customerId as well as id (defence in depth)", async () => {
    getCurrentNaiaCustomer.mockResolvedValueOnce(CUSTOMER_A);
    savedItemFindUnique.mockResolvedValueOnce(A_ROW);
    savedItemDeleteMany.mockResolvedValueOnce({ count: 1 });

    await action(postArgs({ intent: "unsave", itemKey: "TREND:spring-2026-soft-structure:softened-tailoring" }));

    expect(savedItemDeleteMany).toHaveBeenCalledWith({ where: { id: "saved-item-1", customerId: "customer-A" } });
  });

  it("an unauthenticated unsave is rejected before any DB lookup", async () => {
    getCurrentNaiaCustomer.mockResolvedValueOnce(null);

    const res = unwrap(await action(postArgs({ intent: "unsave", itemKey: "whatever" })));

    expect(res.status).toBe(401);
    expect(savedItemFindUnique).not.toHaveBeenCalled();
  });
});

describe("save — scoped to the authenticated customer only", () => {
  it("the created row is written with the SESSION customer's id, never a client-supplied one", async () => {
    getCurrentNaiaCustomer.mockResolvedValueOnce(CUSTOMER_A);
    savedItemFindUnique.mockResolvedValueOnce(null);
    savedItemCreate.mockResolvedValueOnce({ id: "new-row" });

    await action(postArgs({
      intent: "save",
      contentType: "TREND",
      contentKey: "softened-tailoring",
      reportSlug: "spring-2026-soft-structure",
      // Even if a tampered form tried to name a different customer, nothing
      // in the action reads a customerId from the form at all.
      customerId: "customer-B",
    }));

    expect(savedItemCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ customerId: "customer-A" }) }),
    );
  });
});

describe("FACET is not a valid contentType in this v1 (facet vocabulary stays frozen)", () => {
  it("a save with contentType=FACET is rejected as bad_request, never reaching resolve or the DB", async () => {
    getCurrentNaiaCustomer.mockResolvedValueOnce(CUSTOMER_A);

    const res = unwrap(await action(postArgs({
      intent: "save",
      contentType: "FACET",
      contentKey: "material:suede",
      reportSlug: "spring-2026-soft-structure",
    })));

    expect(res.status).toBe(400);
    expect(res.data).toEqual({ ok: false, error: "bad_request" });
    expect(savedItemCreate).not.toHaveBeenCalled();
  });
});
