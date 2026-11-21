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
  computeStyleMeResult,
} = vi.hoisted(() => ({
  getCurrentNaiaCustomer: vi.fn(),
  stylingSessionFindUnique: vi.fn(),
  outfitSuggestionCreate: vi.fn(),
  outfitSuggestionFindUnique: vi.fn(),
  postOutfitReviewUpsert: vi.fn(),
  savedLookCreate: vi.fn(),
  resolveActionAnchor: vi.fn(),
  // H2 (2026-11-21, upgraded to enforce same day) — velocity check on
  // "regenerate". Default: within limit — individual tests below override
  // this to exercise the over-limit 429 path. The underlying atomicity/
  // fail-open/windowing behavior of checkRateLimit itself is already
  // covered by api-rate-limit.test.ts and api-rate-limit-sql.test.ts; these
  // tests cover only this ROUTE's own wiring (called with the right
  // customer/routeKey, rejects correctly, never calls the paid generation
  // path when rejected).
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true, overLimit: false, mode: "enforce", count: 1, limit: 20, retryAfterSeconds: 0 }),
  computeStyleMeResult: vi.fn().mockResolvedValue({}),
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
  computeStyleMeResult,
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

// Same shape as unwrap, plus headers — for the H2 429 tests that need to
// assert on Retry-After. `any`-typed on purpose: action()'s real return
// type is a big union (data() wrappers for every intent branch plus a
// plain Response for redirects), and narrowing it per-call-site here would
// just be noise — the real route code stays fully typed, only this test
// helper widens.
function unwrapFull(result: any): { data: any; status: number | undefined; headers: Record<string, string> } {
  return { data: result?.data, status: result?.init?.status, headers: result?.init?.headers ?? {} };
}

beforeEach(() => {
  vi.clearAllMocks();
  resolveActionAnchor.mockResolvedValue({ ok: true, anchor: { kind: "closet", id: "anchor-1" } });
  // vi.clearAllMocks() wipes the vi.hoisted default implementation too — reset
  // it here so every test starts from "within limit, allowed" unless it
  // explicitly overrides this to exercise the over-limit 429 path.
  checkRateLimit.mockResolvedValue({ allowed: true, overLimit: false, mode: "enforce", count: 1, limit: 20, retryAfterSeconds: 0 });
  computeStyleMeResult.mockResolvedValue({});
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

  // H2 (2026-11-21, upgraded to ENFORCE same day) — regenerate has no
  // StyleMe quota (by design — only the first "generate" on a session
  // counts) and no cooldown of its own, so it had zero velocity protection
  // of any kind before this check. mode: "enforce" in the route's own config
  // (not just shadow observation) actually blocks once the limit is hit.
  it("checkRateLimit is called with the authenticated customer's id and enforce mode, after ownership, before any paid generation call", async () => {
    getCurrentNaiaCustomer.mockResolvedValueOnce(CUSTOMER_A);
    stylingSessionFindUnique.mockResolvedValueOnce(SESSION_OWNED_BY_A);
    outfitSuggestionCreate.mockResolvedValueOnce({ id: "suggestion-2", items: [] });

    await action(makeRequest({ intent: "regenerate", sessionId: SESSION_OWNED_BY_A.id }));

    expect(checkRateLimit).toHaveBeenCalledTimes(1);
    expect(checkRateLimit).toHaveBeenCalledWith(
      CUSTOMER_A.id,
      expect.objectContaining({ routeKey: "styleme-regenerate", mode: "enforce", limit: 20, windowSeconds: 60 }),
    );
    // Called strictly before the paid call — if the ordering ever regressed
    // (rate limit checked after generation), this would still pass, which
    // is exactly why the dedicated "exhausted limit" tests below assert
    // computeStyleMeResult was never invoked at all in that case.
    expect(computeStyleMeResult).toHaveBeenCalledTimes(1);
  });

  it("within the limit: regenerates normally, exactly one paid call, current suggestion replaced", async () => {
    getCurrentNaiaCustomer.mockResolvedValueOnce(CUSTOMER_A);
    stylingSessionFindUnique.mockResolvedValueOnce(SESSION_OWNED_BY_A);
    outfitSuggestionCreate.mockResolvedValueOnce({ id: "suggestion-2", items: [] });
    checkRateLimit.mockResolvedValueOnce({ allowed: true, overLimit: false, mode: "enforce", count: 5, limit: 20, retryAfterSeconds: 0 });

    const res = unwrap(await action(makeRequest({ intent: "regenerate", sessionId: SESSION_OWNED_BY_A.id })));

    expect(res.status).toBeUndefined();
    expect(res.data.rateLimited).toBeUndefined();
    expect(computeStyleMeResult).toHaveBeenCalledTimes(1);
    expect(outfitSuggestionCreate).toHaveBeenCalledTimes(1);
  });

  // ── Exhausted limit: safe 429, zero paid calls, appropriate retry messaging ──
  it("exhausted limit (allowed:false) returns 429 with Retry-After BEFORE computeStyleMeResult runs — zero paid calls", async () => {
    getCurrentNaiaCustomer.mockResolvedValueOnce(CUSTOMER_A);
    stylingSessionFindUnique.mockResolvedValueOnce(SESSION_OWNED_BY_A);
    checkRateLimit.mockResolvedValueOnce({ allowed: false, overLimit: true, mode: "enforce", count: 21, limit: 20, retryAfterSeconds: 42 });

    const res = unwrapFull(await action(makeRequest({ intent: "regenerate", sessionId: SESSION_OWNED_BY_A.id })));

    expect(res.status).toBe(429);
    expect(res.headers["Retry-After"]).toBe("42");
    // Distinct field, never `error` — the error-state guard in the
    // component would otherwise blow away the customer's current,
    // perfectly good suggestion over a transient rate-limit hit.
    expect(res.data.rateLimited).toBe(true);
    expect(res.data.retryAfterSeconds).toBe(42);
    expect(res.data.error).toBeUndefined();
    // The actual guarantee this fix exists for: no paid call, no DB write,
    // when the limit is exhausted.
    expect(computeStyleMeResult).not.toHaveBeenCalled();
    expect(outfitSuggestionCreate).not.toHaveBeenCalled();
  });

  it("repeat requests: once exhausted, every subsequent regenerate call in the same burst is rejected the same way", async () => {
    getCurrentNaiaCustomer.mockResolvedValue(CUSTOMER_A);
    stylingSessionFindUnique.mockResolvedValue(SESSION_OWNED_BY_A);
    // Simulates checkRateLimit's own real behavior once a customer is over
    // the window's limit: every call in the same window keeps reporting
    // not-allowed, not just the one that tipped it over.
    checkRateLimit.mockResolvedValue({ allowed: false, overLimit: true, mode: "enforce", count: 25, limit: 20, retryAfterSeconds: 10 });

    for (let i = 0; i < 5; i++) {
      const res = unwrapFull(await action(makeRequest({ intent: "regenerate", sessionId: SESSION_OWNED_BY_A.id })));
      expect(res.status).toBe(429);
    }

    expect(computeStyleMeResult).not.toHaveBeenCalled();
    expect(outfitSuggestionCreate).not.toHaveBeenCalled();
    expect(checkRateLimit).toHaveBeenCalledTimes(5);
  });

  it("concurrent requests: parallel regenerate calls each independently respect whatever checkRateLimit reports for that call", async () => {
    getCurrentNaiaCustomer.mockResolvedValue(CUSTOMER_A);
    stylingSessionFindUnique.mockResolvedValue(SESSION_OWNED_BY_A);
    outfitSuggestionCreate.mockResolvedValue({ id: "suggestion-2", items: [] });
    // First two calls land inside the window (allowed), the third is the
    // one that tips it over — exercises the route under concurrency without
    // re-testing the shared module's own atomic DB counter (already covered
    // by api-rate-limit-sql.test.ts).
    checkRateLimit
      .mockResolvedValueOnce({ allowed: true, overLimit: false, mode: "enforce", count: 18, limit: 20, retryAfterSeconds: 0 })
      .mockResolvedValueOnce({ allowed: true, overLimit: false, mode: "enforce", count: 19, limit: 20, retryAfterSeconds: 0 })
      .mockResolvedValueOnce({ allowed: false, overLimit: true, mode: "enforce", count: 21, limit: 20, retryAfterSeconds: 5 });

    const results = await Promise.all([
      action(makeRequest({ intent: "regenerate", sessionId: SESSION_OWNED_BY_A.id })),
      action(makeRequest({ intent: "regenerate", sessionId: SESSION_OWNED_BY_A.id })),
      action(makeRequest({ intent: "regenerate", sessionId: SESSION_OWNED_BY_A.id })),
    ]);
    const statuses = results.map((r) => (r as any).init?.status).sort();

    expect(statuses).toEqual([429, undefined, undefined]);
    expect(computeStyleMeResult).toHaveBeenCalledTimes(2);
  });

  it("account isolation: checkRateLimit is always called with THIS request's authenticated customer, never a different one", async () => {
    getCurrentNaiaCustomer.mockResolvedValueOnce(CUSTOMER_B);
    stylingSessionFindUnique.mockResolvedValueOnce({ ...SESSION_OWNED_BY_A, customerId: CUSTOMER_B.id });
    outfitSuggestionCreate.mockResolvedValueOnce({ id: "suggestion-3", items: [] });

    await action(makeRequest({ intent: "regenerate", sessionId: SESSION_OWNED_BY_A.id }));

    expect(checkRateLimit).toHaveBeenCalledWith(CUSTOMER_B.id, expect.anything());
    expect(checkRateLimit).not.toHaveBeenCalledWith(CUSTOMER_A.id, expect.anything());
  });

  // 2026-11-21 — checkRateLimit's own real fail-open behavior (its internal
  // DB call throws, it catches that internally, and resolves with
  // allowed:true, failedOpen:true — never a rejected promise). Regenerate
  // has no other cap, so this route overrides that to fail CLOSED: a
  // rate-limit-store outage must not become unlimited paid Claude calls.
  it("checkRateLimit's real failedOpen:true result (rate-limit store unavailable) is treated as NOT allowed — fails closed, not unlimited calls", async () => {
    getCurrentNaiaCustomer.mockResolvedValueOnce(CUSTOMER_A);
    stylingSessionFindUnique.mockResolvedValueOnce(SESSION_OWNED_BY_A);
    checkRateLimit.mockResolvedValueOnce({ allowed: true, overLimit: false, mode: "enforce", count: 0, limit: 20, retryAfterSeconds: 0, failedOpen: true });

    const res = unwrapFull(await action(makeRequest({ intent: "regenerate", sessionId: SESSION_OWNED_BY_A.id })));

    expect(res.status).toBe(429);
    expect(res.data.rateLimited).toBe(true);
    // The module itself reports 0 (no real window during an outage) — the
    // route floors this to a sane minimum so the customer isn't told to
    // retry instantly into the same outage.
    expect(res.data.retryAfterSeconds).toBeGreaterThanOrEqual(5);
    expect(res.headers["Retry-After"]).toBe(String(res.data.retryAfterSeconds));
    expect(computeStyleMeResult).not.toHaveBeenCalled();
    expect(outfitSuggestionCreate).not.toHaveBeenCalled();
  });

  it("checkRateLimit rejecting (DB/infra error surfaced as a thrown promise, not the module's own fail-open) is caught by the route's existing outer try/catch, not left unhandled", async () => {
    getCurrentNaiaCustomer.mockResolvedValueOnce(CUSTOMER_A);
    stylingSessionFindUnique.mockResolvedValueOnce(SESSION_OWNED_BY_A);
    // api-rate-limit.server.ts's real checkRateLimit never rejects (it fails
    // open internally and always resolves) — this proves that if it ever
    // did, for any reason, the existing action-level try/catch still returns
    // a clean 500 rather than crashing the request, and still never reaches
    // the paid call.
    checkRateLimit.mockRejectedValueOnce(new Error("simulated rate-limit infra failure"));

    const res = unwrapFull(await action(makeRequest({ intent: "regenerate", sessionId: SESSION_OWNED_BY_A.id })));

    expect(res.status).toBe(500);
    expect(computeStyleMeResult).not.toHaveBeenCalled();
    expect(outfitSuggestionCreate).not.toHaveBeenCalled();
  });

  it("ownership is still checked first — a different customer's session 404s before checkRateLimit is ever called", async () => {
    getCurrentNaiaCustomer.mockResolvedValueOnce(CUSTOMER_B);
    stylingSessionFindUnique.mockResolvedValueOnce(SESSION_OWNED_BY_A);

    const res = unwrap(await action(makeRequest({ intent: "regenerate", sessionId: SESSION_OWNED_BY_A.id })));

    expect(res.status).toBe(404);
    expect(checkRateLimit).not.toHaveBeenCalled();
    expect(computeStyleMeResult).not.toHaveBeenCalled();
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
