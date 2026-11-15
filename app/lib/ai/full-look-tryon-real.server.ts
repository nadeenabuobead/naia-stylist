// app/lib/ai/full-look-tryon-real.server.ts
//
// REAL Full-Look VTO — async, submit-then-poll chain across 3 garments.
//
// NOT REGISTERED anywhere yet; invoked only by staging.full-look-vto-real.tsx
// (itself unregistered — see that file's own header). No code in this module
// runs against a live customer photo or a real FASHN credential unless that
// route is both registered AND reached by an explicitly authorised staging
// test account.
//
// WHY THIS EXISTS, NOT A REUSE OF poc-job-tracked-full-look-chain.server.ts:
// that module (and the runFashnTryOn it calls) submits-AND-polls-to-completion
// INSIDE one request, up to 90s per step — safe only because every test of it
// uses a mock fetch that resolves instantly. A real 3-step chain that way is
// up to ~270s of held-open synchronous request time, which the single-garment
// production path (fashn-tryon-service.server.ts's submitTryOnJob) was
// deliberately built to avoid at even ONE step's 90s ceiling ("exceeding
// Vercel's 60s timeout" — that file's own comment). This module extends THAT
// proven pattern instead: every exported function here does at most one
// FASHN HTTP call (one submit POST, or one status GET) per invocation. There
// is no poll loop anywhere in this file. A multi-minute chain is completed
// across many short, cheap requests — driven by a client polling loop, same
// as api.tryon-status.$jobId.tsx already does for one garment — never by one
// long-held request.
//
// JOB TRACKING: no new Prisma model. Each of the 3 garment steps gets its own
// ordinary VirtualTryOnJob row, created via the existing createOrFindTryOnJob/
// advanceTryOnJob state machine (my-naia-model.server.ts, unmodified) — the
// exact mechanism poc-job-tracked-full-look-chain.server.ts already proved
// out for job bookkeeping (just not for the provider call itself, which here
// is submit-then-poll, not submit-and-poll-to-completion). The chain's
// current position is never stored as a separate field: step 0's job id is
// deterministic per customer (REAL_RESERVATION_KEY_PREFIX + customerId);
// step 1 and step 2's idempotency keys are each deterministically derived
// from the PRIOR step's own (already-created, globally unique) job id. So
// "where is this chain right now" is always reconstructible by walking
// step 0 → step 1 → step 2 via these deterministic keys and stopping at the
// first job that isn't COMPLETED yet — no new schema, and a browser refresh
// just re-derives the same walk from the same keys.
//
// KEYS ARE A SEPARATE NAMESPACE FROM THE MOCK CHAIN: REAL_RESERVATION_KEY_PREFIX
// ("fulllook-real-reservation:") and the real productHandle prefix
// ("fulllook-real:") are deliberately distinct from the mock POC's
// "fulllook-poc-reservation:" / "fulllook-poc:" — a real job can never
// collide with, resume, or be confused with a mock job, and entitlement.server.ts's
// MOCK_VTO_PRODUCT_HANDLE_PREFIX exclusion (scoped to "fulllook-poc:") does
// NOT apply to these rows, so they are NOT excluded from real VTO usage
// counting — see the large comment on BILLING below.
//
// INTERMEDIATE IMAGE PERSISTENCE: step N's output (for N < 2, i.e. not the
// final step) must survive until a LATER, separate request submits step N+1
// — it cannot be kept in memory. Reuses the exact same private-Cloudinary
// primitives fashn-tryon-service.server.ts already uses for the FINAL result
// (uploadCloudinaryPrivate / buildPrivateDownloadUrl, both unmodified), under
// a distinct, clearly-named public-id namespace
// ("naia-tryon-fulllook-intermediate/{customerId}/{jobId}") so an
// intermediate step's image is never confused with, or retained alongside,
// the one real deliverable (the final result, uploaded via the existing,
// unmodified uploadTryOnResult/deriveTryOnResultPublicId — approved for this
// reuse explicitly). Intermediate images are a private implementation
// detail of the chain, never a customer-facing preview, and never reachable
// via buildTryOnResultUrl (which only ever derives the FINAL result's public
// id). RETENTION (2026-11-03): advanceFullLookChain deletes every prior
// step's intermediate asset the moment the chain reaches a terminal state
// (COMPLETED or FAILED) — by then each one has already served its one
// purpose (feeding the next step) or never will. Best-effort: a delete
// failure is swallowed, not retried or surfaced, since by that point the
// chain's own outcome is already decided and an orphaned intermediate asset
// is a storage-hygiene issue, not a correctness or privacy-blocking one (it
// is still private, ownership-scoped by its customerId-prefixed path, and
// not linked from anywhere a customer could reach). Still a real-rollout
// gap this does NOT close: there is no scheduled/background sweep for a
// chain that is abandoned mid-flight (e.g. the customer never returns to
// poll again) — that case is outside this authorised test's scope.
//
// BILLING / VTO ALLOWANCE (verified, not decided here): this module makes NO
// new decision about how real FASHN calls should count against a
// customer's VTO allowance. It reuses exactly the policy
// staging.full-look-vto-test.tsx already adopted and documented for its own
// quota PRE-CHECK (hasQuotaRoomForFullLookChain, exported from that file,
// reused unmodified here): that harness's own pre-check still assumes a
// fixed 3-unit cost (it imports its OWN, untouched MAX_CHAIN_LENGTH=3 from
// poc-sequential-full-look-vto.server.ts, deliberately not switched to
// FULL_LOOK_MAX_GARMENTS) — conservative, staging-only, and irrelevant to
// real customers, who are never gated by this pre-check at all; checked via
// getMembershipAllowances(status).vtoPerMonth and
// getEntitlementSummary — deliberately isolated from the pre-existing,
// unresolved VTO_MONTHLY_LIMIT_OVERRIDE scoping bug, and unconditional
// regardless of ENTITLEMENT_ENFORCEMENT. That file's own comment already
// flags this as "PROVISIONAL POLICY, not a final pricing decision" — still
// true here. What is NEW in this module is that, unlike the mock chain, a
// real completed chain's 3 VirtualTryOnJob rows (productHandle prefix
// "fulllook-real:", not "fulllook-poc:") are NOT excluded by
// entitlement.server.ts's MOCK_VTO_PRODUCT_HANDLE_PREFIX filter — so they
// fall into the EXISTING, unmodified vtoCompleted/vtoInFlight counting
// queries automatically, with no new entitlement code required. The net,
// de facto effect: one real 3-garment Full-Look consumes 3 of the
// customer's monthly VTO units once all 3 steps complete. Whether a
// completed Full-Look SHOULD instead cost 1 unit (one "outfit" try-on) is an
// open product decision this module does not make or assume — flagged
// separately for explicit confirmation before any customer-facing rollout.
//
// NO AUTO-RETRY: a step whose FASHN call has already succeeded is never
// resubmitted by this module under any code path — advancing to the next
// step always uses that step's OWN already-completed output, never a fresh
// call. A step that FASHN reports as failed is marked FAILED and never
// retried automatically; a status check that itself errors (network/parse)
// leaves the job exactly as it was (still PROCESSING) so a later poll simply
// re-checks status — never re-submits — which is free, not billable.

import {
  checkCustomerCooldown,
  createOrFindTryOnJob,
  advanceTryOnJob,
} from "./my-naia-model.server.js";
import {
  submitTryOnToProvider,
  isValidModelImageDataUrl,
} from "./fashn-try-on.server.js";
import {
  downloadModelPhotoAsDataUrl,
  uploadTryOnResult,
  buildTryOnResultUrl,
} from "./fashn-tryon-service.server.js";
import {
  uploadCloudinaryPrivate,
  buildPrivateDownloadUrl,
  getCloudinaryConfig,
  deleteCloudinaryAsset,
  type CloudinaryConfig,
  type DeleteAssetFn,
} from "../cloudinary-admin.server.js";
import type { VirtualTryOnConsent, VirtualTryOnJobRecord } from "./virtual-try-on.types.js";
import prisma from "../../db.server.js";
import {
  REAL_PRODUCT_HANDLE_PREFIX,
  FULL_LOOK_MAX_GARMENTS,
  FULL_LOOK_FINAL_STEP_HANDLE_PREFIX,
} from "./full-look-handle-constants.js";
import { createHash } from "node:crypto";

// ── TEMPORARY DIAGNOSTIC LOGGING (2026-11-15) ───────────────────────────────
//
// Investigating why the stale-job reconciliation fix still produced a BUSY
// response against a real staging attempt. Every line below is tagged
// "[vto-diag]" for easy grep and removal once the investigation closes —
// see the session's own diagnostic-logging commit message. Privacy-safe by
// construction: shortHash is one-way and truncated (never reversible to
// the original id in practice), vtoType is a derived 2-value category
// (never the raw productHandle, which can embed a garment label),
// ageSeconds is a number (never a raw timestamp someone could correlate
// elsewhere), and nothing below ever logs a customerId, suggestionId,
// image URL, or FASHN prediction id in full. Purely additive — every
// console.log call sits beside an existing return/decision, changing
// nothing about what that decision actually does.
function shortHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 8);
}

function vtoTypeOf(productHandle: string): "full-look" | "single-item" {
  return productHandle.startsWith(`${REAL_PRODUCT_HANDLE_PREFIX}:`) ? "full-look" : "single-item";
}

// Real DB implementation — the default for every caller except tests, which
// inject a mock via WalkChainDeps._findJobFn instead.
async function defaultFindJobByIdempotencyKey(
  where: { idempotencyKey: string },
): Promise<VirtualTryOnJobRecord | null> {
  return prisma.virtualTryOnJob.findUnique({
    where: { idempotencyKey: where.idempotencyKey },
  }) as Promise<VirtualTryOnJobRecord | null>;
}

// ── Key namespaces — distinct from the mock chain's "fulllook-poc*" keys ────

const REAL_RESERVATION_KEY_PREFIX = "fulllook-real-reservation:";
const REAL_STEP_KEY_PREFIX = "fulllook-real-step:";
// REAL_PRODUCT_HANDLE_PREFIX / FULL_LOOK_INTERMEDIATE_HANDLE_PREFIXES live in
// full-look-handle-constants.ts (pure, dependency-free) specifically so
// fashn-tryon-service.server.ts can import them too without a circular
// dependency — this file already imports FROM that one for the final-
// result upload/URL primitives. Re-exported here for every existing
// caller of this module that imports REAL_PRODUCT_HANDLE_PREFIX from here.
export { REAL_PRODUCT_HANDLE_PREFIX, FULL_LOOK_INTERMEDIATE_HANDLE_PREFIXES } from "./full-look-handle-constants.js";

export function getFullLookStepIdempotencyKey(
  customerId: string,
  stepIndex: number,
  priorJobId: string | null,
  // Omitted by every default/production-shaped caller — falls back to the
  // EXACT original permanent key, byte-identical to before this field
  // existed. Only a caller that explicitly sets this (see
  // FullLookChainContext.reservationScope) ever gets a different key — and
  // only for step 0, the one reservation slot. See that field's own doc
  // comment for the full safety story (server-only, staging-only, never
  // touches the single-garment production path).
  reservationScope?: string,
): string {
  if (stepIndex === 0) {
    return `${REAL_RESERVATION_KEY_PREFIX}${customerId}${reservationScope ? `:${reservationScope}` : ""}`;
  }
  return `${REAL_STEP_KEY_PREFIX}${priorJobId}:${stepIndex}`;
}

// ── Model-photo format pre-flight ────────────────────────────────────────────
//
// My nAia Model accepts heic/heif at upload time (my-naia-model.server.ts's
// ALLOWED_FORMATS), but downloadModelPhotoAsDataUrl's formatToMimeSubtype
// maps anything that isn't jpg/jpeg/webp to a "png" MIME label — silently
// mislabeling real HEIC/HEIF bytes as image/png rather than transcoding them.
// This has never been exercised against a real HEIC photo in this codebase.
// Rather than let a real, billable FASHN submission be the first place that
// surfaces, this chain refuses up front with a clear, distinct reason.
const COMPATIBLE_BODY_FORMATS = new Set(["jpg", "jpeg", "png", "webp"]);

export function isCompatibleModelPhotoFormat(bodyFormat: string | null): boolean {
  const f = (bodyFormat ?? "jpg").toLowerCase();
  return COMPATIBLE_BODY_FORMATS.has(f);
}

// ── Intermediate (non-final) step image persistence ─────────────────────────
//
// Distinct Cloudinary namespace from deriveTryOnResultPublicId's
// "naia-tryon/{customerId}/{jobId}" — this is a private implementation
// detail of the chain (the input to the NEXT step), never a customer-facing
// preview and never exposed through buildTryOnResultUrl.

export function deriveIntermediateStepPublicId(customerId: string, jobId: string): string {
  return `naia-tryon-fulllook-intermediate/${customerId}/${jobId}`;
}

export async function uploadIntermediateStepResult(
  customerId: string,
  jobId: string,
  outputDataUrl: string,
  _fetch: typeof fetch = fetch,
  _getConfig: () => CloudinaryConfig | null = getCloudinaryConfig,
): Promise<{ ok: true } | { ok: false; errorCode: string }> {
  const publicId = deriveIntermediateStepPublicId(customerId, jobId);
  const result = await uploadCloudinaryPrivate(publicId, outputDataUrl, "private", _fetch, _getConfig);
  if (!result.ok) return { ok: false, errorCode: result.errorCode };
  return { ok: true };
}

// Signed, short-lived (10-min, same expiry as buildPrivateDownloadUrl's own
// default) read-only URL for DISPLAYING an intermediate step's image to the
// authorised tester — not used internally by the chain itself (that's
// downloadIntermediateStepResult, below, which fetches bytes to feed the
// next step). Added for the QA pause checkpoint (2026-11-03): intermediate
// images still follow the exact same retention as before — this function
// only signs a URL for an asset that already exists; it changes nothing
// about when that asset is deleted.
export function buildIntermediateStepResultUrl(
  customerId: string,
  jobId: string,
  _getConfig: () => CloudinaryConfig | null = getCloudinaryConfig,
): string | null {
  const cfg = _getConfig();
  if (!cfg) return null;
  return buildPrivateDownloadUrl(cfg, deriveIntermediateStepPublicId(customerId, jobId), "png", "private");
}

export async function downloadIntermediateStepResult(
  customerId: string,
  jobId: string,
  _fetch: typeof fetch = fetch,
  _getConfig: () => CloudinaryConfig | null = getCloudinaryConfig,
): Promise<{ ok: true; dataUrl: string } | { ok: false; errorCode: string }> {
  const cfg = _getConfig();
  if (!cfg) return { ok: false, errorCode: "NOT_CONFIGURED" };
  const publicId = deriveIntermediateStepPublicId(customerId, jobId);
  // Uploaded above via output_format:"png" (FASHN's own fixed output format).
  const downloadUrl = buildPrivateDownloadUrl(cfg, publicId, "png", "private");
  try {
    const res = await _fetch(downloadUrl);
    if (!res.ok) return { ok: false, errorCode: "PROVIDER_ERROR" };
    const buffer = await res.arrayBuffer();
    const base64 = Buffer.from(buffer).toString("base64");
    const dataUrl = `data:image/png;base64,${base64}`;
    if (!isValidModelImageDataUrl(dataUrl)) return { ok: false, errorCode: "INVALID_MODEL_IMAGE" };
    return { ok: true, dataUrl };
  } catch {
    return { ok: false, errorCode: "NETWORK_ERROR" };
  }
}

// ── FASHN status check — single call, no poll loop ──────────────────────────
// Mirrors api.tryon-status.$jobId.tsx's own inline fetch exactly (same URL,
// same header, same response shape) — factored out once here because this
// chain needs it at up to 3 distinct steps instead of 1.

const FASHN_BASE = "https://api.fashn.ai";

export type FashnStatus = "starting" | "in_queue" | "processing" | "completed" | "failed" | "canceled";

export interface FashnStatusBody {
  status: FashnStatus;
  output?: string[];
  error?: string;
}

export type CheckStatusResult =
  | { ok: true; body: FashnStatusBody }
  | { ok: false }; // network/parse error — caller must NOT treat this as failure or success

export async function checkFashnPredictionStatus(
  predictionId: string,
  _fetch: typeof fetch = fetch,
  _getApiKey: () => string | undefined = () => process.env.FASHN_API_KEY,
): Promise<CheckStatusResult> {
  const apiKey = _getApiKey();
  if (!apiKey) return { ok: false };
  try {
    const res = await _fetch(`${FASHN_BASE}/v1/status/${predictionId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) return { ok: false };
    const body = (await res.json()) as FashnStatusBody;
    return { ok: true, body };
  } catch {
    return { ok: false };
  }
}

// ── Chain garment shape ───────────────────────────────────────────────────────

export interface FullLookRealGarmentInput {
  label: string;
  productImageUrl: string;
}

export interface FullLookChainContext {
  customerId: string;
  naiaModelId: string | null;
  bodyPublicId: string | null;
  bodyFormat: string | null;
  deliveryType: string;
  garments: readonly FullLookRealGarmentInput[]; // between 3 and FULL_LOOK_MAX_GARMENTS, ordered
  consent: VirtualTryOnConsent;
  // Applied ONLY to the final (outerwear) step's FASHN request — see
  // submitFullLookRealStep's own stepIndex check. Omitted entirely for
  // steps 0 and 1, which always keep the prior "fast", no-prompt behavior
  // unchanged. Both optional; omitting either here falls back to
  // submitTryOnToProvider's own defaults (generation_mode "fast", no prompt).
  finalStepPrompt?: string;
  finalStepGenerationMode?: "fast" | "balanced" | "quality";
  // Second-(and-later)-test mechanism (2026-11-03). Omitted by default —
  // every caller that doesn't set this gets the EXACT original permanent,
  // customer-scoped, one-time-ever reservation (step 0's idempotency key is
  // unchanged). When set, step 0's key becomes scoped to this value, so a
  // NEW, independent 3-call chain can run for the same customer WITHOUT
  // touching, deleting, or reusing any prior (unscoped or differently
  // scoped) chain's rows — they remain exactly as they are, under their own
  // keys, forever. This value must come ONLY from a server-side source the
  // route controls (e.g. an operator-set env var), never from client
  // request input — see staging.full-look-vto-real.tsx's own use of this
  // field for the actual authorization gate. This field does not exist on,
  // and is never read by, the real single-garment production path
  // (fashn-tryon-service.server.ts) — production idempotency there is
  // completely unaffected by this field's existence.
  reservationScope?: string;
  // 2026-11-14 — the StyleMe OutfitSuggestion this chain is generating a
  // full-look try-on for. Set on every step's VirtualTryOnJob row (not
  // just the final one) so an in-progress or abandoned chain can be found
  // by suggestion without parsing idempotencyKey strings. Required: every
  // real customer-facing chain originates from a saved suggestion; the
  // internal staging harness that doesn't have one passes a synthetic
  // staging-only placeholder (see staging.full-look-vto-real.tsx), which
  // is fine — this value is never used for ownership/security decisions,
  // only for linking a completed result back to a display surface.
  outfitSuggestionId: string;
}

// ── Walk the chain via deterministic keys — no new schema ───────────────────
//
// Returns the jobs found so far, in step order, stopping at the first step
// that has no job yet. A customer with no chain started returns [].

async function findJobByIdempotencyKey(
  key: string,
  _findJobFn: (where: { idempotencyKey: string }) => Promise<VirtualTryOnJobRecord | null>,
): Promise<VirtualTryOnJobRecord | null> {
  return _findJobFn({ idempotencyKey: key });
}

export interface WalkChainDeps {
  _findJobFn: (where: { idempotencyKey: string }) => Promise<VirtualTryOnJobRecord | null>;
}

export async function walkFullLookChainJobs(
  customerId: string,
  deps: WalkChainDeps = { _findJobFn: defaultFindJobByIdempotencyKey },
  // Omitted ⇒ walks the original unscoped chain, unchanged. A scoped walk
  // only ever sees that scope's own rows — it cannot discover, and will
  // never be confused with, any other scope's (including the unscoped
  // first test's) rows, since they live under entirely different keys.
  reservationScope?: string,
): Promise<VirtualTryOnJobRecord[]> {
  const jobs: VirtualTryOnJobRecord[] = [];
  let priorJobId: string | null = null;
  for (let i = 0; i < FULL_LOOK_MAX_GARMENTS; i++) {
    const key = getFullLookStepIdempotencyKey(customerId, i, priorJobId, reservationScope);
    const job = await findJobByIdempotencyKey(key, deps._findJobFn);
    if (!job) break;
    jobs.push(job);
    if (job.status !== "COMPLETED") break; // chain is parked here until this step resolves
    priorJobId = job.id;
  }
  return jobs;
}

// ── Submit one step (create-or-find job, download input image, submit) ──────

export type SubmitStepResult =
  | { ok: true; job: VirtualTryOnJobRecord; alreadySubmitted: boolean }
  | { ok: false; reason: string; job?: VirtualTryOnJobRecord };

async function markFailedBestEffort(job: VirtualTryOnJobRecord, errorCode: string): Promise<void> {
  try {
    await advanceTryOnJob(job, "FAILED", { errorCode });
  } catch {
    // Best-effort only — see poc-job-tracked-full-look-chain.server.ts's
    // identical convention and rationale.
  }
}

export async function submitFullLookRealStep(
  ctx: FullLookChainContext,
  stepIndex: number,
  priorJobId: string | null,
): Promise<SubmitStepResult> {
  // 2026-11-15 — defense in depth. This is the actual site a missing
  // ctx.garments[stepIndex] used to crash with a raw TypeError (see
  // api.full-look-vto.tsx's GET loader regression, fixed the same day):
  // every caller is responsible for passing the real garments the chain
  // was started with, but a future caller making the same mistake must
  // fail closed with a normal SubmitStepResult, never an unhandled throw.
  const garment = ctx.garments[stepIndex];
  if (!garment) {
    return { ok: false, reason: "missing_garment_for_step" };
  }
  const idempotencyKey = getFullLookStepIdempotencyKey(ctx.customerId, stepIndex, priorJobId, ctx.reservationScope);

  // Role-based, not position-based (2026-11-15) — see full-look-handle-
  // constants.ts's header for why. ctx.garments.length is THIS chain's own
  // real length (3-5), so "final" is correct regardless of how many
  // garments any other chain happens to have.
  const isFinalStep = stepIndex === ctx.garments.length - 1;
  const stepHandleSegment = isFinalStep ? "final" : `step${stepIndex + 1}`;

  const jobResult = await createOrFindTryOnJob({
    customerId: ctx.customerId,
    naiaModelId: ctx.naiaModelId,
    productHandle: `${REAL_PRODUCT_HANDLE_PREFIX}:${stepHandleSegment}:${garment.label}`,
    bodyPublicId: ctx.bodyPublicId,
    virtualTryOnConsentAt: new Date(ctx.consent.consentedAt),
    idempotencyKey,
    outfitSuggestionId: ctx.outfitSuggestionId,
  });

  if (!jobResult.ok) {
    return { ok: false, reason: jobResult.code };
  }

  // Idempotent resume: a job already exists for this exact step (duplicate
  // request, or a refresh after step 0 was already submitted) — never
  // submit a second FASHN call for it. The caller polls its current state.
  if (!jobResult.created) {
    return { ok: true, job: jobResult.job, alreadySubmitted: true };
  }

  const job = jobResult.job;

  const submitted = await advanceTryOnJob(job, "SUBMITTED", {});
  if (!submitted.ok) {
    await markFailedBestEffort(job, "state_error_before_submission");
    return { ok: false, reason: "STATE_ERROR", job };
  }

  // ── Resolve this step's input model image — zero FASHN calls yet ──────────
  const inputImage =
    stepIndex === 0
      ? await downloadModelPhotoAsDataUrl(ctx.bodyPublicId as string, ctx.bodyFormat, ctx.deliveryType)
      : await downloadIntermediateStepResult(ctx.customerId, priorJobId as string);

  if (!inputImage.ok) {
    await markFailedBestEffort(submitted.job, inputImage.errorCode);
    return { ok: false, reason: inputImage.errorCode, job: submitted.job };
  }

  // ── Final-step-only tuning — see FullLookChainContext's own doc comment.
  // Every non-final step's request is byte-identical to before (no prompt,
  // generation_mode "fast" via submitTryOnToProvider's own default).
  // isFinalStep computed above, before the productHandle was built. ───────

  // ── Submit only — no poll. Returns immediately with a predictionId. ──────
  const fashnResult = await submitTryOnToProvider({
    customerId: ctx.customerId,
    modelImageDataUrl: inputImage.dataUrl,
    productImageUrl: garment.productImageUrl,
    productHandle: job.productHandle,
    consent: ctx.consent,
    ...(isFinalStep
      ? { prompt: ctx.finalStepPrompt, generationMode: ctx.finalStepGenerationMode }
      : {}),
  });

  if (!fashnResult.ok) {
    await markFailedBestEffort(submitted.job, fashnResult.code);
    return { ok: false, reason: fashnResult.code, job: submitted.job };
  }

  const processing = await advanceTryOnJob(submitted.job, "PROCESSING", {
    predictionId: fashnResult.predictionId,
  });
  if (!processing.ok) {
    // FASHN call already succeeded (and is potentially already billed) —
    // never resubmitted. Bookkeeping failure only; the step itself ran.
    return { ok: false, reason: "STATE_ERROR_AFTER_PROVIDER_SUCCESS", job: submitted.job };
  }

  return { ok: true, job: processing.job, alreadySubmitted: false };
}

// ── Poll one step — single status check, no loop ─────────────────────────────

export type PollStepResult =
  | { status: "PROCESSING" }
  | { status: "STEP_COMPLETE"; job: VirtualTryOnJobRecord } // intermediate step done; caller submits next
  | { status: "COMPLETED"; job: VirtualTryOnJobRecord; resultUrl: string } // final step done
  | { status: "FAILED"; job: VirtualTryOnJobRecord };

export async function pollFullLookRealStep(
  ctx: FullLookChainContext,
  job: VirtualTryOnJobRecord,
  stepIndex: number,
): Promise<PollStepResult> {
  if (job.status === "COMPLETED") {
    if (stepIndex === ctx.garments.length - 1) {
      const resultUrl = buildTryOnResultUrl(ctx.customerId, job.id);
      if (!resultUrl) return { status: "FAILED", job };
      return { status: "COMPLETED", job, resultUrl };
    }
    return { status: "STEP_COMPLETE", job };
  }
  if (job.status === "FAILED" || job.status === "CANCELED" || job.status === "TIMED_OUT") {
    return { status: "FAILED", job };
  }

  const predictionId = job.predictionId;
  if (!predictionId) return { status: "PROCESSING" }; // SUBMITTED but not yet persisted

  const check = await checkFashnPredictionStatus(predictionId);
  if (!check.ok) {
    // Network/parse error on the STATUS CHECK — free, not billable. Leave the
    // job exactly as it is; a later poll simply checks again. Never resubmit.
    return { status: "PROCESSING" };
  }

  const fashnStatus = check.body.status;

  if (fashnStatus === "completed") {
    const outputs = check.body.output;
    if (!Array.isArray(outputs) || outputs.length === 0 || typeof outputs[0] !== "string") {
      await markFailedBestEffort(job, "PROVIDER_FAILED");
      return { status: "FAILED", job };
    }
    const outputDataUrl = outputs[0];

    const isFinal = stepIndex === ctx.garments.length - 1;
    const upload = isFinal
      ? await uploadTryOnResult(ctx.customerId, job.id, outputDataUrl)
      : await uploadIntermediateStepResult(ctx.customerId, job.id, outputDataUrl);

    if (!upload.ok) {
      await markFailedBestEffort(job, "UPLOAD_FAILED");
      return { status: "FAILED", job };
    }

    const completed = await advanceTryOnJob(job, "COMPLETED", { predictionId });
    if (!completed.ok) {
      // FASHN succeeded and the result is already safely uploaded; only our
      // own status transition failed to persist. Report FAILED rather than
      // silently retrying — a human can inspect the uploaded asset directly.
      return { status: "FAILED", job };
    }

    if (isFinal) {
      const resultUrl = buildTryOnResultUrl(ctx.customerId, completed.job.id);
      if (!resultUrl) return { status: "FAILED", job: completed.job };
      return { status: "COMPLETED", job: completed.job, resultUrl };
    }
    return { status: "STEP_COMPLETE", job: completed.job };
  }

  if (fashnStatus === "failed" || fashnStatus === "canceled") {
    await markFailedBestEffort(job, "PROVIDER_FAILED");
    return { status: "FAILED", job };
  }

  // starting | in_queue | processing
  return { status: "PROCESSING" };
}

// ── Top-level: advance the chain by exactly one unit of work ────────────────
//
// Used by both the submit action (to kick off / resume step 0) and the
// status loader (to poll the current step and, if it just completed and
// isn't final, immediately submit the next one in the SAME request — one
// extra cheap POST, never a poll loop).

export interface IntermediateStepPreview {
  stepIndex: number;
  label: string;
  url: string;
}

// ── QA pause abandonment — expiry, not deletion-on-a-timer ──────────────────
//
// The pause checkpoint has no natural terminal event if the tester simply
// closes the tab — unlike every other outcome in this chain, nothing ever
// calls FASHN or Cloudinary again to tell us "done." Rather than deleting
// images on a background timer (no cron infrastructure exists in this app,
// and one would be a new architectural surface, not the smallest fix), this
// is a PURE, DERIVED check: compare now() against the shirt job's own
// completedAt (an already-persisted, honest timestamp — never mutated by
// this check). No new DB field, no new job-status transition — COMPLETED
// has zero allowed outgoing transitions in ALLOWED_TRANSITIONS by design,
// and the shirt step genuinely did complete, so that must never change.
//
// 30 minutes is deliberately longer than MAX_CONSENT_AGE_MS (15 min): the
// tester needs real time to look at two images and decide, not just submit
// a form. Once expired, this is permanent — completedAt never changes, so
// every later poll independently re-derives the same EXPIRED verdict.
const QA_PAUSE_EXPIRY_MS = 30 * 60 * 1000;

function isAwaitingContinueExpired(job: VirtualTryOnJobRecord): boolean {
  return job.completedAt != null && Date.now() - job.completedAt.getTime() > QA_PAUSE_EXPIRY_MS;
}

export type ChainAdvanceResult =
  | { status: "NOT_STARTED" }
  | { status: "PROCESSING"; stepIndex: number }
  // QA pause checkpoint (2026-11-03): reached once the second-to-last step
  // (shirt) is COMPLETED and BEFORE the final (blazer) step is ever
  // submitted. Stable across repeated polls/refreshes — see the fast-path
  // check below — so a browser refresh while paused shows the exact same
  // state, never auto-advances, and never re-fetches FASHN. intermediates
  // carries a signed, short-lived URL per completed-so-far step for
  // display; cleanup is deliberately NOT run yet (see advanceFullLookChain
  // — cleanup only fires from the COMPLETED/FAILED branches, never this
  // one), so these URLs remain valid until the chain reaches a terminal
  // state.
  | { status: "AWAITING_CONTINUE"; intermediates: IntermediateStepPreview[] }
  // Abandoned pause (2026-11-04): more than QA_PAUSE_EXPIRY_MS has passed
  // since the shirt step completed with no Continue submission. Terminal in
  // effect (continueToFinalStep refuses once expired — see its own check),
  // though not a job-status mutation — see isAwaitingContinueExpired above.
  // Intermediate images are cleaned up the moment this is first observed
  // (and, harmlessly, on every later poll too — see advanceFullLookChain's
  // own comment on why re-attempting a delete here is an accepted
  // trade-off, not a bug).
  | { status: "EXPIRED" }
  | { status: "COMPLETED"; resultUrl: string }
  | { status: "FAILED"; failedStepIndex: number; errorCode: string | null }
  | { status: "SUBMIT_ERROR"; reason: string };

// Returns null (not a partial list) if any single URL fails to build —
// Cloudinary misconfiguration should surface as SUBMIT_ERROR, not as a
// broken image silently shown to the tester.
function buildIntermediatePreviews(
  ctx: FullLookChainContext,
  jobs: readonly VirtualTryOnJobRecord[],
): IntermediateStepPreview[] | null {
  const previews: IntermediateStepPreview[] = [];
  for (let i = 0; i < jobs.length; i++) {
    const url = buildIntermediateStepResultUrl(ctx.customerId, jobs[i].id);
    if (!url) return null;
    previews.push({ stepIndex: i, label: ctx.garments[i]?.label ?? `step ${i + 1}`, url });
  }
  return previews;
}

// ── Intermediate-image retention — best-effort cleanup at chain's end ───────
//
// Called exactly once per chain: the moment a poll call OBSERVES the fresh
// PROCESSING → COMPLETED/FAILED transition (see the two call sites below).
// A later poll against an already-terminal chain takes the fast path at the
// top of advanceFullLookChain and never reaches here again, so this never
// re-fires on every subsequent poll. jobIds is every step BEFORE the
// terminal one — the only steps that could ever have an intermediate asset
// (the terminal step's own output either became the real result, via
// uploadTryOnResult, or was never produced at all).
async function cleanupIntermediateStepResults(
  customerId: string,
  jobIds: readonly string[],
  _deleteAsset: DeleteAssetFn = deleteCloudinaryAsset,
): Promise<void> {
  for (const jobId of jobIds) {
    try {
      await _deleteAsset(deriveIntermediateStepPublicId(customerId, jobId), "private");
    } catch {
      // Best-effort only — see this module's own RETENTION comment above.
    }
  }
}

// 2026-11-15 — advanceFullLookChain is the ONE function both a passive GET
// poll (pollFullLookOutfit) and a same-scope resume (startOrResumeFullLookChain
// finding jobs.length > 0) funnel through for an EXISTING chain. Neither of
// those callers ever reaches reconcileStaleFullLookJobForCustomer or
// checkCustomerCooldown — both only run when a chain has zero jobs yet
// under its OWN reservationScope, which is never true for a chain a
// customer is simply refreshing or re-checking. Without a staleness check
// HERE too, a customer who only ever refreshes or clicks a non-destructive
// "Check Again" (never an explicit, scope-resetting "Try Again") would
// poll a dead job forever: pollFullLookRealStep's own FASHN status check
// has no age awareness and will just keep reporting PROCESSING for as
// long as FASHN itself does (or forever, if FASHN silently lost the job).
// This mirrors reconcileStaleFullLookJobForCustomer's exact policy — real
// FASHN check first (already just happened, via the poll three lines
// below), force TIMED_OUT only if it's still reported in-flight AND past
// the threshold — via staleDeps, defaulting to the real implementations.
export interface AdvanceStaleDeps {
  _timeoutJob: (jobId: string) => Promise<boolean>;
  _findById: (id: string) => Promise<VirtualTryOnJobRecord | null>;
  _deleteAsset: DeleteAssetFn;
}

const defaultAdvanceStaleDeps: AdvanceStaleDeps = {
  _timeoutJob: defaultTimeoutStaleJob,
  _findById: defaultFindJobById,
  _deleteAsset: deleteCloudinaryAsset,
};

export async function advanceFullLookChain(
  ctx: FullLookChainContext,
  deps: WalkChainDeps = { _findJobFn: defaultFindJobByIdempotencyKey },
  staleDeps: AdvanceStaleDeps = defaultAdvanceStaleDeps,
): Promise<ChainAdvanceResult> {
  const jobs = await walkFullLookChainJobs(ctx.customerId, deps, ctx.reservationScope);

  if (jobs.length === 0) {
    return { status: "NOT_STARTED" };
  }

  const lastJob = jobs[jobs.length - 1];
  const lastStepIndex = jobs.length - 1;

  if (lastJob.status === "FAILED" || lastJob.status === "CANCELED" || lastJob.status === "TIMED_OUT") {
    return { status: "FAILED", failedStepIndex: lastStepIndex, errorCode: lastJob.errorCode };
  }

  if (lastJob.status === "COMPLETED" && lastStepIndex === ctx.garments.length - 1) {
    const resultUrl = buildTryOnResultUrl(ctx.customerId, lastJob.id);
    if (!resultUrl) return { status: "SUBMIT_ERROR", reason: "NOT_CONFIGURED" };
    return { status: "COMPLETED", resultUrl };
  }

  // ── QA pause checkpoint — fast path ───────────────────────────────────────
  // The second-to-last step (shirt) is already COMPLETED and the final
  // (blazer) step has never been submitted. Stable on every repeated call —
  // no FASHN status check, no submission — so a refresh, a duplicate poll,
  // or a long gap while the tester reviews the images all land here
  // identically. Cleanup is NOT run here: these are exactly the images the
  // tester needs to see.
  if (lastJob.status === "COMPLETED" && lastStepIndex === ctx.garments.length - 2) {
    if (isAwaitingContinueExpired(lastJob)) {
      await cleanupIntermediateStepResults(ctx.customerId, jobs.map((j) => j.id));
      return { status: "EXPIRED" };
    }
    const intermediates = buildIntermediatePreviews(ctx, jobs);
    if (!intermediates) return { status: "SUBMIT_ERROR", reason: "NOT_CONFIGURED" };
    return { status: "AWAITING_CONTINUE", intermediates };
  }

  const poll = await pollFullLookRealStep(ctx, lastJob, lastStepIndex);

  if (poll.status === "FAILED") {
    await cleanupIntermediateStepResults(ctx.customerId, jobs.slice(0, -1).map((j) => j.id));
    return { status: "FAILED", failedStepIndex: lastStepIndex, errorCode: poll.job.errorCode };
  }
  if (poll.status === "COMPLETED") {
    await cleanupIntermediateStepResults(ctx.customerId, jobs.slice(0, -1).map((j) => j.id));
    return { status: "COMPLETED", resultUrl: poll.resultUrl };
  }
  if (poll.status === "PROCESSING") {
    // Real FASHN check (just above) still reports it in flight — but if
    // this step has sat unchanged since before the same stale threshold
    // reconcileStaleFullLookJobForCustomer uses, stop reporting PROCESSING
    // forever and force the identical atomic TIMED_OUT transition the
    // scheduled sweep and the start-time reconciliation both use. This is
    // what lets a customer recover via a PLAIN REFRESH or "Check Again"
    // (same reservationScope, resumed here) — not only an explicit "Try
    // Again" that computes a brand-new scope and goes through
    // startOrResumeFullLookChain's own reconciliation instead.
    if (Date.now() - lastJob.lastActivityAt.getTime() > STALE_PROCESSING_THRESHOLD_MS) {
      const applied = await tryForceTimeoutAndCleanup(
        lastJob, staleDeps._timeoutJob, staleDeps._findById, staleDeps._deleteAsset,
      );
      if (applied) {
        return { status: "FAILED", failedStepIndex: lastStepIndex, errorCode: "ABANDONED_NO_POLL" };
      }
      // Lost a race — a concurrent real resolution won; report the
      // current (still-PROCESSING, about-to-change-on-the-next-poll)
      // state honestly rather than guessing at its new outcome.
    }
    return { status: "PROCESSING", stepIndex: lastStepIndex };
  }

  // STEP_COMPLETE — this step (poll.job) just finished. If the NEXT step is
  // the final one, STOP here instead of auto-submitting: this is the one
  // moment the chain pauses for explicit human review (continueToFinalStep,
  // below) rather than advancing on its own. Any other step keeps the
  // original immediate-auto-advance behavior.
  const nextIndex = lastStepIndex + 1;
  if (nextIndex === ctx.garments.length - 1) {
    const intermediates = buildIntermediatePreviews(ctx, [...jobs.slice(0, -1), poll.job]);
    if (!intermediates) return { status: "SUBMIT_ERROR", reason: "NOT_CONFIGURED" };
    return { status: "AWAITING_CONTINUE", intermediates };
  }

  const submit = await submitFullLookRealStep(ctx, nextIndex, poll.job.id);
  if (!submit.ok) {
    return { status: "SUBMIT_ERROR", reason: submit.reason };
  }
  return { status: "PROCESSING", stepIndex: nextIndex };
}

// ── Continue past the QA pause checkpoint — the ONLY way the final step is
// ever submitted ─────────────────────────────────────────────────────────────
//
// Re-derives the chain's current position from DB state alone (same
// walkFullLookChainJobs every other entry point uses) rather than trusting
// anything persisted client-side, so this is safe to call from a duplicate
// click, a resubmitted form, or a retried request:
//   - Called while genuinely paused (second-to-last step COMPLETED, final
//     step never submitted): submits the final step exactly once.
//   - Called again after that submission already exists (second click,
//     network retry): submitFullLookRealStep's own createOrFindTryOnJob
//     idempotency finds the existing row and returns alreadySubmitted:true
//     — no new FASHN call.
//   - Called when the chain isn't actually at the pause point (too early,
//     already past it, or never started): fails closed with a reason, no
//     I/O against FASHN at all.
export type ContinueResult =
  | { ok: true }
  | { ok: false; reason: string };

export async function continueToFinalStep(
  ctx: FullLookChainContext,
  deps: WalkChainDeps = { _findJobFn: defaultFindJobByIdempotencyKey },
): Promise<ContinueResult> {
  const jobs = await walkFullLookChainJobs(ctx.customerId, deps, ctx.reservationScope);
  const lastStepIndex = jobs.length - 1;

  if (lastStepIndex !== ctx.garments.length - 2 || jobs[lastStepIndex]?.status !== "COMPLETED") {
    return { ok: false, reason: "not_awaiting_continue" };
  }

  // ── Expired pause — refuse before any FASHN I/O. A session abandoned long
  // enough to expire must never resume billable generation just because a
  // stale tab happened to still have the Continue button rendered. ────────
  if (isAwaitingContinueExpired(jobs[lastStepIndex])) {
    return { ok: false, reason: "continue_window_expired" };
  }

  const submit = await submitFullLookRealStep(ctx, ctx.garments.length - 1, jobs[lastStepIndex].id);
  if (!submit.ok) {
    return { ok: false, reason: submit.reason };
  }
  return { ok: true };
}

// ── Start the chain — called once by the submit action ──────────────────────
//
// Cooldown is checked exactly once, only when nothing has been submitted yet
// — same placement and rationale as poc-job-tracked-full-look-chain.server.ts
// ("Issue 1"): checking it again before a later step would self-block the
// chain on its own just-completed prior step.

export type StartChainResult =
  | { ok: true; stepIndex: number }
  | { ok: false; reason: string };

// [vto-diag] TEMPORARY — the real lookup behind the diagnostic log below,
// factored out so tests can inject a stub instead of hitting real prisma.
// Deliberately replicates checkCustomerCooldown's own query exactly (see
// my-naia-model.server.ts's _findJob) — a second, side-effect-free read of
// the same row, purely to report what it is.
async function defaultFindMostRecentJobForCustomer(customerId: string): Promise<VirtualTryOnJobRecord | null> {
  return prisma.virtualTryOnJob.findFirst({
    where: { customerId },
    orderBy: [{ lastActivityAt: "desc" }, { createdAt: "desc" }, { id: "desc" }],
  }) as Promise<VirtualTryOnJobRecord | null>;
}

export async function startOrResumeFullLookChain(
  ctx: FullLookChainContext,
  deps: WalkChainDeps = { _findJobFn: defaultFindJobByIdempotencyKey },
  // Defaults to the real reconciliation function in production. Tests that
  // don't exercise this path inject a no-op stub instead, so they never
  // touch prisma through it — see this file's own test suite.
  _reconcileStale: (customerId: string) => Promise<ReconcileResult> = reconcileStaleFullLookJobForCustomer,
  // [vto-diag] TEMPORARY — see defaultFindMostRecentJobForCustomer above.
  _findMostRecentJob: (customerId: string) => Promise<VirtualTryOnJobRecord | null> = defaultFindMostRecentJobForCustomer,
): Promise<StartChainResult> {
  // 2026-11-15 — chain length is now per-outfit, between 3 (the original
  // minimum — fewer than 3 real pieces means Full-Look simply isn't offered,
  // same as before) and FULL_LOOK_MAX_GARMENTS (the cost/complexity
  // ceiling, not a FASHN limit — see full-look-handle-constants.ts).
  if (ctx.garments.length < 3 || ctx.garments.length > FULL_LOOK_MAX_GARMENTS) {
    return { ok: false, reason: "invalid_chain_length" };
  }

  const jobs = await walkFullLookChainJobs(ctx.customerId, deps, ctx.reservationScope);

  if (jobs.length > 0) {
    // Chain already started (by this request or an earlier one) — resume,
    // never re-submit step 0. The status loader drives actual progress.
    return { ok: true, stepIndex: jobs.length - 1 };
  }

  // Reconcile this customer's OWN stale Full-Look job (if any) before the
  // cooldown check below might otherwise block a genuinely new attempt on
  // a chain that's actually dead — see reconcileStaleFullLookJobForCustomer's
  // own header comment. A no-op in the common case (no stale job exists).
  const reconcileResult = await _reconcileStale(ctx.customerId);
  // [vto-diag] whether reconciliation found and acted on anything this
  // request, and specifically whether it JUST wrote a fresh TIMED_OUT
  // transition — the one case that could make the cooldown check below
  // see a near-zero-age "most recent job" and reject on COOLDOWN rather
  // than ACTIVE_JOB, within this SAME request.
  console.log("[vto-diag] reconcile", {
    customerHash: shortHash(ctx.customerId),
    reconciled: reconcileResult.reconciled,
    outcome: reconcileResult.outcome ?? null,
  });

  const cooldown = await checkCustomerCooldown(ctx.customerId);
  if (!cooldown.ok) {
    // [vto-diag] one additional READ-ONLY lookup, replicating exactly the
    // query checkCustomerCooldown itself just used internally, purely to
    // report WHICH job it found. No write, no new behavior — the real
    // cooldown decision above is already made; this only explains it.
    const blockingJob = await _findMostRecentJob(ctx.customerId);
    console.log("[vto-diag] cooldown-rejected", {
      customerHash: shortHash(ctx.customerId),
      reason: cooldown.reason,
      blockingJobStatus: blockingJob?.status ?? null,
      blockingJobVtoType: blockingJob ? vtoTypeOf(blockingJob.productHandle) : null,
      blockingJobAgeSeconds: blockingJob ? Math.round((Date.now() - blockingJob.lastActivityAt.getTime()) / 1000) : null,
      blockingJobSameSuggestion: blockingJob ? blockingJob.outfitSuggestionId === ctx.outfitSuggestionId : null,
      reconciledJustNow: reconcileResult.reconciled,
    });
    return { ok: false, reason: cooldown.reason };
  }

  const submit = await submitFullLookRealStep(ctx, 0, null);
  if (!submit.ok) {
    return { ok: false, reason: submit.reason };
  }
  return { ok: true, stepIndex: 0 };
}

// ── Independent cleanup — abandoned pauses no browser will ever revisit ────
//
// Every cleanup path above (advanceFullLookChain's fast path, FAILED/
// COMPLETED transitions) only ever runs when SOME request arrives for THAT
// customer's chain. If the tester closes the tab permanently during the
// pause and never returns, nothing in this file is ever invoked again for
// that chain — this function is the one mechanism that reclaims those
// images without depending on any further customer request, for ANY
// customer, in ANY reservation scope at once.
//
// 2026-11-15 — generalized for variable chain length. The ORIGINAL design
// only ever queried for a job labeled "step2:" (1-based), because for the
// fixed 3-item chain that WAS the one and only position "one step before
// final" could ever be — the position where advanceFullLookChain's own
// AWAITING_CONTINUE pause fires. Now that a chain can have 3-5 garments,
// that position varies by chain (step2 for a 3-item chain, step3 for 4,
// step4 for 5) — a dynamic-length chain abandoned at the pause would be
// invisible to a sweep hardcoded to "step2:" alone.
//
// Finds every COMPLETED job labeled step2 through step{FULL_LOOK_MAX_
// GARMENTS-1} (step1 itself can never be "one before final" for any valid
// chain length ≥3, so it's correctly excluded) that has no NEXT step job
// yet (i.e. never continued — a chain that DID continue, to another
// numbered step OR to "final", is never touched, active or not), and is
// past QA_PAUSE_EXPIRY_MS. For each, cleans up both intermediate images.
// This also naturally covers a chain abandoned one step EARLIER than the
// pause (e.g. a 5-item chain's step3, abandoned instead of self-healing on
// a later poll) — a strict improvement over the original's narrower
// coverage, not a behavior change for anyone it already protected.
//
// Idempotent and safe to call repeatedly or concurrently: an
// already-cleaned chain's assets are simply "not found" on a later sweep
// (deleteCloudinaryAsset treats that as ok — see cleanupIntermediateStepResults),
// and a chain that continued or is still within its active window is never
// touched. No write to any VirtualTryOnJob row happens here — only
// Cloudinary deletes — so there is nothing to race with job-status
// transitions elsewhere.
export interface SweepResult {
  cleanedChains: number;
  skippedActive: number;
  skippedAlreadyAdvanced: number;
}

// Every step label that could ever be "one before final" for SOME valid
// chain length (3..FULL_LOOK_MAX_GARMENTS) — step1 excluded, see header
// comment above.
const PAUSE_ADJACENT_HANDLE_PREFIXES = Array.from(
  { length: FULL_LOOK_MAX_GARMENTS - 2 },
  (_, i) => `${REAL_PRODUCT_HANDLE_PREFIX}:step${i + 2}:`,
);

async function defaultFindCompletedPauseAdjacentJobs(): Promise<VirtualTryOnJobRecord[]> {
  return prisma.virtualTryOnJob.findMany({
    where: {
      OR: PAUSE_ADJACENT_HANDLE_PREFIXES.map((prefix) => ({ productHandle: { startsWith: prefix } })),
      status: "COMPLETED",
    },
  }) as Promise<VirtualTryOnJobRecord[]>;
}

// A step's OWN idempotencyKey already encodes the prior job's id (see
// getFullLookStepIdempotencyKey: `${REAL_STEP_KEY_PREFIX}${priorJobId}:${stepIndex}`)
// — reading it back out avoids a second lookup/join for something this
// module already guarantees is embedded in data we already have.
function parsePriorJobIdFromStepKey(idempotencyKey: string): string | null {
  if (!idempotencyKey.startsWith(REAL_STEP_KEY_PREFIX)) return null;
  const rest = idempotencyKey.slice(REAL_STEP_KEY_PREFIX.length);
  const lastColon = rest.lastIndexOf(":");
  if (lastColon === -1) return null;
  return rest.slice(0, lastColon);
}

// This job's own 0-based step index, read back out of its productHandle
// (e.g. "fulllook-real:step3:Brown Chelsea Boots" -> 2). Used only to
// compute the NEXT step's idempotency key — never to infer this chain's
// total length, which this function has no need to know at all.
function parseStepIndexFromHandle(productHandle: string): number | null {
  const match = /^fulllook-real:step(\d+):/.exec(productHandle);
  if (!match) return null;
  return Number(match[1]) - 1;
}

export async function sweepAbandonedFullLookPauses(
  _findPauseAdjacentJobs: () => Promise<VirtualTryOnJobRecord[]> = defaultFindCompletedPauseAdjacentJobs,
  _findJobFn: (where: { idempotencyKey: string }) => Promise<VirtualTryOnJobRecord | null> = defaultFindJobByIdempotencyKey,
  _deleteAsset: DeleteAssetFn = deleteCloudinaryAsset,
): Promise<SweepResult> {
  const candidateJobs = await _findPauseAdjacentJobs();
  let cleanedChains = 0;
  let skippedActive = 0;
  let skippedAlreadyAdvanced = 0;

  for (const job of candidateJobs) {
    if (!isAwaitingContinueExpired(job)) {
      skippedActive++;
      continue;
    }

    const thisStepIndex = parseStepIndexFromHandle(job.productHandle);
    if (thisStepIndex === null) {
      skippedActive++; // unparseable handle — fail closed, never touch
      continue;
    }

    const nextStepKey = `${REAL_STEP_KEY_PREFIX}${job.id}:${thisStepIndex + 1}`;
    const nextJob = await _findJobFn({ idempotencyKey: nextStepKey });
    if (nextJob) {
      skippedAlreadyAdvanced++; // continued (or in progress) — never touch
      continue;
    }

    const priorJobId = parsePriorJobIdFromStepKey(job.idempotencyKey);
    const jobIds = priorJobId ? [priorJobId, job.id] : [job.id];
    await cleanupIntermediateStepResults(job.customerId, jobIds, _deleteAsset);
    cleanedChains++;
  }

  return { cleanedChains, skippedActive, skippedAlreadyAdvanced };
}

// ── Independent cleanup — a mid-chain step the customer never polled again ──
//
// Distinct from sweepAbandonedFullLookPauses above, which only reclaims the
// AWAITING_CONTINUE checkpoint and never mutates a job's status. This sweep
// targets the OTHER abandonment shape: a step already submitted to FASHN
// (status PROCESSING) whose customer closed the tab and never returned to
// poll. Nothing else in this codebase ever resolves that row — see
// entitlement.server.ts's own "VTO stale-job threshold" comment: quota
// *counting* already excludes a stale job after 10 minutes, but no process
// ever transitions the row itself. Left alone, checkCustomerCooldown's
// ACTIVE_JOB check — which, unlike quota counting, has no staleness
// exception — blocks that customer from starting ANY future VTO (single-item
// or Full-Look) permanently, since a stuck PROCESSING row is "active" to it
// forever.
//
// The transition itself must be a conditional (status-guarded) write, not a
// read-then-blind-write: this sweep's own read of "status is PROCESSING"
// can go stale if a real poll resolves the SAME job in the gap before this
// sweep's update executes, and blindly overwriting that outcome back to
// TIMED_OUT would silently hide a genuinely completed outfit from the
// customer. createOrFindTryOnJob's Serializable transaction already applies
// this same atomic check+write principle to this exact table for job
// creation; this reuses it for the transition path instead of a plain
// advanceTryOnJob() read-then-write, whose single existing caller never
// runs concurrently with another writer of the same row the way a sweep
// does. Scoped to Full-Look jobs only (productHandle prefix) — single-item
// VTO jobs have the identical underlying exposure but a fix for that cooldown
// check's own staleness window, if needed, is outside the Full-Look chain
// this module owns.
export interface StaleStepSweepResult {
  timedOut: number;
  skippedRace: number; // a real poll resolved the job first — conditional update found 0 rows
}

// Matches entitlement.server.ts's own documented 10-minute VTO stale-job
// threshold ("exceeds the client polling window (~2 min) and FASHN's
// expected processing time by a safe margin") — same number, same rationale,
// applied here to actually resolve the row instead of merely excluding it
// from a count.
export const STALE_PROCESSING_THRESHOLD_MS = 10 * 60 * 1000;

async function defaultFindStaleFullLookProcessingJobs(thresholdMs: number): Promise<VirtualTryOnJobRecord[]> {
  return prisma.virtualTryOnJob.findMany({
    where: {
      productHandle: { startsWith: `${REAL_PRODUCT_HANDLE_PREFIX}:` },
      status: "PROCESSING",
      lastActivityAt: { lt: new Date(Date.now() - thresholdMs) },
    },
  }) as Promise<VirtualTryOnJobRecord[]>;
}

// Walks the idempotencyKey chain backward from a stale step to every earlier
// step in the SAME chain — bounded by FULL_LOOK_MAX_GARMENTS, no new index or
// query shape needed. Each earlier step, if it reached COMPLETED, already
// has an uploaded intermediate image that advanceFullLookChain's own cleanup
// will now never run (that cleanup only fires from the COMPLETED/FAILED
// terminal branches, and this chain can no longer reach either on its own).
async function collectAncestorStepJobIds(
  job: VirtualTryOnJobRecord,
  _findById: (id: string) => Promise<VirtualTryOnJobRecord | null>,
): Promise<string[]> {
  const ids: string[] = [];
  let priorId = parsePriorJobIdFromStepKey(job.idempotencyKey);
  let guard = 0;
  while (priorId && guard < FULL_LOOK_MAX_GARMENTS) {
    ids.unshift(priorId);
    const prior = await _findById(priorId);
    if (!prior) break;
    priorId = parsePriorJobIdFromStepKey(prior.idempotencyKey);
    guard++;
  }
  return ids;
}

async function defaultFindJobById(id: string): Promise<VirtualTryOnJobRecord | null> {
  return prisma.virtualTryOnJob.findUnique({ where: { id } }) as Promise<VirtualTryOnJobRecord | null>;
}

// Atomic, status-guarded transition: only applies (and only returns true)
// if the row is STILL "PROCESSING" at write time. A concurrent real poll
// that already moved it to COMPLETED/FAILED makes this a no-op — see this
// sweep's own header comment for why a plain read-then-write is unsafe here.
async function defaultTimeoutStaleJob(jobId: string): Promise<boolean> {
  const result = await prisma.virtualTryOnJob.updateMany({
    where: { id: jobId, status: "PROCESSING" },
    data: {
      status: "TIMED_OUT",
      errorCode: "ABANDONED_NO_POLL",
      completedAt: new Date(),
      lastActivityAt: new Date(),
    },
  });
  return result.count === 1;
}

// Shared by sweepStaleFullLookSteps's loop (inlined there, unchanged),
// reconcileStaleFullLookJobForCustomer, and advanceFullLookChain's own
// staleness check below: atomically transition one job to TIMED_OUT and,
// only if that transition actually applied, clean up every earlier step's
// now-orphaned intermediate image. Returns false on a lost race (a real
// poll already resolved the job) — the caller must leave that outcome
// untouched, never overwrite it.
async function tryForceTimeoutAndCleanup(
  job: VirtualTryOnJobRecord,
  _timeoutJob: (jobId: string) => Promise<boolean>,
  _findById: (id: string) => Promise<VirtualTryOnJobRecord | null>,
  _deleteAsset: DeleteAssetFn,
): Promise<boolean> {
  const applied = await _timeoutJob(job.id);
  if (!applied) return false;
  const ancestorIds = await collectAncestorStepJobIds(job, _findById);
  if (ancestorIds.length > 0) {
    await cleanupIntermediateStepResults(job.customerId, ancestorIds, _deleteAsset);
  }
  return true;
}

export async function sweepStaleFullLookSteps(
  thresholdMs: number = STALE_PROCESSING_THRESHOLD_MS,
  _findStaleJobs: (thresholdMs: number) => Promise<VirtualTryOnJobRecord[]> = defaultFindStaleFullLookProcessingJobs,
  _findById: (id: string) => Promise<VirtualTryOnJobRecord | null> = defaultFindJobById,
  _timeoutJob: (jobId: string) => Promise<boolean> = defaultTimeoutStaleJob,
  _deleteAsset: DeleteAssetFn = deleteCloudinaryAsset,
): Promise<StaleStepSweepResult> {
  const staleJobs = await _findStaleJobs(thresholdMs);
  let timedOut = 0;
  let skippedRace = 0;

  for (const job of staleJobs) {
    const applied = await _timeoutJob(job.id);
    if (!applied) {
      // A real poll resolved this job between the find and this update —
      // a genuine race, not an error. Leave it exactly as that poll left it.
      skippedRace++;
      continue;
    }
    timedOut++;

    const ancestorIds = await collectAncestorStepJobIds(job, _findById);
    if (ancestorIds.length > 0) {
      await cleanupIntermediateStepResults(job.customerId, ancestorIds, _deleteAsset);
    }
  }

  return { timedOut, skippedRace };
}

// ── Per-customer reconciliation — runs INLINE on the request path, not on a
// schedule ───────────────────────────────────────────────────────────────────
//
// sweepStaleFullLookSteps (above) is a scheduled backstop: it cannot be
// relied on to run promptly (GitHub Actions does not guarantee a
// sub-hourly `schedule` trigger fires anywhere near its configured cron —
// observed in production as runs every 5-8 hours against a "*/10 * * * *"
// schedule, not a reliability bug in this repo's config but a documented
// limitation of GitHub's own scheduler under load). A customer should
// never be blocked waiting on that backstop's next, unpredictable run.
//
// This function is called from startOrResumeFullLookChain, synchronously,
// before the cooldown check that would otherwise reject a brand-new chain
// because of an OLD, never-resolved job. Unlike the sweep, it does not
// assume a stale job is dead — "reconcile before blocking," not "ignore if
// old": it gives FASHN one real status check (the exact same read-only
// GET pollFullLookRealStep already issues on every normal poll, never a
// new submission) to find out what actually happened, and only forces a
// terminal TIMED_OUT state if FASHN still reports it in flight. A
// genuinely fresh, still-active job (younger than the threshold) is left
// completely untouched, so checkCustomerCooldown's existing "only one
// generation at a time" protection is unaffected for real concurrent
// attempts.
//
// Scoped to this customer's own Full-Look jobs only (productHandle prefix
// "fulllook-real:") — a stale SINGLE-ITEM VTO job is never found or acted
// on here, so that feature's cooldown behavior is unchanged by this
// function's existence.
export interface ReconcileResult {
  reconciled: boolean; // true only if a stale job was found AND acted on
  outcome?: "COMPLETED" | "STEP_COMPLETE" | "FAILED" | "TIMED_OUT";
}

async function defaultFindActiveFullLookJobForCustomer(customerId: string): Promise<VirtualTryOnJobRecord | null> {
  return prisma.virtualTryOnJob.findFirst({
    where: {
      customerId,
      productHandle: { startsWith: `${REAL_PRODUCT_HANDLE_PREFIX}:` },
      status: "PROCESSING",
    },
    orderBy: { lastActivityAt: "desc" },
  }) as Promise<VirtualTryOnJobRecord | null>;
}

// pollFullLookRealStep only ever reads ctx.garments.length to decide FINAL
// vs intermediate (to pick uploadTryOnResult vs uploadIntermediateStepResult,
// and whether to build a customer-facing resultUrl) — it never reads a
// garment's label or image. Reconciliation already knows which role this
// job itself has (its own productHandle says "final" or "stepN" — see
// full-look-handle-constants.ts), so it can encode just that one fact as a
// minimal synthetic context instead of re-deriving the real outfit
// (re-fetching the suggestion, Cloudinary config, and naiaModel) — which
// would also require importing back from full-look-vto-orchestrator.server.ts,
// the module that already imports FROM this one, creating a cycle. stepIndex
// is fixed at 0; garments.length is set to 1 (final) or 2 (not final) so
// `stepIndex === ctx.garments.length - 1` evaluates to exactly the role this
// job already has, regardless of its real position in a 3-5 step chain.
function buildReconciliationCtx(job: VirtualTryOnJobRecord): FullLookChainContext {
  const isFinal = job.productHandle.startsWith(FULL_LOOK_FINAL_STEP_HANDLE_PREFIX);
  return {
    customerId: job.customerId,
    naiaModelId: null,
    bodyPublicId: null,
    bodyFormat: null,
    deliveryType: "private",
    garments: Array.from({ length: isFinal ? 1 : 2 }, () => ({ label: "", productImageUrl: "" })),
    consent: { virtualTryOnConsent: true, policyVersion: "reconciliation", consentedAt: new Date().toISOString() },
    outfitSuggestionId: job.outfitSuggestionId ?? "",
  };
}

export async function reconcileStaleFullLookJobForCustomer(
  customerId: string,
  thresholdMs: number = STALE_PROCESSING_THRESHOLD_MS,
  _findActiveJob: (customerId: string) => Promise<VirtualTryOnJobRecord | null> = defaultFindActiveFullLookJobForCustomer,
  _pollStep: (ctx: FullLookChainContext, job: VirtualTryOnJobRecord, stepIndex: number) => Promise<PollStepResult> = pollFullLookRealStep,
  _timeoutJob: (jobId: string) => Promise<boolean> = defaultTimeoutStaleJob,
  _findById: (id: string) => Promise<VirtualTryOnJobRecord | null> = defaultFindJobById,
  _deleteAsset: DeleteAssetFn = deleteCloudinaryAsset,
): Promise<ReconcileResult> {
  const job = await _findActiveJob(customerId);
  if (!job) return { reconciled: false };

  const ageMs = Date.now() - job.lastActivityAt.getTime();
  if (ageMs < thresholdMs) {
    // Genuinely in-flight, not stale — leave it exactly as it is so
    // checkCustomerCooldown's own ACTIVE_JOB rejection still correctly
    // blocks a second concurrent generation for this customer.
    return { reconciled: false };
  }

  // Stale by age alone — give FASHN one real, final chance to report what
  // actually happened before assuming it's dead. Same category of call as
  // any normal poll: read-only, free, never a new submission.
  const poll = await _pollStep(buildReconciliationCtx(job), job, 0);

  if (poll.status === "COMPLETED") return { reconciled: true, outcome: "COMPLETED" };
  if (poll.status === "STEP_COMPLETE") return { reconciled: true, outcome: "STEP_COMPLETE" };
  if (poll.status === "FAILED") return { reconciled: true, outcome: "FAILED" };

  // Still genuinely PROCESSING after a real check, and already past the
  // threshold — force the same atomic, status-guarded transition
  // sweepStaleFullLookSteps uses, so a race against a real poll resolving
  // this same job in the gap can never silently overwrite a true outcome.
  const applied = await tryForceTimeoutAndCleanup(job, _timeoutJob, _findById, _deleteAsset);
  if (!applied) return { reconciled: false }; // a real poll won the race — leave its outcome untouched.

  return { reconciled: true, outcome: "TIMED_OUT" };
}
