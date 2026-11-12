// app/routes/style-me/result-ownership-behavioral.test.ts
//
// Behavioral integration coverage for the three cross-customer IDOR fixes
// hotfixed 2026-11-12 ("generate", "regenerate", "review") — this calls the
// REAL action() export with every dependency mocked, not a static source
// assertion. Added after a live Preview check (dpl_6cKEpKL7yGYeU9ZkvwjtZnz5t7Hr)
// confirmed the fix behaves correctly at runtime, to close the remaining
// local-coverage gap the static-assertion test (result-ownership.test.ts)
// can't: proving an authenticated request against an EXISTING session owned
// by a DIFFERENT customer is rejected before any downstream generation,
// regeneration, or review write — not just that a nonexistent sessionId 404s.
//
// Three scenarios per intent, synthetic data only, no real customer records:
//   - unauthenticated request
//   - an existing session/review belonging to a DIFFERENT customer
//   - an existing session/review belonging to the authenticated customer
//
// Run: npx vitest run app/routes/style-me/result-ownership-behavioral.test.ts

import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  getCurrentNaiaCustomer,
  stylingSessionFindUnique,
  outfitSuggestionCreate,
  postOutfitReviewUpsert,
  resolveActionAnchor,
} = vi.hoisted(() => ({
  getCurrentNaiaCustomer: vi.fn(),
  stylingSessionFindUnique: vi.fn(),
  outfitSuggestionCreate: vi.fn(),
  postOutfitReviewUpsert: vi.fn(),
  resolveActionAnchor: vi.fn(),
}));

vi.mock("~/lib/naia-session.server", () => ({ getCurrentNaiaCustomer }));

vi.mock("~/lib/prisma.server", () => ({
  prisma: {
    stylingSession: { findUnique: stylingSessionFindUnique },
    outfitSuggestion: { create: outfitSuggestionCreate, findUnique: vi.fn() },
    postOutfitReview: { upsert: postOutfitReviewUpsert },
    customer: { upsert: vi.fn(), findUnique: vi.fn() },
  },
}));

vi.mock("~/lib/ai/my-naia-model.server", () => ({
  loadNaiaModel: vi.fn().mockResolvedValue(null),
  computeModelReadinessFromRecord: vi.fn().mockReturnValue({ isReadyForTryOn: false }),
}));

vi.mock("~/lib/session.server", () => ({
  getSession: vi.fn().mockResolvedValue({ unset: vi.fn(), get: vi.fn(), set: vi.fn() }),
  commitSession: vi.fn().mockResolvedValue("__naia_session=cleared"),
}));

vi.mock("~/lib/pending-save.server", () => ({
  readPendingSave: vi.fn().mockResolvedValue({ status: "none" }),
  writePendingSave: vi.fn().mockResolvedValue("set-cookie-value"),
  clearPendingSave: vi.fn().mockResolvedValue("cleared-cookie-value"),
}));

vi.mock("~/lib/ai/styleme-result.server", () => ({
  buildEngineInput: vi.fn().mockReturnValue({}),
  buildProfileSignals: vi.fn().mockReturnValue({}),
  computeStyleMeResult: vi.fn().mockResolvedValue({}),
  buildDbPayload: vi.fn().mockReturnValue({
    moodDescriptionJson: "{}",
    outfitName: "Synthetic Outfit",
    whyThisWorks: null,
    confidenceBoost: null,
    perfumeRec: null,
    hairstyleRec: null,
    makeupVibeRec: null,
    songRec: null,
    songArtist: null,
    items: [],
  }),
  styleSourceToSessionSource: vi.fn().mockReturnValue("my-closet"),
}));

vi.mock("~/lib/ai/styleme-anchor.server", () => ({ resolveActionAnchor }));

vi.mock("~/lib/ai/styleme-result.types", () => ({
  parseSuggestionMetadata: vi.fn().mockReturnValue(null),
}));

vi.mock("~/lib/dev-tryon-image-tokens.server", () => ({ issueImageToken: vi.fn().mockReturnValue("token") }));
vi.mock("~/lib/ai/tryon-product-eligibility", () => ({ isTryOnEligible: vi.fn().mockReturnValue(false) }));
vi.mock("~/components/TryOnPanel", () => ({ TryOnPanel: () => null }));
vi.mock("~/components/RecommendationFeedbackWidget", () => ({ RecommendationFeedbackWidget: () => null }));

vi.mock("~/lib/ai/journey-context.server", () => ({
  buildCustomerJourneyContext: vi.fn().mockResolvedValue(null),
  buildEphemeralContextSignals: vi.fn().mockReturnValue({}),
}));

vi.mock("~/lib/ai/journey-events.server", () => ({
  emitSessionStarted: vi.fn().mockReturnValue({}),
  emitRecommendationServed: vi.fn().mockReturnValue({}),
  emitLookSaved: vi.fn().mockReturnValue({}),
  emitInSessionReviewSubmitted: vi.fn().mockReturnValue({}),
  recordJourneyEvent: vi.fn(),
  recordJourneyEventAwaited: vi.fn().mockResolvedValue(undefined),
}));

import { action } from "./result";

const CUSTOMER_A = { id: "customer-A", onboardingProfile: { completed: true } };
const CUSTOMER_B = { id: "customer-B", onboardingProfile: { completed: true } };

const SESSION_OWNED_BY_A = {
  id: "session-owned-by-A",
  customerId: "customer-A",
  styleFrom: "CLOSET",
  currentMood: "confident",
  desiredFeeling: "elevated",
  occasion: "everyday",
};

function makeRequest(fields: Record<string, string>) {
  const body = new URLSearchParams(fields);
  return {
    request: new Request("https://example.com/style-me/result", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    }),
  } as any;
}

function unwrap(result: any): { data: any; status: number | undefined } {
  // action() returns react-router's data() wrapper ({type, data, init}),
  // not a plain Response — see the bulk-export-disable lesson from earlier
  // this session: checking the wrong shape silently passes a broken test.
  return { data: result?.data, status: result?.init?.status };
}

beforeEach(() => {
  vi.clearAllMocks();
  resolveActionAnchor.mockResolvedValue({ ok: true, anchor: { kind: "closet", id: "anchor-1" } });
});

describe('"generate" — behavioral, real action(), mocked dependencies', () => {
  it("unauthenticated request is rejected before any generation occurs", async () => {
    getCurrentNaiaCustomer.mockResolvedValueOnce(null);
    stylingSessionFindUnique.mockResolvedValueOnce(SESSION_OWNED_BY_A);

    const res = unwrap(await action(makeRequest({ intent: "generate", sessionId: SESSION_OWNED_BY_A.id })));

    expect(res.status).toBe(404);
    expect(outfitSuggestionCreate).not.toHaveBeenCalled();
  });

  it("an authenticated customer cannot generate against a session owned by a DIFFERENT customer", async () => {
    getCurrentNaiaCustomer.mockResolvedValueOnce(CUSTOMER_B);
    stylingSessionFindUnique.mockResolvedValueOnce(SESSION_OWNED_BY_A);

    const res = unwrap(await action(makeRequest({ intent: "generate", sessionId: SESSION_OWNED_BY_A.id })));

    expect(res.status).toBe(404);
    expect(outfitSuggestionCreate).not.toHaveBeenCalled();
  });

  it("the legitimate owner CAN generate against their own session", async () => {
    getCurrentNaiaCustomer.mockResolvedValueOnce(CUSTOMER_A);
    stylingSessionFindUnique.mockResolvedValueOnce(SESSION_OWNED_BY_A);
    outfitSuggestionCreate.mockResolvedValueOnce({ id: "suggestion-1", items: [] });

    const res = unwrap(await action(makeRequest({ intent: "generate", sessionId: SESSION_OWNED_BY_A.id })));

    expect(res.status).toBeUndefined(); // no explicit error status — implicit 200
    expect(res.data.error).toBeNull();
    expect(outfitSuggestionCreate).toHaveBeenCalledTimes(1);
    expect(outfitSuggestionCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ sessionId: SESSION_OWNED_BY_A.id }) }),
    );
  });
});

describe('"regenerate" — behavioral, real action(), mocked dependencies', () => {
  it("unauthenticated request is rejected before any regeneration occurs", async () => {
    getCurrentNaiaCustomer.mockResolvedValueOnce(null);
    stylingSessionFindUnique.mockResolvedValueOnce(SESSION_OWNED_BY_A);

    const res = unwrap(await action(makeRequest({ intent: "regenerate", sessionId: SESSION_OWNED_BY_A.id })));

    expect(res.status).toBe(404);
    expect(outfitSuggestionCreate).not.toHaveBeenCalled();
  });

  it("an authenticated customer cannot regenerate a session owned by a DIFFERENT customer", async () => {
    getCurrentNaiaCustomer.mockResolvedValueOnce(CUSTOMER_B);
    stylingSessionFindUnique.mockResolvedValueOnce(SESSION_OWNED_BY_A);

    const res = unwrap(await action(makeRequest({ intent: "regenerate", sessionId: SESSION_OWNED_BY_A.id })));

    expect(res.status).toBe(404);
    expect(outfitSuggestionCreate).not.toHaveBeenCalled();
  });

  it("the legitimate owner CAN regenerate their own session", async () => {
    getCurrentNaiaCustomer.mockResolvedValueOnce(CUSTOMER_A);
    stylingSessionFindUnique.mockResolvedValueOnce(SESSION_OWNED_BY_A);
    outfitSuggestionCreate.mockResolvedValueOnce({ id: "suggestion-2", items: [] });

    const res = unwrap(await action(makeRequest({ intent: "regenerate", sessionId: SESSION_OWNED_BY_A.id })));

    expect(res.status).toBeUndefined();
    expect(res.data.error).toBeNull();
    expect(outfitSuggestionCreate).toHaveBeenCalledTimes(1);
  });
});

describe('"review" — behavioral, real action(), mocked dependencies', () => {
  const REVIEW_SESSION_OWNED_BY_A = {
    ...SESSION_OWNED_BY_A,
    suggestions: [{ id: "suggestion-1" }],
  };

  it("unauthenticated request is rejected before any review upsert occurs", async () => {
    getCurrentNaiaCustomer.mockResolvedValueOnce(null);
    stylingSessionFindUnique.mockResolvedValueOnce(REVIEW_SESSION_OWNED_BY_A);

    const res = unwrap(
      await action(makeRequest({ intent: "review", sessionId: SESSION_OWNED_BY_A.id, overallReaction: "4" })),
    );

    expect(res.status).toBe(404);
    expect(postOutfitReviewUpsert).not.toHaveBeenCalled();
  });

  it("an authenticated customer cannot submit a review against a session owned by a DIFFERENT customer", async () => {
    getCurrentNaiaCustomer.mockResolvedValueOnce(CUSTOMER_B);
    stylingSessionFindUnique.mockResolvedValueOnce(REVIEW_SESSION_OWNED_BY_A);

    const res = unwrap(
      await action(makeRequest({ intent: "review", sessionId: SESSION_OWNED_BY_A.id, overallReaction: "4" })),
    );

    expect(res.status).toBe(404);
    expect(postOutfitReviewUpsert).not.toHaveBeenCalled();
  });

  it("the legitimate owner CAN submit a review for their own session", async () => {
    getCurrentNaiaCustomer.mockResolvedValueOnce(CUSTOMER_A);
    stylingSessionFindUnique.mockResolvedValueOnce(REVIEW_SESSION_OWNED_BY_A);
    postOutfitReviewUpsert.mockResolvedValueOnce({ sessionId: SESSION_OWNED_BY_A.id });

    const res = unwrap(
      await action(makeRequest({ intent: "review", sessionId: SESSION_OWNED_BY_A.id, overallReaction: "4" })),
    );

    expect(res.status).toBeUndefined();
    expect(res.data.reviewSaved).toBe(true);
    expect(postOutfitReviewUpsert).toHaveBeenCalledTimes(1);
    expect(postOutfitReviewUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { sessionId: SESSION_OWNED_BY_A.id } }),
    );
  });
});
