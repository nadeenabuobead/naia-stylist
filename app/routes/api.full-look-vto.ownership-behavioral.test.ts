// app/routes/api.full-look-vto.ownership-behavioral.test.ts
//
// d3-8 (2026-11-19) — VTO output access controls / cross-customer
// isolation audit. api.full-look-vto.test.ts already covers
// loadOwnedSuggestion's ownership check, but only via source-text
// assertions (regex/substring matching against the route file's own
// code) — proving the right lines exist, not that the route actually
// behaves correctly at runtime. Its sibling routes
// (api.tryon-status.$jobId.behavioral.test.ts,
// api.tryon-result.behavioral.test.ts,
// api.full-look-vto-diagnostic.test.ts) all have a genuine behavioral
// test for this exact property; this route didn't. This file closes
// that gap: it invokes the REAL loader and action with a mocked
// outfitSuggestion whose session belongs to a DIFFERENT customer than
// the authenticated session, and asserts both that the response is the
// same "not found" (never a distinguishing signal) every other caller
// gets, and that no downstream orchestrator function is ever reached —
// not selectFullLookGarments, not pollFullLookOutfit, not
// findCompletedFullLookForSuggestion, not startFullLookOutfit. No real
// FASHN/Cloudinary call, no real customer data.
//
// Run: npx vitest run app/routes/api.full-look-vto.ownership-behavioral.test.ts

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/db.server", () => ({
  default: {
    outfitSuggestion: { findUnique: vi.fn() },
  },
}));

vi.mock("~/lib/naia-session.server", () => ({
  getCurrentNaiaCustomer: vi.fn(),
}));

vi.mock("~/lib/ai/my-naia-model.server", () => ({
  loadNaiaModel: vi.fn(),
  computeModelReadinessFromRecord: vi.fn(),
}));

vi.mock("~/lib/plan/entitlement.server", () => ({
  checkEntitlement: vi.fn(),
}));

vi.mock("~/lib/cloudinary-admin.server", () => ({
  getCloudinaryConfig: vi.fn(() => null),
}));

vi.mock("~/lib/ai/full-look-vto-orchestrator.server", () => ({
  selectFullLookGarments: vi.fn(),
  startFullLookOutfit: vi.fn(),
  pollFullLookOutfit: vi.fn(),
  recoverFullLookStep: vi.fn(),
  findCompletedFullLookForSuggestion: vi.fn(),
}));

import prisma from "~/db.server";
import { getCurrentNaiaCustomer } from "~/lib/naia-session.server";
import {
  selectFullLookGarments,
  startFullLookOutfit,
  pollFullLookOutfit,
  recoverFullLookStep,
  findCompletedFullLookForSuggestion,
} from "~/lib/ai/full-look-vto-orchestrator.server";
import { loader, action } from "./api.full-look-vto";

const CUSTOMER_ID = "cust_001";
const OTHER_CUSTOMER_ID = "cust_999";
const SUGGESTION_ID = "sugg_001";

function mockForeignSuggestion() {
  return {
    id: SUGGESTION_ID,
    session: { customerId: OTHER_CUSTOMER_ID }, // belongs to someone else
    items: [{ closetItem: { name: "Blazer", imageUrl: null, imagePublicId: "p", imageFormat: "jpg", category: "TOPS" } }],
  };
}

function mockMissingSuggestion() {
  return null;
}

function getReq(suggestionId: string) {
  return new Request(`http://localhost/api/full-look-vto?suggestionId=${suggestionId}`);
}

function postReq(body: Record<string, unknown>) {
  return new Request("http://localhost/api/full-look-vto", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  (getCurrentNaiaCustomer as any).mockResolvedValue({ id: CUSTOMER_ID });
});

describe("GET /api/full-look-vto — cross-customer access blocked before any orchestrator call", () => {
  it("returns the same not-found response for a suggestion owned by a different customer as for one that doesn't exist at all", async () => {
    (prisma.outfitSuggestion.findUnique as any).mockResolvedValue(mockForeignSuggestion());
    const foreignRes: any = await loader({ request: getReq(SUGGESTION_ID), params: {}, context: {} } as any);

    (prisma.outfitSuggestion.findUnique as any).mockResolvedValue(mockMissingSuggestion());
    const missingRes: any = await loader({ request: getReq(SUGGESTION_ID), params: {}, context: {} } as any);

    expect(foreignRes.init.status).toBe(404);
    expect(missingRes.init.status).toBe(404);
    expect(foreignRes.data).toEqual(missingRes.data); // indistinguishable, by design
  });

  it("never calls selectFullLookGarments, pollFullLookOutfit, or findCompletedFullLookForSuggestion for a foreign suggestion", async () => {
    (prisma.outfitSuggestion.findUnique as any).mockResolvedValue(mockForeignSuggestion());
    await loader({ request: getReq(SUGGESTION_ID), params: {}, context: {} } as any);

    expect(selectFullLookGarments).not.toHaveBeenCalled();
    expect(pollFullLookOutfit).not.toHaveBeenCalled();
    expect(findCompletedFullLookForSuggestion).not.toHaveBeenCalled();
  });
});

describe("POST /api/full-look-vto — cross-customer access blocked before any orchestrator call", () => {
  const VALID_BODY = { outfitSuggestionId: SUGGESTION_ID, virtualTryOnConsentAt: new Date().toISOString() };

  it("returns 404 for a suggestion owned by a different customer, same as a missing one", async () => {
    (prisma.outfitSuggestion.findUnique as any).mockResolvedValue(mockForeignSuggestion());
    const foreignRes: any = await action({ request: postReq(VALID_BODY), params: {}, context: {} } as any);

    (prisma.outfitSuggestion.findUnique as any).mockResolvedValue(mockMissingSuggestion());
    const missingRes: any = await action({ request: postReq(VALID_BODY), params: {}, context: {} } as any);

    expect(foreignRes.init.status).toBe(404);
    expect(missingRes.init.status).toBe(404);
    expect(foreignRes.data).toEqual(missingRes.data);
  });

  it("never calls any orchestrator function (selectFullLookGarments, startFullLookOutfit, findCompletedFullLookForSuggestion, recoverFullLookStep) for a foreign suggestion, including on a recover:true request", async () => {
    (prisma.outfitSuggestion.findUnique as any).mockResolvedValue(mockForeignSuggestion());
    await action({ request: postReq({ ...VALID_BODY, recover: true }), params: {}, context: {} } as any);

    expect(selectFullLookGarments).not.toHaveBeenCalled();
    expect(startFullLookOutfit).not.toHaveBeenCalled();
    expect(findCompletedFullLookForSuggestion).not.toHaveBeenCalled();
    expect(recoverFullLookStep).not.toHaveBeenCalled();
  });

  it("never calls any orchestrator function on a retry:true request for a foreign suggestion either", async () => {
    (prisma.outfitSuggestion.findUnique as any).mockResolvedValue(mockForeignSuggestion());
    await action({ request: postReq({ ...VALID_BODY, retry: true }), params: {}, context: {} } as any);

    expect(selectFullLookGarments).not.toHaveBeenCalled();
    expect(startFullLookOutfit).not.toHaveBeenCalled();
  });
});
