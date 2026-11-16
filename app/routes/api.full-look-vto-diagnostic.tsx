// app/routes/api.full-look-vto-diagnostic.tsx
//
// TEMPORARY, STRICTLY READ-ONLY diagnostic (2026-11-15). Built to answer one
// question without risking a single additional FASHN call: exactly what
// happened to a specific customer's Full-Look VTO attempt on a specific
// outfit suggestion — every job row that exists for it, each one's status,
// timestamps, and (for a still-PROCESSING row only) a live, read-only FASHN
// status check against the existing prediction.
//
// WHY A NEW ROUTE, NOT THE EXISTING ONE: api.full-look-vto.tsx's GET loader
// calls pollFullLookOutfit -> advanceAutomatically -> advanceFullLookChain,
// which can legitimately submit the NEXT garment's FASHN call the instant it
// observes the current one has completed. That's correct behavior for the
// real customer-facing route, but it means even "just checking" is not
// side-effect-free there. This route never calls advanceFullLookChain,
// startOrResumeFullLookChain, submitFullLookRealStep, advanceTryOnJob,
// createOrFindTryOnJob, or reconcileStaleFullLookJobForCustomer — nothing
// here can create a job row, change a job's status, or submit anything to
// FASHN. The one FASHN call it does make (checkFashnPredictionStatus) is a
// plain status GET against an id that already exists — the exact same kind
// of read every normal customer poll already performs, never a new
// prediction.
//
// 2026-11-16 addition — ONE narrowly-scoped, explicitly authorized, read-
// only Cloudinary metadata check (listCloudinaryAssetsByPrefix), targeting
// only the single most recent intermediate job with errorCode
// UPLOAD_FAILED for this customer+suggestion. A pure GET against
// Cloudinary's resources-by-prefix admin endpoint: no download, no byte
// content, no modification, no deletion, and the response never includes
// the raw public_id (which embeds this customer's own id) — only
// Cloudinary's own reported format/createdAt metadata, or nothing if the
// asset doesn't exist.
//
// PRIVACY: scoped by the authenticated session's own customerId on every
// query — there is no code path here that can return another customer's
// rows, regardless of what suggestionId is supplied. No raw SQL, no
// cross-customer listing.
//
// GET only. No action export exists — there is no way to POST to this route
// at all.
//
// Not registered as a customer-facing feature: intended to be removed once
// this specific investigation closes.

import type { LoaderFunctionArgs } from "react-router";
import { data } from "react-router";
import { getCurrentNaiaCustomer } from "~/lib/naia-session.server";
import prisma from "~/db.server";
import {
  checkFashnPredictionStatus,
  REAL_PRODUCT_HANDLE_PREFIX,
  deriveIntermediateStepPublicId,
} from "~/lib/ai/full-look-tryon-real.server";
import { FULL_LOOK_FINAL_STEP_HANDLE_PREFIX } from "~/lib/ai/full-look-handle-constants";
import type { VirtualTryOnJobRecord } from "~/lib/ai/virtual-try-on.types";

// VirtualTryOnJobRecord doesn't declare isTest (not needed by any of its
// existing callers) even though the real column exists — entitlement.
// server.ts's own vtoCompleted query filters on it directly. Extended
// locally rather than widening the shared type for one diagnostic's sake.
type JobRow = VirtualTryOnJobRecord & { isTest: boolean };
import {
  selectFullLookGarments,
  resolveCurrentAttemptScope,
  type SelectableOutfitItem,
} from "~/lib/ai/full-look-vto-orchestrator.server";
import { getCloudinaryConfig, listCloudinaryAssetsByPrefix } from "~/lib/cloudinary-admin.server";
import { getEntitlementSummary } from "~/lib/plan/entitlement.server";
import type { MembershipStatus } from "@prisma/client";

const RESERVATION_KEY_PREFIX = "fulllook-real-reservation:";

function authRequired() {
  return data({ ok: false, code: "auth_required" }, { status: 401 });
}
function badRequest(message: string) {
  return data({ ok: false, code: "invalid_request", message }, { status: 400 });
}

function roleFromHandle(productHandle: string): string {
  if (productHandle.startsWith(FULL_LOOK_FINAL_STEP_HANDLE_PREFIX)) return "final";
  const match = /^fulllook-real:step(\d+):/.exec(productHandle);
  return match ? `step${match[1]}` : "unknown";
}

function garmentLabelFromHandle(productHandle: string): string {
  const idx = productHandle.indexOf(":", productHandle.indexOf(":") + 1);
  return idx === -1 ? "" : productHandle.slice(idx + 1);
}

export async function loader({ request }: LoaderFunctionArgs) {
  const customer = await getCurrentNaiaCustomer(request);
  if (!customer) return authRequired();

  const url = new URL(request.url);
  const suggestionId = url.searchParams.get("suggestionId");
  if (!suggestionId) return badRequest("suggestionId is required.");

  // Every row this customer has ever created for this suggestion, across
  // every reservationScope/attempt — a plain read, no write, no FASHN I/O
  // yet. customerId comes from the session only, never from the request.
  const jobs = (await prisma.virtualTryOnJob.findMany({
    where: {
      customerId: customer.id,
      outfitSuggestionId: suggestionId,
      productHandle: { startsWith: `${REAL_PRODUCT_HANDLE_PREFIX}:` },
    },
    orderBy: [{ createdAt: "asc" }],
  })) as JobRow[];

  const now = Date.now();
  const steps = await Promise.all(
    jobs.map(async (job) => {
      let liveFashnStatus: string | null = null;
      // Only ever a READ against an EXISTING prediction id, and only when
      // this row is still PROCESSING locally — the same category of call
      // any normal customer poll already makes, never a new submission.
      if (job.status === "PROCESSING" && job.predictionId) {
        const check = await checkFashnPredictionStatus(job.predictionId);
        liveFashnStatus = check.ok ? check.body.status : "status_check_failed";
      }
      return {
        jobId: job.id,
        reservationKeyHint: job.idempotencyKey.startsWith("fulllook-real-reservation:") ? "step-0" : "later-step",
        role: roleFromHandle(job.productHandle),
        garmentLabel: garmentLabelFromHandle(job.productHandle),
        status: job.status,
        errorCode: job.errorCode,
        hasPredictionId: job.predictionId != null,
        createdAt: job.createdAt.toISOString(),
        lastActivityAt: job.lastActivityAt.toISOString(),
        ageSeconds: Math.round((now - job.lastActivityAt.getTime()) / 1000),
        completedAt: job.completedAt ? job.completedAt.toISOString() : null,
        liveFashnStatus,
      };
    }),
  );

  // ── Narrowly-scoped, read-only Cloudinary metadata check (2026-11-16) —
  // explicitly authorized, one asset only. Targets ONLY the single most
  // recent non-final (intermediate) job with errorCode UPLOAD_FAILED for
  // THIS customer+suggestion — never iterates every failed job, never
  // lists a broader prefix, never touches a final-step or unrelated asset.
  // listCloudinaryAssetsByPrefix (cloudinary-admin.server.ts) is a pure
  // GET against Cloudinary's resources-by-prefix admin endpoint — no
  // download, no byte content, no modification, no deletion. The exact
  // publicId (which embeds this customer's own id) is never included in
  // the response; only metadata Cloudinary itself reports back.
  let cloudinaryAssetCheck: Record<string, unknown> = { attempted: false };
  const uploadFailedIntermediate = jobs
    .filter((j) => j.errorCode === "UPLOAD_FAILED" && !j.productHandle.startsWith(FULL_LOOK_FINAL_STEP_HANDLE_PREFIX))
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
  if (uploadFailedIntermediate) {
    const targetPublicId = deriveIntermediateStepPublicId(customer.id, uploadFailedIntermediate.id);
    const listResult = await listCloudinaryAssetsByPrefix(targetPublicId, "private", { maxResults: 1 });
    if (!listResult.ok) {
      cloudinaryAssetCheck = {
        attempted: true,
        jobId: uploadFailedIntermediate.id,
        checkSucceeded: false,
        checkErrorCode: listResult.errorCode,
        note: "The metadata check itself failed — this says nothing about whether the original upload succeeded or failed.",
      };
    } else {
      const match = listResult.assets.find((a) => a.publicId === targetPublicId);
      cloudinaryAssetCheck = {
        attempted: true,
        jobId: uploadFailedIntermediate.id,
        checkSucceeded: true,
        assetExistsInCloudinary: match != null,
        // Metadata only — never a URL, never bytes, never the raw public_id
        // (which embeds this customer's own id).
        format: match?.format ?? null,
        cloudinaryCreatedAt: match?.createdAt ?? null,
        note: match
          ? "An asset already exists at this job's own intermediate path — the upload may have actually succeeded (or partially succeeded) upstream, with the failure occurring in this app's own response handling afterward, not at Cloudinary. Worth reconciling: the DB still says UPLOAD_FAILED."
          : "No asset exists at this job's own intermediate path — consistent with the upload genuinely never completing at Cloudinary (rejected before storage, or never reaching Cloudinary at all), not a response-handling bug on our side.",
      };
    }
  }

  // ── Content-free FASHN output-SHAPE check (2026-11-16 addition) — one
  // more read-only status GET against the SAME existing predictionId as
  // the Cloudinary check above (same job, same category of call the
  // diagnostic already makes for PROCESSING rows, same thing
  // recoverFailedUploadStep itself does — nothing billable, no new
  // prediction). Built to answer, without another live recovery attempt,
  // why a genuinely "completed" prediction's output was rejected as
  // INVALID_OUTPUT_FORMAT during Attempt C's one approved recovery.
  // Reports structural flags only (does the string look like a data URI /
  // bare base64 / URL, its length, its mime subtype if a data URI) — never
  // the string itself, never a URL, never any byte content.
  let outputShapeCheck: Record<string, unknown> = { attempted: false };
  if (uploadFailedIntermediate?.predictionId) {
    const shapeStatusCheck = await checkFashnPredictionStatus(uploadFailedIntermediate.predictionId);
    if (!shapeStatusCheck.ok) {
      outputShapeCheck = { attempted: true, jobId: uploadFailedIntermediate.id, checkSucceeded: false };
    } else if (shapeStatusCheck.body.status !== "completed") {
      outputShapeCheck = {
        attempted: true,
        jobId: uploadFailedIntermediate.id,
        checkSucceeded: true,
        liveFashnStatus: shapeStatusCheck.body.status,
        note: "The prediction no longer reports completed — nothing to inspect the shape of.",
      };
    } else {
      const output = shapeStatusCheck.body.output;
      const first = Array.isArray(output) && typeof output[0] === "string" ? output[0].trim() : null;
      const dataUriMatch = first != null ? /^data:image\/([a-zA-Z0-9.+-]+);/i.exec(first) : null;
      outputShapeCheck = {
        attempted: true,
        jobId: uploadFailedIntermediate.id,
        checkSucceeded: true,
        liveFashnStatus: "completed",
        outputArrayLength: Array.isArray(output) ? output.length : null,
        firstEntryIsString: first != null,
        looksLikeDataUri: first != null ? /^data:image\//i.test(first) : null,
        looksLikeBareBase64: first != null ? /^[A-Za-z0-9+/]+=*$/.test(first) : null,
        looksLikeUrl: first != null ? /^https?:\/\//i.test(first) : null,
        dataUriMimeSubtype: dataUriMatch ? dataUriMatch[1].toLowerCase() : null,
        stringLength: first != null ? first.length : null,
      };
    }
  }

  const finalStep = jobs.find((j) => j.productHandle.startsWith(FULL_LOOK_FINAL_STEP_HANDLE_PREFIX));
  const finalStepCompleted = finalStep?.status === "COMPLETED";

  // ── Real credit-accounting check (2026-11-16 addition) — still strictly
  // read-only: getEntitlementSummary (entitlement.server.ts) only ever
  // runs .count()/.findFirst() queries, never a write. Calls the SAME
  // function the real app uses to decide "does this customer have VTO
  // allowance left" — not a re-derivation of its logic, the actual
  // function — so this is the real answer, not an inference from
  // finalStepCompleted alone. Separately checks whether THIS suggestion's
  // own final-step row would itself be included in that count (COMPLETED,
  // not a test job) — the real exclusion entitlement.server.ts's own
  // vtoCompleted query applies (excludingMockAndIntermediateFullLookHandles
  // already excludes every intermediate step handle by construction; the
  // final-step handle is never in that exclusion list, so a COMPLETED,
  // non-test final-step row for this suggestion is counted).
  const entitlementSummary = await getEntitlementSummary(
    customer.id,
    customer.membershipStatus as MembershipStatus,
  );
  const thisAttemptsFinalStepWouldCount =
    finalStep != null && finalStep.status === "COMPLETED" && finalStep.isTest === false;
  const realCreditAccounting = {
    verified: true,
    vtoMonthlyLimit: entitlementSummary.vto.monthlyLimit,
    vtoMonthlyCompleted: entitlementSummary.vto.monthlyCompleted,
    vtoMonthlyInFlight: entitlementSummary.vto.monthlyInFlight,
    thisSuggestionsFinalStepStatus: finalStep?.status ?? "no_final_step_row",
    thisSuggestionsFinalStepIsTest: finalStep?.isTest ?? null,
    thisAttemptsFinalStepWouldCountTowardEntitlement: thisAttemptsFinalStepWouldCount,
    note: thisAttemptsFinalStepWouldCount
      ? "This suggestion's final step is COMPLETED and non-test — it IS counted in vtoMonthlyCompleted above. A credit has been consumed for this outfit."
      : "This suggestion's final step has not reached a COMPLETED, non-test state — it is NOT counted in vtoMonthlyCompleted above. No credit has been consumed for this outfit yet.",
  };

  // ── Scope-resolution check (2026-11-15 addition) — still strictly
  // read-only. resolveCurrentAttemptScope only runs a count() query and
  // formats a string; selectFullLookGarments/computeGarmentFingerprint are
  // pure, synchronous, no I/O. Added to settle, empirically, exactly which
  // reservationScope a GET refresh would resolve to RIGHT NOW, and whether
  // that matches the scope any existing step-0 job actually lives under —
  // rather than inferring it by hand, which produced two disagreeing
  // answers on manual re-derivation.
  let scopeCheck: Record<string, unknown> = { attempted: false };
  const suggestion = await prisma.outfitSuggestion.findUnique({
    where: { id: suggestionId },
    include: {
      session: { select: { customerId: true } },
      items: { include: { closetItem: { select: { name: true, imageUrl: true, imagePublicId: true, imageFormat: true, category: true } } } },
    },
  });
  if (suggestion && suggestion.session.customerId === customer.id) {
    const selection = selectFullLookGarments(suggestion.items as unknown as SelectableOutfitItem[], {
      customerId: customer.id,
      cloudinaryConfig: getCloudinaryConfig(),
    });
    if (selection) {
      const currentlyResolvedScope = await resolveCurrentAttemptScope(customer.id, suggestionId, selection.fingerprint);
      const step0Jobs = jobs
        .filter((j) => j.idempotencyKey.startsWith(`${RESERVATION_KEY_PREFIX}${customer.id}:`))
        .map((j) => ({
          jobId: j.id,
          status: j.status,
          ownScope: j.idempotencyKey.slice(`${RESERVATION_KEY_PREFIX}${customer.id}:`.length),
        }));
      scopeCheck = {
        attempted: true,
        currentFingerprint: selection.fingerprint,
        currentlyResolvedScope,
        step0Jobs,
        aScopeMatchesTheMostRecentStep0Job:
          step0Jobs.length > 0 && step0Jobs[step0Jobs.length - 1].ownScope === currentlyResolvedScope,
      };
    } else {
      scopeCheck = { attempted: true, error: "selectFullLookGarments returned null (fewer than 3 eligible garments)." };
    }
  } else {
    scopeCheck = { attempted: true, error: "Suggestion not found or not owned by this customer." };
  }

  return data(
    {
      ok: true,
      suggestionId,
      totalJobRows: jobs.length,
      steps,
      scopeCheck,
      finalStepCompleted,
      realCreditAccounting,
      cloudinaryAssetCheck,
      outputShapeCheck,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
