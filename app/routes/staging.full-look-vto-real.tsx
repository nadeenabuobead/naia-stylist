// app/routes/staging.full-look-vto-real.tsx
//
// STAGING-ONLY, REAL FASHN test harness for sequential full-look VTO.
//
// NOT REGISTERED in app/routes.ts — same deliberate, separate-later-step
// convention as staging.full-look-vto-test.tsx (the mock harness, which this
// route reuses the gate, Work-combination resolution, and quota policy from,
// unmodified). Loader/action are invoked directly by this route's own test
// file; there is no route() entry wiring this into the live application.
//
// WHAT'S DIFFERENT FROM THE MOCK ROUTE: this route submits real garment
// images from Sara's real Closet (resolveClosetAnchor, already real in the
// mock route too) to the REAL FASHN API, using Sara's REAL nAia Model photo
// (downloadModelPhotoAsDataUrl — the mock route's own "SWAP POINT"). Every
// other protection (ownership, category eligibility, model readiness,
// moderation, consent freshness, garment suitability screening, the
// provisional 3-unit quota pre-check) is reused UNMODIFIED from
// staging.full-look-vto-test.tsx — imported, not reimplemented, so there is
// exactly one place each of those checks is defined.
//
// EXECUTION MODEL (the one real architectural change from the mock route):
// the mock route runs all 3 steps synchronously inside one POST via
// runFashnTryOn's submit-and-poll-to-completion loop (up to ~270s worst
// case) — safe only because its FASHN calls are mocked and resolve
// instantly. This route instead uses full-look-tryon-real.server.ts, which
// never holds a request open waiting on FASHN: the action submits AT MOST
// one step (one POST), and the loader checks AT MOST one step's status (one
// GET), optionally followed by submitting the next step (one more POST) —
// the same two-endpoint, client-polls-the-loader shape
// api.tryon-status.$jobId.tsx already uses for one garment, extended across
// 3. See that module's own header for the full rationale.
//
// JOB TRACKING / RECOVERY: 3 ordinary VirtualTryOnJob rows (one per garment
// step), looked up by deterministic idempotency keys — no new Prisma model,
// no new migration. A browser refresh just re-GETs this route; the loader
// re-derives the chain's current position from those same keys and
// continues polling/advancing exactly where it left off. A duplicate POST
// (double-click, retry) resolves to the SAME existing job via the unique
// idempotencyKey constraint — never a second FASHN submission.
//
// BILLING CEILING: exactly MAX_CHAIN_LENGTH (3) VirtualTryOnJob rows can
// ever be created for this customer's one real chain — step 0's job uses a
// PERMANENT, customer-scoped reservation key (no reservationScope escape
// hatch like the mock route's repeatable-testing one), so this chain can run
// to real completion at most ONCE, ever, per customer, without a manual
// database reset. A failed or uncertain step is never auto-retried — see
// full-look-tryon-real.server.ts's "NO AUTO-RETRY" section.
//
// RESULT PERSISTENCE: the final (3rd step's) output is uploaded to private
// Cloudinary storage via the existing, unmodified uploadTryOnResult /
// buildTryOnResultUrl (same mechanism and same short-lived signed-URL
// pattern as the real single-garment path) — never returned as a raw data
// URL, never retained in the HTTP response only. Ownership-scoped,
// Cache-Control: no-store, 10-minute signed expiry, same as every other VTO
// result in this app.
//
// AUTH / AUTHORIZATION: identical gate to the mock route — session cookie
// only (getCurrentNaiaCustomer), isAuthorizedStagingTestAccount (imported
// unmodified from staging.full-look-vto-test.tsx: NAIA_PROJECT_VARIANT ===
// "staging" strictly, plus FULL_LOOK_VTO_TEST_CUSTOMER_IDS allowlist),
// re-checked independently in both loader and action.
//
// WHAT THIS DOES NOT DO: GET never submits anything — it only polls a
// chain already started by a prior POST. Nothing in this route decides or
// changes how a completed chain counts against the customer's VTO
// allowance — see full-look-tryon-real.server.ts's BILLING comment for what
// the existing, unmodified entitlement system already does with these rows.

import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data } from "react-router";
import { getCurrentNaiaCustomer } from "~/lib/naia-session.server";
import { loadNaiaModel, computeModelReadinessFromRecord } from "~/lib/ai/my-naia-model.server";
import { isVtoCategoryAllowed } from "~/lib/ai/closet-eligibility";
import { resolveClosetAnchor } from "~/lib/ai/styleme-anchor.server";
import { screenGarmentSuitability } from "~/lib/image-suitability.server";
import type { VirtualTryOnConsent } from "~/lib/ai/virtual-try-on.types";
// isAuthorizedStagingTestAccount is the one symbol still imported from the
// mock route file — it has zero dependency on any `.server.ts` module
// (pure process.env checks), so re-exporting/importing it doesn't trigger
// the server/client boundary issue the other 4 symbols did (see
// full-look-work-combination.server.ts's header for that story). Those 4
// come from the shared module instead, never from a route file.
import { isAuthorizedStagingTestAccount } from "./staging.full-look-vto-test";
import {
  resolveExpectedWorkCombination,
  hasQuotaRoomForFullLookChain,
  sortForDisplay,
  MAX_CONSENT_AGE_MS,
} from "~/lib/ai/full-look-work-combination.server";
import {
  startOrResumeFullLookChain,
  advanceFullLookChain,
  isCompatibleModelPhotoFormat,
  type FullLookChainContext,
  type FullLookRealGarmentInput,
} from "~/lib/ai/full-look-tryon-real.server";

function notFound(): never {
  throw new Response("Not Found", { status: 404 });
}

// ── Loader — poll the chain's current state; never submits step 0 ──────────

export async function loader({ request }: LoaderFunctionArgs) {
  const customer = await getCurrentNaiaCustomer(request);
  if (!customer || !isAuthorizedStagingTestAccount(customer)) notFound();

  const outcome = await resolveExpectedWorkCombination(customer.id);
  if (!outcome.ok) {
    return data({ ok: false as const, reason: outcome.reason });
  }

  const naiaModel = await loadNaiaModel(customer.id);
  if (!naiaModel) {
    return data({ ok: true as const, chain: { status: "NOT_STARTED" as const } });
  }

  // ── Re-resolve real, ownership-verified garment URLs fresh on every poll —
  // cheap (a DB read + a signed-URL build, no AI call) and necessary: if this
  // poll discovers the current step just completed, advanceFullLookChain
  // submits the NEXT step inline and needs that step's real productImageUrl,
  // not a placeholder. Suitability screening is deliberately NOT re-run here
  // — it already ran once per garment, for this exact garment set, inside the
  // action that authorised this chain to start at all (see that function's
  // own per-garment loop). Re-running the AI vision screen on every ~3s poll
  // for a garment already approved for this chain would be pure waste, not a
  // safety gain. Ownership IS re-verified every call (resolveClosetAnchor's
  // own `where: { id: closetItemId, customerId }` check), so a garment
  // removed from the customer's Closet mid-chain still fails closed. ────────
  const ordered = sortForDisplay(outcome.garments);
  const garments: FullLookRealGarmentInput[] = [];
  for (const g of ordered) {
    const anchor = await resolveClosetAnchor(customer.id, g.closetItemId);
    if (!anchor || !anchor.imageUrl) {
      return data(
        { ok: false as const, reason: "garment_image_unavailable" },
        { status: 400 },
      );
    }
    garments.push({ label: g.name ?? g.closetItemId, productImageUrl: anchor.imageUrl });
  }

  const ctx: FullLookChainContext = {
    customerId: customer.id,
    naiaModelId: naiaModel.id,
    bodyPublicId: naiaModel.bodyPublicId,
    bodyFormat: naiaModel.bodyFormat,
    deliveryType: naiaModel.deliveryType,
    garments,
    // Loader-driven submissions (advancing to step 1 or 2) only ever happen
    // for a chain the action already started and consent-validated — this
    // object just satisfies submitFullLookRealStep's signature for stamping
    // the new job's virtualTryOnConsentAt; it is never used to authorise a
    // NEW chain (startOrResumeFullLookChain, which does real consent-age
    // validation, is only ever called from the action, never the loader).
    consent: {
      virtualTryOnConsent: true,
      policyVersion: "1.0-staging-real-test",
      consentedAt: new Date().toISOString(),
    },
  };

  const result = await advanceFullLookChain(ctx);
  return data(
    { ok: true as const, chain: result },
    { headers: { "Cache-Control": "no-store" } },
  );
}

// ── Action — the only way step 0 is ever submitted ───────────────────────────

interface ActionStartResult {
  ok: boolean;
  reason?: string;
  stepIndex?: number;
}

export async function action({ request }: ActionFunctionArgs) {
  const customer = await getCurrentNaiaCustomer(request);
  if (!customer || !isAuthorizedStagingTestAccount(customer)) notFound();

  const form = await request.formData();

  if (form.get("consent") !== "yes") {
    return data({ ok: false, reason: "consent_required" } as ActionStartResult, { status: 400 });
  }

  const rawConsentAt = form.get("virtualTryOnConsentAt");
  if (typeof rawConsentAt !== "string" || rawConsentAt.length === 0) {
    return data({ ok: false, reason: "consent_required" } as ActionStartResult, { status: 400 });
  }
  const consentAt = new Date(rawConsentAt);
  if (isNaN(consentAt.getTime())) {
    return data({ ok: false, reason: "consent_required" } as ActionStartResult, { status: 400 });
  }
  const consentAgeMs = Date.now() - consentAt.getTime();
  if (consentAgeMs < 0 || consentAgeMs > MAX_CONSENT_AGE_MS) {
    return data({ ok: false, reason: "consent_expired" } as ActionStartResult, { status: 400 });
  }

  // ── Explicit second confirmation that THIS is a real, billable run — not
  // the same "consent=yes" checkbox the mock route uses, so a human cannot
  // reach a real FASHN submission by reusing a mock-route form payload. ────
  if (form.get("confirmReal") !== "yes-real-fashn-calls") {
    return data({ ok: false, reason: "real_confirmation_required" } as ActionStartResult, { status: 400 });
  }

  const outcome = await resolveExpectedWorkCombination(customer.id);
  if (!outcome.ok) {
    return data({ ok: false, reason: outcome.reason } as ActionStartResult, { status: 400 });
  }

  const naiaModel = await loadNaiaModel(customer.id);
  if (!naiaModel) {
    return data({ ok: false, reason: "model_not_configured" } as ActionStartResult, { status: 400 });
  }
  const readiness = computeModelReadinessFromRecord(naiaModel);
  if (!readiness.hasFullBodyPhoto || !readiness.isReadyForTryOn) {
    return data({ ok: false, reason: "model_not_ready" } as ActionStartResult, { status: 400 });
  }
  if (naiaModel.bodyModerationStatus !== "APPROVED") {
    return data({ ok: false, reason: "model_not_moderated" } as ActionStartResult, { status: 400 });
  }

  // ── Format pre-flight (new for the real run — see full-look-tryon-real
  // .server.ts's isCompatibleModelPhotoFormat doc comment). ────────────────
  if (!isCompatibleModelPhotoFormat(naiaModel.bodyFormat)) {
    return data({ ok: false, reason: "model_photo_format_unsupported" } as ActionStartResult, { status: 400 });
  }

  const ineligible = outcome.garments.find((g) => !isVtoCategoryAllowed(g.category, g.subcategory));
  if (ineligible) {
    return data({ ok: false, reason: "garment_not_eligible" } as ActionStartResult, { status: 400 });
  }

  // ── Same provisional 3-unit quota policy as the mock route, reused
  // unmodified — see hasQuotaRoomForFullLookChain's own doc comment. ───────
  const hasQuotaRoom = await hasQuotaRoomForFullLookChain(customer);
  if (!hasQuotaRoom) {
    return data({ ok: false, reason: "quota_insufficient_for_full_look" } as ActionStartResult, { status: 400 });
  }

  // ── Real, ownership-verified, screened garment images — identical checks
  // to the mock route's action, same fail-closed-on-any-failure contract.
  // sortForDisplay fixes the body-outward step order (trousers → shirt →
  // blazer) — the SAME ordering the loader re-derives on every poll; two
  // independently-sorted copies would risk a different step order between
  // chain start and chain advancement. ─────────────────────────────────────
  const resolvedGarments: FullLookRealGarmentInput[] = [];
  for (const g of sortForDisplay(outcome.garments)) {
    const anchor = await resolveClosetAnchor(customer.id, g.closetItemId);
    if (!anchor || !anchor.imageUrl) {
      return data({ ok: false, reason: "garment_image_unavailable" } as ActionStartResult, { status: 400 });
    }
    const suitability = await screenGarmentSuitability(anchor.imageUrl, { declaredCategory: g.category });
    if (suitability.status !== "PASS") {
      return data({ ok: false, reason: "garment_not_suitable" } as ActionStartResult, { status: 400 });
    }
    resolvedGarments.push({ label: g.name ?? g.closetItemId, productImageUrl: anchor.imageUrl });
  }

  const consent: VirtualTryOnConsent = {
    virtualTryOnConsent: true,
    policyVersion: "1.0-staging-real-test",
    consentedAt: consentAt.toISOString(),
  };

  const ctx: FullLookChainContext = {
    customerId: customer.id,
    naiaModelId: naiaModel.id,
    bodyPublicId: naiaModel.bodyPublicId,
    bodyFormat: naiaModel.bodyFormat,
    deliveryType: naiaModel.deliveryType,
    garments: resolvedGarments,
    consent,
  };

  const result = await startOrResumeFullLookChain(ctx);
  if (!result.ok) {
    return data({ ok: false, reason: result.reason } as ActionStartResult, { status: 400 });
  }
  return data({ ok: true, stepIndex: result.stepIndex } as ActionStartResult);
}
