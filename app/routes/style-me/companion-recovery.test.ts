// app/routes/style-me/companion-recovery.test.ts
//
// Regenerating a WI multi-garment look ("New Look, Same Vibe") after the session cookie
// expired, was cleared, or on a different device/browser resolved the correct anchor (a
// real StylingSession.closetAnchorId DB column) but silently styled around it alone,
// dropping every required companion — the cookie was the ONLY place they lived.
//
// THE FIX. StyleMeMetadata.companionIds (styleme-result.types.ts) is a new optional key in
// the SAME versioned JSON envelope already stored in OutfitSuggestion.moodDescription for
// every other regeneration-context field (resultDirections, sameCombination, mode) — no
// schema change, no migration. From the moment a suggestion is generated, this field is the
// durable, cross-device-safe record of which closet ids were REQUIRED, independent of the
// cookie and independent of OutfitSuggestion.items (which also contains auto-recommended
// pieces — reading companions back from .items would reintroduce exactly the ambiguity this
// field exists to resolve).
//
// FAIL-CLOSED. A durable record can still fail to apply — the customer may have deleted or
// reassigned a companion garment since. resolveRegenCompanionIds (result.tsx) refuses to
// regenerate in that case rather than silently produce an incomplete look; the action
// returns `companionRecoveryBlocked` instead of a new suggestion, and the EXISTING complete
// suggestion stays exactly as rendered (a distinct field from `error`, which the component's
// error-state branch keys on — using it here would blow away the still-correct look on
// screen, the opposite of what this fix is for).

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { resolveRegenCompanionIds, buildMetadataJson } from "~/lib/ai/styleme-result.server";
import { parseSuggestionMetadata, type StyleMeCustomerResult } from "~/lib/ai/styleme-result.types";

const route = (): string =>
  readFileSync(join(process.cwd(), "app/routes/style-me/result.tsx"), "utf8");

// A minimal, valid StyleMeCustomerResult — only the fields buildMetadataJson actually reads
// are filled in meaningfully; the rest are the smallest legal value for their type.
function minimalResult(companionIds?: string[]): StyleMeCustomerResult {
  return {
    outcome: "closet-led",
    outfitName: "Test Look",
    whyThisWorks: "Because the test says so.",
    confidenceBoost: "Confident.",
    perfumeNote: null,
    primaryProduct: null,
    alternatives: [],
    closetAnchorLabel: "Test Anchor",
    closetAnchorImageUrl: null,
    pairingNote: null,
    finishingLayer: { shoes: "x", bag: null, accessories: null, hair: null, beauty: null, colourDirection: null },
    completionLayer: [],
    songReason: "x",
    song: { title: "t", artist: "a", moods: [], occasions: [] } as unknown as StyleMeCustomerResult["song"],
    rawRecommendation: { anchor: { type: "closet", id: "anchor-1", slot: "top", label: "Anchor", colors: [], material: null, styleTags: [], imageUrl: null } } as unknown as StyleMeCustomerResult["rawRecommendation"],
    resultDirections: [],
    ...(companionIds !== undefined && { companionIds }),
  };
}

// ── CR-A: the pure recovery decision ────────────────────────────────────────

describe("CR-A — resolveRegenCompanionIds decides the source of truth and the fail-closed case", () => {
  test("CR-A.1 no durable record (legacy, predates the fix): falls back to the cookie, never blocked", () => {
    const result = resolveRegenCompanionIds(undefined, [], ["cookie-id-1", "cookie-id-2"]);
    assert.deepEqual(result, { blocked: false, companionIds: ["cookie-id-1", "cookie-id-2"] });
  });

  test("CR-A.2 a durable record of ZERO companions is honoured as confirmed, not treated as missing", () => {
    const result = resolveRegenCompanionIds([], [], ["stale-cookie-id"]);
    assert.deepEqual(
      result, { blocked: false, companionIds: [] },
      "an explicit [] must win over a stale cookie value, not be confused with 'no record'",
    );
  });

  test("CR-A.3 a durable record with every id still owned is used verbatim, ignoring the cookie", () => {
    const result = resolveRegenCompanionIds(["wi-bottom", "wi-layer"], [true, true], ["irrelevant-cookie-id"]);
    assert.deepEqual(result, { blocked: false, companionIds: ["wi-bottom", "wi-layer"] });
  });

  test("CR-A.4 a single unresolvable companion blocks regeneration entirely", () => {
    const result = resolveRegenCompanionIds(["wi-bottom"], [false], []);
    assert.deepEqual(result, { blocked: true });
  });

  test("CR-A.5 three required companions, only the middle one fails ownership: still blocked (not a partial pass)", () => {
    const result = resolveRegenCompanionIds(
      ["wi-bottom", "wi-layer", "wi-bag"],
      [true, false, true],
      [],
    );
    assert.deepEqual(
      result, { blocked: true },
      "one bad id must block the WHOLE regeneration, not silently proceed with the other two",
    );
  });

  test("CR-A.6 the cookie is never consulted once a durable record exists, even an expired/empty one", () => {
    const withLiveCookie = resolveRegenCompanionIds(["a"], [true], ["b", "c"]);
    const withNoCookie = resolveRegenCompanionIds(["a"], [true], []);
    assert.deepEqual(withLiveCookie, withNoCookie, "the cookie's contents must not affect the outcome when metadata is authoritative");
  });
});

// ── CR-B: the metadata round trip — undefined vs [] survive JSON persistence ──

describe("CR-B — companionIds round-trips through the persisted moodDescription JSON envelope", () => {
  test("CR-B.1 a non-empty companion list persists and reads back exactly", () => {
    const json = buildMetadataJson(minimalResult(["wi-bottom", "wi-layer"]));
    const meta = parseSuggestionMetadata(json);
    assert.deepEqual(meta?.companionIds, ["wi-bottom", "wi-layer"]);
  });

  test("CR-B.2 an explicit empty list persists as [] — distinguishable from absent", () => {
    const json = buildMetadataJson(minimalResult([]));
    const meta = parseSuggestionMetadata(json);
    assert.deepEqual(meta?.companionIds, [], "confirmed-zero must round-trip as [], not vanish into undefined");
  });

  test("CR-B.3 omitting companionIds entirely (legacy simulation) leaves the key absent after round-trip", () => {
    const json = buildMetadataJson(minimalResult(undefined));
    const meta = parseSuggestionMetadata(json);
    assert.equal(meta?.companionIds, undefined, "a suggestion that never set this field must read back as undefined, not []");
    assert.doesNotMatch(json, /"companionIds"/, "the key itself must be absent from the stored JSON, not present-but-empty");
  });

  test("CR-B.4 a saved look reopened later (simulated: parse straight from the stored string) still carries its companions", () => {
    // "Saved look" / "reopened from history" means exactly this: nothing but the stored
    // moodDescription string survives into the next read — no cookie, no live session state.
    const stored: string = buildMetadataJson(minimalResult(["wi-bottom", "wi-layer", "wi-bag"]));
    const reopened = parseSuggestionMetadata(stored);
    assert.deepEqual(reopened?.companionIds, ["wi-bottom", "wi-layer", "wi-bag"]);
  });
});

// ── CR-C: expired cookie / cross-device regeneration is now recoverable ─────

describe("CR-C — expired-cookie and cross-device regeneration recover the original companions", () => {
  test("CR-C.1 cross-device: the durable record alone (no cookie at all) reproduces the full combination", () => {
    // Simulates opening the StylingSession from a second device/browser that never ran the
    // original WI handoff — there is no cookie carrying styleMeClosetCompanionIds here at all.
    const persisted = parseSuggestionMetadata(buildMetadataJson(minimalResult(["wi-bottom", "wi-layer"])));
    const decision = resolveRegenCompanionIds(persisted?.companionIds, [true, true], /* cookie */ []);
    assert.deepEqual(decision, { blocked: false, companionIds: ["wi-bottom", "wi-layer"] });
  });

  test("CR-C.2 expired cookie, but the companion garment was since deleted: fails closed, not silently incomplete", () => {
    const persisted = parseSuggestionMetadata(buildMetadataJson(minimalResult(["wi-bottom", "wi-layer"])));
    // wi-layer no longer resolves (deleted from the Closet since the original generation).
    const decision = resolveRegenCompanionIds(persisted?.companionIds, [true, false], []);
    assert.deepEqual(decision, { blocked: true });
  });

  test("CR-C.3 a genuinely legacy suggestion (predates this fix) with an also-expired cookie: unchanged pre-fix behaviour, not a new failure", () => {
    // No durable record AND no cookie — the one case this fix cannot recover (no data exists
    // anywhere). Must degrade to "no companions", exactly as before this fix shipped, not a
    // new blocked state — that would be a regression for every historical single-anchor
    // session, the overwhelming majority of all sessions ever created.
    const decision = resolveRegenCompanionIds(undefined, [], []);
    assert.deepEqual(decision, { blocked: false, companionIds: [] });
  });
});

// ── CR-D: mocked behavioral ownership test — multiple submitted/recovered ids ──
//
// resolveClosetAnchor itself is DB-integration-only in this codebase's convention (see
// wi-handoff-fresh-session.test.ts, WMG-L's own note) — not mockable without a database. What
// IS safely mockable, and genuinely behavioral rather than a source assertion, is the exact
// calling pattern the route uses around it: Promise.all over every id, each resolved
// independently, fed into resolveRegenCompanionIds. This test supplies a literal mock
// matching resolveClosetAnchor's (customerId, id) => Promise<T | null> signature — no Prisma,
// no network — and drives three different multi-id scenarios through the real aggregation.

describe("CR-D — mocked ownership resolution for multiple submitted companion ids", () => {
  type FakeClosetItem = { id: string; ownerOk: boolean };

  // Stands in for resolveClosetAnchor(customerId, id): returns the item when "owned", null
  // otherwise — the same null-collapses-not-found-and-not-owned contract the real function
  // documents (see wi-handoff-fresh-session.test.ts's note on this).
  const mockResolveClosetAnchor = async (
    _customerId: string,
    id: string,
    registry: Record<string, FakeClosetItem>,
  ): Promise<FakeClosetItem | null> => {
    const item = registry[id];
    if (!item || !item.ownerOk) return null;
    return item;
  };

  test("CR-D.1 three submitted ids, all owned: ownership resolves true for every one, nothing blocked", async () => {
    const registry: Record<string, FakeClosetItem> = {
      "wi-bottom": { id: "wi-bottom", ownerOk: true },
      "wi-layer": { id: "wi-layer", ownerOk: true },
      "wi-bag": { id: "wi-bag", ownerOk: true },
    };
    const priorIds = ["wi-bottom", "wi-layer", "wi-bag"];
    const resolved = await Promise.all(priorIds.map((id) => mockResolveClosetAnchor("cust-1", id, registry)));
    const decision = resolveRegenCompanionIds(priorIds, resolved.map((r) => r !== null), []);
    assert.deepEqual(decision, { blocked: false, companionIds: priorIds });
  });

  test("CR-D.2 three submitted ids, one belongs to a different customer (ownerOk: false): the whole set is blocked", async () => {
    const registry: Record<string, FakeClosetItem> = {
      "wi-bottom": { id: "wi-bottom", ownerOk: true },
      "wi-layer": { id: "wi-layer", ownerOk: false }, // cross-customer / not this customer's item
      "wi-bag": { id: "wi-bag", ownerOk: true },
    };
    const priorIds = ["wi-bottom", "wi-layer", "wi-bag"];
    const resolved = await Promise.all(priorIds.map((id) => mockResolveClosetAnchor("cust-1", id, registry)));
    assert.deepEqual(resolved.map((r) => r !== null), [true, false, true], "sanity: exactly the middle id must fail to resolve");
    const decision = resolveRegenCompanionIds(priorIds, resolved.map((r) => r !== null), []);
    assert.deepEqual(decision, { blocked: true });
  });

  test("CR-D.3 three submitted ids, one no longer exists at all (deleted): collapses to the same null as cross-customer, still blocked", async () => {
    const registry: Record<string, FakeClosetItem> = {
      "wi-bottom": { id: "wi-bottom", ownerOk: true },
      "wi-bag": { id: "wi-bag", ownerOk: true },
      // "wi-layer" intentionally absent from the registry — deleted since generation.
    };
    const priorIds = ["wi-bottom", "wi-layer", "wi-bag"];
    const resolved = await Promise.all(priorIds.map((id) => mockResolveClosetAnchor("cust-1", id, registry)));
    const decision = resolveRegenCompanionIds(priorIds, resolved.map((r) => r !== null), []);
    assert.deepEqual(decision, { blocked: true });
  });

  test("CR-D.4 two submitted ids, both owned: a smaller combination is unaffected by the three-id scenarios above", async () => {
    const registry: Record<string, FakeClosetItem> = {
      "wi-bottom": { id: "wi-bottom", ownerOk: true },
      "wi-layer": { id: "wi-layer", ownerOk: true },
    };
    const priorIds = ["wi-bottom", "wi-layer"];
    const resolved = await Promise.all(priorIds.map((id) => mockResolveClosetAnchor("cust-1", id, registry)));
    const decision = resolveRegenCompanionIds(priorIds, resolved.map((r) => r !== null), []);
    assert.deepEqual(decision, { blocked: false, companionIds: priorIds });
  });
});

// ── CR-E: the route is actually wired to the fix, not just the test file ────
//
// Source-regex, not behavioral — a claim about wiring (is the real action calling the real
// function with the real field name), not about one input's runtime behaviour. CR-A through
// CR-D already prove the LOGIC is correct in isolation; this proves result.tsx's regenerate
// action actually uses it, and that a block returns a distinct field rather than `error`
// (which would blow away the still-correct, already-displayed suggestion — see this file's
// header note).

describe("CR-E — result.tsx's regenerate action is wired to the recovery fix", () => {
  test("CR-E.1 the regenerate branch calls resolveRegenCompanionIds with the metadata and the cookie fallback", () => {
    const src = route();
    const regenAt = src.indexOf('intent === "regenerate"');
    assert.ok(regenAt > -1, "the regenerate branch must still exist");
    const scope = src.slice(regenAt, regenAt + 6000);
    assert.match(scope, /resolveRegenCompanionIds\(/, "regeneration must go through the extracted, tested decision function");
    assert.match(scope, /prevMeta\?\.companionIds/, "the durable record must be read from the previous suggestion's metadata");
    assert.match(scope, /parseClosetCompanionIds\(regenCookieSession\.get\("styleMeClosetCompanionIds"\)\)/, "the cookie fallback must still be passed in for the legacy-session case");
  });

  test("CR-E.2 a blocked recovery returns a distinct field, never the generic `error` the UI treats as a full-page takeover", () => {
    const src = route();
    const regenAt = src.indexOf('intent === "regenerate"');
    const scope = src.slice(regenAt, regenAt + 6000);
    const blockedReturn = scope.slice(scope.indexOf("companionRecovery.blocked"));
    assert.match(blockedReturn.slice(0, 400), /companionRecoveryBlocked: true/);
    assert.doesNotMatch(
      blockedReturn.slice(0, 400), /\berror:/,
      "must not set `error` — that field makes the component replace the still-correct existing suggestion with the full error page",
    );
  });

  test("CR-E.3 the UI renders the blocked message with a path back to Wardrobe Intelligence, without touching the existing suggestion", () => {
    const src = route();
    assert.match(src, /generateFetcher\.data\?\.companionRecoveryBlocked/, "the component must read the new field");
    assert.match(src, /to="\/closet\/intelligence"/, "must offer a concrete path to reselect the complete combination");
    // The existing `suggestion` variable must come from loaderData/prior state, not be
    // reassigned by this new branch — i.e. the fix adds a sibling message, not a replacement.
    const bannerAt = src.indexOf("companionRecoveryBlocked &&");
    assert.ok(bannerAt > -1);
    assert.match(src.slice(Math.max(0, bannerAt - 400), bannerAt), /sameCombination/, "must sit alongside the existing sameCombination message, same non-destructive pattern");
  });
});

// ── CR-F: a forged/wrong-customer sessionId or suggestionId is rejected uniformly ──
//
// Gap found during final acceptance (Step 4 — ownership and data isolation): no existing
// test asserted result.tsx's own cross-customer ownership checks. result.tsx reads a
// StylingSession or OutfitSuggestion by a bare id (sessionId from the URL/form, suggestionId
// from the client) in four places; each must re-verify the row's OWN customerId against the
// currently authenticated customer before doing anything with it — never trust that an id
// reaching the server belongs to whoever is asking. Source-regex, not behavioral: resolving
// an id against a forged owner requires a real customer/session row in the database, which
// this acceptance pass must not create (no shared DB access). This is the precise case Step
// 4 flags as remaining: a live pass with two real customer rows and a forged cross-customer
// id is the one thing this suite cannot prove by itself.

describe("CR-F — every id result.tsx reads from the client is re-verified against its OWN row's customerId", () => {
  test("CR-F.1 the direct-sessionId loader (?sessionId=) rejects a session owned by someone else", () => {
    const src = route();
    assert.match(src, /if \(!session \|\| session\.customerId !== naiaCustomer\.id\)/, "a session that resolves but belongs to another customer must be rejected, not just a missing session");
  });

  // UPDATED 2026-10-21 during the WI + security integration (df00020 merged in via
  // security/cross-customer-isolation-20261021 @ 17522e0). CR-F.2 used to pin a CONFIRMED
  // GAP — this guard's `naiaCustomer &&` prefix skipped the whole check for an
  // unauthenticated request, so an unauthenticated caller could regenerate another
  // customer's session. The security branch's own fix (df00020, "close 4 cross-customer
  // PostOutfitReview IDORs") tightens this to `!naiaCustomer || ...`, now present in the
  // merged file. Converted from a gap-assertion into a permanent protection test per the
  // integration's own instruction: do not delete tests documenting a vulnerability, convert
  // them once the fix lands so a regression (e.g. someone reverting to `naiaCustomer &&`)
  // is caught again.
  test("CR-F.2 the regenerate action rejects BOTH an unauthenticated caller and one authenticated as someone else", () => {
    const src = route();
    const regenAt = src.indexOf('intent === "regenerate"');
    const scope = src.slice(regenAt, regenAt + 900);
    assert.match(
      scope, /if \(!naiaCustomer \|\| session\.customerId !== naiaCustomer\.id\)/,
      "regenerate must reject when unauthenticated (!naiaCustomer) OR when authenticated as the wrong customer — the pre-fix `naiaCustomer && ...` form skipped the check entirely for an unauthenticated caller",
    );
  });

  test("CR-F.3 both the save and pending-save actions reject a suggestion owned by someone else", () => {
    const src = route();
    const matches = src.match(/suggestion\.session\.customerId !== naiaCustomer\.id/g) ?? [];
    assert.ok(matches.length >= 2, `expected both the completed-Passport save path and the pending-save path to check this; found ${matches.length}`);
  });

  // UPDATED 2026-10-21: all four ownership checks (CR-F.1/2/5/6) now use the SAME
  // `!naiaCustomer || <row>.customerId !== naiaCustomer.id` shape, uniformly rejecting an
  // unauthenticated caller and a wrongly-authenticated one with the identical generic
  // "Not found"/404 — never a distinguishing oracle between "doesn't exist" and "exists but
  // isn't yours".
  test("CR-F.4 generate, regenerate, review and the direct-sessionId loader all reject with the SAME uniform not-found shape", () => {
    const src = route();
    const uniformChecks = [
      /if \(!session \|\| session\.customerId !== naiaCustomer\.id\) \{[\s\S]{0,40}return data\(\s*\{/, // CR-F.1 (loader)
      /if \(!naiaCustomer \|\| session\.customerId !== naiaCustomer\.id\) \{\s*return data\(\{ error: "Session not found" \}, \{ status: 404 \}\);/, // CR-F.6 (generate)
      /if \(!naiaCustomer \|\| session\.customerId !== naiaCustomer\.id\) \{\s*return data\(\{ error: "Not found" \}, \{ status: 404 \}\);/, // CR-F.2 (regenerate)
      /if \(!naiaCustomer \|\| reviewSession\.customerId !== naiaCustomer\.id\) \{\s*return data\(\{ error: "Session not found" \}, \{ status: 404 \}\);/, // CR-F.5 (review)
    ];
    for (const re of uniformChecks) assert.match(src, re, `expected to find: ${re}`);
    const pendingPathChecks = (src.match(/if \(!suggestion \|\| suggestion\.session\.customerId !== naiaCustomer\.id\) \{\s*return data\(\{ error: "Not found" \}, \{ status: 404 \}\);/g) ?? []).length;
    assert.equal(pendingPathChecks, 2, "both suggestion-ownership checks must use the identical generic 'Not found' / 404 shape");
  });

  // UPDATED 2026-10-21: was CONFIRMED, SEVERE GAP — the "review" intent (post-outfit
  // feedback) had NO ownership check at all: it loaded a StylingSession by a bare
  // client-supplied sessionId and wrote/overwrote a PostOutfitReview keyed to THAT
  // session's customerId, letting any caller (authenticated as anyone, or not at all)
  // create or silently overwrite another customer's review. Fixed by df00020 on the
  // security branch, now merged in. Converted into a permanent protection test.
  test("CR-F.5 the 'review' intent now rejects a session owned by someone else before writing a PostOutfitReview", () => {
    const src = route();
    const reviewAt = src.indexOf('intent === "review"');
    assert.ok(reviewAt > -1, "the review intent must still exist");
    const reviewSessionAt = src.indexOf("const reviewSession = await prisma.stylingSession.findUnique", reviewAt);
    const scope = src.slice(reviewSessionAt, reviewSessionAt + 900);
    // Both checks must be present, and in order: the existence check first, the ownership
    // check second — ownership of a session that doesn't exist is meaningless to ask.
    const existsAt = scope.search(/if \(!reviewSession \|\| !reviewSession\.suggestions\[0\]\)/);
    const ownerAt = scope.search(/if \(!naiaCustomer \|\| reviewSession\.customerId !== naiaCustomer\.id\)/);
    assert.ok(existsAt > -1, "the existence check must still be present");
    assert.ok(ownerAt > -1, "the ownership check must now be present — this is the permanent protection for the fixed IDOR");
    assert.ok(existsAt < ownerAt, "existence must be checked before ownership");
  });

  // UPDATED 2026-10-21: was the same class of confirmed, severe gap as CR-F.5, on the
  // "generate" intent (the very first StyleMe result generation for a session). Fixed by
  // the same df00020 commit, now merged in. Converted into a permanent protection test.
  test("CR-F.6 the 'generate' intent now rejects a session owned by someone else before generating a suggestion", () => {
    const src = route();
    const genAt = src.indexOf('intent === "generate"');
    assert.ok(genAt > -1, "the generate intent must still exist");
    const sessionAt = src.indexOf("const session = await prisma.stylingSession.findUnique", genAt);
    const scope = src.slice(sessionAt, sessionAt + 900);
    assert.match(
      scope, /if \(!naiaCustomer \|\| session\.customerId !== naiaCustomer\.id\)/,
      "the generate intent must reject a session it does not own — this is the permanent protection for the fixed IDOR",
    );
  });

  // NEW 2026-10-21: the fourth ownership fix named alongside CR-F.2/5/6 — a legacy route,
  // not result.tsx, so it needs its own source reader. Also fixed by df00020.
  test("CR-F.7 api.outfit-rating.jsx (legacy route) rejects both an existing review owned by someone else and a session owned by someone else", () => {
    const src = readFileSync(join(process.cwd(), "app/routes/api.outfit-rating.jsx"), "utf8");
    assert.match(
      src, /if \(existing && existing\.customerId !== customer\.id\)/,
      "updating an existing review must reject when it belongs to a different customer",
    );
    assert.match(
      src, /if \(linkedSession && linkedSession\.customerId !== customer\.id\)/,
      "creating a new review must reject when the linked session belongs to a different customer",
    );
  });
});
