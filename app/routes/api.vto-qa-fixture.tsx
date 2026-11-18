// app/routes/api.vto-qa-fixture.tsx
//
// Narrowly-scoped, staging-only, deterministic Full-Look VTO test fixture.
//
// WHY THIS EXISTS: a real StyleMe generation does not guarantee an outfit
// with 3+ Full-Look-eligible garments. selectAdditionalClosetGarments fills
// each clothing slot only when a candidate clears its own suitability gate
// (styleme-result.server.ts) — a real outfit can legitimately come back as
// just an anchor + one companion, which Full-Look's own 3-category floor
// (selectFullLookGarments, full-look-vto-orchestrator.server.ts) would then
// decline. Re-running real StyleMe generation to "try for a bigger outfit"
// would waste a real Claude API call and a real monthly StyleMe-generation
// slot on every attempt that comes up short, with no way to predict how
// many attempts that takes.
//
// This route sidesteps the AI engine entirely: it picks up to 5 of the
// target customer's OWN existing closet items — one per Full-Look-eligible
// category, in the exact same priority order and slot-mapping the real
// engine uses (closetItemToSlot + the same slot->OutfitItemType mapping as
// slotToItemType in styleme-result.server.ts, duplicated here rather than
// exported from that file) — and persists them as a plain OutfitSuggestion
// + OutfitItem rows pointing at those real items. No Claude call, no FASHN
// call, no new closet upload, no account creation. If fewer than 3 eligible
// categories exist, nothing is created and the response says so — the
// eligibility check IS the creation gate, so "verify before creating" and
// "the actual creation" are the same atomic step.
//
// The resulting OutfitSuggestion deliberately has moodDescription: null —
// qualifyingStyleMeWhere (entitlement.server.ts) requires a non-null
// moodDescription for a session to count toward the StyleMe monthly quota,
// so this fixture consumes neither a real StyleMe generation nor any VTO
// entitlement. It is otherwise indistinguishable from a real suggestion to
// every downstream Full-Look VTO code path (loadOwnedSuggestion only reads
// suggestion.items and session.customerId).
//
// AUTHORIZATION — three independent checks, same posture as the entitlement
// overrides (plan-limits.server.ts): VERCEL_ENV must be "preview" or
// "development" (Vercel's own system variable, never hand-configured),
// NAIA_PROJECT_VARIANT must be exactly "staging", and the customerId in the
// request body must match QA_OVERRIDE_CUSTOMER_ID exactly — the SAME
// designated single disposable account used everywhere else in this
// effort. A dedicated VTO_QA_FIXTURE_SECRET header is also required,
// deliberately NOT shared with STAGING_SEED_SECRET/WI_QA_LOGIN_SECRET, so
// this route can never be invoked by anything authorized only for the
// existing shared seed-staging fixture tooling (and vice versa) — this
// keeps Five-Persona QA's own fixture secret completely uninvolved.
//
// POST creates; GET verifies (read-only); DELETE removes exactly the
// StylingSession + OutfitSuggestion this POST created (see that handler's
// own comment for its narrow scoping) — see deleteFixtureSuggestion below.
// Never creates a ClosetItem, never creates a Customer, never touches any
// customer other than the one named by QA_OVERRIDE_CUSTOMER_ID.
//
// POST body field fixtureKind: "styleme-result-view" (2026-11-18) switches
// to a second, independent fixture shape — see createStyleMeResultViewFixture
// below for why and how it differs from the Full-Look fixture above.
//
// fixtureKind: "closet-legacy-image-ownership" (2026-11-18, same day) is a
// third, independent fixture — see createClosetLegacyImageOwnershipFixture
// below. Unlike the two above, it creates real ClosetItem/BuyOrSkipAnalysis
// rows (not StyleMe sessions) to exercise QA #36's ownership/priority logic.

import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data } from "react-router";
import { timingSafeEqual } from "crypto";
import dbServer from "~/db.server";
import { closetItemToSlot } from "~/lib/ai/closet-slot";
import { getCurrentNaiaCustomer } from "~/lib/clerk-session.server";
import type { OutfitSlot } from "~/lib/ai/styleme-recommendation.types";
import type { OutfitItemType, PrismaClient } from "@prisma/client";

const prisma: PrismaClient = dbServer;
import { getCloudinaryConfig } from "~/lib/cloudinary-admin.server";
import { selectFullLookGarments, type SelectableOutfitItem } from "~/lib/ai/full-look-vto-orchestrator.server";
import { loadNaiaModel, computeModelReadinessFromRecord } from "~/lib/ai/my-naia-model.server";

// Mirrors slotToItemType in app/lib/ai/styleme-result.server.ts exactly —
// that function is private to a large, sensitive file this fixture has no
// other reason to import from. Keep in sync if the real mapping changes.
const SLOT_TO_ITEM_TYPE: Record<OutfitSlot, OutfitItemType> = {
  top: "TOP",
  bottom: "BOTTOM",
  dress: "DRESS",
  set: "DRESS",
  outerwear: "OUTERWEAR",
  shoe: "SHOES",
  bag: "BAG",
  accessory: "ACCESSORY",
  jewelry: "JEWELRY",
  unknown: "TOP",
};

// Same priority order as CATEGORY_PRIORITY in full-look-vto-orchestrator.server.ts.
const ELIGIBLE_SLOT_PRIORITY: OutfitSlot[] = [
  "dress", "set", "top", "bottom", "outerwear", "shoe", "accessory", "bag", "jewelry",
];
const FULL_LOOK_MAX_GARMENTS = 5;
const FULL_LOOK_MIN_GARMENTS = 3;

function timingSafeStringEqual(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

function isAuthorized(request: Request, customerId: unknown): customerId is string {
  if (process.env.VERCEL_ENV !== "preview" && process.env.VERCEL_ENV !== "development") return false;
  if (process.env.NAIA_PROJECT_VARIANT !== "staging") return false;
  const providedSecret = request.headers.get("x-vto-qa-fixture-secret") ?? undefined;
  if (!timingSafeStringEqual(providedSecret, process.env.VTO_QA_FIXTURE_SECRET)) return false;
  const qaCustomerId = process.env.QA_OVERRIDE_CUSTOMER_ID;
  if (!qaCustomerId || typeof customerId !== "string" || customerId !== qaCustomerId) return false;
  return true;
}

// 2026-11-18 — the fixtureKind: "styleme-result-view" path below cannot be
// gated by VTO_QA_FIXTURE_SECRET like everything else in this file:
// confirmed directly with the founder that the secret genuinely cannot be
// given to the Five-Persona QA session that needs to invoke it (it was
// rotated into, and only ever existed in, this session's own local
// Keychain — there was never an actual channel for QA to receive it). A
// design requiring a secret neither party can supply is not executable;
// building it anyway and discovering that at test time would have been
// the real defect.
//
// Fix: gate this one mode on the SAME real, already-established
// authentication every ordinary customer route already requires —
// getCurrentNaiaCustomer (Clerk-backed, see clerk-session.server.ts) —
// instead of a shared static secret. Five-Persona QA signs in as Persona A
// through the real, unmodified Clerk sign-in flow (exactly how they already
// test any other customer-facing behavior) and calls this route while that
// session's cookie is attached. No secret is transmitted, held, or
// revealed anywhere. This is NOT a weaker check than the secret-header
// gate — it's the same production-grade identity verification already
// trusted everywhere else in the app, and it still requires every one of:
// VERCEL_ENV preview/development (never production), NAIA_PROJECT_VARIANT
// exactly "staging", AND the resolved customer being the one single
// pre-designated QA_OVERRIDE_CUSTOMER_ID account — a real customer's own
// session can never satisfy the third condition, so this can never reach a
// real customer's data regardless of environment. customerId is derived
// ONLY from the verified session, never read from the request body — this
// mode does not accept a client-supplied customerId at all.
async function resolveAuthorizedQaSessionCustomerId(request: Request): Promise<string | null> {
  if (process.env.VERCEL_ENV !== "preview" && process.env.VERCEL_ENV !== "development") return null;
  if (process.env.NAIA_PROJECT_VARIANT !== "staging") return null;
  const qaCustomerId = process.env.QA_OVERRIDE_CUSTOMER_ID;
  if (!qaCustomerId) return null;
  const customer = await getCurrentNaiaCustomer(request);
  if (!customer || customer.id !== qaCustomerId) return null;
  return customer.id;
}

export async function action({ request }: ActionFunctionArgs) {
  if (request.method === "DELETE") {
    // Read the body exactly once here and pass it down — request.clone()
    // is not implemented by this file's test mocks (and is unnecessary in
    // the real Request object too), so every DELETE-side handler below
    // takes the already-parsed body as a parameter instead of re-reading
    // request.json() itself. See deleteFixtureSuggestion's own signature.
    let deleteBody: unknown;
    try {
      deleteBody = await request.json();
    } catch {
      return data({ ok: false, code: "invalid_request" }, { status: 400 });
    }
    const parsedDeleteBody = deleteBody as Record<string, unknown> | null;

    if (parsedDeleteBody?.fixtureKind === "closet-legacy-image-ownership") {
      const sessionCustomerId = await resolveAuthorizedQaSessionCustomerId(request);
      if (!sessionCustomerId) {
        return data({ ok: false, code: "forbidden" }, { status: 403 });
      }
      return deleteClosetLegacyImageOwnershipFixture(sessionCustomerId);
    }
    return deleteFixtureSuggestion(request, parsedDeleteBody);
  }
  if (request.method !== "POST") {
    return data({ ok: false, code: "method_not_allowed" }, { status: 405 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return data({ ok: false, code: "invalid_request" }, { status: 400 });
  }
  const parsedBody = body as Record<string, unknown> | null;

  if (parsedBody?.fixtureKind === "styleme-result-view") {
    // Real-session auth only — see resolveAuthorizedQaSessionCustomerId's
    // own comment for why this mode cannot use the secret-header gate.
    // customerId comes from the verified session, never from the body.
    const sessionCustomerId = await resolveAuthorizedQaSessionCustomerId(request);
    if (!sessionCustomerId) {
      return data({ ok: false, code: "forbidden" }, { status: 403 });
    }
    return createStyleMeResultViewFixture(sessionCustomerId);
  }

  if (parsedBody?.fixtureKind === "closet-legacy-image-ownership") {
    // Real-session auth only — same reason as styleme-result-view: Five-
    // Persona QA needs to invoke this directly and cannot be given
    // VTO_QA_FIXTURE_SECRET. customerId comes from the verified session.
    const sessionCustomerId = await resolveAuthorizedQaSessionCustomerId(request);
    if (!sessionCustomerId) {
      return data({ ok: false, code: "forbidden" }, { status: 403 });
    }
    return createClosetLegacyImageOwnershipFixture(sessionCustomerId);
  }

  const customerId = parsedBody?.customerId;

  if (!isAuthorized(request, customerId)) {
    // Deliberately generic — never distinguishes "wrong secret" from "wrong
    // customer" from "wrong environment" in the response.
    return data({ ok: false, code: "forbidden" }, { status: 403 });
  }

  const closetItems = await prisma.closetItem.findMany({
    where: { customerId },
    select: { id: true, name: true, category: true, subcategory: true, imagePublicId: true, imageFormat: true, imageUrl: true },
  });

  const bySlot = new Map<OutfitSlot, (typeof closetItems)[number]>();
  for (const item of closetItems) {
    const hasResolvableImage = Boolean((item.imagePublicId && item.imageFormat) || item.imageUrl);
    if (!hasResolvableImage) continue;
    const slot = closetItemToSlot(item.category, item.subcategory);
    if (slot === "unknown") continue;
    if (!bySlot.has(slot)) bySlot.set(slot, item);
  }

  const hasDress = bySlot.has("dress") || bySlot.has("set");
  const chosenSlots: OutfitSlot[] = [];
  for (const slot of ELIGIBLE_SLOT_PRIORITY) {
    if (hasDress && (slot === "top" || slot === "bottom")) continue;
    if (slot === "set" && bySlot.has("dress")) continue; // avoid double-counting dress+set as two garments
    if (bySlot.has(slot)) chosenSlots.push(slot);
  }
  const chosen = chosenSlots.slice(0, FULL_LOOK_MAX_GARMENTS).map((slot) => ({ slot, item: bySlot.get(slot)! }));

  if (chosen.length < FULL_LOOK_MIN_GARMENTS) {
    return data(
      {
        ok: false,
        code: "insufficient_eligible_categories",
        eligibleCategoriesFound: chosen.map((c) => c.slot),
        totalClosetItems: closetItems.length,
        message: `Found ${chosen.length} Full-Look-eligible categories with a resolvable image; need at least ${FULL_LOOK_MIN_GARMENTS}. No suggestion was created.`,
      },
      { status: 200 },
    );
  }

  const { sessionId, suggestionId } = await prisma.$transaction(async (tx) => {
    const session = await tx.stylingSession.create({ data: { customerId }, select: { id: true } });
    const suggestion = await tx.outfitSuggestion.create({ data: { sessionId: session.id }, select: { id: true } });
    for (const { slot, item } of chosen) {
      await tx.outfitItem.create({
        data: {
          suggestionId: suggestion.id,
          itemType: SLOT_TO_ITEM_TYPE[slot],
          closetItemId: item.id,
        },
      });
    }
    return { sessionId: session.id, suggestionId: suggestion.id };
  });

  return data({
    ok: true,
    sessionId,
    suggestionId,
    chosenItems: chosen.map(({ slot, item }) => ({ slot, closetItemId: item.id, name: item.name })),
    totalEligibleCategoriesAvailable: chosen.length,
  });
}

// ── StyleMe result-page fixture (2026-11-18) ────────────────────────────────
//
// POST /api/vto-qa-fixture, body: { fixtureKind: "styleme-result-view" },
// while signed in (real Clerk session) as the one pre-designated
// QA_OVERRIDE_CUSTOMER_ID account — see
// resolveAuthorizedQaSessionCustomerId's own comment above for why this
// mode is authenticated this way instead of the secret-header gate every
// other action in this file uses. No customerId field in the body is read
// or trusted for this mode; it is derived only from the verified session.
//
// WHY THIS EXISTS: Five-Persona QA checks #26/#30/#31/#37 need the target
// customer to have AT LEAST ONE existing StyleMe suggestion to view/navigate
// to/test cross-customer isolation against — /style-me/result.tsx's loader
// only requires session.suggestions[0] to exist (confirmed by reading it
// directly; it does not gate on moodDescription or on Full-Look eligibility
// at all). The existing fixture above (Full-Look VTO) is the wrong tool for
// this: it refuses outright unless the customer's REAL closet already has 3+
// categories with a resolvable image (Persona A's real closet has zero, not
// "fewer than 3" — confirmed via that fixture's own response), so no choice
// of threshold on that path can ever succeed from Persona A's actual data.
//
// This creates a StylingSession + OutfitSuggestion with 1-3 OutfitItem rows
// that are entirely synthetic "nAia product" shop-style items (schema's own
// documented "Source (either closet item OR nAia product)" shape on
// OutfitItem — closetItemId left null, exactly like a real shop-recommended
// item) — zero dependency on the target customer's real closet data, zero
// Claude call, zero FASHN call. result.tsx's own item-hydration code only
// attempts a live Cloudinary re-resolution when item.closetItemId AND
// item.closetItem are BOTH present (confirmed by reading that code); a null
// closetItemId item is passed through exactly as stored, so the placeholder
// productImageUrl (null here — rendered as "no image", never a broken
// signed-URL fetch) carries zero live-resolution risk.
//
// moodDescription is left null — the EXACT SAME convention the Full-Look
// fixture above already uses, for the exact same two reasons: (1) it keeps
// this fixture outside qualifyingStyleMeWhere's StyleMe-monthly-quota count
// (entitlement.server.ts), and (2) it is what makes the EXISTING, already-
// reviewed deleteFixtureSuggestion cleanup below work for this fixture kind
// completely unmodified — same moodDescription-null check, same 1-suggestion-
// per-session check, same zero-VirtualTryOnJob check. No separate cleanup
// path was written or is needed.
//
// Every product name is prefixed "[QA FIXTURE]" and the Shopify product id
// is a clearly-fake, non-existent-looking string — never confusable with a
// real catalog item if ever seen directly.
//
// Authorization for this mode — real Clerk session, not the secret header
// — already enforced by resolveAuthorizedQaSessionCustomerId before this
// function is reached. See that function's own comment for why. No new
// secret, no new allowlist, no weakening of any existing check.
const STYLEME_FIXTURE_ITEMS: { itemType: OutfitItemType; title: string }[] = [
  { itemType: "TOP", title: "[QA FIXTURE] Synthetic top — not a real product" },
  { itemType: "BOTTOM", title: "[QA FIXTURE] Synthetic bottom — not a real product" },
  { itemType: "SHOES", title: "[QA FIXTURE] Synthetic shoes — not a real product" },
];

async function createStyleMeResultViewFixture(customerId: string) {
  const { sessionId, suggestionId } = await prisma.$transaction(async (tx) => {
    const session = await tx.stylingSession.create({ data: { customerId }, select: { id: true } });
    // moodDescription left at its default (null) — see header comment above.
    const suggestion = await tx.outfitSuggestion.create({ data: { sessionId: session.id }, select: { id: true } });
    for (const { itemType, title } of STYLEME_FIXTURE_ITEMS) {
      await tx.outfitItem.create({
        data: {
          suggestionId: suggestion.id,
          itemType,
          productTitle: title,
          shopifyProductId: "qa-fixture-not-a-real-product-id",
          productImageUrl: null,
        },
      });
    }
    return { sessionId: session.id, suggestionId: suggestion.id };
  });

  return data({
    ok: true,
    fixtureKind: "styleme-result-view",
    sessionId,
    suggestionId,
    itemCount: STYLEME_FIXTURE_ITEMS.length,
  });
}

// ── QA #36 — legacy imageUrl ownership/priority fixture (2026-11-18) ───────
//
// POST /api/vto-qa-fixture, body: { fixtureKind: "closet-legacy-image-ownership" },
// while signed in (real Clerk session) as QA_OVERRIDE_CUSTOMER_ID — same
// session-scoped auth as fixtureKind "styleme-result-view" above, for the
// same reason: Five-Persona QA cannot be given VTO_QA_FIXTURE_SECRET.
//
// WHY THIS EXISTS: QA #36 (validateImageUrlOwnership + the signed-URL-
// first priority order, both in cloudinary-admin.server.ts) could not be
// exercised through any real route on the ovevg9dy0 Preview — confirmed by
// QA's own retest — because the test persona's real ClosetItem/
// BuyOrSkipAnalysis rows have no imageUrl/imagePublicId populated at all.
// This creates exactly 4 synthetic rows (2 ClosetItem, 2 BuyOrSkipAnalysis)
// under ONLY this one QA customer, covering the two behaviors that need a
// real populated row to observe:
//
//   "signed priority" row — BOTH imagePublicId+imageFormat AND imageUrl are
//     set, imageUrl pointing at THIS SAME customer's own folder. Every
//     resolver in this codebase must now return the SIGNED
//     buildPrivateDownloadUrl shape (starts with
//     "https://api.cloudinary.com/v1_1/") — never the legacy imageUrl
//     value verbatim, which is distinguishable by containing the literal
//     substring "legacy-should-not-be-used".
//   "ownership rejection" row — imagePublicId/imageFormat are left null;
//     imageUrl names a DIFFERENT, clearly-synthetic folder segment
//     (QA_FIXTURE_OTHER_CUSTOMER_MARKER below — never a real customer id).
//     Every resolver must return null/no image for this row, never the
//     legacy URL (distinguishable by containing "should-be-rejected").
//
// No real Cloudinary asset is uploaded or fetched by this fixture, and no
// live Cloudinary call is made at any point: the imagePublicId values are
// syntactically valid but reference nothing on Cloudinary, and
// buildPrivateDownloadUrl only ever SIGNS a URL mathematically (HMAC over
// known inputs) — it never makes a network call. Verifying which branch a
// resolver took only ever requires reading the URL string a route's loader
// returns, never fetching it.
//
// Creating 2 real ClosetItem rows deliberately bypasses the normal
// reserveClosetSlot quota path, same as every other fixture in this file
// bypasses its own normal business logic by design — this is a staging-
// only QA mechanism, not a customer-facing write path. It temporarily
// raises this one QA customer's visible closet count by 2 until cleanup
// runs; no other customer's data or quota is touched.
const QA_FIXTURE_OTHER_CUSTOMER_MARKER = "qa-fixture-other-customer-marker-not-a-real-customer";
const QA_FIXTURE_IMAGE_MARKER = "qa-fixture-cloudinary-36";

function qaFixtureLegacyImageUrl(folderSegment: string, filenameSuffix: string): string {
  return `https://res.cloudinary.com/naia-staging-demo/image/upload/v1700000000/naia-wardrobe/${folderSegment}/${QA_FIXTURE_IMAGE_MARKER}-${filenameSuffix}.jpg`;
}

async function createClosetLegacyImageOwnershipFixture(customerId: string) {
  const created = await prisma.$transaction(async (tx) => {
    const signedPriorityItem = await tx.closetItem.create({
      data: {
        customerId,
        name: "[QA FIXTURE] Signed-priority check — do not use",
        category: "TOPS",
        imagePublicId: `naia-wardrobe/${customerId}/${QA_FIXTURE_IMAGE_MARKER}-signed-priority`,
        imageFormat: "jpg",
        imageUrl: qaFixtureLegacyImageUrl(customerId, "legacy-should-not-be-used"),
      },
    });
    const ownershipRejectionItem = await tx.closetItem.create({
      data: {
        customerId,
        name: "[QA FIXTURE] Ownership-rejection check — do not use",
        category: "TOPS",
        imageUrl: qaFixtureLegacyImageUrl(QA_FIXTURE_OTHER_CUSTOMER_MARKER, "should-be-rejected"),
      },
    });
    const signedPriorityAnalysis = await tx.buyOrSkipAnalysis.create({
      data: {
        customerId,
        verdict: "MAYBE",
        reasoning: "[QA FIXTURE] synthetic analysis for Cloudinary #36 signed-priority verification — not a real analysis",
        imagePublicId: `naia-wardrobe/${customerId}/${QA_FIXTURE_IMAGE_MARKER}-signed-priority`,
        imageFormat: "jpg",
        imageUrl: qaFixtureLegacyImageUrl(customerId, "legacy-should-not-be-used"),
      },
    });
    const ownershipRejectionAnalysis = await tx.buyOrSkipAnalysis.create({
      data: {
        customerId,
        verdict: "MAYBE",
        reasoning: "[QA FIXTURE] synthetic analysis for Cloudinary #36 ownership-rejection verification — not a real analysis",
        imageUrl: qaFixtureLegacyImageUrl(QA_FIXTURE_OTHER_CUSTOMER_MARKER, "should-be-rejected"),
      },
    });
    return { signedPriorityItem, ownershipRejectionItem, signedPriorityAnalysis, ownershipRejectionAnalysis };
  });

  return data({
    ok: true,
    fixtureKind: "closet-legacy-image-ownership",
    closetItemIds: {
      signedPriority: created.signedPriorityItem.id,
      ownershipRejection: created.ownershipRejectionItem.id,
    },
    buyOrSkipAnalysisIds: {
      signedPriority: created.signedPriorityAnalysis.id,
      ownershipRejection: created.ownershipRejectionAnalysis.id,
    },
    howToVerify: {
      signedPriority: "The resolved image URL must start with https://api.cloudinary.com/v1_1/ — never contain 'legacy-should-not-be-used'.",
      ownershipRejection: "The resolved image URL must be null/absent — never contain 'should-be-rejected'.",
    },
  });
}

// DELETE /api/vto-qa-fixture, body: { fixtureKind: "closet-legacy-image-ownership" }
// Same real-session auth as creation. Matches on QA_FIXTURE_IMAGE_MARKER
// appearing in imagePublicId OR imageUrl, scoped by customerId from the
// verified session — never a generic "delete this customer's closet"
// primitive, and structurally incapable of touching another customer's
// rows since customerId always comes from the session, never the body.
// Idempotent: deleteMany matching zero rows (already cleaned up, or never
// created) still returns ok:true with count 0, never an error.
async function deleteClosetLegacyImageOwnershipFixture(customerId: string) {
  const [deletedClosetItems, deletedAnalyses] = await prisma.$transaction([
    prisma.closetItem.deleteMany({
      where: {
        customerId,
        OR: [
          { imagePublicId: { contains: QA_FIXTURE_IMAGE_MARKER } },
          { imageUrl: { contains: QA_FIXTURE_IMAGE_MARKER } },
        ],
      },
    }),
    prisma.buyOrSkipAnalysis.deleteMany({
      where: {
        customerId,
        OR: [
          { imagePublicId: { contains: QA_FIXTURE_IMAGE_MARKER } },
          { imageUrl: { contains: QA_FIXTURE_IMAGE_MARKER } },
        ],
      },
    }),
  ]);

  return data({
    ok: true,
    fixtureKind: "closet-legacy-image-ownership",
    deletedClosetItemCount: deletedClosetItems.count,
    deletedBuyOrSkipAnalysisCount: deletedAnalyses.count,
  });
}

// ── Cleanup — delete exactly one fixture-created suggestion (2026-11-17) ───
//
// DELETE /api/vto-qa-fixture, body: { customerId, suggestionId }
//
// Narrowly scoped on purpose: this only ever deletes what THIS fixture's
// own POST action creates (one StylingSession + one OutfitSuggestion + its
// OutfitItem rows), never anything a real StyleMe session produced. Three
// independent guards, each refusing rather than guessing:
//   1. Authorization — EITHER the secret-header path (wrong secret, wrong
//      environment, or wrong customerId all refuse), OR the real-session
//      path added 2026-11-18 for the styleme-result-view fixture kind (see
//      resolveAuthorizedQaSessionCustomerId's own comment: Five-Persona QA
//      cannot be given the secret, so their only way to delete their OWN
//      fixture is to be genuinely signed in as the one pre-designated
//      QA_OVERRIDE_CUSTOMER_ID account). Either path resolves to the same
//      kind of value — a customerId already proven to be that one account
//      — before the suggestion is even looked up. This is purely additive:
//      every existing secret-header caller keeps working exactly as before.
//   2. Ownership, same not-found-not-403 convention as the GET loader
//      above — a suggestionId belonging to a different customer (fixture
//      or real) is indistinguishable from one that doesn't exist.
//   3. moodDescription must be null. This fixture's own POST action never
//      sets it (see that action's own comment on why) — a real StyleMe
//      suggestion always has one. Refusing to delete a non-null-mood
//      suggestion means this action can never be turned into a generic
//      "delete any suggestion" primitive, even by a caller who already
//      has the secret and the right customerId.
//   4. The suggestion's own session must have exactly one suggestion (this
//      one) and zero VirtualTryOnJob rows referencing it. This fixture
//      always creates a session 1:1 with its suggestion (see the POST
//      action), so a session with more than one suggestion, or a
//      suggestion with a real VTO job against it, is a state this action
//      was never scoped to touch — it refuses rather than silently
//      cascading into tables this cleanup path was not asked to manage.
// onDelete behaviour for these foreign keys isn't established anywhere in
// this codebase's migrations (same caution closet._index.tsx's own delete
// path documents) — so OutfitItem is deleted explicitly, never assumed to
// cascade.
async function deleteFixtureSuggestion(request: Request, parsed: Record<string, unknown> | null) {
  const suggestionId = parsed?.suggestionId;

  // Try the secret-header path first (preserves exact existing behavior
  // for every caller that already holds the secret); fall back to the
  // real-session path for the styleme-result-view fixture kind, which has
  // no secret to present. Either way, customerId ends up proven to be the
  // one pre-designated QA account before anything is looked up.
  let customerId: string | null = null;
  if (isAuthorized(request, parsed?.customerId)) {
    customerId = parsed!.customerId as string;
  } else {
    customerId = await resolveAuthorizedQaSessionCustomerId(request);
  }
  if (!customerId) {
    return data({ ok: false, code: "forbidden" }, { status: 403 });
  }
  if (typeof suggestionId !== "string" || !suggestionId) {
    return data({ ok: false, code: "invalid_request", message: "suggestionId required" }, { status: 400 });
  }

  const suggestion = await prisma.outfitSuggestion.findUnique({
    where: { id: suggestionId },
    select: { id: true, moodDescription: true, sessionId: true, session: { select: { customerId: true } } },
  });

  if (!suggestion || suggestion.session.customerId !== customerId) {
    return data({ ok: false, code: "not_found" }, { status: 404 });
  }

  if (suggestion.moodDescription !== null) {
    return data({ ok: false, code: "not_a_fixture_suggestion" }, { status: 403 });
  }

  const [suggestionsOnSession, dependentJobs] = await Promise.all([
    prisma.outfitSuggestion.count({ where: { sessionId: suggestion.sessionId } }),
    prisma.virtualTryOnJob.count({ where: { outfitSuggestionId: suggestion.id } }),
  ]);
  if (suggestionsOnSession !== 1) {
    return data({ ok: false, code: "session_not_isolated", suggestionsOnSession }, { status: 409 });
  }
  if (dependentJobs > 0) {
    return data({ ok: false, code: "has_dependent_jobs", dependentJobs }, { status: 409 });
  }

  await prisma.$transaction([
    prisma.outfitItem.deleteMany({ where: { suggestionId: suggestion.id } }),
    prisma.outfitSuggestion.delete({ where: { id: suggestion.id } }),
    prisma.stylingSession.delete({ where: { id: suggestion.sessionId } }),
  ]);

  return data({ ok: true, deletedSuggestionId: suggestion.id, deletedSessionId: suggestion.sessionId });
}

// ── Read-only FASHN credits check (2026-11-17) ──────────────────────────────
//
// GET /api/vto-qa-fixture?customerId=...&mode=credits
//
// GET https://api.fashn.ai/v1/credits using the exact same FASHN_API_KEY the
// real submission path reads (fashn-try-on.server.ts's _getApiKey default)
// — confirms the server-side key this app would actually use belongs to the
// now-credited account, without ever revealing the key itself. Purely a
// balance check per FASHN's own docs (docs.fashn.ai/utility-endpoints/
// credits) — never submits, never creates a prediction, never costs
// anything. Same authorization gate as every other action in this file.
export async function checkFashnCredits(_fetch: typeof fetch = fetch) {
  const apiKey = process.env.FASHN_API_KEY;
  if (!apiKey) {
    return data({ ok: false, code: "not_configured", message: "FASHN_API_KEY is not set on this deployment." }, { status: 200 });
  }
  try {
    const res = await _fetch("https://api.fashn.ai/v1/credits", {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      return data({ ok: false, code: "fashn_error", httpStatus: res.status }, { status: 200 });
    }
    const body = (await res.json()) as { credits?: { total?: number; subscription?: number; on_demand?: number } };
    return data({ ok: true, credits: body.credits ?? null });
  } catch {
    return data({ ok: false, code: "network_error" }, { status: 200 });
  }
}

// ── Read-only verification of an existing fixture (or any) suggestion ──────
//
// GET /api/vto-qa-fixture?customerId=...&suggestionId=...
//
// Deliberately re-runs the REAL selectFullLookGarments against the
// suggestion's actual persisted items — not a re-derivation from the
// current closet state — so "eligible" here means exactly what
// /api/full-look-vto's own POST action would see if the customer clicked
// "TRY THIS LOOK ON" right now, image resolvability included. Creates and
// changes nothing. Same authorization posture as the action above, with
// customerId read from the query string (GET has no body) instead.
export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const customerId = url.searchParams.get("customerId") ?? undefined;
  const suggestionId = url.searchParams.get("suggestionId");
  const mode = url.searchParams.get("mode");

  if (!isAuthorized(request, customerId)) {
    return data({ ok: false, code: "forbidden" }, { status: 403 });
  }

  if (mode === "credits") {
    return checkFashnCredits();
  }

  if (!suggestionId) {
    return data({ ok: false, code: "forbidden" }, { status: 403 });
  }

  const suggestion = await prisma.outfitSuggestion.findUnique({
    where: { id: suggestionId },
    include: {
      session: { select: { id: true, customerId: true } },
      items: {
        include: {
          closetItem: { select: { name: true, imageUrl: true, imagePublicId: true, imageFormat: true, category: true } },
        },
      },
    },
  });

  // Same not-found-not-403 convention as api.full-look-vto.tsx's own
  // loadOwnedSuggestion — never reveals whether a foreign-customer
  // suggestionId exists at all.
  if (!suggestion || suggestion.session.customerId !== customerId) {
    return data({ ok: false, code: "not_found" }, { status: 404 });
  }

  const selectableItems: SelectableOutfitItem[] = suggestion.items.map((item) => ({
    itemType: item.itemType,
    productTitle: item.productTitle,
    closetItemId: item.closetItemId,
    shopifyProductId: item.shopifyProductId,
    productImageUrl: item.productImageUrl,
    closetItem: item.closetItem
      ? {
          name: item.closetItem.name,
          imageUrl: item.closetItem.imageUrl,
          imagePublicId: item.closetItem.imagePublicId,
          imageFormat: item.closetItem.imageFormat,
          category: item.closetItem.category,
        }
      : null,
  }));

  const selection = selectFullLookGarments(selectableItems, {
    customerId,
    cloudinaryConfig: getCloudinaryConfig(),
  });

  const [naiaModel, priorJobs] = await Promise.all([
    loadNaiaModel(customerId),
    prisma.virtualTryOnJob.findMany({
      where: { customerId, outfitSuggestionId: suggestionId },
      select: {
        id: true,
        productHandle: true,
        status: true,
        predictionId: true,
        errorCode: true,
        isTest: true,
        createdAt: true,
        updatedAt: true,
        completedAt: true,
        lastActivityAt: true,
      },
      orderBy: { createdAt: "asc" },
    }),
  ]);
  const modelReadiness = computeModelReadinessFromRecord(naiaModel);

  return data({
    ok: true,
    sessionId: suggestion.session.id,
    suggestionId: suggestion.id,
    belongsToCustomerId: suggestion.session.customerId,
    rawItemCount: suggestion.items.length,
    fullLookEligible: selection !== null,
    eligibleGarmentCount: selection?.garments.length ?? 0,
    eligibleGarmentLabels: selection?.garments.map((g) => g.label) ?? [],
    omittedLabels: selection?.omittedLabels ?? [],
    naiaModelReadyForTryOn: modelReadiness.isReadyForTryOn,
    priorVirtualTryOnJobsOnThisSuggestion: priorJobs.length,
    priorJobs,
  });
}
