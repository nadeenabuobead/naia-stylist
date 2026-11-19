// app/routes/api.trend-feedback-ownership.test.ts
//
// 2026-11-19 — Trend Feedback customer-isolation coverage, following the same
// pattern as api.saved-items-ownership.test.ts and
// app/routes/style-me/saved-looks-isolation-behavioral.test.ts: the REAL
// action() called with every dependency mocked.
//
// Run: npx vitest run app/routes/api.trend-feedback-ownership.test.ts

import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  getCurrentNaiaCustomer,
  feedbackFindUnique,
  feedbackCreate,
  feedbackDelete,
} = vi.hoisted(() => ({
  getCurrentNaiaCustomer: vi.fn(),
  feedbackFindUnique: vi.fn(),
  feedbackCreate: vi.fn(),
  feedbackDelete: vi.fn(),
}));

vi.mock("~/lib/naia-session.server", () => ({ getCurrentNaiaCustomer }));

vi.mock("~/db.server", () => ({
  default: {
    trendContentFeedback: {
      findUnique: feedbackFindUnique,
      create: feedbackCreate,
      delete: feedbackDelete,
    },
  },
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

import { action } from "./api.trend-feedback";

const CUSTOMER_A = { id: "customer-A" };
const CUSTOMER_B = { id: "customer-B" };

function postArgs(fields: Record<string, string>) {
  const body = new URLSearchParams(fields);
  return {
    request: new Request("https://example.com/api/trend-feedback", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    }),
  } as any;
}

function unwrap(result: any): { data: any; status: number | undefined } {
  return { data: result?.data, status: result?.init?.status };
}

const FEEDBACK_FORM = {
  contentType: "TREND",
  contentKey: "softened-tailoring",
  reportSlug: "spring-2026-soft-structure",
  active: "true",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("setTrendFeedback scoping — every query names the SESSION customerId", () => {
  it("customer B marking 'not for me' never matches or disturbs a row created under customer A's id", async () => {
    getCurrentNaiaCustomer.mockResolvedValueOnce(CUSTOMER_B);
    feedbackFindUnique.mockImplementation(async ({ where }: any) => {
      const key = where.customerId_reportSlug_contentType_contentKey_action;
      // Simulated DB: a row exists only under customer A's id.
      if (key.customerId === "customer-A") return { id: "fb-row-A" };
      return null;
    });
    feedbackCreate.mockResolvedValueOnce({ id: "fb-row-B" });

    await action(postArgs(FEEDBACK_FORM));

    expect(feedbackCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ customerId: "customer-B" }) }),
    );
    // Customer A's row was never read for a delete and never deleted.
    expect(feedbackDelete).not.toHaveBeenCalled();
  });

  it("reversing (active=false) only deletes a row scoped to the caller's own customerId", async () => {
    getCurrentNaiaCustomer.mockResolvedValueOnce(CUSTOMER_A);
    feedbackFindUnique.mockResolvedValueOnce({ id: "fb-row-A" });
    feedbackDelete.mockResolvedValueOnce({ id: "fb-row-A" });

    await action(postArgs({ ...FEEDBACK_FORM, active: "false" }));

    expect(feedbackFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          customerId_reportSlug_contentType_contentKey_action: expect.objectContaining({ customerId: "customer-A" }),
        }),
      }),
    );
    expect(feedbackDelete).toHaveBeenCalledWith({ where: { id: "fb-row-A" } });
  });

  it("an unauthenticated request never reaches resolve or the DB", async () => {
    getCurrentNaiaCustomer.mockResolvedValueOnce(null);

    const res = unwrap(await action(postArgs(FEEDBACK_FORM)));

    expect(res.status).toBe(401);
    expect(feedbackFindUnique).not.toHaveBeenCalled();
    expect(feedbackCreate).not.toHaveBeenCalled();
  });
});

describe("FACET is not a valid contentType in this v1", () => {
  it("rejects a FACET feedback payload as bad_request", async () => {
    getCurrentNaiaCustomer.mockResolvedValueOnce(CUSTOMER_A);

    const res = unwrap(await action(postArgs({ ...FEEDBACK_FORM, contentType: "FACET", contentKey: "material:suede" })));

    expect(res.status).toBe(400);
    expect(res.data).toEqual({ ok: false, error: "bad_request" });
    expect(feedbackCreate).not.toHaveBeenCalled();
  });
});
