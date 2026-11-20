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
//
// fixtureKind: "closet-real-shoe" (2026-11-20) is a fourth, independent
// fixture — see createQaRealShoeClosetFixture below. Ingests a real,
// caller-supplied photo through the same Cloudinary verification/
// moderation/suitability pipeline the real customer-facing Closet upload
// uses, and writes a real SHOES ClosetItem, bypassing only the membership/
// capacity gate (never membershipStatus itself, never billing).

import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data } from "react-router";
import { timingSafeEqual } from "crypto";
import zlib from "zlib";
import dbServer from "~/db.server";
import { closetItemToSlot } from "~/lib/ai/closet-slot";
import { getCurrentNaiaCustomer } from "~/lib/clerk-session.server";
import type { OutfitSlot } from "~/lib/ai/styleme-recommendation.types";
import type { OutfitItemType, PrismaClient } from "@prisma/client";

const prisma: PrismaClient = dbServer;
import {
  getCloudinaryConfig,
  deleteCloudinaryAsset,
  uploadCloudinaryPrivate,
  verifyCloudinaryAsset,
  buildPrivateDownloadUrl,
  validatePublicIdOwnership,
} from "~/lib/cloudinary-admin.server";
import { deleteCloudinaryAssetOrRecord } from "~/lib/cloudinary-deletion-record.server";
import { moderateImageContent } from "~/lib/image-moderation.server";
import { screenGarmentSuitability } from "~/lib/image-suitability.server";
import { assessClosetEligibility, isVtoCategoryAllowed } from "~/lib/ai/closet-eligibility";
import { analyzeClosetGarment } from "~/lib/ai/closet-garment-analysis.server";
import { buildConsentStamp } from "~/lib/photo-consent.server";
import { emitClosetItemAdded, recordJourneyEventAwaited } from "~/lib/ai/journey-events.server";
import { selectFullLookGarments, type SelectableOutfitItem } from "~/lib/ai/full-look-vto-orchestrator.server";
import { loadNaiaModel, computeModelReadinessFromRecord, POLICY_VERSION } from "~/lib/ai/my-naia-model.server";

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
    // Read the body exactly once here — a Request's body stream can only
    // be consumed a single time, so deleteFixtureSuggestion and every
    // dedicated real-session DELETE handler below take the already-parsed
    // body (or, where they need nothing from it, just `request` itself)
    // rather than reading request.json() a second time.
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
    if (parsedDeleteBody?.fixtureKind === "closet-real-shoe") {
      const sessionCustomerId = await resolveAuthorizedQaSessionCustomerId(request);
      if (!sessionCustomerId) {
        return data({ ok: false, code: "forbidden" }, { status: 403 });
      }
      return deleteQaRealShoeClosetFixture(sessionCustomerId);
    }
    if (parsedDeleteBody?.fixtureKind === "closet-real-accessory") {
      const sessionCustomerId = await resolveAuthorizedQaSessionCustomerId(request);
      if (!sessionCustomerId) {
        return data({ ok: false, code: "forbidden" }, { status: 403 });
      }
      const accessoryType = parseQaAccessoryType(parsedDeleteBody?.accessoryType);
      if (!accessoryType) {
        return data({ ok: false, code: "invalid_accessory_type" }, { status: 400 });
      }
      return deleteQaRealAccessoryClosetFixture(sessionCustomerId, accessoryType);
    }
    if (parsedDeleteBody?.fixtureKind === "full-look-gate-negative") {
      const sessionCustomerId = await resolveAuthorizedQaSessionCustomerId(request);
      if (!sessionCustomerId) {
        return data({ ok: false, code: "forbidden" }, { status: 403 });
      }
      return deleteFullLookGateNegativeFixture(request, parsedDeleteBody, sessionCustomerId);
    }
    if (parsedDeleteBody?.fixtureKind === "my-naia-model") {
      // deleteMyNaiaModelFixture never reads the body itself — it only
      // needs the verified session — so passing the already-consumed
      // request is safe here, not a second read of the same stream.
      return deleteMyNaiaModelFixture(request);
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

  if (parsedBody?.fixtureKind === "closet-real-shoe") {
    // Same real-session auth as every other fixtureKind above — see
    // createQaRealShoeClosetFixture's own header comment for why this
    // exists and exactly what it bypasses (membership/capacity only).
    const sessionCustomerId = await resolveAuthorizedQaSessionCustomerId(request);
    if (!sessionCustomerId) {
      return data({ ok: false, code: "forbidden" }, { status: 403 });
    }
    const imageDataUrl = parsedBody?.imageDataUrl;
    if (typeof imageDataUrl !== "string") {
      return data({ ok: false, code: "image_data_url_required" }, { status: 400 });
    }
    return createQaRealShoeClosetFixture(sessionCustomerId, imageDataUrl);
  }

  if (parsedBody?.fixtureKind === "closet-real-accessory") {
    // Same real-session auth as closet-real-shoe — see
    // createQaRealAccessoryClosetFixture's header comment.
    const sessionCustomerId = await resolveAuthorizedQaSessionCustomerId(request);
    if (!sessionCustomerId) {
      return data({ ok: false, code: "forbidden" }, { status: 403 });
    }
    const accessoryType = parseQaAccessoryType(parsedBody?.accessoryType);
    if (!accessoryType) {
      return data({ ok: false, code: "invalid_accessory_type" }, { status: 400 });
    }
    const imageDataUrl = parsedBody?.imageDataUrl;
    if (typeof imageDataUrl !== "string") {
      return data({ ok: false, code: "image_data_url_required" }, { status: 400 });
    }
    return createQaRealAccessoryClosetFixture(sessionCustomerId, imageDataUrl, accessoryType);
  }

  if (parsedBody?.fixtureKind === "full-look-gate-negative") {
    // Same real-session auth as every other real-session fixtureKind. NEVER
    // run a Full-Look POST against this fixture expecting a render: it exists
    // only to prove the pre-FASHN eligibility gate refuses it.
    const sessionCustomerId = await resolveAuthorizedQaSessionCustomerId(request);
    if (!sessionCustomerId) {
      return data({ ok: false, code: "forbidden" }, { status: 403 });
    }
    return createFullLookGateNegativeFixture(sessionCustomerId);
  }

  if (parsedBody?.fixtureKind === "full-look-real-garments") {
    // Same real-session auth as styleme-result-view — see
    // resolveAuthorizedQaSessionCustomerId's own comment.
    const sessionCustomerId = await resolveAuthorizedQaSessionCustomerId(request);
    if (!sessionCustomerId) {
      return data({ ok: false, code: "forbidden" }, { status: 403 });
    }
    return createFullLookRealGarmentsFixture(sessionCustomerId);
  }

  if (parsedBody?.fixtureKind === "full-look-real-garments-max") {
    // Same real-session auth as full-look-real-garments above — see
    // resolveAuthorizedQaSessionCustomerId's own comment. A SEPARATE
    // fixtureKind, not a modification of the 3-garment one above: that
    // fixture is relied on by already-passed Five-Persona QA #30/#31
    // evidence and must stay exactly as it is. This one exists solely to
    // exercise FULL_LOOK_MAX_GARMENTS (5) — the maximum-boundary case,
    // never yet run against a real provider.
    const sessionCustomerId = await resolveAuthorizedQaSessionCustomerId(request);
    if (!sessionCustomerId) {
      return data({ ok: false, code: "forbidden" }, { status: 403 });
    }
    return createFullLookRealGarmentsMaxFixture(sessionCustomerId, { requireRealAccessory: false });
  }

  if (parsedBody?.fixtureKind === "full-look-real-garments-max-all-real") {
    // STRICT five-real-item acceptance path (2026-11-20). Same auth as the
    // legacy max kind above. Fails CLOSED with no_real_accessory_closet_item
    // when no real VTO-eligible accessory exists — never substitutes the
    // synthetic cap. The legacy "full-look-real-garments-max" kind keeps its
    // synthetic-cap behavior for compatibility with earlier evidence.
    const sessionCustomerId = await resolveAuthorizedQaSessionCustomerId(request);
    if (!sessionCustomerId) {
      return data({ ok: false, code: "forbidden" }, { status: 403 });
    }
    return createFullLookRealGarmentsMaxFixture(sessionCustomerId, { requireRealAccessory: true });
  }

  if (parsedBody?.fixtureKind === "my-naia-model") {
    // Same real-session auth as the other real-session fixture kinds.
    const sessionCustomerId = await resolveAuthorizedQaSessionCustomerId(request);
    if (!sessionCustomerId) {
      return data({ ok: false, code: "forbidden" }, { status: 403 });
    }
    return createMyNaiaModelFixture(sessionCustomerId);
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
        // colors/styleTags/seasons/occasions: ClosetItem declares these
        // String[] with no @default in schema.prisma (the DB happens to
        // allow NULL here, a pre-existing drift — but schema.prisma's own
        // stated contract is that they're required, so this fixture
        // supplies them explicitly rather than relying on that drift).
        colors: [],
        styleTags: [],
        seasons: [],
        occasions: [],
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
        colors: [],
        styleTags: [],
        seasons: [],
        occasions: [],
        imageUrl: qaFixtureLegacyImageUrl(QA_FIXTURE_OTHER_CUSTOMER_MARKER, "should-be-rejected"),
      },
    });
    const signedPriorityAnalysis = await tx.buyOrSkipAnalysis.create({
      data: {
        customerId,
        verdict: "MAYBE",
        reasoning: "[QA FIXTURE] synthetic analysis for Cloudinary #36 signed-priority verification — not a real analysis",
        // colors: required with NO default at the DB level — its default
        // was deliberately dropped (20261103000004_sandbox_replay_schema_parity)
        // to match schema.prisma's own lack of @default. Omitting it is a
        // genuine 500 (NOT NULL violation), confirmed live by Five-Persona
        // QA on dpl_DC3RG7LiBsZUMyBxBVp2nsZJsFX6 — this is the actual fix.
        // wardrobeMatches/similarItems: nullable at the DB level (a
        // separate, unrelated, pre-existing drift from schema.prisma's
        // stated non-optional contract), but supplied anyway for the same
        // reason as ClosetItem's array fields above.
        colors: [],
        wardrobeMatches: [],
        similarItems: [],
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
        colors: [],
        wardrobeMatches: [],
        similarItems: [],
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

// ── QA real-shoe Closet fixture (2026-11-20) ─────────────────────────────────
//
// WHY THIS EXISTS: createFullLookRealGarmentsMaxFixture (above) requires the
// QA customer to already have a real SHOES ClosetItem (findRealShoeClosetItem
// below) — a genuine uploaded photo, not a synthetic placeholder, so the
// Full-Look VTO max-boundary test exercises the real resolveItemImage path
// exactly as a real customer's own shoe would. The real customer-facing
// upload (closet._index.tsx, intent "add") is gated behind
// Customer.membershipStatus (checkEntitlement/reserveClosetSlot) — this QA
// customer has no membership, and the founder has explicitly declined to
// grant MEMBER status, start a Stripe checkout, or touch any billing/
// entitlement record just to attach one QA photo (2026-11-20 decision:
// "Do not change membershipStatus, billing records, Stripe subscriptions,
// customer entitlements or production upload restrictions").
//
// This fixture is the alternative: it runs the EXACT SAME server-side
// upload-validation pipeline the real "add" action runs — ownership check,
// Cloudinary Admin API verification, format allowlist, size cap, dimension
// bounds, magic-byte check, Layer 2 safety moderation, Layer 3 garment-
// suitability screening, Stage-A VTO eligibility, and garment-intelligence
// analysis — by calling the SAME shared functions from the SAME ~/lib
// modules the real route imports (verifyCloudinaryAsset, buildConsentStamp,
// moderateImageContent, screenGarmentSuitability, assessClosetEligibility,
// analyzeClosetGarment, deleteCloudinaryAssetOrRecord — never a
// reimplementation), and writes the resulting ClosetItem directly via
// Prisma instead of through reserveClosetSlot. The ONLY step this fixture
// skips is reserveClosetSlot's own membership/capacity gate — exactly the
// same bypass createClosetLegacyImageOwnershipFixture (above) and
// createClosetItemDetailed (api.seed-staging.jsx) already make for QA
// writes by design, since both are staging-only QA mechanisms, not
// customer-facing write paths. This never changes Customer.membershipStatus,
// never touches billing or Stripe, and never relaxes capacity for any other
// customer or any other write path — the bypass is scoped to this one
// function call, for this one QA_OVERRIDE_CUSTOMER_ID-matched customer,
// behind the same real-session auth as every other fixture in this file.
//
// detectImageFormatFromBytesQaCopy below is copied verbatim from
// closet._index.tsx's own private helper of the same name — that function
// is private to a large, sensitive route file this fixture has no other
// reason to import from, same precedent as this file's own SLOT_TO_ITEM_TYPE
// mirror of styleme-result.server.ts's slotToItemType above. Keep in sync if
// the real check changes.
//
// Idempotent: a prior successful run is detected by an existing SHOES
// ClosetItem carrying QA_REAL_SHOE_FIXTURE_MARKER as its name, with a real
// imagePublicId/imageFormat already set — if found, returns it unchanged
// rather than re-uploading or creating a second item. This is the mechanism
// that satisfies "prevent duplicate fixture items" — a repeat POST (retry,
// double-submit, re-running this test later) is always a no-op after the
// first successful run.
// Try-on eligibility states that mean "no photo problem flagged": Stage A
// passed (pending Stage-B visual assessment) or fully ready. "needs-clearer-
// photo" (e.g. < 300px on a side), "not-supported" and null/unassessed all
// fail the five-real-item acceptance path closed — a real photo that the
// product itself says is not good enough for try-on must not be reported as
// a VTO-eligible real accessory.
const QA_USABLE_TRY_ON_ELIGIBILITY: ReadonlySet<string> = new Set(["pending-assessment", "ready-for-try-on"]);

const QA_REAL_SHOE_FIXTURE_MARKER = "[QA FIXTURE] Real shoe (customer-supplied photo)";

function detectImageFormatFromBytesQaCopy(header: Uint8Array): string | null {
  if (header.length < 4) return null;
  if (header[0] === 0xFF && header[1] === 0xD8 && header[2] === 0xFF) return "jpeg";
  if (header[0] === 0x89 && header[1] === 0x50 && header[2] === 0x4E && header[3] === 0x47) return "png";
  if (header[0] === 0x47 && header[1] === 0x49 && header[2] === 0x46 && header[3] === 0x38) return "gif";
  if (
    header[0] === 0x52 && header[1] === 0x49 && header[2] === 0x46 && header[3] === 0x46 &&
    header.length >= 12 &&
    header[8] === 0x57 && header[9] === 0x45 && header[10] === 0x42 && header[11] === 0x50
  ) return "webp";
  if (header.length >= 8 && header[4] === 0x66 && header[5] === 0x74 && header[6] === 0x79 && header[7] === 0x70) return "heic";
  return null;
}

async function createQaRealClosetFixture(customerId: string, imageDataUrl: string, spec: QaRealClosetFixtureSpec) {
  if (typeof imageDataUrl !== "string" || !imageDataUrl.startsWith("data:image/")) {
    return data({ ok: false, code: "invalid_image_data_url" }, { status: 400 });
  }

  // Idempotency check FIRST — before any upload — so a retry never touches
  // Cloudinary at all, let alone creates a second item.
  const existing = await prisma.closetItem.findFirst({
    where: { customerId, category: spec.category, name: spec.marker },
    select: { id: true, imagePublicId: true, imageFormat: true, subcategory: true, tryOnEligibility: true },
  });
  if (existing && existing.imagePublicId && existing.imageFormat) {
    return data({
      ok: true,
      fixtureKind: spec.fixtureKind,
      closetItemId: existing.id,
      imagePublicId: existing.imagePublicId,
      imageFormat: existing.imageFormat,
      reused: true,
      ...(spec.accessoryType
        ? {
            accessoryType: spec.accessoryType,
            subcategory: existing.subcategory ?? null,
            vtoAllowed: isVtoCategoryAllowed(spec.category, existing.subcategory ?? null),
            tryOnEligibility: existing.tryOnEligibility ?? null,
            tryOnEligible:
              isVtoCategoryAllowed(spec.category, existing.subcategory ?? null) &&
              QA_USABLE_TRY_ON_ELIGIBILITY.has(existing.tryOnEligibility ?? ""),
          }
        : {}),
    });
  }

  // Stable, customer-scoped publicId — naia-wardrobe/{customerId}/... is the
  // exact convention validatePublicIdOwnership (below) enforces for every
  // real customer upload.
  const publicId = `naia-wardrobe/${customerId}/${spec.publicIdSuffix}`;

  const discardUpload = (uploadPublicId: string, context: string) =>
    deleteCloudinaryAssetOrRecord({ customerId, publicId: uploadPublicId, deliveryType: "private", context });

  // 1. Ownership check — same function the real "add" action calls. This
  // fixture generates publicId itself, so this can only ever fail if the
  // convention above is ever changed inconsistently with
  // validatePublicIdOwnership's own expectation.
  const ownership = validatePublicIdOwnership(publicId, customerId);
  if (!ownership.ok) {
    return data({ ok: false, code: "ownership_check_failed", message: ownership.error }, { status: 400 });
  }

  // 2. Real private Cloudinary ingestion — same helper the real pipeline
  // uses elsewhere in this file, with deliveryType "private" (never
  // "upload"/public — this is a genuine private customer photo, not a
  // FASHN-facing synthetic garment image like the cap fixture above).
  const upload = await uploadCloudinaryPrivate(publicId, imageDataUrl, "private");
  if (!upload.ok) {
    return data({ ok: false, code: "upload_failed", errorCode: upload.errorCode }, { status: 502 });
  }

  // 3. Verify via Cloudinary Admin API — authoritative format/bytes/
  // dimensions, same call the real action makes; never trust the caller's
  // declared format.
  const verify = await verifyCloudinaryAsset(publicId, "private");
  if (!verify.ok) {
    await discardUpload(publicId, `${spec.contextPrefix}-verify-failed`);
    return data({ ok: false, code: "verify_failed", errorCode: verify.errorCode }, { status: 400 });
  }
  const serverFormat = verify.asset.format.toLowerCase();
  const serverBytes = verify.asset.bytes;
  const serverWidth = verify.asset.width;
  const serverHeight = verify.asset.height;

  if (verify.asset.type !== "private") {
    await discardUpload(publicId, `${spec.contextPrefix}-wrong-type`);
    return data({ ok: false, code: "wrong_delivery_type" }, { status: 400 });
  }
  if (verify.asset.resourceType !== "image") {
    await discardUpload(publicId, `${spec.contextPrefix}-not-image`);
    return data({ ok: false, code: "not_an_image" }, { status: 400 });
  }

  // 4. Format allowlist — identical set to the real action.
  const ALLOWED_FORMATS = new Set(["jpg", "jpeg", "png", "webp", "heic", "heif"]);
  if (!ALLOWED_FORMATS.has(serverFormat)) {
    await discardUpload(publicId, `${spec.contextPrefix}-format-rejected`);
    return data({ ok: false, code: "format_not_allowed", format: serverFormat }, { status: 400 });
  }

  // 5. Size cap — identical 5 MB limit.
  const SERVER_MAX_BYTES = 5 * 1024 * 1024;
  if (serverBytes > SERVER_MAX_BYTES) {
    await discardUpload(publicId, `${spec.contextPrefix}-too-large`);
    return data({ ok: false, code: "image_too_large", bytes: serverBytes }, { status: 400 });
  }

  // 6. Dimension bounds — identical 200-8000px window.
  const MIN_DIM = 200;
  const MAX_DIM = 8000;
  if (
    (serverWidth !== null && (serverWidth < MIN_DIM || serverWidth > MAX_DIM)) ||
    (serverHeight !== null && (serverHeight < MIN_DIM || serverHeight > MAX_DIM))
  ) {
    await discardUpload(publicId, `${spec.contextPrefix}-dimensions-rejected`);
    return data({ ok: false, code: "dimensions_out_of_range", width: serverWidth, height: serverHeight }, { status: 400 });
  }

  // 7. Server-side magic-byte check — see detectImageFormatFromBytesQaCopy's
  // own comment above.
  const cfg = getCloudinaryConfig();
  if (!cfg) {
    await discardUpload(publicId, `${spec.contextPrefix}-not-configured`);
    return data({ ok: false, code: "cloudinary_not_configured" }, { status: 502 });
  }
  const downloadUrl = buildPrivateDownloadUrl(cfg, publicId, serverFormat, "private");
  try {
    const byteRes = await fetch(downloadUrl, { headers: { Range: "bytes=0-11" }, signal: AbortSignal.timeout(15000) });
    if (byteRes.ok) {
      const buf = await byteRes.arrayBuffer();
      const header = new Uint8Array(buf);
      if (!detectImageFormatFromBytesQaCopy(header)) {
        await discardUpload(publicId, `${spec.contextPrefix}-bad-signature`);
        return data({ ok: false, code: "bad_file_signature" }, { status: 400 });
      }
    }
  } catch {
    await discardUpload(publicId, `${spec.contextPrefix}-verify-timeout`);
    return data({ ok: false, code: "verification_timed_out" }, { status: 400 });
  }

  // 8. Layer 2 — global content safety moderation. Identical call; on
  // reject/unavailable, discard and refuse exactly as the real action does
  // — a QA fixture must never be able to plant an image real customer
  // moderation would have rejected.
  const moderation = await moderateImageContent(downloadUrl);
  if (moderation.status === "MODERATION_UNAVAILABLE") {
    await discardUpload(publicId, `${spec.contextPrefix}-moderation-unavailable`);
    return data({ ok: false, code: "moderation_unavailable" }, { status: 503 });
  }
  if (moderation.status === "SAFETY_REJECT") {
    await discardUpload(publicId, `${spec.contextPrefix}-safety-reject`);
    return data({ ok: false, code: "safety_reject", reasonCode: moderation.reasonCode }, { status: 422 });
  }

  // 9. Layer 3 — garment suitability, declared category SHOES.
  const suitability = await screenGarmentSuitability(downloadUrl, { declaredCategory: spec.category });
  if (suitability.status === "RETRY_IMAGE") {
    await discardUpload(publicId, `${spec.contextPrefix}-retry-image`);
    return data({ ok: false, code: "retry_image", subCode: suitability.subCode }, { status: 422 });
  }
  if (suitability.status === "NEEDS_CLARIFICATION" && suitability.subCode !== "category_mismatch") {
    await discardUpload(publicId, `${spec.contextPrefix}-needs-clarification`);
    return data({ ok: false, code: "needs_clarification", subCode: suitability.subCode }, { status: 422 });
  }

  // 10. Stage-A VTO eligibility — identical call.
  const stageA = assessClosetEligibility({
    prismaCategory: spec.category,
    subcategory: spec.subcategory,
    width: serverWidth ?? undefined,
    height: serverHeight ?? undefined,
    format: serverFormat,
    bytes: serverBytes,
  });

  // 11. Direct Prisma write — the ONLY step that differs from the real
  // action: reserveClosetSlot's membership/capacity gate is intentionally
  // not called here (see this function's header comment for why). Every
  // other field matches exactly what reserveClosetSlot's own itemData sets
  // for a real private-upload item.
  const createdItem = await prisma.closetItem.create({
    data: {
      customerId,
      name: spec.marker,
      category: spec.category,
      subcategory: spec.subcategory,
      imageUrl: null,
      imagePublicId: publicId,
      imageFormat: serverFormat,
      colors: [],
      primaryColor: null,
      pattern: null,
      brand: null,
      occasions: [],
      seasons: [],
      tryOnEligibility: stageA.eligible,
      tryOnAssessedAt: new Date(stageA.assessedAt),
      tryOnCustomerHint: stageA.customerHint,
      tryOnInternalNote: stageA.internalNote,
      garmentRelationships: [],
      customerNote: null,
      ...buildConsentStamp(true),
      analysisStatus: "pending",
    },
  });

  try {
    await recordJourneyEventAwaited(
      emitClosetItemAdded({
        customerId,
        closetItemId: createdItem.id,
        category: createdItem.category,
        tryOnEligibility: createdItem.tryOnEligibility ?? null,
      }),
      `closet_item_added:${createdItem.id}:v1`,
    );
  } catch { /* event emission never blocks the response */ }

  // 12. Garment-intelligence analysis — same call, awaited, same as the
  // real action. Always exits "ready" or "failed", never stays "pending".
  await analyzeClosetGarment({
    closetItemId: createdItem.id,
    imagePublicId: publicId,
    category: spec.category,
    imageFormat: serverFormat,
    userPrimaryColor: null,
    userPattern: null,
    userOccasions: [],
    userSeasons: [],
  }).catch(() => {});

  // Garment analysis may rewrite subcategory (AI-derived) and re-evaluate
  // eligibility. Report the FINAL state honestly rather than the declared
  // one, so a QA run can see whether the item is genuinely VTO-eligible.
  let finalSubcategory: string | null = spec.subcategory;
  let finalEligibility: string | null = stageA.eligible;
  try {
    const refreshed = await prisma.closetItem.findUnique({
      where: { id: createdItem.id },
      select: { subcategory: true, tryOnEligibility: true },
    });
    if (refreshed) {
      finalSubcategory = refreshed.subcategory ?? null;
      finalEligibility = refreshed.tryOnEligibility ?? null;
    }
  } catch { /* report declared values if re-read fails */ }

  return data({
    ok: true,
    fixtureKind: spec.fixtureKind,
    closetItemId: createdItem.id,
    imagePublicId: publicId,
    imageFormat: serverFormat,
    reused: false,
    ...(spec.accessoryType
      ? {
          accessoryType: spec.accessoryType,
          subcategory: finalSubcategory,
          vtoAllowed: isVtoCategoryAllowed(spec.category, finalSubcategory),
          tryOnEligibility: finalEligibility,
          tryOnEligible:
            isVtoCategoryAllowed(spec.category, finalSubcategory) &&
            QA_USABLE_TRY_ON_ELIGIBILITY.has(finalEligibility ?? ""),
          ...(stageA.customerHint ? { photoHint: stageA.customerHint } : {}),
        }
      : {}),
  });
}

type QaRealClosetFixtureSpec = {
  fixtureKind: "closet-real-shoe" | "closet-real-accessory";
  marker: string;
  category: "SHOES" | "BAGS" | "ACCESSORIES";
  subcategory: string | null;
  publicIdSuffix: string;
  contextPrefix: string;
  accessoryType?: QaAccessoryType;
};

const QA_REAL_SHOE_SPEC: QaRealClosetFixtureSpec = {
  fixtureKind: "closet-real-shoe",
  marker: QA_REAL_SHOE_FIXTURE_MARKER,
  category: "SHOES",
  subcategory: null,
  publicIdSuffix: "qa-fixture-real-shoe",
  contextPrefix: "qa-real-shoe-fixture",
};

async function createQaRealShoeClosetFixture(customerId: string, imageDataUrl: string) {
  return createQaRealClosetFixture(customerId, imageDataUrl, QA_REAL_SHOE_SPEC);
}

// ── QA real-accessory Closet fixture (2026-11-20) ────────────────────────────
//
// Reusable counterpart of the real-shoe fixture for hats, scarves, handbags
// and belts. Runs the IDENTICAL pipeline (createQaRealClosetFixture above:
// ownership, private Cloudinary ingestion, Admin-API verification, format/
// size/dimension/magic-byte checks, Layer 2 moderation, Layer 3 suitability,
// Stage-A eligibility, garment analysis) — only the category/subcategory/
// marker differ. Same single bypass: reserveClosetSlot's membership/capacity
// gate. Never touches membershipStatus, billing, or entitlements.
//
// Category mapping follows closet-eligibility.ts's isVtoCategoryAllowed:
// handbag → BAGS (always VTO-allowed); hat/scarf/belt → ACCESSORIES with the
// allowlisted subcategory. Each type has its own marker + publicId so
// idempotency is per (customer, type) and types never collide.
type QaAccessoryType = "hat" | "scarf" | "handbag" | "belt";

const QA_ACCESSORY_SPECS: Record<QaAccessoryType, QaRealClosetFixtureSpec> = {
  hat: { fixtureKind: "closet-real-accessory", marker: "[QA FIXTURE] Real hat (customer-supplied photo)", category: "ACCESSORIES", subcategory: "hat", publicIdSuffix: "qa-fixture-real-hat", contextPrefix: "qa-real-hat-fixture", accessoryType: "hat" },
  scarf: { fixtureKind: "closet-real-accessory", marker: "[QA FIXTURE] Real scarf (customer-supplied photo)", category: "ACCESSORIES", subcategory: "scarf", publicIdSuffix: "qa-fixture-real-scarf", contextPrefix: "qa-real-scarf-fixture", accessoryType: "scarf" },
  handbag: { fixtureKind: "closet-real-accessory", marker: "[QA FIXTURE] Real handbag (customer-supplied photo)", category: "BAGS", subcategory: "handbag", publicIdSuffix: "qa-fixture-real-handbag", contextPrefix: "qa-real-handbag-fixture", accessoryType: "handbag" },
  belt: { fixtureKind: "closet-real-accessory", marker: "[QA FIXTURE] Real belt (customer-supplied photo)", category: "ACCESSORIES", subcategory: "belt", publicIdSuffix: "qa-fixture-real-belt", contextPrefix: "qa-real-belt-fixture", accessoryType: "belt" },
};

function parseQaAccessoryType(value: unknown): QaAccessoryType | null {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(QA_ACCESSORY_SPECS, value)
    ? (value as QaAccessoryType)
    : null;
}

async function createQaRealAccessoryClosetFixture(customerId: string, imageDataUrl: string, accessoryType: QaAccessoryType) {
  return createQaRealClosetFixture(customerId, imageDataUrl, QA_ACCESSORY_SPECS[accessoryType]);
}

// DELETE body: { fixtureKind: "closet-real-accessory", accessoryType }.
// Scoped by verified-session customerId + this type's marker + category —
// never a generic closet delete. Idempotent (count 0 is still ok:true).
async function deleteQaRealAccessoryClosetFixture(customerId: string, accessoryType: QaAccessoryType) {
  const spec = QA_ACCESSORY_SPECS[accessoryType];
  const deleted = await prisma.closetItem.deleteMany({
    where: { customerId, category: spec.category, name: spec.marker },
  });
  return data({ ok: true, fixtureKind: "closet-real-accessory", accessoryType, deletedCount: deleted.count });
}

// DELETE /api/vto-qa-fixture, body: { fixtureKind: "closet-real-shoe" }
// Same real-session auth as creation. Matches on QA_REAL_SHOE_FIXTURE_MARKER
// as the item's name, scoped by customerId from the verified session —
// never a generic "delete this customer's closet" primitive. Idempotent:
// deleteMany matching zero rows (already cleaned up, or never created)
// still returns ok:true with count 0. Does not delete the underlying
// Cloudinary asset (same customer-owned publicId is reused on the next
// create, which re-uploads/overwrites it) — only the ClosetItem row.
async function deleteQaRealShoeClosetFixture(customerId: string) {
  const deleted = await prisma.closetItem.deleteMany({
    where: { customerId, category: "SHOES", name: QA_REAL_SHOE_FIXTURE_MARKER },
  });
  return data({ ok: true, fixtureKind: "closet-real-shoe", deletedCount: deleted.count });
}

// ── Full-Look VTO real-garment fixture (2026-11-18) ─────────────────────────
//
// POST /api/vto-qa-fixture, body: { fixtureKind: "full-look-real-garments" },
// while signed in (real Clerk session) as the one pre-designated
// QA_OVERRIDE_CUSTOMER_ID account — identical authorization posture to
// styleme-result-view above.
//
// WHY THIS EXISTS: Five-Persona QA #30/#31 need genuine end-to-end evidence
// (a real FASHN submission, real entitlement deduction, real duplicate-
// submission handling) against Persona A — but her real closet has zero
// Full-Look-eligible categories (confirmed via the Full-Look fixture above's
// own eligible-categories response), and the styleme-result-view fixture's
// items are deliberately imageless (productImageUrl: null), so neither
// existing mechanism can produce a suggestion selectFullLookGarments will
// actually accept.
//
// This creates exactly FULL_LOOK_MIN_GARMENTS (3) synthetic OutfitItem rows
// — closetItemId: null, same "nAia product" shape as styleme-result-view —
// but with productImageUrl set to a REAL, already-public Shopify CDN URL
// (resolveItemImage returns item.productImageUrl verbatim when set; see
// look-image-resolution.server.ts — no Cloudinary call, no new upload).
// The three URLs are drawn from naia-product-media.ts's own static
// verified-media map, each entry marked eligibility: "ready" (approved via
// visual review, GID-verified live against Shopify Admin API) — reusing
// already-approved real assets, never fabricating one. One category each —
// TOP, BOTTOM, OUTERWEAR — satisfies selectFullLookGarments's 3-category
// floor without needing a dress/shoe/bag entry this map doesn't have.
//
// moodDescription is left null, matching both existing fixture kinds'
// convention, for the same reason: it keeps this suggestion's CREATION step
// outside the StyleMe-generation quota. It does NOT exempt a later real
// Full-Look VTO run against this suggestion from the SEPARATE "vto"
// entitlement check (checkEntitlement in entitlement.server.ts) — that
// check counts live VirtualTryOnJob rows directly, independent of
// moodDescription, so it genuinely applies once api.full-look-vto.tsx's
// real action is invoked against this fixture. That is the point: this
// fixture is scoped to let the REAL entitlement/duplicate-submission/
// accounting logic run for real, not to bypass it.
//
// Every item's shopifyProductId is the clearly-fake, distinctly-prefixed
// "qa-fixture-full-look-real-garment" — DIFFERENT from
// styleme-result-view's own marker — so deleteFixtureSuggestion below can
// tell the two fixture kinds apart and apply the right cleanup scope to
// each. Every productTitle is "[QA FIXTURE] ..." per the established
// convention.
const FULL_LOOK_FIXTURE_SHOPIFY_PRODUCT_ID = "qa-fixture-full-look-real-garment";

const FULL_LOOK_FIXTURE_ITEMS: { itemType: OutfitItemType; title: string; productImageUrl: string }[] = [
  {
    itemType: "TOP",
    title: "[QA FIXTURE] Full-Look real-garment top — not a real customer item",
    productImageUrl: "https://cdn.shopify.com/s/files/1/0998/1008/2948/files/0c950ae7-dfe3-4395-81c4-4d2663fa11bd.png?v=1784196037",
  },
  {
    itemType: "BOTTOM",
    title: "[QA FIXTURE] Full-Look real-garment bottom — not a real customer item",
    productImageUrl: "https://cdn.shopify.com/s/files/1/0998/1008/2948/files/7d5d1e05-796a-45d9-b74a-4ddb0c9da3cf.png?v=1774533080",
  },
  {
    itemType: "OUTERWEAR",
    title: "[QA FIXTURE] Full-Look real-garment outerwear — not a real customer item",
    productImageUrl: "https://cdn.shopify.com/s/files/1/0998/1008/2948/files/b7af3725-7048-4ead-8d04-d6fb42556eac.png?v=1774532277",
  },
];

async function createFullLookRealGarmentsFixture(customerId: string) {
  const { sessionId, suggestionId } = await prisma.$transaction(async (tx) => {
    const session = await tx.stylingSession.create({ data: { customerId }, select: { id: true } });
    const suggestion = await tx.outfitSuggestion.create({ data: { sessionId: session.id }, select: { id: true } });
    for (const { itemType, title, productImageUrl } of FULL_LOOK_FIXTURE_ITEMS) {
      await tx.outfitItem.create({
        data: {
          suggestionId: suggestion.id,
          itemType,
          productTitle: title,
          shopifyProductId: FULL_LOOK_FIXTURE_SHOPIFY_PRODUCT_ID,
          productImageUrl,
        },
      });
    }
    return { sessionId: session.id, suggestionId: suggestion.id };
  });

  return data({
    ok: true,
    fixtureKind: "full-look-real-garments",
    sessionId,
    suggestionId,
    itemCount: FULL_LOOK_FIXTURE_ITEMS.length,
  });
}

// ── Full-Look VTO real-garment MAX fixture (2026-11-19, corrected 2026-11-20) ─
//
// POST /api/vto-qa-fixture, body: { fixtureKind: "full-look-real-garments-max" },
// same authorization posture as full-look-real-garments above.
//
// WHY THIS EXISTS: the only real-provider evidence on record for Full-Look
// VTO (Five-Persona QA #30/#31) exercised exactly FULL_LOOK_MIN_GARMENTS
// (3) — the minimum-boundary case. FULL_LOOK_MAX_GARMENTS (5) has never
// been run against the real provider. This is a SEPARATE fixtureKind, not
// a change to the 3-garment one above, so #30/#31's existing passed
// evidence is never put at risk by this addition.
//
// 2026-11-20 CORRECTED — this fixture originally reached 5 items by
// repeating two categories already present in the base 3 (a second TOP, a
// second OUTERWEAR). That is not 5 genuinely distinct categories, and
// selectFullLookGarments's own (now-fixed, see full-look-vto-orchestrator.
// server.ts) same-category-omission-disclosure logic means a repeated
// category's second item was never actually selected anyway — so this
// fixture never truly exercised the max-boundary (5-distinct-category)
// selection path at all. Fixed: the 5 items are now the 3 base categories
// (TOP/BOTTOM/OUTERWEAR, untouched real Shopify CDN media, unchanged below)
// PLUS a genuine SHOES item and a genuine ACCESSORY item — 5 distinct
// categories, the actual max-boundary case this fixture exists to
// represent.
//
// No real Shopify CDN image for a shoe or a cap exists anywhere in this
// repo (the extracted NADINE catalog is dresses-only; the storefront is
// password-protected and must not be bypassed to go looking for one).
// Founder-authorized synthetic alternative instead — see
// buildSyntheticShoeSilhouettePng/buildSyntheticCapSilhouettePng above.
// "cap" is drawn from closet-eligibility.ts's VTO_ACCESSORY_SUBCATEGORY_
// ALLOWLIST (scarf, belt, earrings, hat, cap, beanie, beret) — used here
// only as the product's own stated definition of "intended-to-work"
// accessory types, for an honest choice of test data; that allowlist
// governs the real-closet-upload eligibility pipeline, which this
// fixture's synthetic OutfitItem rows bypass entirely (confirmed:
// selectFullLookGarments/submitFullLookRealStep never reference it).
//
// Uploaded with Cloudinary delivery type "upload" (public), NOT "private":
// unlike the My nAia Model body photo below (genuinely private, fetched via
// a signed buildPrivateDownloadUrl), a garment's productImageUrl is fetched
// directly by FASHN as a plain, non-expiring public URL (see
// buildPublicCloudinaryDeliveryUrl's own comment above for the full
// reasoning). Uploaded BEFORE either OutfitItem row is written, mirroring
// createMyNaiaModelFixture's own upload-then-write discipline below: no row
// ever claims an image exists if the upload actually failed.
//
// Every item's shopifyProductId is the distinctly-prefixed
// "qa-fixture-full-look-real-garment-max" — different from both other
// fixture kinds' markers — so deleteFixtureSuggestion below can scope
// cleanup correctly (including deleting the 2 synthetic Cloudinary assets
// this fixture now creates — see deleteFixtureSuggestion's own comment).
// Every productTitle is "[QA FIXTURE] ..." per convention.
const FULL_LOOK_MAX_FIXTURE_SHOPIFY_PRODUCT_ID = "qa-fixture-full-look-real-garment-max";

// 2026-11-20 — the SHOES slot now prefers a REAL closet photo over the
// synthetic silhouette, if the customer has actually uploaded one. Same
// motivation as the rest of this fixture's "genuine 5-distinct-category"
// correction: a hand-drawn silhouette can't answer the real visual-
// acceptance question (does the provider actually render real shoes, and
// do they survive the later compositing steps?) the way a real photo can.
// SHOES is one of isVtoCategoryAllowed's always-allowed main categories
// (closet-eligibility.ts) — no subcategory gating, so ANY real SHOES
// closet item that passed the real upload pipeline's own suitability
// screening is already VTO-eligible exactly like a real customer's would
// be. Deliberately does NOT fall back to the synthetic image when none
// exists — silently substituting it would misreport what was actually
// tested, the opposite of this fixture's own purpose.
async function findRealShoeClosetItem(customerId: string) {
  return prisma.closetItem.findFirst({
    where: {
      customerId,
      category: "SHOES",
      imagePublicId: { not: null },
      imageFormat: { not: null },
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true },
  });
}

// 2026-11-20 — real VTO-allowed accessory closet photo (hat/scarf/belt via
// the closet-real-accessory fixture, or any real upload the customer made).
// Two modes, selected by the caller's fixtureKind:
//  - "full-look-real-garments-max-all-real" (requireRealAccessory: true):
//    FAILS CLOSED — no_real_accessory_closet_item, nothing uploaded or
//    written — when none exists. This is the five-real-item acceptance path.
//  - legacy "full-look-real-garments-max" (false): behavior unchanged from
//    before this work — always the synthetic cap — kept for compatibility
//    with already-recorded evidence. Its response states
//    accessorySource:"synthetic-cap" and syntheticPlaceholderCount:1 so it can
//    never be mistaken for an all-real result.
// Only items whose tryOnEligibility is pending-assessment or ready-for-try-on
// count: "needs-clearer-photo", "not-supported" and unassessed items are
// excluded even if their subcategory is allowlisted.
async function findRealAccessoryClosetItem(customerId: string) {
  const candidates = await prisma.closetItem.findMany({
    where: {
      customerId,
      category: "ACCESSORIES",
      imagePublicId: { not: null },
      imageFormat: { not: null },
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true, subcategory: true, tryOnEligibility: true },
  });
  return (
    (candidates ?? []).find(
      (c: { subcategory: string | null; tryOnEligibility?: string | null }) =>
        QA_USABLE_TRY_ON_ELIGIBILITY.has(c.tryOnEligibility ?? "") && isVtoCategoryAllowed("ACCESSORIES", c.subcategory),
    ) ?? null
  );
}

async function createFullLookRealGarmentsMaxFixture(customerId: string, opts: { requireRealAccessory: boolean }) {
  const realShoeClosetItem = await findRealShoeClosetItem(customerId);
  if (!realShoeClosetItem) {
    return data(
      {
        ok: false,
        code: "no_real_shoe_closet_item",
        message:
          "Upload a real shoe photo to your closet first (category SHOES, at /closet), then re-run this fixture.",
      },
      { status: 400 },
    );
  }

  const realAccessoryClosetItem = opts.requireRealAccessory ? await findRealAccessoryClosetItem(customerId) : null;
  if (opts.requireRealAccessory && !realAccessoryClosetItem) {
    return data(
      {
        ok: false,
        code: "no_real_accessory_closet_item",
        message:
          "No real VTO-eligible accessory (hat/scarf/belt) found in your closet. Run the closet-real-accessory fixture with a real photo first, then re-run this fixture. No synthetic placeholder is substituted.",
      },
      { status: 400 },
    );
  }
  const capPublicId = fullLookMaxFixtureCapPublicId(customerId);

  // Cap image uploaded BEFORE any DB write — see this function's own
  // original header comment for why (same discipline as
  // createMyNaiaModelFixture below). The shoe item needs no upload of its
  // own now — it reuses the customer's own already-uploaded real photo.
  const capUpload = realAccessoryClosetItem
    ? null
    : await uploadCloudinaryPrivate(
        capPublicId,
        SYNTHETIC_FIXTURE_CAP_DATA_URL,
        "upload",
        undefined,
        undefined,
        undefined,
        FULL_LOOK_MAX_FIXTURE_SYNTHETIC_FORMAT,
      );
  if (capUpload && !capUpload.ok) {
    return data({ ok: false, code: "upload_failed", asset: "cap", errorCode: capUpload.errorCode }, { status: 502 });
  }

  const cloudinaryConfig = getCloudinaryConfig();
  if (capUpload && !cloudinaryConfig) {
    // The cap upload above already required a valid config to succeed at
    // all — this branch should be unreachable, but refuse explicitly
    // rather than build a malformed URL if it ever somehow is.
    return data({ ok: false, code: "cloudinary_not_configured" }, { status: 502 });
  }

  type FixtureItem = { itemType: OutfitItemType; title: string; productImageUrl?: string; closetItemId?: string };
  const items: FixtureItem[] = [
    ...FULL_LOOK_FIXTURE_ITEMS,
    {
      itemType: "SHOES",
      title: `[QA FIXTURE] Full-Look real shoe (max-boundary) — customer's own closet item${realShoeClosetItem.name ? `: ${realShoeClosetItem.name}` : ""}`,
      closetItemId: realShoeClosetItem.id,
    },
    realAccessoryClosetItem
      ? {
          itemType: "ACCESSORY" as OutfitItemType,
          title: `[QA FIXTURE] Full-Look real accessory (max-boundary) — customer's own closet item${realAccessoryClosetItem.name ? `: ${realAccessoryClosetItem.name}` : ""}`,
          closetItemId: realAccessoryClosetItem.id,
        }
      : {
          itemType: "ACCESSORY" as OutfitItemType,
          title: "[QA FIXTURE] Full-Look synthetic cap/accessory (max-boundary) — not a real customer item",
          productImageUrl: buildPublicCloudinaryDeliveryUrl(cloudinaryConfig!, capUpload!.publicId, capUpload!.version, capUpload!.format),
        },
  ];

  const { sessionId, suggestionId } = await prisma.$transaction(async (tx) => {
    const session = await tx.stylingSession.create({ data: { customerId }, select: { id: true } });
    const suggestion = await tx.outfitSuggestion.create({ data: { sessionId: session.id }, select: { id: true } });
    for (const { itemType, title, productImageUrl, closetItemId } of items) {
      await tx.outfitItem.create({
        data: {
          suggestionId: suggestion.id,
          itemType,
          productTitle: title,
          // Both the fixture marker AND closetItemId can be set together —
          // resolveItemImage (look-image-resolution.server.ts) checks
          // closetItemId first regardless, exactly as it does for a real
          // customer's own outfit item, so this item's real photo is what
          // actually gets resolved; shopifyProductId stays only as this
          // fixture's own cleanup/identification marker.
          shopifyProductId: FULL_LOOK_MAX_FIXTURE_SHOPIFY_PRODUCT_ID,
          ...(closetItemId ? { closetItemId } : {}),
          ...(productImageUrl ? { productImageUrl } : {}),
        },
      });
    }
    return { sessionId: session.id, suggestionId: suggestion.id };
  });

  return data({
    ok: true,
    fixtureKind: opts.requireRealAccessory ? "full-look-real-garments-max-all-real" : "full-look-real-garments-max",
    sessionId,
    suggestionId,
    itemCount: items.length,
    shoeSource: "real-closet-item",
    shoeClosetItemId: realShoeClosetItem.id,
    fixtureMode: opts.requireRealAccessory ? "all-real" : "legacy-synthetic-cap",
    accessorySource: realAccessoryClosetItem ? "real-closet-item" : "synthetic-cap",
    syntheticPlaceholderCount: realAccessoryClosetItem ? 0 : 1,
    ...(realAccessoryClosetItem ? { accessoryClosetItemId: realAccessoryClosetItem.id } : {}),
  });
}

// ── Full-Look eligibility-gate NEGATIVE fixture (2026-11-21) ─────────────────
//
// POST /api/vto-qa-fixture, body: { fixtureKind: "full-look-gate-negative" }
// (real Persona-A session only — resolveAuthorizedQaSessionCustomerId).
//
// WHY: proves on staging, WITHOUT spending FASHN credits, that Full-Look's
// pre-FASHN eligibility gate (full-look-closet-gate.server.ts) refuses an
// ineligible closet garment with HTTP 400 not_eligible before any job is
// reserved or submitted. There is no other way to build such a suggestion
// without running real StyleMe/AI flows or secret-gated seeding.
//
// WHAT IT CREATES (all throwaway, all marked):
//  - one ClosetItem, category SWIMWEAR (never VTO-allowed), Stage-A
//    "not-supported", named GATE_NEGATIVE_CLOSET_NAME. It points at a
//    customer-scoped publicId that was NEVER uploaded: nothing is written to
//    Cloudinary, and the gate refuses on category before any image is fetched.
//  - one StylingSession + OutfitSuggestion (moodDescription null, so the
//    existing deleteFixtureSuggestion cleanup works unmodified, including its
//    refusal to delete anything that has dependent VirtualTryOnJob rows).
//  - three OutfitItems (TOP, BOTTOM from the existing Full-Look fixture media,
//    OUTERWEAR backed by the swimwear closet item) — three distinct categories,
//    the minimum selectFullLookGarments needs to proceed to the gate. Every
//    item carries GATE_NEGATIVE_PRODUCT_ID, deliberately DIFFERENT from the
//    real-garments markers so it can never be mistaken for, or cleaned up as,
//    the approved five-item fixture.
//
// It creates no VirtualTryOnJob, reserves nothing, touches no billing.
// Refuses (409) if a previous throwaway closet item still exists, so it can
// never silently duplicate.
const GATE_NEGATIVE_PRODUCT_ID = "qa-fixture-full-look-gate-negative";
const GATE_NEGATIVE_CLOSET_NAME = "[QA FIXTURE] Gate-negative swimwear (throwaway, never rendered)";

async function createFullLookGateNegativeFixture(customerId: string) {
  const existing = await prisma.closetItem.findFirst({
    where: { customerId, category: "SWIMWEAR", name: GATE_NEGATIVE_CLOSET_NAME },
    select: { id: true },
  });
  if (existing) {
    return data({ ok: false, code: "already_exists", closetItemId: existing.id }, { status: 409 });
  }

  const result = await prisma.$transaction(async (tx) => {
    const closetItem = await tx.closetItem.create({
      data: {
        customerId,
        name: GATE_NEGATIVE_CLOSET_NAME,
        category: "SWIMWEAR",
        imageUrl: null,
        imagePublicId: `naia-wardrobe/${customerId}/qa-fixture-gate-negative-never-uploaded`,
        imageFormat: "jpg",
        colors: [],
        primaryColor: null,
        pattern: null,
        brand: null,
        occasions: [],
        seasons: [],
        tryOnEligibility: "not-supported",
        tryOnAssessedAt: new Date(),
        tryOnCustomerHint: null,
        tryOnInternalNote: "QA gate-negative fixture: SWIMWEAR is never VTO-allowed.",
        garmentRelationships: [],
        customerNote: null,
        ...buildConsentStamp(true),
      },
      select: { id: true },
    });
    const session = await tx.stylingSession.create({ data: { customerId }, select: { id: true } });
    const suggestion = await tx.outfitSuggestion.create({ data: { sessionId: session.id }, select: { id: true } });
    const rows: { itemType: OutfitItemType; title: string; productImageUrl?: string; closetItemId?: string }[] = [
      { itemType: "TOP", title: "[QA FIXTURE] Gate-negative top — never rendered", productImageUrl: FULL_LOOK_FIXTURE_ITEMS[0].productImageUrl },
      { itemType: "BOTTOM", title: "[QA FIXTURE] Gate-negative bottom — never rendered", productImageUrl: FULL_LOOK_FIXTURE_ITEMS[1].productImageUrl },
      { itemType: "OUTERWEAR", title: "[QA FIXTURE] Gate-negative closet swimwear — never rendered", closetItemId: closetItem.id },
    ];
    for (const { itemType, title, productImageUrl, closetItemId } of rows) {
      await tx.outfitItem.create({
        data: {
          suggestionId: suggestion.id,
          itemType,
          productTitle: title,
          shopifyProductId: GATE_NEGATIVE_PRODUCT_ID,
          ...(productImageUrl ? { productImageUrl } : {}),
          ...(closetItemId ? { closetItemId } : {}),
        },
      });
    }
    return { closetItemId: closetItem.id, sessionId: session.id, suggestionId: suggestion.id };
  });

  return data({ ok: true, fixtureKind: "full-look-gate-negative", ...result, itemCount: 3 });
}

// DELETE body: { fixtureKind: "full-look-gate-negative", suggestionId }.
// Tightly scoped: the suggestion must belong to the verified-session customer
// AND every one of its items must carry GATE_NEGATIVE_PRODUCT_ID — it can
// never delete the approved five-item fixture or any other suggestion. The
// suggestion itself is removed by the EXISTING deleteFixtureSuggestion
// (unmodified; it refuses with has_dependent_jobs if any VirtualTryOnJob
// exists), and only after it succeeds is the throwaway swimwear closet item
// removed, matched on customer + category + exact marker name.
async function deleteFullLookGateNegativeFixture(
  request: Request,
  parsed: Record<string, unknown> | null,
  customerId: string,
) {
  const suggestionId = parsed?.suggestionId;
  if (typeof suggestionId !== "string" || !suggestionId) {
    return data({ ok: false, code: "invalid_request", message: "suggestionId required" }, { status: 400 });
  }
  const suggestion = await prisma.outfitSuggestion.findUnique({
    where: { id: suggestionId },
    select: { id: true, session: { select: { customerId: true } }, items: { select: { shopifyProductId: true } } },
  });
  if (
    !suggestion ||
    suggestion.session.customerId !== customerId ||
    suggestion.items.length === 0 ||
    !suggestion.items.every((i) => i.shopifyProductId === GATE_NEGATIVE_PRODUCT_ID)
  ) {
    return data({ ok: false, code: "not_found" }, { status: 404 });
  }
  const res = await deleteFixtureSuggestion(request, parsed);
  const body = res.data as { ok?: boolean } | undefined;
  if (!body?.ok) return res;
  const closet = await prisma.closetItem.deleteMany({
    where: { customerId, category: "SWIMWEAR", name: GATE_NEGATIVE_CLOSET_NAME },
  });
  return data({ ...(body as object), fixtureKind: "full-look-gate-negative", closetItemsDeleted: closet.count });
}

// ── My nAia Model fixture (2026-11-18) ──────────────────────────────────────
//
// POST /api/vto-qa-fixture, body: { fixtureKind: "my-naia-model" }, while
// signed in (real Clerk session) as the one pre-designated
// QA_OVERRIDE_CUSTOMER_ID account — same authorization posture as
// full-look-real-garments / styleme-result-view above.
//
// WHY THIS EXISTS: Five-Persona QA #30/#31 found Persona A has no
// configured My nAia Model at all — the real Full-Look VTO route rejects
// before ever reaching FASHN (computeModelReadinessFromRecord's
// isReadyForTryOn requires both a non-empty bodyPublicId AND a non-null
// saveModelConsentAt; fashn-tryon-service.server.ts separately hard-
// requires bodyModerationStatus === "APPROVED" before submitting). This
// fixture satisfies BOTH checks for real — it does not weaken, mock, or
// bypass either one; it writes a NaiaModel row whose fields are the exact
// same shape and values a REAL, fully-onboarded, approved model has.
//
// NOT SAFE TO INVENT A FAKE bodyPublicId: downloadModelPhotoAsDataUrl
// (fashn-tryon-service.server.ts) always builds a real, signed Cloudinary
// private_download URL from bodyPublicId + bodyFormat and actually fetches
// it — there is no plain-URL bypass here the way OutfitItem.productImageUrl
// has one. A bodyPublicId with no real backing Cloudinary asset would pass
// this fixture's own write but fail at actual FASHN-submission time with
// PROVIDER_ERROR, which would misreport readiness as fixed when it isn't.
//
// THEREFORE: MY_NAIA_MODEL_FIXTURE_BODY_PUBLIC_ID below names a specific,
// not-yet-uploaded Cloudinary asset path, naia-wardrobe/<customerId>/
// prefixed per validatePublicIdOwnership's own convention (even though
// this write goes directly through Prisma, bypassing saveNaiaModelPhoto's
// own call to that check, for consistency with every real row's shape).
// 2026-11-18 — the synthetic test image has now been generated (fully
// AI-generated, non-identifiable, founder-confirmed — not a real
// person's photograph) and uploaded to exactly this public_id, delivery
// type private, via a disposable upload route reusing the same
// uploadCloudinaryPrivate() saveNaiaModelPhoto itself calls. Independently
// verified after upload, not assumed: listed at this exact public_id;
// Cloudinary's own reported format is "png" (not guessed — the format
// constant below was corrected from an initial "jpg" placeholder to
// match); a real signed private_download fetch returns the complete
// asset (content-length byte-for-byte identical to the original 1,894,571-
// byte source file); a plausible plain/unsigned Cloudinary CDN URL for
// this exact asset returns 404 — confirmed genuinely private, not public.
//
// bodyModerationStatus is set directly to "APPROVED" — the real value
// saveNaiaModelPhoto only reaches after Layer 2+3 moderation (a real,
// potentially-paid AI call) passes. Setting it directly here, for this
// specific, already-generated, founder-reviewed synthetic test image
// whose content is already known and controlled, is the same "skip the
// AI-dependent creation pipeline, write the real resulting shape
// directly" approach the StyleMe and Full-Look fixtures above already use
// for Claude/FASHN generation — not a new pattern, and not a weakening of
// the real check: the FIELD is still checked for real at submission time,
// this fixture just supplies its value directly instead of deriving it
// from a real moderation call, in place of the test-specific appropriateness
// review this image already received before upload.
//
// consentPolicyVersion uses the real POLICY_VERSION constant — this is
// the same value every real customer's consent record uses, not a fixture-
// specific placeholder, so this row is structurally indistinguishable
// from a real one to every downstream consumer.
//
// 2026-11-20 CONFIRMED GAP, FIXED — the paragraph above describes a single
// manual upload performed once, out-of-band, for the one disposable QA
// account this fixture has always targeted. That manual step is NOT part
// of this function's own code path, so it only ever covered that one
// account's one bodyPublicId — any other invocation (a different
// QA_OVERRIDE_CUSTOMER_ID, or this same asset having since been deleted,
// e.g. by this fixture's own cleanup below) writes a bodyPublicId with no
// real Cloudinary asset behind it. A real Full-Look VTO submission then
// calls downloadModelPhotoAsDataUrl (fashn-tryon-service.server.ts), which
// actually fetches the asset — and fails with PROVIDER_ERROR before FASHN
// is ever reached (full-look-tryon-real.server.ts's submitFullLookRealStep
// marks the job FAILED on that download failure), exactly matching a real
// staging acceptance-test failure with zero FASHN credits spent. Confirmed
// by direct code tracing of that exact path, not by assumption.
//
// Fixed here: this function now ACTUALLY uploads a real (synthetic,
// generated inline, non-identifying) photo to bodyPublicId via the same
// uploadCloudinaryPrivate() saveNaiaModelPhoto itself calls, every time it
// runs, for every customer — never relying on a prior manual step. The
// NaiaModel row is only written (create, update, or the adopt-path's CAS
// update) after that upload has actually succeeded; a failed upload
// returns a clear failure and writes nothing, rather than repeating the
// exact broken "DB says ready, no bytes exist" state this gap produced.
const MY_NAIA_MODEL_FIXTURE_FORMAT = "png";

// A valid, synthetic PNG — hand-built here from raw pixels via Node's
// built-in zlib (no new dependency, no network fetch, no AI-generation
// call) — depicting a simple humanoid silhouette: a head circle, a torso
// rectangle, two arm rectangles, and two leg rectangles in a flat dark
// gray against a light gray background, 180x320px. Generated inline, not
// read from a checked-in asset file, so there is no separate file to keep
// in sync with this constant.
//
// 2026-11-20 — upgraded from an earlier single-solid-pixel placeholder.
// A 1x1 pixel passes Cloudinary's own upload validation but gives FASHN's
// pose/body-detection step nothing to find — in the real paid Full-Look
// VTO flow this fixture exists to exercise, that risks either a NEW
// failure mode (PROVIDER_REJECTED) or, worse, acceptance followed by a
// real-credit-spending, guaranteed-garbage generation. This image is
// still fully synthetic and non-identifiable (geometric shapes, not a
// real photo of a real person) but has actual head/torso/limb structure
// for a pose-detection step to act on.
function buildSyntheticHumanoidSilhouettePng(): Buffer {
  const width = 180;
  const height = 320;

  const background: [number, number, number] = [230, 230, 230];
  const foreground: [number, number, number] = [60, 60, 60];

  const headCenterX = width / 2;
  const headCenterY = 54;
  const headRadius = 32;
  const torso = { x0: 62, y0: 86, x1: 118, y1: 190 };
  const armLeft = { x0: 40, y0: 92, x1: 62, y1: 178 };
  const armRight = { x0: 118, y0: 92, x1: 140, y1: 178 };
  const legLeft = { x0: 68, y0: 190, x1: 88, y1: 304 };
  const legRight = { x0: 92, y0: 190, x1: 112, y1: 304 };

  const inRect = (x: number, y: number, r: { x0: number; y0: number; x1: number; y1: number }) =>
    x >= r.x0 && x < r.x1 && y >= r.y0 && y < r.y1;

  const isForeground = (x: number, y: number): boolean => {
    const dx = x - headCenterX;
    const dy = y - headCenterY;
    if (dx * dx + dy * dy <= headRadius * headRadius) return true;
    return (
      inRect(x, y, torso) ||
      inRect(x, y, armLeft) ||
      inRect(x, y, armRight) ||
      inRect(x, y, legLeft) ||
      inRect(x, y, legRight)
    );
  };

  // Raw PNG scanlines: each row is a filter-type byte (0 = "None")
  // followed by width * 3 RGB bytes — exactly what zlib-deflating and
  // wrapping in IDAT below expects.
  const stride = 1 + width * 3;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * stride;
    raw[rowStart] = 0;
    for (let x = 0; x < width; x++) {
      const [r, g, b] = isForeground(x, y) ? foreground : background;
      const px = rowStart + 1 + x * 3;
      raw[px] = r;
      raw[px + 1] = g;
      raw[px + 2] = b;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: truecolor (RGB)
  ihdr[10] = 0; // compression method
  ihdr[11] = 0; // filter method
  ihdr[12] = 0; // interlace method

  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([
    signature,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", zlib.deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

// Standard PNG/zlib CRC-32 table, used only to checksum the chunks this
// file hand-builds above — no external dependency, this is the same
// well-known polynomial every PNG encoder/decoder uses.
const PNG_CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function pngCrc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = PNG_CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, chunkData: Buffer): Buffer {
  const typeBuf = Buffer.from(type, "ascii");
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(chunkData.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(pngCrc32(Buffer.concat([typeBuf, chunkData])), 0);
  return Buffer.concat([lenBuf, typeBuf, chunkData, crcBuf]);
}

// Built once at module load (cheap: a few hundred KB of in-memory pixel
// math, not a network call) and reused for every fixture invocation,
// rather than re-encoding the same PNG bytes on every request.
const SYNTHETIC_FIXTURE_PHOTO_DATA_URL = `data:image/png;base64,${buildSyntheticHumanoidSilhouettePng().toString("base64")}`;

// ── Synthetic shoe/cap fixture images (2026-11-20) ──────────────────────────
//
// WHY THESE EXIST: the full-look-real-garments-max fixture below (SHOES +
// ACCESSORY slots) needs a real, fetchable productImageUrl for each item —
// no real Shopify CDN image for a shoe or a cap exists anywhere in this
// repo (the extracted NADINE catalog is dresses-only; the storefront is
// password-protected and must not be bypassed to go look for one). Founder-
// authorized synthetic alternative, same spirit as
// buildSyntheticHumanoidSilhouettePng above: hand-built, zero-dependency,
// non-identifiable, visually-meaningful (not a trivial placeholder) PNGs.
//
// Shared raw-pixel-to-PNG renderer, factored out so the shoe and cap
// builders below don't each duplicate the scanline/IHDR/IDAT assembly —
// reuses the SAME pngChunk/PNG_CRC_TABLE helpers buildSyntheticHumanoid
// SilhouettePng already uses (via pngChunk below); that function itself is
// left untouched, not refactored to call this, so its own already-verified
// output can never change as a side effect of adding this.
function renderSilhouettePng(
  width: number,
  height: number,
  background: [number, number, number],
  foreground: [number, number, number],
  isForeground: (x: number, y: number) => boolean,
): Buffer {
  const stride = 1 + width * 3;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * stride;
    raw[rowStart] = 0;
    for (let x = 0; x < width; x++) {
      const [r, g, b] = isForeground(x, y) ? foreground : background;
      const px = rowStart + 1 + x * 3;
      raw[px] = r;
      raw[px + 1] = g;
      raw[px + 2] = b;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: truecolor (RGB)
  ihdr[10] = 0; // compression method
  ihdr[11] = 0; // filter method
  ihdr[12] = 0; // interlace method

  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([
    signature,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", zlib.deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

// Shoe-profile silhouette: a long, thin sole strip along the bottom, a
// rounded toe box (circle), a raised heel block at the back, and a vamp
// (rectangle) connecting them — clearly shoe-shaped, not an abstract block.
// 160x100px, same small scale as the body-photo fixture above.
function buildSyntheticShoeSilhouettePng(): Buffer {
  const width = 160;
  const height = 100;
  const background: [number, number, number] = [235, 235, 235];
  const foreground: [number, number, number] = [92, 64, 51]; // shoe-leather brown

  const sole = { x0: 14, y0: 78, x1: 146, y1: 92 };
  const heel = { x0: 118, y0: 38, x1: 146, y1: 90 };
  const vamp = { x0: 36, y0: 52, x1: 120, y1: 86 };
  const toeCenterX = 40;
  const toeCenterY = 68;
  const toeRadius = 26;

  const inRect = (x: number, y: number, r: { x0: number; y0: number; x1: number; y1: number }) =>
    x >= r.x0 && x < r.x1 && y >= r.y0 && y < r.y1;

  const isForeground = (x: number, y: number): boolean => {
    const dx = x - toeCenterX;
    const dy = y - toeCenterY;
    if (dx * dx + dy * dy <= toeRadius * toeRadius) return true;
    return inRect(x, y, sole) || inRect(x, y, heel) || inRect(x, y, vamp);
  };

  return renderSilhouettePng(width, height, background, foreground, isForeground);
}

// Cap silhouette: a rounded dome (upper half of a circle, flattened at the
// head-opening line) with a brim projecting from one side (front) at that
// same line — clearly cap-shaped, not an abstract blob. 140x100px.
function buildSyntheticCapSilhouettePng(): Buffer {
  const width = 140;
  const height = 100;
  const background: [number, number, number] = [235, 235, 235];
  const foreground: [number, number, number] = [40, 60, 90]; // cap-navy

  const domeCenterX = 65;
  const domeCenterY = 52;
  const domeRadius = 42;
  const baseY = 52; // flat bottom edge of the dome (head-opening line)
  const brim = { x0: domeCenterX - 8, y0: baseY, x1: domeCenterX + domeRadius + 26, y1: baseY + 12 };

  const inRect = (x: number, y: number, r: { x0: number; y0: number; x1: number; y1: number }) =>
    x >= r.x0 && x < r.x1 && y >= r.y0 && y < r.y1;

  const isForeground = (x: number, y: number): boolean => {
    const dx = x - domeCenterX;
    const dy = y - domeCenterY;
    if (y <= baseY && dx * dx + dy * dy <= domeRadius * domeRadius) return true; // dome, trimmed flat
    return inRect(x, y, brim); // brim projecting to one side
  };

  return renderSilhouettePng(width, height, background, foreground, isForeground);
}

const SYNTHETIC_FIXTURE_SHOE_DATA_URL = `data:image/png;base64,${buildSyntheticShoeSilhouettePng().toString("base64")}`;
const SYNTHETIC_FIXTURE_CAP_DATA_URL = `data:image/png;base64,${buildSyntheticCapSilhouettePng().toString("base64")}`;
const FULL_LOOK_MAX_FIXTURE_SYNTHETIC_FORMAT = "png";

function fullLookMaxFixtureShoePublicId(customerId: string): string {
  return `naia-wardrobe/${customerId}/qa-fixture-synthetic-shoe`;
}

function fullLookMaxFixtureCapPublicId(customerId: string): string {
  return `naia-wardrobe/${customerId}/qa-fixture-synthetic-cap`;
}

// Plain PUBLIC Cloudinary delivery URL — deliberately NOT buildPrivateDownloadUrl
// (that signs a time-limited, Admin-API "download" URL meant for THIS app's
// own authenticated preview surfaces) and NOT buildSignedDeliveryUrl (that
// signs a CDN path, also for private/authenticated delivery types). A
// garment's productImageUrl is fetched directly by FASHN
// (submitTryOnToProvider, fashn-try-on.server.ts: `product_image:
// input.productImageUrl`) exactly like every real Shopify CDN URL this
// fixture otherwise uses — it must be a plain, non-expiring public URL, not
// a signed one. This is the standard, well-documented Cloudinary delivery
// URL shape for assets uploaded with type "upload" (public): res.cloudinary.
// com/{cloud_name}/image/upload/v{version}/{public_id}.{format} — built
// here from the real cloudName (CloudinaryConfig) and the real
// version/format Cloudinary's own upload response returned, never guessed.
function buildPublicCloudinaryDeliveryUrl(
  config: { cloudName: string },
  publicId: string,
  version: string,
  format: string,
): string {
  const vPart = version ? `v${version}/` : "";
  return `https://res.cloudinary.com/${config.cloudName}/image/upload/${vPart}${publicId}.${format}`;
}

function myNaiaModelFixtureBodyPublicId(customerId: string): string {
  return `naia-wardrobe/${customerId}/qa-fixture-synthetic-body`;
}

// 2026-11-18 — Persona A turned out to already have a NaiaModel row
// (confirmed via a disposable, zero-PII-disclosure diagnostic: no
// facePublicId, no bodyPublicId, no consent of any kind, zero
// VirtualTryOnJob rows ever — but bodyFormat/bodyModerationStatus/
// bodyModerationAt were non-null, an inconsistent remnant of some
// earlier incomplete/failed attempt, not a usable photo or a real
// customer's consent). The original overwrite-protection check (any
// bodyPublicId mismatch → refuse) was stricter than necessary: it
// correctly blocks a row with a REAL photo or REAL consent, but also
// blocked this harmless, photo-less, consent-less remnant.
//
// ADOPTABLE is defined narrowly and exactly matches the concept this
// codebase already uses for "nothing real here": no bodyPublicId AND no
// saveModelConsentAt — computeModelReadinessFromRecord's own
// isReadyForTryOn already treats a row failing either condition as not
// usable, and neither field can mean anything to a real customer without
// the other (a stray bodyFormat with no bodyPublicId describes no actual
// photo; stray moderation fields describe no actual review of anything
// real). A row with a REAL bodyPublicId OR REAL saveModelConsentAt is
// never adoptable — refused exactly as before.
function isAdoptableNaiaModelRow(model: { bodyPublicId: string | null; saveModelConsentAt: Date | null }): boolean {
  return !model.bodyPublicId && model.saveModelConsentAt === null;
}

const NAIA_MODEL_ADOPTION_AUDIT_ACTION = "qa_fixture_naia_model_adoption";

async function createMyNaiaModelFixture(customerId: string) {
  const bodyPublicId = myNaiaModelFixtureBodyPublicId(customerId);
  const now = new Date();
  const fields = {
    bodyPublicId,
    bodyFormat: MY_NAIA_MODEL_FIXTURE_FORMAT,
    deliveryType: "private",
    bodyModerationStatus: "APPROVED",
    bodyModerationAt: now,
    saveModelConsentAt: now,
    consentPolicyVersion: POLICY_VERSION,
  };

  // Single read, OUTSIDE any DB transaction, deciding which of the four
  // outcomes this call is — before any upload or any write is attempted.
  // This is the ONLY read of the row this function performs; the write
  // below (whichever branch) does not re-read it, so there is nothing to
  // keep in sync with a second query. Not reachable at all for "refused":
  // that branch returns immediately below, writing nothing and uploading
  // nothing — a real/foreign model is never touched, exactly as before.
  const existing = await prisma.naiaModel.findUnique({ where: { customerId } });

  let mode: "created" | "updated-own" | "adopted";
  if (!existing) {
    mode = "created";
  } else if (existing.bodyPublicId === bodyPublicId) {
    // Already this exact fixture's own prior record — safe repeat call.
    mode = "updated-own";
  } else if (isAdoptableNaiaModelRow(existing)) {
    mode = "adopted";
  } else {
    return data({ ok: false, code: "existing_model_present" }, { status: 409 });
  }

  // Upload the synthetic fixture photo BEFORE writing (or updating) any
  // NaiaModel row that claims a photo exists at bodyPublicId — see this
  // function's own header comment (2026-11-20) for exactly why a DB-only
  // write here is the defect this fixes. Deliberately NOT inside the
  // prisma.$transaction below: this is a real network call (Cloudinary),
  // and holding an interactive-transaction connection open across it would
  // risk the transaction's own (much shorter) timeout — a concern that
  // doesn't apply to a plain sequential await here.
  const uploadResult = await uploadCloudinaryPrivate(
    bodyPublicId,
    SYNTHETIC_FIXTURE_PHOTO_DATA_URL,
    "private",
    undefined,
    undefined,
    undefined,
    MY_NAIA_MODEL_FIXTURE_FORMAT,
  );
  if (!uploadResult.ok) {
    // No DB write of any kind happens past this point — never leave a
    // NaiaModel row (new, updated, or adopted) claiming a photo exists
    // that in fact was never actually uploaded. This is exactly the
    // "server_error PROVIDER_ERROR, zero FASHN credits spent" failure
    // mode this fix exists to prevent from recurring.
    return data(
      { ok: false, code: "upload_failed", errorCode: uploadResult.errorCode },
      { status: 502 },
    );
  }

  let outcome: { mode: "created" | "updated-own" | "adopted"; model: { id: string; bodyPublicId: string | null } };
  try {
    outcome = await prisma.$transaction(async (tx) => {
      if (mode === "created") {
        const created = await tx.naiaModel.create({
          data: { customerId, ...fields },
          select: { id: true, bodyPublicId: true },
        });
        return { mode: "created" as const, model: created };
      }

      if (mode === "updated-own") {
        const updated = await tx.naiaModel.update({
          where: { customerId },
          data: fields,
          select: { id: true, bodyPublicId: true },
        });
        return { mode: "updated-own" as const, model: updated };
      }

      // mode === "adopted". `existing` is guaranteed non-null here (only
      // "adopted" is reachable when existing is set and adoptable).
      const adoptable = existing!;

      // Snapshot EVERY field before touching anything, so cleanup can
      // restore it exactly — not just delete the row, which would lose a
      // state that (even though not functionally meaningful) the founder
      // asked to be precisely preserved and restored, not discarded by
      // assumption. Written to AdminAuditLog directly (within this same
      // transaction) rather than via recordAdminAction(), which hardcodes
      // the top-level prisma client and so cannot participate in this
      // transaction's atomicity.
      await tx.adminAuditLog.create({
        data: {
          performedBy: "qa-fixture:my-naia-model",
          action: NAIA_MODEL_ADOPTION_AUDIT_ACTION,
          detail: {
            customerId,
            originalFields: {
              facePublicId: adoptable.facePublicId,
              faceVersion: adoptable.faceVersion,
              faceFormat: adoptable.faceFormat,
              bodyPublicId: adoptable.bodyPublicId,
              bodyVersion: adoptable.bodyVersion,
              bodyFormat: adoptable.bodyFormat,
              deliveryType: adoptable.deliveryType,
              photoAnalysisConsentAt: adoptable.photoAnalysisConsentAt?.toISOString() ?? null,
              saveModelConsentAt: adoptable.saveModelConsentAt?.toISOString() ?? null,
              consentPolicyVersion: adoptable.consentPolicyVersion,
              bodyModerationStatus: adoptable.bodyModerationStatus,
              bodyModerationAt: adoptable.bodyModerationAt?.toISOString() ?? null,
            },
          },
        },
      });

      // Compare-and-swap: only proceed if the row still looks exactly as
      // just read (no real photo, no real consent) at the moment of
      // write — detects a concurrent writer between our read (and the
      // upload we just performed) and this update instead of silently
      // clobbering it. A lost race aborts the whole transaction
      // (including the audit-log insert above) rather than leaving a
      // snapshot with no corresponding adoption. The now-uploaded
      // Cloudinary asset is harmless orphaned fixture content either way
      // — left for the existing orphan-sweep mechanism, same as any other
      // abandoned upload in this file.
      const cas = await tx.naiaModel.updateMany({
        where: { customerId, bodyPublicId: adoptable.bodyPublicId, saveModelConsentAt: null },
        data: fields,
      });
      if (cas.count !== 1) {
        throw new Error("CONCURRENT_MODIFICATION");
      }
      const updated = await tx.naiaModel.findUniqueOrThrow({
        where: { customerId },
        select: { id: true, bodyPublicId: true },
      });
      return { mode: "adopted" as const, model: updated };
    });
  } catch (err) {
    if (err instanceof Error && err.message === "CONCURRENT_MODIFICATION") {
      return data({ ok: false, code: "concurrent_modification" }, { status: 409 });
    }
    throw err;
  }

  return data({
    ok: true,
    fixtureKind: "my-naia-model",
    naiaModelId: outcome.model.id,
    bodyPublicId: outcome.model.bodyPublicId,
    adopted: outcome.mode === "adopted",
  });
}

// ── My nAia Model fixture cleanup (2026-11-18) ──────────────────────────────
//
// DELETE /api/vto-qa-fixture, body: { fixtureKind: "my-naia-model" }
//
// Deliberately a SEPARATE cleanup path from deleteFixtureSuggestion below —
// NaiaModel is a distinct, customerId-unique table, not reachable through
// an OutfitSuggestion at all. Same real-session authorization. Refuses
// (does nothing) unless the existing row's bodyPublicId exactly matches
// this fixture's own deterministic value for this customer — never deletes
// a real customer's genuinely-configured model, even if one happens to
// exist for this same customerId by the time cleanup runs.
async function deleteMyNaiaModelFixture(request: Request) {
  const sessionCustomerId = await resolveAuthorizedQaSessionCustomerId(request);
  if (!sessionCustomerId) {
    return data({ ok: false, code: "forbidden" }, { status: 403 });
  }

  const model = await prisma.naiaModel.findUnique({
    where: { customerId: sessionCustomerId },
    select: { id: true, bodyPublicId: true },
  });

  if (!model || model.bodyPublicId !== myNaiaModelFixtureBodyPublicId(sessionCustomerId)) {
    // Not found, or a real/different model — refuse rather than guess.
    return data({ ok: false, code: "not_found" }, { status: 404 });
  }

  // 2026-11-18 — delete the actual Cloudinary asset too, not just the DB
  // row. The styleme/full-look fixtures above never upload anything of
  // their own to this app's Cloudinary account (synthetic items point at
  // already-public, externally-hosted URLs), so there was nothing to
  // clean up there — this fixture is the first to actually place a new
  // asset in this app's own Cloudinary account, so secure, verified
  // deletion is part of its cleanup contract, not left to the orphan
  // sweep. Best-effort, reported but not fatal: the DB row (the only
  // thing any readiness/entitlement check actually reads) is still
  // removed either way, and a failed Cloudinary delete here is the same
  // kind of residual the orphan sweep already exists to catch.
  const assetDeletion = await deleteCloudinaryAsset(model.bodyPublicId, "private");

  // 2026-11-18 — if this customer's row was ADOPTED (a pre-existing,
  // photo-less/consent-less remnant this fixture temporarily overwrote,
  // not a freshly-created row), restore its exact original field values
  // instead of deleting it — a real row, however empty its practical
  // content, must come back exactly as found, not vanish. Found by its
  // own adoption audit-log entry, which only ever exists for this exact
  // path (never written on a fresh create or a same-fixture re-run — see
  // createMyNaiaModelFixture's own comment). Most recent entry for this
  // customerId, since at most one adoption cycle is ever open per
  // customer at a time under this fixture's own usage pattern.
  const adoptionLog = await prisma.adminAuditLog.findFirst({
    where: { action: NAIA_MODEL_ADOPTION_AUDIT_ACTION },
    orderBy: { createdAt: "desc" },
  });
  const adoptionDetail = adoptionLog?.detail as { customerId?: string; originalFields?: Record<string, unknown> } | null;
  const isThisCustomersAdoption = adoptionDetail?.customerId === sessionCustomerId;

  if (isThisCustomersAdoption && adoptionDetail?.originalFields) {
    const o = adoptionDetail.originalFields;
    await prisma.naiaModel.update({
      where: { customerId: sessionCustomerId },
      data: {
        facePublicId: (o.facePublicId as string | null) ?? null,
        faceVersion: (o.faceVersion as string | null) ?? null,
        faceFormat: (o.faceFormat as string | null) ?? null,
        bodyPublicId: (o.bodyPublicId as string | null) ?? null,
        bodyVersion: (o.bodyVersion as string | null) ?? null,
        bodyFormat: (o.bodyFormat as string | null) ?? null,
        deliveryType: (o.deliveryType as string | undefined) ?? "private",
        photoAnalysisConsentAt: o.photoAnalysisConsentAt ? new Date(o.photoAnalysisConsentAt as string) : null,
        saveModelConsentAt: o.saveModelConsentAt ? new Date(o.saveModelConsentAt as string) : null,
        consentPolicyVersion: (o.consentPolicyVersion as string | null) ?? null,
        bodyModerationStatus: (o.bodyModerationStatus as string | null) ?? null,
        bodyModerationAt: o.bodyModerationAt ? new Date(o.bodyModerationAt as string) : null,
      },
    });

    return data({
      ok: true,
      fixtureKind: "my-naia-model",
      restoredNaiaModelId: model.id,
      cloudinaryAssetDeleted: assetDeletion.ok,
    });
  }

  await prisma.naiaModel.delete({ where: { customerId: sessionCustomerId } });

  return data({
    ok: true,
    fixtureKind: "my-naia-model",
    deletedNaiaModelId: model.id,
    cloudinaryAssetDeleted: assetDeletion.ok,
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
    select: {
      id: true,
      moodDescription: true,
      sessionId: true,
      session: { select: { customerId: true } },
      items: { select: { shopifyProductId: true } },
    },
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

  // 2026-11-18 — the full-look-real-garments fixture above exists
  // specifically so a REAL Full-Look VTO run can create real
  // VirtualTryOnJob rows against it (that's the point: exercising the
  // genuine entitlement/duplicate-submission/accounting logic). This
  // cleanup must therefore be able to remove those jobs too — but ONLY for
  // suggestions this exact fixture created, never for styleme-result-view
  // or any real customer suggestion, where a dependent job existing is
  // still an unexpected state this action refuses to touch. Distinguished
  // by every one of the suggestion's own items carrying one of these two
  // fixtures' distinct shopifyProductId markers (set only by
  // createFullLookRealGarmentsFixture / createFullLookRealGarmentsMaxFixture
  // above) — not by moodDescription alone, since that's shared with
  // styleme-result-view.
  const isFullLookRealGarmentsFixture =
    suggestion.items.length > 0 &&
    (suggestion.items.every((item) => item.shopifyProductId === FULL_LOOK_FIXTURE_SHOPIFY_PRODUCT_ID) ||
      suggestion.items.every((item) => item.shopifyProductId === FULL_LOOK_MAX_FIXTURE_SHOPIFY_PRODUCT_ID));

  // 2026-11-20 — narrower than isFullLookRealGarmentsFixture above: ONLY the
  // max-boundary fixture kind ever uploads its own Cloudinary assets (the
  // synthetic shoe/cap images — see createFullLookRealGarmentsMaxFixture's
  // own comment); the 3-item fixture's items are all real, already-public
  // Shopify CDN URLs with nothing of this fixture's own to clean up.
  const isFullLookMaxGarmentsFixture =
    suggestion.items.length > 0 &&
    suggestion.items.every((item) => item.shopifyProductId === FULL_LOOK_MAX_FIXTURE_SHOPIFY_PRODUCT_ID);

  if (dependentJobs > 0 && !isFullLookRealGarmentsFixture) {
    return data({ ok: false, code: "has_dependent_jobs", dependentJobs }, { status: 409 });
  }

  // No Cloudinary cleanup here for a completed real FASHN run's OWN result
  // image(s) — those are uploaded independently of these DB rows, and
  // deleting the VirtualTryOnJob row does not delete that asset; it is
  // left for the existing, already-reviewed Cloudinary orphan-sweep
  // mechanism to reclaim in the ordinary course, same as any other
  // abandoned upload. That is unchanged.
  await prisma.$transaction([
    ...(dependentJobs > 0 ? [prisma.virtualTryOnJob.deleteMany({ where: { outfitSuggestionId: suggestion.id } })] : []),
    prisma.outfitItem.deleteMany({ where: { suggestionId: suggestion.id } }),
    prisma.outfitSuggestion.delete({ where: { id: suggestion.id } }),
    prisma.stylingSession.delete({ where: { id: suggestion.sessionId } }),
  ]);

  // 2026-11-20 — the max-boundary fixture's own 2 synthetic assets (shoe +
  // cap, uploaded by createFullLookRealGarmentsMaxFixture with delivery
  // type "upload", public) ARE this fixture's own content, unlike a real
  // FASHN result image — so, unlike the comment above, this cleanup does
  // own them. Best-effort and non-fatal, same posture as
  // deleteMyNaiaModelFixture's own Cloudinary deletion above: the DB rows
  // are already gone by this point regardless of whether this succeeds,
  // and a failed delete here is the same kind of residual the orphan
  // sweep already exists to catch — never a reason to fail this request
  // after the real (DB) cleanup already succeeded.
  let cloudinaryAssetsDeleted: boolean | null = null;
  if (isFullLookMaxGarmentsFixture) {
    try {
      const [shoeDeletion, capDeletion] = await Promise.all([
        deleteCloudinaryAsset(fullLookMaxFixtureShoePublicId(customerId), "upload"),
        deleteCloudinaryAsset(fullLookMaxFixtureCapPublicId(customerId), "upload"),
      ]);
      cloudinaryAssetsDeleted = shoeDeletion.ok && capDeletion.ok;
    } catch {
      cloudinaryAssetsDeleted = false;
    }
  }

  return data({
    ok: true,
    deletedSuggestionId: suggestion.id,
    deletedSessionId: suggestion.sessionId,
    deletedJobCount: dependentJobs,
    ...(cloudinaryAssetsDeleted !== null ? { cloudinaryAssetsDeleted } : {}),
  });
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
