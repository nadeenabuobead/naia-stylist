// app/routes/staging.full-look-vto-real.tsx
//
// STAGING-ONLY, REAL FASHN test harness for sequential full-look VTO.
//
// REGISTERED in app/routes.ts (2026-11-03) at staging/full-look-vto-real,
// right below the mock harness this route reuses the gate, Work-combination
// resolution, and quota policy from, unmodified. Registration itself grants
// no access — isAuthorizedStagingTestAccount (NAIA_PROJECT_VARIANT==="staging"
// + FULL_LOOK_VTO_TEST_CUSTOMER_IDS) is the real, unchanged enforcement, same
// as the mock route, re-checked independently in both loader and action.
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
import { data, Form, useActionData, useLoaderData, useRevalidator } from "react-router";
import { useEffect, useState } from "react";
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
  FINAL_STEP_VISUAL_PROMPT,
  FINAL_STEP_GENERATION_MODE,
} from "~/lib/ai/full-look-work-combination.server";
import {
  startOrResumeFullLookChain,
  advanceFullLookChain,
  continueToFinalStep,
  isCompatibleModelPhotoFormat,
  type FullLookChainContext,
  type FullLookRealGarmentInput,
} from "~/lib/ai/full-look-tryon-real.server";

function notFound(): never {
  throw new Response("Not Found", { status: 404 });
}

// ── Second-(and-later)-test reservation scope ───────────────────────────────
//
// Server-side only — NEVER read from request input. Omitted (undefined) by
// default, which keeps step 0's idempotency key exactly as it was: one
// permanent reservation per customer, forever. Setting this env var is a
// deliberate, separate, operator-only action (not a UI control a tester can
// toggle) that opens exactly one NEW, independent 3-call chain for the same
// customer — the first test's rows are never touched, deleted, or reused;
// they remain reachable forever under the unscoped key. See
// FullLookChainContext.reservationScope's own doc comment in
// full-look-tryon-real.server.ts for the full safety story.
function getReservationScope(): string | undefined {
  const scope = process.env.FULL_LOOK_VTO_REAL_TEST_SCOPE;
  return scope && scope.trim().length > 0 ? scope.trim() : undefined;
}

// ── Resilience wrapper (2026-11-04) ─────────────────────────────────────────
//
// Root cause of the "Something went wrong" generic error screen a tester hit
// on this route: a transient Prisma Postgres connectivity outage (confirmed
// via Vercel runtime logs — PrismaClientInitializationError, "Can't reach
// database server at pooled.db.prisma.io:5432", thrown from
// resolveNaiaSession during getCurrentNaiaCustomer, which crashed the whole
// loader with an unhandled exception). This was NOT specific to this route
// or to the diagnostic feature — the SAME error, at the SAME time, also hit
// the pre-existing, unrelated api.staging-full-look-vto-sweep endpoint
// (confirmed via the same logs), and the outage had already resolved itself
// within about a minute (confirmed via a live retry). No garment-suitability
// rule, auth check, or diagnostic logic was at fault.
//
// This wrapper doesn't (and can't) fix a database outage — it only changes
// what a tester sees WHEN one happens again: an unexpected exception
// (anything that reaches here is NOT one of the intentional typed
// `data(...)` responses above, nor the intentional notFound() 404, which is
// re-thrown unchanged) now resolves to a clearly-labeled, retryable
// "temporarily_unavailable" state instead of crashing into the framework's
// generic error boundary. Logged via console.error so it's still visible in
// Vercel's runtime logs for investigation.
function isIntentionalResponse(err: unknown): err is Response {
  return err instanceof Response;
}

// ── Loader — poll the chain's current state; never submits step 0 ──────────

async function loaderImpl({ request }: LoaderFunctionArgs) {
  const customer = await getCurrentNaiaCustomer(request);
  if (!customer || !isAuthorizedStagingTestAccount(customer)) notFound();

  const outcome = await resolveExpectedWorkCombination(customer.id);
  if (!outcome.ok) {
    return data({ ok: false as const, reason: outcome.reason });
  }

  const naiaModel = await loadNaiaModel(customer.id);
  if (!naiaModel) {
    return data({ ok: true as const, modelReady: false, chain: { status: "NOT_STARTED" as const } });
  }
  const modelReady = computeModelReadinessFromRecord(naiaModel).isReadyForTryOn;

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
    finalStepPrompt: FINAL_STEP_VISUAL_PROMPT,
    finalStepGenerationMode: FINAL_STEP_GENERATION_MODE,
    reservationScope: getReservationScope(),
  };

  const result = await advanceFullLookChain(ctx);
  return data(
    { ok: true as const, modelReady, chain: result },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function loader(args: LoaderFunctionArgs) {
  try {
    return await loaderImpl(args);
  } catch (err) {
    if (isIntentionalResponse(err)) throw err; // preserve the notFound() 404 gate
    console.error("staging.full-look-vto-real loader failed unexpectedly", err);
    return data(
      { ok: false as const, reason: "temporarily_unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}

// ── Action — the only way step 0 is ever submitted ───────────────────────────

interface ActionStartResult {
  ok: boolean;
  reason?: string;
  stepIndex?: number;
  // Diagnostic only — set ONLY alongside reason: "garment_not_suitable", to
  // surface exactly which of the 3 garments failed and why, since the
  // suitability loop below stops at the first failure and the bare `reason`
  // string alone cannot distinguish trousers/shirt/blazer. Never influences
  // the pass/fail decision itself — purely visibility into a decision
  // already made by screenGarmentSuitability.
  garmentDetail?: { name: string; category: string; subCode: string };
  // Diagnostic-only fields — set ONLY when intent === "diagnose". This path
  // NEVER touches naiaModel/consent/quota/startOrResumeFullLookChain and
  // therefore can never start a chain, create a reservation, call FASHN, or
  // consume VTO allowance — see the "diagnose" branch below for why that's
  // true by construction, not just by convention.
  diagnostic?: boolean;
  garmentResults?: Array<{ name: string; category: string; status: string; subCode?: string }>;
}

async function actionImpl({ request }: ActionFunctionArgs) {
  const customer = await getCurrentNaiaCustomer(request);
  if (!customer || !isAuthorizedStagingTestAccount(customer)) notFound();

  const form = await request.formData();
  // "continue" is the ONLY way the final (blazer) step is ever submitted —
  // see continueToFinalStep's own doc comment. "diagnose" is a dead end that
  // returns before any of the other branches. Any other/missing value
  // (including a malformed or replayed form) falls back to "start", which
  // is itself idempotent-safe (startOrResumeFullLookChain never resubmits
  // an already-started chain).
  const rawIntent = form.get("intent");
  const intent = rawIntent === "continue" ? "continue" : rawIntent === "diagnose" ? "diagnose" : "start";

  // ── Diagnostic-only: reports per-garment suitability for all 3 garments
  // without stopping at the first failure, so a tester can see every
  // result in one pass instead of retrying "Start" and risking the
  // non-deterministic AI check unexpectedly PASSing on a retry and
  // beginning a real, billable chain. Deliberately placed BEFORE every
  // consent/confirmReal/quota/model check below — this branch returns
  // unconditionally and can never fall through into the real-submission
  // code path. Calls the exact same screenGarmentSuitability used by the
  // real "start" path (so results match what "Start" would see) but never
  // calls loadNaiaModel, hasQuotaRoomForFullLookChain, or
  // startOrResumeFullLookChain — no reservation, no FASHN call, no VTO
  // allowance touched. ──────────────────────────────────────────────────
  if (intent === "diagnose") {
    const outcome = await resolveExpectedWorkCombination(customer.id);
    if (!outcome.ok) {
      return data({ ok: false, diagnostic: true, reason: outcome.reason } as ActionStartResult, { status: 400 });
    }

    const garmentResults: Array<{ name: string; category: string; status: string; subCode?: string }> = [];
    for (const g of sortForDisplay(outcome.garments)) {
      const anchor = await resolveClosetAnchor(customer.id, g.closetItemId);
      if (!anchor || !anchor.imageUrl) {
        garmentResults.push({ name: g.name ?? g.closetItemId, category: g.category, status: "IMAGE_UNAVAILABLE" });
        continue;
      }
      const suitability = await screenGarmentSuitability(anchor.imageUrl, { declaredCategory: g.category });
      garmentResults.push({
        name: g.name ?? g.closetItemId,
        category: g.category,
        status: suitability.status,
        subCode: suitability.status === "PASS" ? undefined : suitability.subCode,
      });
    }

    return data(
      { ok: true, diagnostic: true, garmentResults } as ActionStartResult,
      { headers: { "Cache-Control": "no-store" } },
    );
  }

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

  // ── "continue" — the QA pause checkpoint's only exit. Eligibility, the
  // quota pre-check, and suitability screening all already ran (and
  // passed) for these exact 3 garments when the chain started; re-running
  // the AI suitability screen here would be pure waste, not a safety gain
  // — only ownership is re-verified (resolveClosetAnchor's own check),
  // matching the loader's own convention. Consent/confirmReal above are
  // re-validated with a FRESH timestamp (committing to the most expensive,
  // quality-mode step deserves its own explicit, recent confirmation). ────
  if (intent === "continue") {
    const continueGarments: FullLookRealGarmentInput[] = [];
    for (const g of sortForDisplay(outcome.garments)) {
      const anchor = await resolveClosetAnchor(customer.id, g.closetItemId);
      if (!anchor || !anchor.imageUrl) {
        return data({ ok: false, reason: "garment_image_unavailable" } as ActionStartResult, { status: 400 });
      }
      continueGarments.push({ label: g.name ?? g.closetItemId, productImageUrl: anchor.imageUrl });
    }

    const continueCtx: FullLookChainContext = {
      customerId: customer.id,
      naiaModelId: naiaModel.id,
      bodyPublicId: naiaModel.bodyPublicId,
      bodyFormat: naiaModel.bodyFormat,
      deliveryType: naiaModel.deliveryType,
      garments: continueGarments,
      consent: { virtualTryOnConsent: true, policyVersion: "1.0-staging-real-test", consentedAt: consentAt.toISOString() },
      finalStepPrompt: FINAL_STEP_VISUAL_PROMPT,
      finalStepGenerationMode: FINAL_STEP_GENERATION_MODE,
      reservationScope: getReservationScope(),
    };

    const continueResult = await continueToFinalStep(continueCtx);
    if (!continueResult.ok) {
      return data({ ok: false, reason: continueResult.reason } as ActionStartResult, { status: 400 });
    }
    return data({ ok: true } as ActionStartResult);
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
      return data(
        {
          ok: false,
          reason: "garment_not_suitable",
          garmentDetail: { name: g.name ?? g.closetItemId, category: g.category, subCode: suitability.subCode },
        } as ActionStartResult,
        { status: 400 },
      );
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
    finalStepPrompt: FINAL_STEP_VISUAL_PROMPT,
    finalStepGenerationMode: FINAL_STEP_GENERATION_MODE,
    reservationScope: getReservationScope(),
  };

  const result = await startOrResumeFullLookChain(ctx);
  if (!result.ok) {
    return data({ ok: false, reason: result.reason } as ActionStartResult, { status: 400 });
  }
  return data({ ok: true, stepIndex: result.stepIndex } as ActionStartResult);
}

export async function action(args: ActionFunctionArgs) {
  try {
    return await actionImpl(args);
  } catch (err) {
    if (isIntentionalResponse(err)) throw err; // preserve the notFound() 404 gate
    console.error("staging.full-look-vto-real action failed unexpectedly", err);
    return data(
      { ok: false, reason: "temporarily_unavailable" } as ActionStartResult,
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}

// ── Page ──────────────────────────────────────────────────────────────────────
//
// Refresh-safety: this component holds NO client-side chain state of its own.
// Every render reflects loaderData.chain, which the loader rebuilds fresh from
// VirtualTryOnJob rows on every request — a browser refresh just re-runs the
// loader and shows exactly the same state. The only client behaviour here is
// polling: while the chain is PROCESSING, useRevalidator() re-runs the SAME
// loader every 3s (same interval and mechanism api.tryon-status.$jobId.tsx's
// client hook already uses for one garment) so progress advances without a
// manual reload. Closing the tab and coming back later re-derives the exact
// same state from the same DB rows — nothing is lost.

export default function StagingFullLookVtoReal() {
  const loaderData = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const revalidator = useRevalidator();
  const [confirmArmed, setConfirmArmed] = useState(false);
  const [continueConfirmArmed, setContinueConfirmArmed] = useState(false);

  const chain = loaderData.ok ? loaderData.chain : null;
  // Polling stops on its own once AWAITING_CONTINUE is reached — nothing
  // will change until the tester explicitly submits the Continue form, so
  // there is nothing to gain from keeping the interval running.
  const isProcessing = chain?.status === "PROCESSING";

  useEffect(() => {
    if (!isProcessing) return;
    const id = setInterval(() => {
      if (revalidator.state === "idle") revalidator.revalidate();
    }, 3000);
    return () => clearInterval(id);
  }, [isProcessing, revalidator]);

  if (!loaderData.ok) {
    if (loaderData.reason === "temporarily_unavailable") {
      return <p>Temporarily unavailable (transient error) — please reload and try again.</p>;
    }
    return <p>Could not find the expected Work combination: {loaderData.reason}</p>;
  }

  return (
    <div>
      <p style={{ fontWeight: "bold", color: "darkred" }}>
        REAL TEST — this submits real garment photos to the real FASHN API and
        spends real provider credits. Capped at 3 submissions, ever, for this
        account.
      </p>
      <h1>Full-Look VTO real test — Work</h1>
      <p>nAia Model ready: {loaderData.modelReady ? "yes" : "no"}</p>

      {(!chain || chain.status === "NOT_STARTED") && (
        <div style={{ border: "1px solid #999", padding: 12, marginBottom: 16 }}>
          <p style={{ fontWeight: "bold" }}>
            Diagnostic only — checks all 3 garments, never starts generation
          </p>
          <p>
            Does NOT submit to FASHN, does NOT create a reservation, does NOT
            consume VTO allowance. Safe to run as many times as you like.
          </p>
          <Form method="post">
            <input type="hidden" name="intent" value="diagnose" />
            <button type="submit">Check garment suitability (diagnostic only)</button>
          </Form>

          {actionData && actionData.diagnostic && !actionData.ok && (
            <p>Could not run diagnostic: {actionData.reason}</p>
          )}

          {actionData && actionData.diagnostic && actionData.ok && actionData.garmentResults && (
            <table style={{ marginTop: 12, borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={{ border: "1px solid #ccc", padding: "4px 8px", textAlign: "left" }}>Garment</th>
                  <th style={{ border: "1px solid #ccc", padding: "4px 8px", textAlign: "left" }}>Category</th>
                  <th style={{ border: "1px solid #ccc", padding: "4px 8px", textAlign: "left" }}>Result</th>
                  <th style={{ border: "1px solid #ccc", padding: "4px 8px", textAlign: "left" }}>Sub-code</th>
                </tr>
              </thead>
              <tbody>
                {actionData.garmentResults.map((g) => (
                  <tr key={g.name}>
                    <td style={{ border: "1px solid #ccc", padding: "4px 8px" }}>{g.name}</td>
                    <td style={{ border: "1px solid #ccc", padding: "4px 8px" }}>{g.category}</td>
                    <td
                      style={{
                        border: "1px solid #ccc",
                        padding: "4px 8px",
                        fontWeight: "bold",
                        color: g.status === "PASS" ? "green" : "darkred",
                      }}
                    >
                      {g.status}
                    </td>
                    <td style={{ border: "1px solid #ccc", padding: "4px 8px" }}>{g.subCode ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {(!chain || chain.status === "NOT_STARTED") && (
        <Form
          method="post"
          onSubmit={(e) => {
            const input = e.currentTarget.elements.namedItem("virtualTryOnConsentAt") as HTMLInputElement | null;
            if (input) input.value = new Date().toISOString();
          }}
        >
          <input type="hidden" name="intent" value="start" />
          <input type="hidden" name="virtualTryOnConsentAt" value="" />
          <label>
            <input type="checkbox" name="consent" value="yes" required /> I consent to this one staging test.
          </label>
          <br />
          <label>
            <input
              type="checkbox"
              name="confirmReal"
              value="yes-real-fashn-calls"
              required
              onChange={(e) => setConfirmArmed(e.currentTarget.checked)}
            />{" "}
            I understand this makes up to 3 REAL, billable FASHN calls using a real customer photo.
          </label>
          <br />
          <button type="submit" disabled={!confirmArmed}>
            Start real full-look generation
          </button>
        </Form>
      )}

      {actionData && !actionData.ok && !actionData.diagnostic && (
        <p>
          Could not continue: {actionData.reason}
          {actionData.garmentDetail && (
            <>
              {" "}— {actionData.garmentDetail.name} ({actionData.garmentDetail.category}):{" "}
              {actionData.garmentDetail.subCode}
            </>
          )}
        </p>
      )}

      {chain && chain.status === "PROCESSING" && (
        <p>Step {chain.stepIndex + 1} of 3 in progress — checking again in a few seconds…</p>
      )}

      {chain && chain.status === "AWAITING_CONTINUE" && (
        <div>
          <p style={{ fontWeight: "bold" }}>
            Paused before the blazer step — review the trousers and shirt results below.
          </p>
          <p>
            These images are shown via short-lived, ownership-protected signed links and will be
            deleted automatically once the chain finishes (success or failure) — they are not kept
            indefinitely and are never publicly reachable.
          </p>
          <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
            {chain.intermediates.map((step) => (
              <div key={step.stepIndex}>
                <p>Step {step.stepIndex + 1}: {step.label}</p>
                <img src={step.url} alt={`Intermediate result after step ${step.stepIndex + 1}`} width={300} />
              </div>
            ))}
          </div>

          <Form
            method="post"
            onSubmit={(e) => {
              const input = e.currentTarget.elements.namedItem("virtualTryOnConsentAt") as HTMLInputElement | null;
              if (input) input.value = new Date().toISOString();
            }}
          >
            <input type="hidden" name="intent" value="continue" />
            <input type="hidden" name="virtualTryOnConsentAt" value="" />
            <label>
              <input type="checkbox" name="consent" value="yes" required /> I have reviewed the shirt
              result above and consent to continuing.
            </label>
            <br />
            <label>
              <input
                type="checkbox"
                name="confirmReal"
                value="yes-real-fashn-calls"
                required
                onChange={(e) => setContinueConfirmArmed(e.currentTarget.checked)}
              />{" "}
              I understand this submits the final, Quality-mode, real FASHN call for the blazer.
            </label>
            <br />
            <button type="submit" disabled={!continueConfirmArmed}>
              Continue to blazer
            </button>
          </Form>
        </div>
      )}

      {chain && chain.status === "FAILED" && (
        <p>
          Step {chain.failedStepIndex + 1} failed ({chain.errorCode ?? "unknown error"}). Not retried
          automatically — a new attempt requires manual review.
        </p>
      )}

      {chain && chain.status === "EXPIRED" && (
        <p>
          This paused review window expired before Continue was submitted. The trousers and shirt
          preview images have been deleted. The blazer step was never submitted — no credits were
          spent on it. A new attempt requires manual review.
        </p>
      )}

      {chain && chain.status === "COMPLETED" && (
        <div>
          <p>Complete. Result is stored privately and shown below via a short-lived signed link.</p>
          <img src={chain.resultUrl} alt="Full-look real result" />
        </div>
      )}
    </div>
  );
}
