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
  outfitSuggestionFindUnique,
  postOutfitReviewUpsert,
  savedLookCreate,
  resolveActionAnchor,
  checkRateLimit,
} = vi.hoisted(() => ({
  getCurrentNaiaCustomer: vi.fn(),
  stylingSessionFindUnique: vi.fn(),
  outfitSuggestionCreate: vi.fn(),
  outfitSuggestionFindUnique: vi.fn(),
  postOutfitReviewUpsert: vi.fn(),
  savedLookCreate: vi.fn(),
  resolveActionAnchor: vi.fn(),
  // H2 (2026-11-21) — shadow-mode velocity check on "regenerate". Default:
  // always allowed, same as real shadow mode — individual tests below
  // override this to prove the enforce-mode path (route code, not the
  // shared module, already covered by api-rate-limit.test.ts) is wired
  // correctly end to end.
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true, overLimit: false, mode: "shadow", count: 1, limit: 20, retryAfterSeconds: 0 }),
}));

vi.mock("~/lib/naia-session.server", () => ({ getCurrentNaiaCustomer }));

vi.mock("~/lib/api-rate-limit.server", () => ({ checkRateLimit }));

// Was "~/lib/prisma.server" (a separate, uncapped PrismaClient) until the
// 2026-11-17 fix retargeted result.tsx at the shared, connection-capped
// db.server client instead — see app/db.server.js's own header for why that
// cap matters in production.
vi.mock("~/db.server", () => ({
  default: {
    stylingSession: { findUnique: stylingSessionFindUnique },
    // findFirst added after the reroll-anchor-diversity feature landed —
    // "regenerate" reads the most-recent suggestion to penalize repeats.
    outfitSuggestion: { create: outfitSuggestionCreate, findUnique: outfitSuggestionFindUnique, findFirst: vi.fn().mockResolvedValue(null) },
    postOutfitReview: { upsert: postOutfitReviewUpsert },
    customer: { upsert: vi.fn(), findUnique: vi.fn() },
    // 2026-11-18 — added for "save" (Case 1: completed-Passport immediate save).
    savedLook: { create: savedLookCreate },
  },
}));

vi.mock("~/lib/ai/my-naia-model.server", () => ({
  loadNaiaModel: vi.fn().mockResolvedValue(null),
  computeModelReadinessFromRecord: vi.fn().mockReturnValue({ isReadyForTryOn: false }),
}));

vi.mock("~/lib/session.server", () => ({
  getSession: vi.fn().mockResolvedValue({ unset: vi.fn(), get: vi.fn(), set: vi.fn() }),
  commitSession: vi.fn().mockResolvedValue("__naia_session=cleared"),
  // Added after the WI-companions durable-record feature landed — reads
  // directly from the cookie, same as styleMeMode/occasionDisplayLabel.
  // A malformed value fails closed to an empty list, never throws.
  parseClosetCompanionIds: vi.fn().mockReturnValue([]),
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
  // Added after the companion-recovery feature landed — pure decision logic,
  // database-free; default to "nothing to recover, proceed unblocked".
  resolveRegenCompanionIds: vi.fn().mockReturnValue({ blocked: false, companionIds: [] }),
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
  // vi.clearAllMocks() wipes the vi.hoisted default implementation too — reset
  // it here so every test starts from "shadow mode, always allowed" unless it
  // explicitly overrides this to exercise the enforce-mode 429 path.
  checkRateLimit.mockResolvedValue({ allowed: true, overLimit: false, mode: "shadow", count: 1, limit: 20, retryAfterSeconds: 0 });
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

  // H2 (2026-11-21) — regenerate has no StyleMe quota (by design — only the
  // first "generate" on a session counts) and no cooldown of its own, so it
  // had zero velocity protection of any kind before this shadow-mode check.
  it("checkRateLimit is called with the authenticated customer's id, after ownership, before any paid generation call", async () => {
    getCurrentNaiaCustomer.mockResolvedValueOnce(CUSTOMER_A);
    stylingSessionFindUnique.mockResolvedValueOnce(SESSION_OWNED_BY_A);
    outfitSuggestionCreate.mockResolvedValueOnce({ id: "suggestion-2", items: [] });

    await action(makeRequest({ intent: "regenerate", sessionId: SESSION_OWNED_BY_A.id }));

    expect(checkRateLimit).toHaveBeenCalledTimes(1);
    expect(checkRateLimit).toHaveBeenCalledWith(
      CUSTOMER_A.id,
      expect.objectContaining({ routeKey: "styleme-regenerate", mode: "shadow" }),
    );
  });

  it("shadow mode never blocks — overLimit true but allowed true still regenerates normally", async () => {
    getCurrentNaiaCustomer.mockResolvedValueOnce(CUSTOMER_A);
    stylingSessionFindUnique.mockResolvedValueOnce(SESSION_OWNED_BY_A);
    outfitSuggestionCreate.mockResolvedValueOnce({ id: "suggestion-2", items: [] });
    checkRateLimit.mockResolvedValueOnce({ allowed: true, overLimit: true, mode: "shadow", count: 99, limit: 20, retryAfterSeconds: 42 });

    const res = unwrap(await action(makeRequest({ intent: "regenerate", sessionId: SESSION_OWNED_BY_A.id })));

    expect(res.status).toBeUndefined();
    expect(outfitSuggestionCreate).toHaveBeenCalledTimes(1);
  });

  it("the route-level wiring correctly rejects when checkRateLimit reports allowed:false (proves enforce mode would work if ever turned on)", async () => {
    getCurrentNaiaCustomer.mockResolvedValueOnce(CUSTOMER_A);
    stylingSessionFindUnique.mockResolvedValueOnce(SESSION_OWNED_BY_A);
    checkRateLimit.mockResolvedValueOnce({ allowed: false, overLimit: true, mode: "enforce", count: 21, limit: 20, retryAfterSeconds: 42 });

    const res = unwrap(await action(makeRequest({ intent: "regenerate", sessionId: SESSION_OWNED_BY_A.id })));

    expect(res.status).toBe(429);
    expect(outfitSuggestionCreate).not.toHaveBeenCalled();
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

// 2026-11-18 — Saved Looks: "save" (Case 1, completed-Passport immediate
// save) gets the same cross-customer-IDOR coverage as generate/regenerate/
// review above. The ownership check here is one level removed from a
// session id: it checks suggestion.session.customerId, since a suggestion
// (not a session) is what gets saved.
describe('"save" — behavioral, real action(), mocked dependencies', () => {
  const SUGGESTION_OWNED_BY_A = {
    id: "suggestion-owned-by-A",
    outfitName: "Weekend Brunch Look",
    items: [{ itemType: "TOP", closetItemId: "closet-1", shopifyProductId: null, productImageUrl: null }],
    session: { customerId: "customer-A" },
  };

  it("unauthenticated request is rejected before any save occurs", async () => {
    getCurrentNaiaCustomer.mockResolvedValueOnce(null);
    // Deliberately NOT queuing a mockResolvedValueOnce for
    // outfitSuggestionFindUnique here: an unauthenticated customer fails
    // the `naiaCustomer?.onboardingProfile?.completed` check in Case 1 (and
    // Case 2's `if (naiaCustomer)`) before the suggestion lookup is ever
    // reached. A leftover queued value here was previously consumed by a
    // LATER test instead (vi.clearAllMocks() does not drain unconsumed
    // mockResolvedValueOnce queues), silently shifting every subsequent
    // test's mock return by one and producing two tests that looked like
    // their expectations had been swapped. Asserting the call count below
    // is what actually caught it.

    const res = unwrap(
      await action(makeRequest({ intent: "save", suggestionId: SUGGESTION_OWNED_BY_A.id, sessionId: "s1" })),
    );

    expect(res.status).toBe(404);
    expect(outfitSuggestionFindUnique).not.toHaveBeenCalled();
    expect(savedLookCreate).not.toHaveBeenCalled();
  });

  it("an authenticated customer cannot save a suggestion belonging to a DIFFERENT customer's session", async () => {
    getCurrentNaiaCustomer.mockResolvedValueOnce(CUSTOMER_B);
    outfitSuggestionFindUnique.mockResolvedValueOnce(SUGGESTION_OWNED_BY_A);

    const res = unwrap(
      await action(makeRequest({ intent: "save", suggestionId: SUGGESTION_OWNED_BY_A.id, sessionId: "s1" })),
    );

    expect(res.status).toBe(404);
    expect(savedLookCreate).not.toHaveBeenCalled();
  });

  it("customer B's cross-customer attempt never creates a SavedLook attributed to customer A — not just a 404 response, the write itself never happens", async () => {
    getCurrentNaiaCustomer.mockResolvedValueOnce(CUSTOMER_B);
    outfitSuggestionFindUnique.mockResolvedValueOnce(SUGGESTION_OWNED_BY_A);

    await action(makeRequest({ intent: "save", suggestionId: SUGGESTION_OWNED_BY_A.id, sessionId: "s1" }));

    expect(savedLookCreate).toHaveBeenCalledTimes(0);
  });

  it("a nonexistent suggestionId is indistinguishable from a cross-customer one — 404 either way, never leaking existence", async () => {
    getCurrentNaiaCustomer.mockResolvedValueOnce(CUSTOMER_A);
    outfitSuggestionFindUnique.mockResolvedValueOnce(null);

    const res = unwrap(
      await action(makeRequest({ intent: "save", suggestionId: "does-not-exist", sessionId: "s1" })),
    );

    expect(res.status).toBe(404);
    expect(savedLookCreate).not.toHaveBeenCalled();
  });

  it("the legitimate owner CAN save their own suggestion, correctly attributed to their own customerId", async () => {
    getCurrentNaiaCustomer.mockResolvedValueOnce(CUSTOMER_A);
    outfitSuggestionFindUnique.mockResolvedValueOnce(SUGGESTION_OWNED_BY_A);
    savedLookCreate.mockResolvedValueOnce({ id: "saved-look-1" });

    const res = unwrap(
      await action(makeRequest({ intent: "save", suggestionId: SUGGESTION_OWNED_BY_A.id, sessionId: "s1" })),
    );

    expect(res.status).toBeUndefined();
    expect(res.data).toEqual({ saved: true, error: null });
    expect(savedLookCreate).toHaveBeenCalledTimes(1);
    expect(savedLookCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          customerId: "customer-A",
          fromSuggestionId: SUGGESTION_OWNED_BY_A.id,
        }),
      }),
    );
  });
});
