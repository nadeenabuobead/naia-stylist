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
import { checkFashnPredictionStatus, REAL_PRODUCT_HANDLE_PREFIX } from "~/lib/ai/full-look-tryon-real.server";
import { FULL_LOOK_FINAL_STEP_HANDLE_PREFIX } from "~/lib/ai/full-look-handle-constants";
import type { VirtualTryOnJobRecord } from "~/lib/ai/virtual-try-on.types";

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
  })) as VirtualTryOnJobRecord[];

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

  const finalStep = jobs.find((j) => j.productHandle.startsWith(FULL_LOOK_FINAL_STEP_HANDLE_PREFIX));
  const finalStepCompleted = finalStep?.status === "COMPLETED";

  return data(
    {
      ok: true,
      suggestionId,
      totalJobRows: jobs.length,
      steps,
      // Deliberately NOT a credit-consumption answer. This only reflects
      // whether the final garment's own row reached COMPLETED — it does
      // not query entitlement.server.ts's actual counting logic
      // (getEntitlementSummary's vtoCompleted count, which also applies
      // isTest/mock-handle exclusions and a billing-window boundary this
      // route never computes). Report credit consumption as unverified
      // unless/until that query is run directly.
      finalStepCompleted,
      creditConsumptionVerified: false,
      creditNote: finalStepCompleted
        ? "Final step row is COMPLETED. This is necessary but not sufficient proof a credit was recorded — credit consumption is NOT independently verified by this diagnostic. Check entitlement.server.ts's getEntitlementSummary (vtoCompleted) directly for a real answer."
        : "Final step row is not COMPLETED. Credit consumption is NOT independently verified by this diagnostic either way.",
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
