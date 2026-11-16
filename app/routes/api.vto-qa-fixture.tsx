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
// POST only. Never creates a ClosetItem, never creates a Customer, never
// touches any customer other than the one named by QA_OVERRIDE_CUSTOMER_ID.

import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { timingSafeEqual } from "crypto";
import { prisma } from "~/lib/prisma.server";
import { closetItemToSlot } from "~/lib/ai/closet-slot";
import type { OutfitSlot } from "~/lib/ai/styleme-recommendation.types";
import type { OutfitItemType } from "@prisma/client";

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

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return data({ ok: false, code: "method_not_allowed" }, { status: 405 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return data({ ok: false, code: "invalid_request" }, { status: 400 });
  }
  const customerId = (body as Record<string, unknown> | null)?.customerId;

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

  const suggestionId = await prisma.$transaction(async (tx) => {
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
    return suggestion.id;
  });

  return data({
    ok: true,
    suggestionId,
    chosenItems: chosen.map(({ slot, item }) => ({ slot, closetItemId: item.id, name: item.name })),
    totalEligibleCategoriesAvailable: chosen.length,
  });
}
