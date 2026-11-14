// app/routes/api.full-look-vto.tsx
//
// Real, persisted Full-Look VTO — the customer-facing replacement for
// api.staging-full-look-vto.tsx's ephemeral prototype (that route is
// untouched and still exists for direct comparison/rollback; it is no
// longer called by style-me/result.tsx once this route is wired in).
//
// GET  /api/full-look-vto?suggestionId=X  — status / resume (no charge, no re-generation)
// POST /api/full-look-vto                 — start a new outfit, or retry a failed one
//
// Security contract (mirrors api.trigger-tryon.tsx exactly):
//   - Customer identity from the authenticated session only, never the body.
//   - outfitSuggestionId ownership is verified against the session's own
//     customerId before anything else runs — a client can never operate on
//     another customer's suggestion.
//   - Garment image URLs are resolved server-side only (selectFullLookGarments
//     + resolveItemImage); the client never supplies an image URL.
//   - Per-generation consent required, same 15-minute freshness window as
//     the single-item flow.
//   - Entitlement is checked before starting a NEW outfit (never before
//     resuming/polling an existing one) — "1 credit per completed outfit"
//     is enforced by entitlement.server.ts's own exclusion of intermediate
//     steps; this pre-check just avoids spending a FASHN call at all once
//     over quota, same as the single-item route.

import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data } from "react-router";
import { getCurrentNaiaCustomer } from "~/lib/naia-session.server";
import prisma from "~/db.server";
import { loadNaiaModel, computeModelReadinessFromRecord } from "~/lib/ai/my-naia-model.server";
import { checkEntitlement } from "~/lib/plan/entitlement.server";
import { getCloudinaryConfig } from "~/lib/cloudinary-admin.server";
import {
  selectFullLookGarments,
  startFullLookOutfit,
  pollFullLookOutfit,
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
          closetItem: { select: { name: true, imageUrl: true, imagePublicId: true, imageFormat: true, category: true } },
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
  const { garments, omittedLabels } = selection;

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

  const result = await pollFullLookOutfit({
    customerId: customer.id,
    naiaModelId: naiaModel.id,
    bodyPublicId: naiaModel.bodyPublicId,
    bodyFormat: naiaModel.bodyFormat,
    deliveryType: naiaModel.deliveryType,
    garments,
    consent: { virtualTryOnConsent: true, policyVersion: "1.0", consentedAt: new Date().toISOString() },
    outfitSuggestionId: suggestionId,
  });

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
  const { outfitSuggestionId, virtualTryOnConsentAt, retry } = body as Record<string, unknown>;

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
  const { garments, omittedLabels } = selection;

  // A retry is only meaningful after the current attempt actually failed —
  // never a way to bypass "never regenerate" for a result that's already
  // done or still running.
  const existing = await findCompletedFullLookForSuggestion(customer.id, outfitSuggestionId);
  if (existing) {
    return data({ ok: true, status: "COMPLETED", resultUrl: existing.resultUrl, omittedLabels });
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
    { forceNewAttempt: retry === true },
  );

  if (result.status === "ERROR") return serverError(result.reason);
  return data({ ok: true, ...result, omittedLabels });
}
