// app/routes/api.full-look-vto.tsx
//
// Real, persisted Full-Look VTO — the customer-facing replacement for
// api.staging-full-look-vto.tsx's ephemeral prototype (that route is
// untouched and still exists for direct comparison/rollback; it is no
// longer called by style-me/result.tsx once this route is wired in).
//
// GET  /api/full-look-vto?suggestionId=X  — status / resume (no charge, no re-generation)
// POST /api/full-look-vto                 — start a new outfit, retry a failed one, or
//                                            (2026-11-16) explicitly recover one whose
//                                            FASHN prediction completed but whose own
//                                            Cloudinary upload failed ({recover: true})
//
// Security contract (mirrors api.trigger-tryon.tsx exactly):
//   - Customer identity from the authenticated session only, never the body.
//   - outfitSuggestionId ownership is verified against the session's own
//     customerId before anything else runs — a client can never operate on
//     another customer's suggestion.
//   - Garment image URLs are resolved server-side only (selectFullLookGarments
//     + resolveItemImage); the client never supplies an image URL.
//   - Per-generation consent required, same 15-minute freshness window as
//     the single-item flow — recover is NOT exempt from this.
//   - Entitlement is checked before starting a NEW outfit (never before
//     resuming/polling an existing one) — "1 credit per completed outfit"
//     is enforced by entitlement.server.ts's own exclusion of intermediate
//     steps; this pre-check just avoids spending a FASHN call at all once
//     over quota, same as the single-item route. recover never reaches
//     this check either — it can never submit a new FASHN prediction, so
//     there is no new FASHN spend to gate.
//   - recover is POST-only, same as start/retry. The GET loader above
//     never calls recoverFullLookStep or anything that could reach it —
//     it only ever calls pollFullLookOutfit, which itself can never
//     submit a new step (allowSubmitNext: false, see that module). There
//     is no code path by which loading or refreshing a page can trigger
//     a recovery, exactly as there is none by which it can submit a new
//     garment.
//   - recover never accepts a jobId from the client — the step to
//     recover is always resolved server-side from the session's own
//     current scope (recoverFullLookStep), the same way every other
//     entry point here resolves what to act on.

import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data } from "react-router";
import { getCurrentNaiaCustomer } from "~/lib/naia-session.server";
import prisma from "~/db.server";
import { loadNaiaModel, computeModelReadinessFromRecord } from "~/lib/ai/my-naia-model.server";
import { checkEntitlement } from "~/lib/plan/entitlement.server";
import { getCloudinaryConfig } from "~/lib/cloudinary-admin.server";
import { gateFullLookClosetGarments } from "~/lib/ai/full-look-closet-gate.server";
import {
  selectFullLookGarments,
  startFullLookOutfit,
  pollFullLookOutfit,
  recoverFullLookStep,
  findCompletedFullLookForSuggestion,
  type SelectableOutfitItem,
} from "~/lib/ai/full-look-vto-orchestrator.server";

const MAX_CONSENT_AGE_MS = 15 * 60 * 1000;

function authRequired() {
  return data({ ok: false, code: "auth_required" }, { status: 401 });
}
function badRequest(code: string, message: string) {
  return data({ ok: false, code, message }, { status: 400 });
}
function notFound() {
  return data({ ok: false, code: "not_found", message: "Outfit not found." }, { status: 404 });
}
function tooMany(message: string) {
  return data({ ok: false, code: "quota_exceeded", message }, { status: 429 });
}
function serverError(message: string) {
  return data({ ok: false, code: "server_error", message }, { status: 500 });
}
// Another generation is already in flight for this customer, or the short
// post-completion cooldown hasn't elapsed yet (checkCustomerCooldown's two
// rejection reasons, surfaced by startFullLookOutfit as OrchestratorStatus
// "BUSY") — an expected, temporary business condition, not a server
// failure. 409 Conflict: the request is well-formed, but can't be actioned
// against the customer's current state right now.
function busy(reason: string) {
  return data(
    { ok: false, code: "busy", message: "Still finishing a previous try-on — please wait a moment and try again.", reason },
    { status: 409 },
  );
}

// Loads the suggestion scoped to the authenticated customer in one query —
// a client-supplied id that belongs to another customer, or doesn't exist,
// is indistinguishable from "not found" (same not-found-not-403 convention
// this codebase uses elsewhere for ownership checks).
async function loadOwnedSuggestion(customerId: string, suggestionId: string) {
  const suggestion = await prisma.outfitSuggestion.findUnique({
    where: { id: suggestionId },
    include: {
      session: { select: { customerId: true } },
      items: {
        include: {
          closetItem: { select: { name: true, imageUrl: true, imagePublicId: true, imageFormat: true, category: true, subcategory: true, tryOnEligibility: true } },
        },
      },
    },
  });
  if (!suggestion || suggestion.session.customerId !== customerId) return null;
  return suggestion;
}

export async function loader({ request }: LoaderFunctionArgs) {
  const customer = await getCurrentNaiaCustomer(request);
  if (!customer) return authRequired();

  const url = new URL(request.url);
  const suggestionId = url.searchParams.get("suggestionId");
  if (!suggestionId) return badRequest("invalid_request", "suggestionId is required.");

  const suggestion = await loadOwnedSuggestion(customer.id, suggestionId);
  if (!suggestion) return notFound();

  // 2026-11-15 REGRESSION FIX — garments are NOT "only read by start/submit".
  // advanceFullLookChain auto-advances to the next step the instant the
  // current one completes (per the founder's "progress through all garment
  // steps automatically" decision), and that auto-advance calls
  // submitFullLookRealStep(ctx, nextIndex, ...), which reads
  // ctx.garments[nextIndex] to build the FASHN submission. A poll is exactly
  // when that auto-advance fires — passing [] here crashed every single
  // poll once the first step completed (TypeError: Cannot read properties
  // of undefined (reading 'label')), which made every real Full-Look
  // attempt appear to hang forever. Re-derive the same real garments the
  // POST action used to start this chain, the same way. Computed BEFORE the
  // completed-result short-circuit below so omittedLabels (requirement:
  // disclose any recommended piece that didn't make the cut, on resume AND
  // on revisit — never only on the initial start) is always available.
  const cloudinaryConfig = getCloudinaryConfig();
  const selection = selectFullLookGarments(
    suggestion.items as unknown as SelectableOutfitItem[],
    { customerId: customer.id, cloudinaryConfig },
  );
  if (!selection) {
    return serverError("This look's try-on–eligible pieces could not be resolved while resuming.");
  }
  const { garments, omittedLabels, fingerprint } = selection;

  // Never regenerate on revisit — check for an already-completed result
  // before touching the chain at all.
  const existing = await findCompletedFullLookForSuggestion(customer.id, suggestionId);
  if (existing) {
    return data(
      { ok: true, status: "COMPLETED", resultUrl: existing.resultUrl, omittedLabels },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  const naiaModel = await loadNaiaModel(customer.id);
  if (!naiaModel) return data({ ok: true, status: "NOT_STARTED" }, { headers: { "Cache-Control": "no-store" } });

  const result = await pollFullLookOutfit(
    {
      customerId: customer.id,
      naiaModelId: naiaModel.id,
      bodyPublicId: naiaModel.bodyPublicId,
      bodyFormat: naiaModel.bodyFormat,
      deliveryType: naiaModel.deliveryType,
      garments,
      consent: { virtualTryOnConsent: true, policyVersion: "1.0", consentedAt: new Date().toISOString() },
      outfitSuggestionId: suggestionId,
    },
    fingerprint,
  );

  return data({ ok: true, ...result, omittedLabels }, { headers: { "Cache-Control": "no-store" } });
}

export async function action({ request }: ActionFunctionArgs) {
  const customer = await getCurrentNaiaCustomer(request);
  if (!customer) return authRequired();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return badRequest("invalid_request", "Request body must be JSON.");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return badRequest("invalid_request", "Request body must be a JSON object.");
  }
  const { outfitSuggestionId, virtualTryOnConsentAt, retry, recover } = body as Record<string, unknown>;

  if (typeof outfitSuggestionId !== "string" || !outfitSuggestionId.trim()) {
    return badRequest("invalid_request", "outfitSuggestionId is required.");
  }
  if (typeof virtualTryOnConsentAt !== "string" || !virtualTryOnConsentAt) {
    return badRequest("consent_required", "Per-generation virtual try-on consent is required.");
  }
  const consentAt = new Date(virtualTryOnConsentAt);
  if (isNaN(consentAt.getTime())) {
    return badRequest("consent_required", "Invalid consent timestamp.");
  }
  const consentAgeMs = Date.now() - consentAt.getTime();
  if (consentAgeMs < 0 || consentAgeMs > MAX_CONSENT_AGE_MS) {
    return badRequest("consent_expired", "Virtual try-on consent has expired. Please try again.");
  }

  const suggestion = await loadOwnedSuggestion(customer.id, outfitSuggestionId);
  if (!suggestion) return notFound();

  // Computed before the completed-result short-circuit — see the GET
  // loader's identical comment for why.
  const cloudinaryConfig = getCloudinaryConfig();
  const selection = selectFullLookGarments(
    suggestion.items as unknown as SelectableOutfitItem[],
    { customerId: customer.id, cloudinaryConfig },
  );
  if (!selection) {
    return badRequest("not_eligible", "This look doesn't have enough try-on–eligible pieces for a full-look preview.");
  }
  const { garments, omittedLabels, fingerprint } = selection;
  const chosenItems = selection.chosenItems;

  // A retry is only meaningful after the current attempt actually failed —
  // never a way to bypass "never regenerate" for a result that's already
  // done or still running.
  const existing = await findCompletedFullLookForSuggestion(customer.id, outfitSuggestionId);
  if (existing) {
    return data({ ok: true, status: "COMPLETED", resultUrl: existing.resultUrl, omittedLabels });
  }

  // 2026-11-16 — "recover": the ONLY explicit, consent-gated trigger for
  // recoverFailedUploadStep. POST only (this entire action is POST-only by
  // construction — there is no GET equivalent of this branch, and the GET
  // loader above never calls anything in this file past pollFullLookOutfit,
  // which itself can never submit a new step either). Same ownership
  // (loadOwnedSuggestion, above) and consent-freshness check (top of this
  // action, shared with every other submission intent) as every other mutating path here —
  // recovery gets no special exemption from either. The client never
  // supplies a jobId: recoverFullLookStep resolves the exact step to
  // recover itself, from the session's own current scope, the same way
  // pollFullLookOutfit resolves what to report.
  if (recover === true) {
    // Recovery never downloads a new model photo or needs readiness —
    // it only reuses a prediction that already completed. naiaModel is
    // still loaded for its id (record-keeping on the new row only; see
    // recoverFailedUploadStep's own comment on why this is never used
    // functionally), not gated behind computeModelReadinessFromRecord.
    const naiaModelForRecovery = await loadNaiaModel(customer.id);
    const outcome = await recoverFullLookStep(
      {
        customerId: customer.id,
        naiaModelId: naiaModelForRecovery?.id ?? null,
        bodyPublicId: naiaModelForRecovery?.bodyPublicId ?? null,
        bodyFormat: naiaModelForRecovery?.bodyFormat ?? null,
        deliveryType: naiaModelForRecovery?.deliveryType ?? "private",
        garments,
        consent: { virtualTryOnConsent: true, policyVersion: "1.0", consentedAt: consentAt.toISOString() },
        outfitSuggestionId,
      },
      fingerprint,
    );
    if (outcome.status === "NOT_RECOVERABLE") {
      return badRequest("not_recoverable", outcome.reason);
    }
    if (outcome.status === "ERROR") {
      return data({ ok: false, code: "recovery_failed", reason: outcome.reason }, { status: 400 });
    }
    return data({ ok: true, recovered: true, alreadyRecovered: outcome.alreadyRecovered });
  }

  const naiaModel = await loadNaiaModel(customer.id);
  if (!naiaModel) return badRequest("model_not_configured", "Set up your My nAia Model first.");
  const readiness = computeModelReadinessFromRecord(naiaModel);
  if (!readiness.hasFullBodyPhoto || !readiness.isReadyForTryOn) {
    return badRequest("model_not_ready", "Confirm My nAia Model consent and add a full-body photo to use virtual try-on.");
  }

  // Entitlement is checked only when actually starting a new outfit (not
  // on every poll) — "1 credit per outfit" is enforced by the exclusion in
  // entitlement.server.ts; this just avoids spending a FASHN call once the
  // customer is already over quota.
  const entCheck = await checkEntitlement(customer.id, customer.membershipStatus, "vto");
  if (!entCheck.allowed) {
    return tooMany("You've used all your Virtual Try-On sessions for this month.");
  }

  const result = await startFullLookOutfit(
    {
      customerId: customer.id,
      naiaModelId: naiaModel.id,
      bodyPublicId: naiaModel.bodyPublicId,
      bodyFormat: naiaModel.bodyFormat,
      deliveryType: naiaModel.deliveryType,
      garments,
      consent: { virtualTryOnConsent: true, policyVersion: "1.0", consentedAt: consentAt.toISOString() },
      outfitSuggestionId,
    },
    fingerprint,
    { forceNewAttempt: retry === true },
    // 2026-11-21 — pre-FASHN closet eligibility gate; the orchestrator awaits
    // it only when a NEW attempt would spend credits (see
    // full-look-closet-gate.server.ts). A refusal means zero FASHN calls.
    async () => {
      const gate = await gateFullLookClosetGarments({ customerId: customer.id, chosenItems, cloudinaryConfig });
      return gate.ok ? null : { reason: gate.reason, label: gate.label };
    },
  );

  if (result.status === "NOT_ELIGIBLE" && result.reason === "screening_unavailable") {
    // Transient: the piece check could not complete. Nothing was reserved or
    // submitted; safe for the customer to try again.
    return data(
      { ok: false, code: "screening_unavailable", message: "We couldn't check your pieces just now — please try again in a moment." },
      { status: 503 },
    );
  }
  if (result.status === "NOT_ELIGIBLE") {
    return data(
      {
        ok: false,
        code: "not_eligible",
        reason: result.reason,
        label: result.label,
        message: "One of the pieces in this look isn't suitable for a virtual try-on. Try a clearer photo of that piece on its own.",
      },
      { status: 400 },
    );
  }
  if (result.status === "BUSY") return busy(result.reason);
  if (result.status === "ERROR") return serverError(result.reason);
  return data({ ok: true, ...result, omittedLabels });
}
